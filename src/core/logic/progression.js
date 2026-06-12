/**
 * ══════════════════════════════════════════════════════
 *  Progression Engine
 *  src/core/logic/progression.js
 * ══════════════════════════════════════════════════════
 *
 * Pure functions — zero side-effects, no DOM, no imports.
 * All inputs are passed in; all outputs are plain values.
 *
 * ## What this system does
 *   Tracks per-exercise strength via EMA of Epley e1RM (top-set),
 *   models fatigue with continuous-time exponential decay, and
 *   recommends a next working weight using a proportional controller
 *   targeting the Epley-inverse weight for the prescribed rep scheme.
 *   A multi-factor risk gate suppresses upward progression when
 *   stress indicators are simultaneously elevated.
 *
 * ## State (persisted between sessions)
 *   T   — strength estimate (EMA of top-set e1RM, lbs)
 *   F   — fatigue state (dimensionless, exponential integrator)
 *   Δw  — exercise-specific progression step (lbs)
 *
 * ## Per-session observations
 *   E_t — top-set e1RM: trimmed top-2 mean of Epley e1RM across
 *         completed sets. Resists single-outlier inflation while
 *         reflecting top-end performance. Bootstrap estimator —
 *         acceptable but not a strong estimator in dirty sessions.
 *   V_t — total volume Σ(w × r) across completed sets (lbs)
 *   w_t — working weight: weight from the top-performing set
 *
 * ## Update rules
 *   T_{t+1}  = (1 - η)T_t + η·E_t             (EMA, η=0.2)
 *   φ_t      = V_eff / V_norm                  (normalized volume)
 *   V_eff    = V_t × (1 + effort_factor)        (heuristic RIR scaling)
 *   F_{t+1}  = α·φ_t + (1-α)·e^(-λ·Δt)·F_t    (continuous decay)
 *
 * ## Controller
 *   T_working = T / (1 + r_target/30)           (Epley inverse)
 *   R_t       = T_working × (1 - s_pct · F_t)   (proportional fatigue)
 *   u_t       = k·(R_t - w_t) - λ_pen·max(0, F_t - F*)
 *   w_{t+1}   = Δw × round((w_t + clamp(u_t)) / Δw)
 *
 * ## Risk gate
 *   Risk_t = a·|Δ%| + b·max(0,ΔF) + c·1/(RIR+1) + d·density_norm + e·riskMul + f·max(0,F-F*)
 *   if Risk_t > threshold and Δ% > 0 → suppress upward progression
 *
 * ## Deload detection
 *   Multi-signal, exercise-local: if ≥2 of 3 signals (e1RM drop, volume
 *   drop, top weight drop) agree, use reduced learning rate η/4 instead
 *   of standard η. Deloads contain information — low-intensity, not none.
 */

// ── Default Hyperparameters ───────────────────────────────────────────────────

const DEFAULTS = {
  η:           0.2,    // EMA learning rate for strength (dimensionless, [0,1])
  η_deload:    0.05,   // reduced learning rate during detected deloads (η/4)
  α:           0.5,    // fatigue accumulation rate (dimensionless)
  s_pct:       0.05,   // fatigue sensitivity on readiness (proportional, 5% per unit F)
  k:           0.4,    // proportional gain on control signal (dimensionless)
  λ:           0.3,    // fatigue penalty coefficient on control signal (lbs per unit F above F*)
  Fstar:       0.6,    // fatigue threshold above which λ penalty applies (dimensionless)
  Vnorm:       1500,   // volume normaliser (lbs, ~typical per-exercise session volume)
  riskThresh:  0.65,   // risk threshold above which progression is suppressed
  defaultDw:   2.5,    // default progression step (lbs) if not yet set

  // ── Risk scoring coefficients ───────────────────────────────────────────
  // Weights for each risk factor in computeRisk().
  // Kept here (not inside the function) so they're tunable alongside other params.
  // NOTE: coefficients sum to 1.0. Risk stays in [0, ~1] when all inputs
  // are bounded — which they now are (density is saturated, all others are
  // naturally bounded or clamped).
  riskCoeffs: {
    a: 0.25,   // weight change magnitude |Δ%|
    b: 0.15,   // fatigue accumulation delta (max(0, ΔF))
    c: 0.20,   // effort contribution (1/(avgRIR+1))
    d: 0.10,   // volume density (saturated, [0,1))
    e: 0.05,   // per-exercise risk multiplier
    f: 0.25,   // absolute fatigue above Fstar (chronic load term)
  },
};

// ── Continuous fatigue decay constant ─────────────────────────────────────────
// Derived from γ=0.85 per 24 hours: λ_decay = -ln(0.85)/24 ≈ 0.00677/hr.
// This gives 15% decay per day, ~93% decay after 14 days.
// Works for any schedule: same-day sessions, half-days, multi-week layoffs.
const DECAY_LAMBDA = -Math.log(0.85) / 24;  // ≈ 0.00677 per hour

// ── Density saturation constant ──────────────────────────────────────────────
// Bootstrap value — not empirically grounded. Tunable placeholder.
// At K=80 lbs/min: density=40 → 0.33, density=80 → 0.50, density=160 → 0.67.
const DENSITY_K = 80;  // lbs/min saturation half-point

// ── Observation Layer ─────────────────────────────────────────────────────────

/**
 * Return the ROM quality factor for a given range-of-motion tag.
 * A factor < 1.0 discounts the effective e1RM / volume for partial or
 * compromised movements. All current sets are logged as 'full', so this
 * always returns 1.0 in practice — the helper is a documented hook for
 * when a ROM UI input is added.
 *
 * @param {string} [rom]  'full' | 'partial' | 'restricted' | 'cheat' | 'shortened'
 * @returns {number}      multiplicative factor ∈ (0, 1]
 */
function getRomFactor(rom) {
  if (rom === 'partial')    return 0.80;
  if (rom === 'restricted') return 0.80;
  if (rom === 'cheat')      return 0.85;
  if (rom === 'shortened')  return 0.90;
  return 1.0; // 'full' or unset
}

/**
 * Compute per-set Epley e1RM.
 * Valid for ~1-12 reps. Degrades above ~15 reps.
 *
 * @param {number} w  weight (lbs, > 0)
 * @param {number} r  reps (> 0)
 * @returns {number|null}  estimated 1RM in lbs, or null if inputs invalid
 */
export function epleyE1RM(w, r) {
  if (!w || !r || w <= 0 || r <= 0) return null;
  return w * (1 + r / 30);
}

/**
 * Epley inverse: the weight at which you'd perform `reps` repetitions
 * given a 1RM estimate of `T`.
 *
 *   e1RM = w × (1 + r/30)  →  w = e1RM / (1 + r/30)
 *
 * For single-rep work (reps ≤ 0 or null): target = T (identity).
 *
 * @param {number} T           strength estimate / e1RM (lbs)
 * @param {number} targetReps  prescribed rep count
 * @returns {number}           working weight (lbs)
 */
export function workingTarget(T, targetReps) {
  if (!targetReps || targetReps <= 0) return T;
  return T / (1 + targetReps / 30);
}

/**
 * Derive session observations from a set array.
 * Ignores failed sets and sets with missing data.
 *
 * E_t uses trimmed top-2 mean of per-set e1RM:
 *   - Resists single-outlier inflation (vs raw max)
 *   - Reflects top-end performance, not diluted by warm-ups (vs flat mean)
 *   - For straight sets, top-2 = any individual set (correct)
 *   - Bootstrap estimator. A trimmed median of top-3 or winsorized top-k
 *     would be more robust in dirty sessions. Acceptable for now.
 *
 * w_t uses the weight from the top-performing set (highest e1RM), not
 * the mean across all sets. Fixes conservative drift for pyramid/ramp schemes.
 *
 * @param {Array<{s:string, w:number|null, r:number|null, rom?:string}>} sets
 * @returns {{ E_t: number|null, V_t: number, topWeight: number|null }}
 *   E_t       — trimmed top-2 mean e1RM (lbs), null if no data
 *   V_t       — total volume Σ(w × r) (lbs)
 *   topWeight — weight from the set with highest e1RM (lbs), null if no data
 */
export function computeObservations(sets) {
  const done = (sets || []).filter(s => s.s === 'done' && s.w !== null && s.r !== null);
  if (!done.length) return { E_t: null, V_t: 0, topWeight: null };

  // Compute per-set e1RM with ROM discount
  const setE1rms = done.map(s => {
    const baseE1rm = epleyE1RM(s.w, s.r);
    if (baseE1rm === null) return { e1rm: null, w: s.w };
    return { e1rm: baseE1rm * getRomFactor(s.rom), w: s.w };
  }).filter(x => x.e1rm !== null);

  if (!setE1rms.length) return { E_t: null, V_t: 0, topWeight: null };

  // Trimmed top-2 mean (bootstrap estimator)
  const sortedDesc = [...setE1rms].sort((a, b) => b.e1rm - a.e1rm);
  const k = Math.min(2, sortedDesc.length);
  const topK = sortedDesc.slice(0, k);
  const E_t = topK.reduce((sum, x) => sum + x.e1rm, 0) / k;

  // Top weight: from the set with highest e1RM
  const topWeight = sortedDesc[0].w;

  const V_t = done.reduce((sum, s) => sum + s.w * s.r * getRomFactor(s.rom), 0);

  return { E_t, V_t, topWeight };
}

// ── Effort-scaled volume (heuristic) ──────────────────────────────────────────

/**
 * HEURISTIC: scale session volume by effort proximity (RIR).
 *
 * Rationale: a set at RIR 0 is more fatiguing than RIR 3 at the same
 * weight × reps, but the relationship is not linear or universal across
 * exercises, tempos, or individuals. This is a directional correction,
 * not a calibrated physiological mapping.
 *
 * effort_factor = 0.1 × max(0, min(3, 3 - avgRIR))
 *   RIR 0 → +30% volume, RIR 1 → +20%, RIR 2 → +10%, RIR 3+ → +0%
 *
 * @param {number} V_t     raw session volume (lbs)
 * @param {number|null} avgRIR  mean RIR across completed sets
 * @returns {number}       effort-scaled volume (lbs)
 */
function effortScaledVolume(V_t, avgRIR) {
  if (avgRIR === null || avgRIR < 0) return V_t;
  const effortFactor = 0.1 * Math.max(0, Math.min(3, 3 - avgRIR));
  return V_t * (1 + effortFactor);
}

// ── Strength Update ───────────────────────────────────────────────────────────

/**
 * EMA update for strength estimate T.
 *
 * @param {number|null} T      previous strength estimate (lbs; null → bootstrap from E_t)
 * @param {number|null} E_t    current session top-set e1RM (lbs)
 * @param {number}      η      learning rate ∈ [0,1]
 * @returns {number|null}      updated T (lbs), or null if no data ever
 */
export function updateStrength(T, E_t, η = DEFAULTS.η) {
  if (E_t === null) return T;          // no data this session — keep prior
  if (T === null)   return E_t;        // first session — bootstrap
  return (1 - η) * T + η * E_t;
}

// ── Fatigue Update ────────────────────────────────────────────────────────────

/**
 * Fatigue integrator with continuous time decay and effort scaling.
 *
 * Decay uses e^(-λ·Δt) where Δt is hours since last session:
 *   - 1 day  → decay ≈ 0.85 (matches legacy γ=0.85 per day)
 *   - 3 days → decay ≈ 0.61
 *   - 7 days → decay ≈ 0.26
 *   - 14 days → decay ≈ 0.07 (93% recovery — realistic for two weeks off)
 *   - Same-day (2h) → decay ≈ 0.99 (minimal, correct)
 *
 * @param {number} F             previous fatigue state (dimensionless, ≥ 0)
 * @param {number} V_t           raw session volume (lbs)
 * @param {number} hoursElapsed  hours since last session for this exercise
 * @param {number|null} avgRIR   mean RIR across completed sets (null → no scaling)
 * @param {number} α             accumulation rate ∈ [0,1]
 * @param {number} Vnorm         volume normaliser (lbs)
 * @returns {number}             next fatigue state (dimensionless, ≥ 0)
 */
export function updateFatigue(F = 0, V_t = 0, hoursElapsed = 24, avgRIR = null, α = DEFAULTS.α, Vnorm = DEFAULTS.Vnorm) {
  const V_eff = effortScaledVolume(V_t, avgRIR);
  const φ_t = V_eff / Math.max(Vnorm, 1);
  const decay = Math.exp(-DECAY_LAMBDA * Math.max(0, hoursElapsed));
  return α * φ_t + (1 - α) * decay * F;
}

// ── Readiness ─────────────────────────────────────────────────────────────────

/**
 * Compute readiness: working target scaled down by proportional fatigue.
 *
 * Unlike the legacy additive form (T - s·F) which produced sub-pound
 * adjustments, this scales with the weight being recommended:
 *   At F=1.0, s_pct=0.05: 5% reduction ≈ 9.6 lbs on a 192 lb target.
 *
 * @param {number} T_working  Epley-inverse working target (lbs)
 * @param {number} F          fatigue state (dimensionless)
 * @param {number} s_pct      fatigue sensitivity ∈ [0,1], proportion per unit F
 * @returns {number}          readiness-adjusted target (lbs)
 */
export function readiness(T_working, F, s_pct = DEFAULTS.s_pct) {
  return T_working * (1 - s_pct * F);
}

// ── Control Signal ────────────────────────────────────────────────────────────

/**
 * Proportional feedback control signal.
 *
 * u = k·(R_t - w_t) - λ·max(0, F_t - F*)
 *
 * The λ term is retained as a short-term overload correction, pending
 * verification that the new proportional readiness path makes it redundant.
 * Removing it simultaneously with changing readiness would create a
 * confounded test.
 *
 * @param {number} R_t   readiness-adjusted target (lbs)
 * @param {number} w_t   current working weight (lbs)
 * @param {number} k     proportional gain (dimensionless)
 * @param {number} F_t   current fatigue (dimensionless)
 * @param {number} λ     fatigue penalty coefficient (lbs per unit F)
 * @param {number} Fstar fatigue threshold (dimensionless)
 * @returns {number}      control signal (lbs, positive = increase weight)
 */
export function controlSignal(R_t, w_t, k = DEFAULTS.k, F_t = 0, λ = DEFAULTS.λ, Fstar = DEFAULTS.Fstar) {
  let u = k * (R_t - w_t);
  u -= λ * Math.max(0, F_t - Fstar);
  return u;
}

// ── Discretization ────────────────────────────────────────────────────────────

/**
 * Round the continuous weight target to the nearest progression step.
 *
 * @param {number} w_t   current working weight (lbs)
 * @param {number} u_t   control signal (lbs)
 * @param {number} dw    progression step (lbs, > 0)
 * @returns {number}     next recommended weight (lbs, ≥ 0)
 */
export function discretize(w_t, u_t, dw) {
  const step = Math.max(dw, 0.5);
  return Math.max(0, step * Math.round((w_t + u_t) / step));
}

// ── Density Normalization ─────────────────────────────────────────────────────

/**
 * Saturating density transform: density / (density + K).
 * Bounded ∈ [0, 1), monotonic, smooth — no threshold cliff.
 *
 * K is a bootstrap constant (not empirically grounded). Can be replaced
 * with user-relative percentile normalization without changing the interface.
 *
 * @param {number|null} density  raw density (lbs/min), null → 0
 * @returns {number}             normalized density ∈ [0, 1)
 */
function normalizeDensity(density) {
  if (density === null || density <= 0) return 0;
  return density / (density + DENSITY_K);
}

// ── Deload Detection ──────────────────────────────────────────────────────────

/**
 * Multi-signal deload detector, exercise-local.
 *
 * Requires ≥ 2 of 3 signals to agree before classifying as deload.
 * Any single signal alone is too brittle (warm-up-heavy sessions,
 * exercise mix changes, low volume for non-deload reasons).
 *
 * When deload is detected, the caller uses a reduced learning rate (η/4)
 * instead of freezing T. Deloads contain information — lower-intensity
 * information, not no information.
 *
 * @param {number|null} topE1RM       current session top-set e1RM (lbs)
 * @param {number|null} T_prev        previous strength estimate (lbs)
 * @param {number}      V_t           current session volume for this exercise (lbs)
 * @param {number}      Vnorm         typical session volume (lbs)
 * @param {number|null} topWeight     current session top working weight (lbs)
 * @param {number|null} lastTopWeight previous session top working weight (lbs)
 * @returns {boolean}                 true if session is likely a deliberate deload
 */
function isLikelyDeload(topE1RM, T_prev, V_t, Vnorm, topWeight, lastTopWeight) {
  const signals = [];

  // Signal 1: top-set e1RM dropped significantly from estimated capacity
  if (T_prev !== null && topE1RM !== null) {
    signals.push(topE1RM < T_prev * 0.75);
  }

  // Signal 2: session volume is well below typical
  if (Vnorm > 0) {
    signals.push(V_t < Vnorm * 0.5);
  }

  // Signal 3: top working weight dropped significantly from last session
  if (lastTopWeight && topWeight) {
    signals.push(topWeight < lastTopWeight * 0.70);
  }

  const trueCount = signals.filter(Boolean).length;
  return signals.length >= 2 && trueCount >= 2;
}

// ── Risk Layer ────────────────────────────────────────────────────────────────

/**
 * Compute risk score for an upward progression step.
 *
 * Parameters:
 *   deltaPct       — |Δw / w_t| (fractional weight change magnitude)
 *   deltaF         — F_t − F_{t−1} (fatigue change; only positive accumulation penalised)
 *   F_t            — absolute post-session fatigue state (chronic load term, dimensionless)
 *   avgRIR         — mean RIR this session (null → treated as low effort)
 *   density        — already normalized via normalizeDensity(), ∈ [0,1)
 *   riskMultiplier — per-exercise injury risk factor × deltaW scaling (≥ 1.0)
 *
 * Coefficients (sum = 1.0):
 *   a=0.25  weight change magnitude |Δ%|
 *   b=0.15  fatigue accumulation delta (max(0, ΔF))
 *   c=0.20  effort contribution (1/(avgRIR+1))
 *   d=0.10  volume density (saturated ∈ [0,1))
 *   e=0.05  per-exercise risk multiplier
 *   f=0.25  absolute fatigue above Fstar (chronic load)
 *
 * Why the f-term matters:
 *   When an athlete carries high chronic fatigue (F > Fstar) and trains again,
 *   F_next can be slightly lower than F_prev (decay > accumulation), making
 *   deltaF < 0. Without f, max(0, deltaF) = 0 and the high fatigue state is
 *   invisible to risk. The f-term ensures chronic high-load athletes are still
 *   risk-penalised.
 *
 * @returns {number}  Risk_t ∈ [0, ~1]; values > 0.65 suppress progression
 */
export function computeRisk({ deltaPct = 0, deltaF = 0, F_t = 0, avgRIR = null, density = 0, riskMultiplier = 1.0 } = {}) {
  const { a, b, c, d: dCoeff, e, f } = DEFAULTS.riskCoeffs;
  const effortContribution = avgRIR !== null ? c * (1 / (avgRIR + 1)) : 0;
  const chronicFatigueLoad = f * Math.max(0, F_t - DEFAULTS.Fstar);

  return (
    a * Math.abs(deltaPct) +
    b * Math.max(0, deltaF) +
    effortContribution +
    dCoeff * density +      // density is already normalized [0,1) by caller
    e * riskMultiplier +
    chronicFatigueLoad
  );
}

// ── Full Session Update ───────────────────────────────────────────────────────

/**
 * Process one completed session for an exercise and return the next
 * progression state and recommended weight.
 *
 * @param {object} prev   Previous progression state: { T, F, dw, lastTopWeight }
 * @param {object[]} sets Completed sets for this exercise this session
 * @param {object} [opts] Options:
 *   - deltaW        {number}      exercise-specific step (lbs)
 *   - targetReps    {number}      center-of-range rep anchor for working target
 *   - hoursElapsed  {number}      hours since last session (default 24 = bootstrapped prior)
 *   - density       {number|null} raw density (lbs/min), will be normalized internally
 *   - riskMultiplier {number}     per-exercise risk factor (default 1.0)
 * @returns {{
 *   T:              number|null,  // updated strength estimate (lbs)
 *   F:              number,       // updated fatigue state (dimensionless)
 *   dw:             number,       // progression step (lbs, unchanged)
 *   suggestedWeight: number|null, // recommended next working weight (lbs)
 *   topWeight:      number|null,  // top set weight this session (lbs)
 *   riskScore:      number,       // computed risk score ∈ [0, ~1]
 *   suppressed:     boolean       // true if progression was risk-gated
 * }}
 */
export function updateProgressionState(prev = {}, sets = [], opts = {}) {
  const T_prev  = prev.T  ?? null;
  const F_prev  = prev.F  ?? 0;
  const lastTopWeight = prev.lastTopWeight ?? null;

  // deltaW: from exercise definition → persisted state → global default
  const dw = opts.deltaW ?? prev.dw ?? DEFAULTS.defaultDw;

  // Target reps: center-of-range anchor from exercise definition
  const targetReps = opts.targetReps ?? 8;

  // Hours since last session (bootstrapped prior: 24h on first session — not neutral, labeled)
  const hoursElapsed = opts.hoursElapsed ?? 24;

  const { E_t, V_t, topWeight } = computeObservations(sets);

  // Compute avgRIR for fatigue scaling and risk
  const avgRIR = (() => {
    const rirSets = (sets || []).filter(s => s.s === 'done' && s.rir !== null && s.rir >= 0);
    if (!rirSets.length) return null;
    return rirSets.reduce((n, s) => n + s.rir, 0) / rirSets.length;
  })();

  // ── Deload detection (exercise-local, multi-signal) ────────────────────
  const deload = isLikelyDeload(E_t, T_prev, V_t, DEFAULTS.Vnorm, topWeight, lastTopWeight);
  const η_effective = deload ? DEFAULTS.η_deload : DEFAULTS.η;

  // ── State updates ──────────────────────────────────────────────────────
  const T_next = updateStrength(T_prev, E_t, η_effective);
  const F_next = updateFatigue(F_prev, V_t, hoursElapsed, avgRIR);

  if (T_next === null) {
    // Insufficient data — return updated fatigue but no weight suggestion
    return { T: null, F: F_next, dw, suggestedWeight: null, topWeight, riskScore: 0, suppressed: false };
  }

  // ── Controller ─────────────────────────────────────────────────────────
  // Working weight from the top-performing set (not mean across all sets)
  const doneSets = (sets || []).filter(s => s.s === 'done' && s.w !== null);
  const w_t = topWeight ?? (doneSets.length
    ? doneSets.reduce((n, s) => n + s.w, 0) / doneSets.length
    : workingTarget(T_next, targetReps));

  const T_working = workingTarget(T_next, targetReps);
  const R_t = readiness(T_working, F_next);
  const u_raw = controlSignal(R_t, w_t, DEFAULTS.k, F_next);

  // Per-session step cap: clamp u to ±2×dw so that large gaps don't produce
  // multi-plate jumps in a single session.
  const uCap = 2 * dw;
  const u_t  = Math.max(-uCap, Math.min(uCap, u_raw));

  const w_next_continuous = w_t + u_t;

  // ── Risk assessment ────────────────────────────────────────────────────
  const deltaPct = w_t > 0 ? (w_next_continuous - w_t) / w_t : 0;
  const deltaF   = F_next - F_prev;

  // Risk scales with relative deltaW — larger step = bigger jump = more evidence needed
  const relativeDeltaW  = w_t > 0 ? dw / w_t : 0;
  const dwRiskScale     = 1.0 + Math.min(relativeDeltaW, 1.0); // [1.0, 2.0]
  const effectiveRiskMultiplier = (opts.riskMultiplier ?? 1.0) * dwRiskScale;

  const riskScore = computeRisk({
    deltaPct,
    deltaF,
    F_t: F_next,
    avgRIR,
    density: normalizeDensity(opts.density ?? null),
    riskMultiplier: effectiveRiskMultiplier
  });

  const suppressed = deltaPct > 0 && riskScore > DEFAULTS.riskThresh;

  // If progression is suppressed, allow only downward movement
  const effectiveU = suppressed ? Math.min(0, u_t) : u_t;
  const suggestedWeight = +discretize(w_t, effectiveU, dw).toFixed(1);

  return {
    T: +T_next.toFixed(2),
    F: +F_next.toFixed(4),
    dw,
    suggestedWeight,
    topWeight: topWeight ?? null,
    riskScore: +riskScore.toFixed(3),
    suppressed
  };
}

// ── Fatigue Index (diagnostic) ────────────────────────────────────────────────

/**
 * Compute per-exercise intra-session fatigue index from a set array.
 *
 * Fatigue Index = 1 − (Last Set Performance / First Set Performance)
 * Performance = weight × reps × ROM factor.
 *
 * This is a diagnostic function — it returns a plausible fatigue metric
 * but does NOT feed into the progression state or control signal.
 * It can be displayed in the UI for user awareness.
 *
 * @param {Array<{s:string, w:number|null, r:number|null, rom?:string}>} sets
 * @returns {number|null}  ∈ [-∞, 1], increasing = more fatigue; negative = strength increase within session
 */
export function computeFatigueIndex(sets) {
  const done = (sets || []).filter(s => s.s === 'done' && s.w !== null && s.r !== null);
  if (done.length < 2) return null;

  const getPerf = s => s.w * s.r * getRomFactor(s.rom);

  const firstPerf = getPerf(done[0]);
  const lastPerf  = getPerf(done[done.length - 1]);

  if (firstPerf === 0) return null;
  return +(1 - lastPerf / firstPerf).toFixed(3);
}
