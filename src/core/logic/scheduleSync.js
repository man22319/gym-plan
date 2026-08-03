// ── Automatic Mesocycle Phase Resynchronization ───────────────────────────────
//
// Infers missing workout history entries when structural evidence proves they
// occurred.  Evidence is defined as: the two explicit completions immediately
// surrounding the gap in chronological history belong to the correct adjacent
// positions in the schedule and their timestamps are within tolerance of the
// expected calendar gap.
//
// Design invariants:
//   • Pure — no imports from app state, no side effects.
//   • Non-destructive — never overwrites or modifies explicit history entries.
//   • Ephemeral — inferred entries are never persisted (compactExport strips them).
//   • Transparent — inferred entries are flagged with inferred: true.
//   • completedWorkouts is NEVER mutated.  The counter describes user behaviour,
//     not algorithmic guesses.  Scheduling queries work correctly because the
//     inferred entry has a valid estimated timestamp that sorts into the right
//     chronological position, so history.slice(-currentCycleCount) picks it up
//     naturally without any counter adjustment.
//   • Idempotent — strips pre-existing inferred entries before recomputing so
//     repeated calls do not accumulate duplicates.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MAP = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const MS_PER_DAY     = 86_400_000;
const TOLERANCE_DAYS = 2;

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Compute the forward calendar day gap from sessionA's dayLabel to sessionB's
 * dayLabel.  Same day-of-week returns 7 (next weekly occurrence).
 * Returns null when either label is unrecognised.
 *
 * @param {object} sessionA
 * @param {object} sessionB
 * @returns {number|null}
 */
function daysBetweenSessions(sessionA, sessionB) {
  const dowA = DAY_MAP[(sessionA?.dayLabel ?? '').toUpperCase()];
  const dowB = DAY_MAP[(sessionB?.dayLabel ?? '').toUpperCase()];
  if (dowA === undefined || dowB === undefined) return null;
  const diff = (dowB - dowA + 7) % 7;
  return diff === 0 ? 7 : diff;
}

// ── Exported API ──────────────────────────────────────────────────────────────

/**
 * Determine whether two history entries represent occurrences that could be
 * adjacent members of the same schedule rotation cycle.
 *
 * The check compares the actual timestamp gap between entryA and entryB
 * against the expected calendar span between sessA and sessB (the full A→B
 * span, which includes the missing session's slot) ± TOLERANCE_DAYS.
 *
 * Exported for unit testing.
 *
 * @param {object} entryA  Earlier history entry (must have .timestamp)
 * @param {object} entryB  Later history entry  (must have .timestamp)
 * @param {object} sessA   Schedule session for entryA (must have .dayLabel)
 * @param {object} sessB   Schedule session for entryB (must have .dayLabel)
 * @returns {boolean}
 */
export function sameCycle(entryA, entryB, sessA, sessB) {
  const expected = daysBetweenSessions(sessA, sessB);
  if (expected === null) return false;
  const actual = (entryB.timestamp - entryA.timestamp) / MS_PER_DAY;
  return Math.abs(actual - expected) <= TOLERANCE_DAYS;
}

/**
 * Infer missing workout history entries from structural evidence in the
 * explicit history.
 *
 * Algorithm  O(history + schedule):
 *   1. Build a chronologically sorted list of explicit (non-inferred) entries.
 *   2. For every adjacent pair (A, B) in that list:
 *      a. Identify A and B's positions in the schedule (idxA, idxB).
 *      b. Enforce B is exactly 2 schedule positions ahead of A (one gap slot).
 *         — This guarantees the gap is uniquely determined.
 *      c. Run sameCycle(A, B) — actual timestamp span ≈ expected calendar span.
 *      d. Confirm no explicit completion for the missing session already fills
 *         the time window between A and B.
 *      e. Inject a synthetic entry with:
 *           - estimatedTimestamp = A.timestamp + (A→missing days) * MS_PER_DAY
 *           - inferred: true
 *           - exercises: {}  (no invented exercise data)
 *           - exerciseRefs: {}
 *
 * Safety rules:
 *   - Skipped entries (entry.skipped === true) are respected; they are
 *     included in the explicit list but cause their pair-checks to abort.
 *   - completedWorkouts is never touched.
 *   - Any pre-existing inferred entries in appState.history are stripped and
 *     recomputed fresh (idempotent).
 *   - Returns the original history array unchanged when inferredCount === 0
 *     (avoids unnecessary object allocations on the happy path).
 *
 * @param {object} appState        — application state (read-only)
 * @param {Array}  sessions        — schedule sessions array (state.sessions)
 * @returns {{ augmentedHistory: Array, inferredCount: number }}
 */
export function inferMissingWorkouts(appState, sessions) {
  const n           = sessions?.length ?? 0;
  const baseHistory = appState.history ?? [];

  // Need at least 2 sessions to have a cycle, and at least 2 history
  // entries to form an adjacent pair worth examining.
  if (n < 2) return { augmentedHistory: baseHistory, inferredCount: 0 };

  // Separate explicit entries (strip any stale inferred ones from a prior run).
  const explicit = baseHistory
    .filter(e => !e.inferred)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (explicit.length < 2) {
    return { augmentedHistory: baseHistory, inferredCount: 0 };
  }

  // Schedule lookup: sessionId → index in sessions array.
  const schedIdx = new Map(sessions.map((s, i) => [s.id, i]));

  const inferred = [];

  for (let j = 0; j < explicit.length - 1; j++) {
    const entryA = explicit[j];
    const entryB = explicit[j + 1];

    // Honour explicit user-marked skips on either neighbour.
    if (entryA.skipped || entryB.skipped) continue;

    const idxA = schedIdx.get(entryA.sessionId);
    const idxB = schedIdx.get(entryB.sessionId);

    // Both sessions must exist in the current schedule.
    if (idxA === undefined || idxB === undefined) continue;

    // B must be exactly 2 schedule positions ahead of A (wrapping).
    // This is the "exactly one missing slot" invariant.
    const idxMissing   = (idxA + 1) % n;
    const expectedIdxB = (idxA + 2) % n;
    if (expectedIdxB !== idxB) continue;

    const missingSession = sessions[idxMissing];

    // sameCycle: timestamp gap between A and B must match the expected
    // calendar span A→B (which straddles the missing session) ± tolerance.
    if (!sameCycle(entryA, entryB, sessions[idxA], sessions[idxB])) continue;

    // Verify no explicit completion for the missing session already exists
    // in the time window bounded by A and B.
    const alreadyLogged = explicit.some(e =>
      e.sessionId === missingSession.id &&
      e.timestamp > entryA.timestamp &&
      e.timestamp < entryB.timestamp
    );
    if (alreadyLogged) continue;

    // Estimate the missing workout's timestamp:
    //   A.timestamp + forward calendar gap from A's day to the missing day.
    const gapDays     = daysBetweenSessions(sessions[idxA], missingSession) ?? 1;
    const estimatedTs = entryA.timestamp + gapDays * MS_PER_DAY;

    inferred.push({
      entryId:          crypto.randomUUID(),
      sessionId:        missingSession.id,
      timestamp:        estimatedTs,
      startTimestamp:   null,
      lastSetTimestamp: null,
      exercises:        {},
      exerciseRefs:     {},
      cardio:           null,
      inferred:         true,
    });
  }

  // Fast path: nothing to infer — return original object reference unchanged.
  if (!inferred.length) {
    return { augmentedHistory: baseHistory, inferredCount: 0 };
  }

  // Merge explicit entries + inferred entries, re-sort chronologically.
  // (We rebuild from explicit rather than baseHistory to drop stale inferred.)
  const augmentedHistory = [...explicit, ...inferred]
    .sort((a, b) => a.timestamp - b.timestamp);

  return { augmentedHistory, inferredCount: inferred.length };
}
