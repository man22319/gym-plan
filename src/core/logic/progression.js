/**
 * ══════════════════════════════════════════════════════
 *  Progression Engine — §21 + §21.1
 *  src/core/progression.js
 * ══════════════════════════════════════════════════════
 *
 * Pure functions — zero side-effects, no DOM, no imports.
 * All inputs are passed in; all outputs are plain values.
 *
 * ## Model (§21)
 *   T   = strength estimate  (EMA of e1RM)
 *   F   = fatigue state      (exponential integrator)
 *   Δw  = exercise-specific progression step (lbs)
 *
 * ## Observations (per session)
 *   ê   = w(1 + r/30)          Epley e1RM per set
 *   E_t = mean(ê)              average estimated 1RM
 *   V_t = Σ(w × r)            total volume
 *
 * ## Update rules
 *   T_{t+1} = (1 - η)T_t + ηE_t
 *   φ_t     = V_t / V_norm          normalized volume
 *   F_{t+1} = α·φ_t + (1 - α)·γ·F_t
 *
 * ## Readiness & control
 *   R_t = T_t - s·F_t
 *   u_t = k·(R_t - w_t) - λ·max(0, F_t - F*)
 *
 * ## Discretization
 *   w_{t+1} = Δw × round((w_t + u_t) / Δw)
 *
 * ## Risk-aware gate (§21.1)
 *   Risk_t = a·Δ% + b·ΔF + c·1/(EffortProxy+1) + d·Density + e·RiskMultiplier
 *   if Risk_t > threshold → suppress or reduce upward progression
 */

// ── Default Hyperparameters ───────────────────────────────────────────────────

const DEFAULTS = {
  η:           0.2,    // EMA learning rate for strength
  α:           0.5,    // fatigue accumulation rate
  γ:           0.85,   // fatigue decay rate (per session)
  s:           0.6,    // fatigue sensitivity on readiness
  k:           0.4,    // proportional gain on control signal
  λ:           0.3,    // fatigue penalty coefficient
  Fstar:       0.6,    // fatigue threshold above which penalty applies
  Vnorm:       1500,   // volume normaliser (lbs, ~typical session volume per exercise)
  riskThresh:  0.65,   // risk threshold above which progression is suppressed
  defaultDw:   2.5,    // default progression step (lbs) if not yet set

  // ── Risk scoring coefficients (§21.1) ───────────────────────────────────
  // Weights for each risk factor in computeRisk().
  // Kept here (not inside the function) so they're tunable alongside other params.
  riskCoeffs: {
    a: 0.30,   // weight change magnitude (Δ%)
    b: 0.25,   // fatigue delta
    c: 0.20,   // effort contribution (via RIR)
    d: 0.15,   // volume density
    e: 0.10,   // per-exercise risk multiplier
  },
};

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
 * @param {number} w  weight (lbs)
 * @param {number} r  reps
 * @returns {number|null}
 */
export function epleyE1RM(w, r) {
  if (!w || !r || w <= 0 || r <= 0) return null;
  return w * (1 + r / 30);
}

/**
 * Derive session observations from a set array.
 * Ignores failed sets and sets with missing data.
 *
 * @param {Array<{s:string, w:number|null, r:number|null}>} sets
 * @returns {{ E_t: number|null, V_t: number }}
 *   E_t — mean estimated 1RM across completed sets (null if no data)
 *   V_t — total volume Σ(w × r)
 */
export function computeObservations(sets) {
  const done = (sets || []).filter(s => s.s === 'done' && s.w !== null && s.r !== null);
  if (!done.length) return { E_t: null, V_t: 0 };

  const e1rms = done.map(s => {
    const baseE1rm = epleyE1RM(s.w, s.r);
    if (baseE1rm === null) return null;
    return baseE1rm * getRomFactor(s.rom);
  }).filter(e => e !== null);

  const E_t = e1rms.length ? (e1rms.reduce((a, b) => a + b, 0) / e1rms.length) : null;

  const V_t = done.reduce((sum, s) => sum + s.w * s.r * getRomFactor(s.rom), 0);

  return { E_t, V_t };
}

// ── Strength Update ───────────────────────────────────────────────────────────

/**
 * EMA update for strength estimate T.
 * @param {number|null} T      previous strength estimate (null → bootstrap from E_t)
 * @param {number|null} E_t    current session mean e1RM
 * @param {number}      η      learning rate [0,1]
 * @returns {number|null}
 */
export function updateStrength(T, E_t, η = DEFAULTS.η) {
  if (E_t === null) return T;          // no data this session — keep prior
  if (T === null)   return E_t;        // first session — bootstrap
  return (1 - η) * T + η * E_t;
}

// ── Fatigue Update ────────────────────────────────────────────────────────────

/**
 * Fatigue integrator update.
 * @param {number} F      previous fatigue state (default 0)
 * @param {number} V_t    session volume (lbs)
 * @param {number} α      accumulation rate
 * @param {number} γ      decay rate
 * @param {number} Vnorm  volume normaliser
 * @returns {number}      next fatigue state ∈ [0, ∞)
 */
export function updateFatigue(F = 0, V_t = 0, α = DEFAULTS.α, γ = DEFAULTS.γ, Vnorm = DEFAULTS.Vnorm) {
  const φ_t = V_t / Math.max(Vnorm, 1);
  return α * φ_t + (1 - α) * γ * F;
}

// ── Readiness ─────────────────────────────────────────────────────────────────

/**
 * Compute readiness: strength minus fatigue-adjusted penalty.
 * @param {number} T   strength
 * @param {number} F   fatigue
 * @param {number} s   fatigue sensitivity
 * @returns {number}
 */
export function readiness(T, F, s = DEFAULTS.s) {
  return T - s * F;
}

// ── Control Signal ────────────────────────────────────────────────────────────

/**
 * Proportional feedback control signal.
 * @param {number} R_t   readiness
 * @param {number} w_t   current working weight
 * @param {number} k     proportional gain
 * @param {number} F_t   current fatigue
 * @param {number} λ     fatigue penalty coefficient
 * @param {number} Fstar fatigue threshold
 * @returns {number}
 */
export function controlSignal(R_t, w_t, k = DEFAULTS.k, F_t = 0, λ = DEFAULTS.λ, Fstar = DEFAULTS.Fstar) {
  let u = k * (R_t - w_t);
  u -= λ * Math.max(0, F_t - Fstar);
  return u;
}

// ── Discretization ────────────────────────────────────────────────────────────

/**
 * Round the continuous weight target to the nearest progression step.
 * @param {number} w_t   current working weight
 * @param {number} u_t   control signal
 * @param {number} dw    progression step (lbs)
 * @returns {number}     next recommended weight (≥ 0)
 */
export function discretize(w_t, u_t, dw) {
  const step = Math.max(dw, 0.5);
  return Math.max(0, step * Math.round((w_t + u_t) / step));
}

// ── Risk Layer (§21.1) ────────────────────────────────────────────────────────

/**
 * Compute risk score for an upward progression step.
 *
 * Parameters:
 *   deltaPct      — Δ% = Δw / w_t  (fractional weight increase)
 *   deltaF        — ΔF = F_t − F_{t−1}  (fatigue change)
 *   avgRIR        — mean RIR this session (null → treated as low effort)
 *   density       — volume / session duration minutes (null → 0)
 *   riskMultiplier — per-exercise injury risk factor (default 1.0)
 *
 * Coefficients (tunable):
 *   a=0.3, b=0.25, c=0.2, d=0.15, e=0.1
 *
 * @returns {number}  Risk_t ∈ [0, ∞); values >0.65 suppress progression
 */
export function computeRisk({ deltaPct = 0, deltaF = 0, avgRIR = null, density = null, riskMultiplier = 1.0 } = {}) {
  const d = density !== null ? density : 0;
  const { a, b, c, d: dCoeff, e } = DEFAULTS.riskCoeffs;
  const effortContribution = avgRIR !== null ? c * (1 / (avgRIR + 1)) : 0;

  return (
    a * Math.abs(deltaPct) +
    b * Math.max(0, deltaF) +
    effortContribution +
    dCoeff * d +
    e * riskMultiplier
  );
}

// ── Full Session Update ───────────────────────────────────────────────────────

/**
 * Process one completed session for an exercise and return the next
 * progression state and recommended weight.
 *
 * @param {object} prev  Previous progression state: { T, F, dw }
 *                       All fields default to null/DEFAULTS.defaultDw if absent.
 * @param {object[]} sets  Completed sets for this exercise this session
 * @param {object}  [opts] Optional overrides for hyperparameters & risk params
 * @returns {{
 *   T:              number,       // updated strength estimate
 *   F:              number,       // updated fatigue state
 *   dw:             number,       // progression step (unchanged or adapted)
 *   suggestedWeight: number|null, // recommended next weight (null if insufficient data)
 *   riskScore:      number,       // computed risk for this progression step
 *   suppressed:     boolean       // true if progression was risk-gated
 * }}
 */
export function updateProgressionState(prev = {}, sets = [], opts = {}) {
  const T_prev  = prev.T  ?? null;
  const F_prev  = prev.F  ?? 0;

  // §28.5 HARD RULE: deltaW MUST come from the stored JSON exercise field.
  // opts.deltaW is passed from the EXERCISE_INDEX entry at call-site.
  // Fall back to prev.dw (previously persisted) if the caller didn't supply one,
  // and only use DEFAULTS.defaultDw as a last resort on very first boot.
  const dw = opts.deltaW ?? prev.dw ?? DEFAULTS.defaultDw;

  const { E_t, V_t } = computeObservations(sets);

  const T_next = updateStrength(T_prev, E_t);
  const F_next = updateFatigue(F_prev, V_t);

  if (T_next === null) {
    // Insufficient data — return updated fatigue but no weight suggestion
    return { T: null, F: F_next, dw, suggestedWeight: null, riskScore: 0, suppressed: false };
  }

  // Derive working weight from last session avg (fallback to T estimate)
  const doneSets = (sets || []).filter(s => s.s === 'done' && s.w !== null);
  const w_t = doneSets.length
    ? doneSets.reduce((n, s) => n + s.w, 0) / doneSets.length
    : T_next;

  const R_t = readiness(T_next, F_next);
  const u_t = controlSignal(R_t, w_t);
  const w_next_continuous = w_t + u_t;

  // Risk assessment (§21.1 + §28.7)
  const deltaPct = w_t > 0 ? (w_next_continuous - w_t) / w_t : 0;
  const deltaF   = F_next - F_prev;
  const avgRIR   = (() => {
    const rirSets = (sets || []).filter(s => s.s === 'done' && s.rir !== null && s.rir >= 0);
    if (!rirSets.length) return null;
    return rirSets.reduce((n, s) => n + s.rir, 0) / rirSets.length;
  })();

  // §28.7: Risk scales with relative deltaW (Δ% = deltaW / w_t).
  // A larger stored step means a bigger absolute jump, which demands more evidence.
  // We pass deltaW into riskMultiplier as a scaling factor (clamped to reasonable range).
  const relativeDeltaW  = w_t > 0 ? dw / w_t : 0;
  const dwRiskScale     = 1.0 + Math.min(relativeDeltaW, 1.0); // [1.0, 2.0]
  const effectiveRiskMultiplier = (opts.riskMultiplier ?? 1.0) * dwRiskScale;

  const riskScore = computeRisk({
    deltaPct,
    deltaF,
    avgRIR,
    density: opts.density ?? null,
    riskMultiplier: effectiveRiskMultiplier
  });

  const suppressed = deltaPct > 0 && riskScore > DEFAULTS.riskThresh;

  // If progression is suppressed or control signal is downward, clamp
  const effectiveU = suppressed ? Math.min(0, u_t) : u_t;
  const suggestedWeight = +discretize(w_t, effectiveU, dw).toFixed(1);

  return {
    T: +T_next.toFixed(2),
    F: +F_next.toFixed(4),
    dw,
    suggestedWeight,
    riskScore: +riskScore.toFixed(3),
    suppressed
  };
}

// ── Fatigue Index (§11) ───────────────────────────────────────────────────────

/**
 * Compute per-exercise fatigue index from a set array.
 * Fatigue Index = 1 − (Last Set Performance / First Set Performance)
 * Performance = weight × reps (default, per §11).
 *
 * Ordering based on entry order.
 * Returns null if fewer than 2 completed sets with data.
 *
 * @param {Array<{s:string, w:number|null, r:number|null}>} sets
 * @returns {number|null}  [0, 1] increasing = more fatigue; negative = strength increase
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
