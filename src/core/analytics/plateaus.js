/**
 * ══════════════════════════════════════════════════════
 *  Plateau Detection Utility
 *  src/core/analytics/plateaus.js
 * ══════════════════════════════════════════════════════
 *
 * Pure function — zero side-effects, no imports.
 * All history data is passed in; nothing is fetched here.
 *
 * E1RM formula (Epley): weight * (1 + reps / 30)
 */

// ── Helpers ──────────────────────────────────────────

/**
 * Compute the Estimated 1-Rep Max for a single set.
 * Returns null if weight or reps are missing / zero.
 * @param {number|null} weight
 * @param {number|null} reps
 * @returns {number|null}
 */
export function calcE1RM(weight, reps) {
  if (weight === null || reps === null || weight <= 0 || reps <= 0) return null;
  return +(weight * (1 + reps / 30)).toFixed(2);
}

/**
 * Derive the "best" E1RM (top-set) from an array of logged sets.
 * Only 'done' sets with both weight and reps present are considered.
 * Falls back to best weight × reps volume if E1RM cannot be computed.
 *
 * @param {Array<{s: string, w: number|null, r: number|null}>} sets
 * @returns {number|null}
 */
export function bestMetricFromSets(sets) {
  if (!sets || !sets.length) return null;
  const doneSets = sets.filter(s => s.s === 'done' && s.w !== null && s.r !== null);
  if (!doneSets.length) return null;

  let best = null;
  for (const s of doneSets) {
    const e = calcE1RM(s.w, s.r);
    if (e !== null && (best === null || e > best)) best = e;
  }

  // Fallback: use max volume (w × r) if all reps were 0 somehow
  if (best === null) {
    for (const s of doneSets) {
      const vol = (s.w ?? 0) * (s.r ?? 0);
      if (best === null || vol > best) best = vol;
    }
  }

  return best;
}

// ── Intervention Map ─────────────────────────────────

/**
 * Returns a human-readable suggested intervention based on
 * the trend direction and how many consecutive sessions it
 * has persisted.
 *
 * @param {'flat'|'down'} trend
 * @param {number} consecutiveSessions  number of stagnant sessions detected
 * @returns {string}
 */
export function getSuggestedIntervention(trend, consecutiveSessions) {
  if (trend === 'down') {
    if (consecutiveSessions >= 5) {
      return 'Reduce intensity by 15–20% and run a full deload week';
    }
    if (consecutiveSessions >= 3) {
      return 'Scheduled deload / reduce intensity by 10%';
    }
    return 'Monitor closely — consider reducing load by 5%';
  }

  // trend === 'flat'
  if (consecutiveSessions >= 5) {
    return 'Restructure stimulus: change exercise variation or rep scheme entirely';
  }
  if (consecutiveSessions >= 3) {
    return 'Increase set volume or change rep range';
  }
  return 'Maintain current load; add one extra set if recovery allows';
}

// ── Core Detection ───────────────────────────────────

/**
 * Scan `history` (chronological array of completed workout entries)
 * for exercises present in the active session that have stagnated
 * over the last `consecutiveSessionsThreshold` appearances.
 *
 * Each history entry has the shape:
 *   {
 *     sessionId:      string,
 *     timestamp:      number,       // ms since epoch
 *     exercises: {
 *       [exId]: Array<{ s: string, w: number|null, r: number|null, n: string }>
 *     }
 *   }
 *
 * @param {object[]} history               - All past completed workout entries (any order).
 * @param {string}   activeSessionId       - The currently active session's ID.
 * @param {object[]} sessions              - Full sessions template array (to enumerate exercises).
 * @param {number}   [consecutiveSessionsThreshold=3] - Minimum consecutive appearances to evaluate.
 *
 * @returns {Array<{
 *   exerciseId:           string,
 *   exerciseName:         string,
 *   status:               'stagnated',
 *   currentTrend:         'flat'|'down',
 *   consecutiveSessions:  number,
 *   metrics:              number[],   // the E1RM values observed, oldest→newest
 *   suggestedIntervention: string
 * }>}
 */
export function detectPlateaus(
  history,
  activeSessionId,
  sessions,
  consecutiveSessionsThreshold = 3
) {
  // ── Guard clauses ──────────────────────────────────
  if (!history || !history.length) return [];
  if (!activeSessionId) return [];
  if (!sessions || !sessions.length) return [];

  // ── Resolve active session definition ─────────────
  const activeSession = sessions.find(s => s.id === activeSessionId);
  if (!activeSession) return [];

  // Collect all exercise definitions in the active session
  const activeExercises = (activeSession.blocks || []).flatMap(b => b.exercises || []);
  if (!activeExercises.length) return [];

  // ── Sort history chronologically ───────────────────
  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);

  // ── Analyse per exercise ───────────────────────────
  const plateaus = [];

  for (const ex of activeExercises) {
    const exId = ex.id;

    // Gather only entries from the SAME session type that logged this exercise
    const relevantEntries = sorted.filter(
      entry => entry.sessionId === activeSessionId &&
               entry.exercises &&
               entry.exercises[exId] !== undefined
    );

    // Need at least N appearances to detect a plateau
    if (relevantEntries.length < consecutiveSessionsThreshold) continue;

    // Take the last N consecutive appearances
    const window = relevantEntries.slice(-consecutiveSessionsThreshold);

    // Compute best E1RM for each appearance in the window
    const metrics = window.map(entry => bestMetricFromSets(entry.exercises[exId] || []));

    // Skip if any window slot has no usable data
    if (metrics.some(m => m === null)) continue;

    // ── Plateau check ──────────────────────────────
    // "Stagnated" = the metric never increased across all N sessions.
    // Determine if it went flat (no change) or down (at least one regression).
    let increased = false;
    let anyDown   = false;

    for (let i = 1; i < metrics.length; i++) {
      if (metrics[i] > metrics[i - 1]) { increased = true; break; }
      if (metrics[i] < metrics[i - 1]) anyDown = true;
    }

    if (increased) continue; // exercise is progressing — not a plateau

    const currentTrend = anyDown ? 'down' : 'flat';
    const suggestedIntervention = getSuggestedIntervention(
      currentTrend,
      consecutiveSessionsThreshold
    );

    plateaus.push({
      exerciseId:           exId,
      exerciseName:         ex.name ?? exId,
      status:               'stagnated',
      currentTrend,
      consecutiveSessions:  consecutiveSessionsThreshold,
      metrics,
      suggestedIntervention
    });
  }

  return plateaus;
}
