import { workouts, EXERCISE_INDEX, EX_SESSION_INDEX } from './workouts.js';

export const query = {
  // ── History Access ─────────────────────────────────────────────────────────

  // All history entries, guaranteed chronological (newest last).
  chronological(appState) {
    return [...(appState.history || [])].sort((a, b) => a.timestamp - b.timestamp);
  },

  // Last N completed sessions for a given sessionId.
  sessionHistory(appState, sessionId, n = Infinity) {
    return this.chronological(appState)
      .filter(e => e.sessionId === sessionId)
      .slice(-n);
  },

  // The single most recent completed entry for a sessionId.
  lastSession(appState, sessionId) {
    const hist = this.sessionHistory(appState, sessionId, 1);
    return hist.length ? hist[0] : null;
  },

  // Last completed sets for a specific exercise.
  lastExerciseSets(appState, exId) {
    const sessionId = EX_SESSION_INDEX[exId];
    if (!sessionId) return null;
    const entry = this.lastSession(appState, sessionId);
    if (!entry) return null;
    return entry.exercises[exId] || null;
  },

  // Last N entries for an exercise (for trend analysis).
  exerciseHistory(appState, exId, n = Infinity) {
    return this.chronological(appState)
      .filter(e => e.exercises && e.exercises[exId] && e.exercises[exId].some(s => s.s === 'done' || s.s === 'failed'))
      .map(e => ({
        timestamp: e.timestamp,
        sets:      e.exercises[exId]
      }))
      .slice(-n);
  },

  // Derived: last completed timestamp for a session (from history).
  lastDoneTimestamp(appState, sessionId) {
    const entry = this.lastSession(appState, sessionId);
    return entry ? entry.timestamp : null;
  },

  // ── Session Completion ─────────────────────────────────────────────────────

  // Derived: is the current working session complete?
  // Depends ONLY on state.exercises — never on history.
  isSessionComplete(appState, sessionId) {
    const session = workouts.find(s => s.id === sessionId)
      ?? (appState.sessions || []).find(s => s.id === sessionId);
    if (!session) return false;
    const allEx = session.blocks.flatMap(b => b.exercises);
    if (!allEx.length) return false;
    return allEx.every(ex => {
      const sets = appState.exercises[ex.id] || [];
      return sets.length > 0 && sets.every(s => s.s === 'done' || s.s === 'failed');
    });
  },

  isExerciseComplete(appState, exId) {
    const sets = appState.exercises[exId] || [];
    return sets.length > 0 && sets.every(s => s.s === 'done' || s.s === 'failed');
  },

  // ── Completion Validation (§15) ────────────────────────────────────────────

  /**
   * Validate whether the session can be finished per §15 rules.
   * Returns { valid: bool, reason: string|null }.
   *
   * Required:
   *   - all exercises visited (at least one set changed from blank)
   *   - all sets contain weight AND reps
   * Optional:
   *   - RIR, cardio, notes
   */
  validateFinish(appState, sessionId) {
    const session = workouts.find(s => s.id === sessionId)
      ?? (appState.sessions || []).find(s => s.id === sessionId);
    if (!session) return { valid: false, reason: 'Session not found.' };

    const allEx = session.blocks.flatMap(b => b.exercises);
    if (!allEx.length) return { valid: true, reason: null };

    for (const ex of allEx) {
      const sets = appState.exercises[ex.id] || [];

      // All sets must have been interacted with (not blank)
      const allVisited = sets.every(s => s.s === 'done' || s.s === 'failed');
      if (!allVisited) {
        return { valid: false, reason: `Complete all sets for "${ex.name}" before finishing.` };
      }

      // All done sets must have weight AND reps
      for (const s of sets) {
        if (s.s === 'done' && (s.w === null || s.r === null)) {
          return { valid: false, reason: `Set missing weight or reps in "${ex.name}".` };
        }
      }
    }

    return { valid: true, reason: null };
  },

  sessionProgress(appState, sessionId) {
    const session = workouts.find(s => s.id === sessionId)
      ?? (appState.sessions || []).find(s => s.id === sessionId);
    if (!session) return 0;
    const allEx  = session.blocks.flatMap(b => b.exercises);
    const total  = allEx.reduce((n, ex) => n + ex.sets, 0);
    if (!total) return 0;
    const resolved = allEx.reduce((n, ex) => {
      const sets = appState.exercises[ex.id] || [];
      return n + sets.filter(s => s.s === 'done' || s.s === 'failed').length;
    }, 0);
    return Math.round((resolved / total) * 100);
  },

  // ── Week / Session Display (§3) ────────────────────────────────────────────

  /**
   * Derive current week and session from completedWorkouts (§3).
   *
   * week         = floor(completedWorkouts / sessionsPerWeek) + 1
   * session      = (completedWorkouts % sessionsPerWeek) + 1
   *
   * No calendar dependency. Missed sessions do not shift indexing.
   */
  weekAndSession(appState) {
    const n    = appState?.completedWorkouts ?? 0;
    const spw  = Math.max(1, appState?.sessionsPerWeek ?? 3);
    const week    = Math.floor(n / spw) + 1;
    const session = (((n % spw) + spw) % spw) + 1; // handles negative offset safely
    return { week, session };
  },

  // ── Derived Metrics ────────────────────────────────────────────────────────

  // Volume for a set array: Σ(w × r) — skips null/failed
  setVolume(sets) {
    return sets.reduce((sum, s) => {
      if (s.w !== null && s.r !== null && s.s !== 'failed') return sum + s.w * s.r;
      return sum;
    }, 0);
  },

  // Compare two Set[] arrays: returns { weightDelta, repsDelta } using avg of logged sets
  compareSets(prev, curr) {
    const avgW = arr => {
      const logged = arr.filter(s => s.w !== null);
      return logged.length ? logged.reduce((n, s) => n + s.w, 0) / logged.length : null;
    };
    const avgR = arr => {
      const logged = arr.filter(s => s.r !== null);
      return logged.length ? logged.reduce((n, s) => n + s.r, 0) / logged.length : null;
    };
    const prevW = avgW(prev), currW = avgW(curr);
    const prevR = avgR(prev), currR = avgR(curr);
    return {
      weightDelta: (prevW !== null && currW !== null) ? +(currW - prevW).toFixed(1) : null,
      repsDelta:   (prevR !== null && currR !== null) ? +(currR - prevR).toFixed(1) : null
    };
  },

  // ── Progression Recommendation (§21) ─────────────────────────────────────

  /**
   * Returns the progression engine's suggestion for an exercise.
   * Reads from state.progressionState (updated after FINISH_WORKOUT).
   * Returns null if no data yet.
   *
   * @param {object} appState
   * @param {string} exId
   * @returns {{ suggestedWeight: number, suppressed: boolean, riskScore: number } | null}
   */
  progressionSuggestion(appState, exId) {
    const EXERCISE_INDEX_local = appState?.sessions
      ? Object.fromEntries(
          (appState.sessions || []).flatMap(s =>
            (s.blocks || []).flatMap(b => (b.exercises || []).map(ex => [ex.id, ex]))
          )
        )
      : EXERCISE_INDEX;
    const ex = EXERCISE_INDEX_local[exId];
    if (ex?.invariant) return null;

    const ps = appState?.progressionState?.[exId];
    if (!ps || ps.T === null) return null;
    return {
      suggestedWeight: ps.lastSuggested ?? null,
      suppressed:      ps.lastSuppressed ?? false,
      riskScore:       ps.lastRisk       ?? 0
    };
  },

  // ── Personal Records ──────────────────────────────────────────────────────

  personalRecords(appState, exId) {
    const history = this.exerciseHistory(appState, exId);
    let heaviestSet = null, highestVolume = null, mostReps = null;

    for (const entry of history) {
      const doneSets = entry.sets.filter(s => s.s === 'done' && s.w !== null && s.r !== null);
      const volume   = doneSets.reduce((n, s) => n + s.w * s.r, 0);

      for (const s of doneSets) {
        if (!heaviestSet || s.w > heaviestSet.w || (s.w === heaviestSet.w && s.r > heaviestSet.r))
          heaviestSet = { w: s.w, r: s.r, date: entry.timestamp };
        if (!mostReps || s.r > mostReps.r || (s.r === mostReps.r && s.w > mostReps.w))
          mostReps = { w: s.w, r: s.r, date: entry.timestamp };
      }
      if (volume > 0 && (!highestVolume || volume > highestVolume.volume))
        highestVolume = { volume, date: entry.timestamp };
    }
    return { heaviestSet, highestVolume, mostReps };
  },

  currentSetPRs(appState, exId) {
    const currentSets = appState.exercises[exId] || [];
    const doneSets    = currentSets.filter(s => s.s === 'done' && s.w !== null && s.r !== null);
    if (!doneSets.length) return [];

    const sessionId = EX_SESSION_INDEX[exId];
    if (!sessionId) return [];
    const histEntries = this.sessionHistory(appState, sessionId);

    let prWeight = null, prReps = null, prVolume = null;
    for (const entry of histEntries) {
      const sets = (entry.exercises[exId] || []).filter(s => s.s === 'done' && s.w !== null && s.r !== null);
      for (const s of sets) {
        if (prWeight === null || s.w > prWeight) prWeight = s.w;
        if (prReps   === null || s.r > prReps)   prReps   = s.r;
      }
      const vol = sets.reduce((n, s) => n + s.w * s.r, 0);
      if (vol > 0 && (prVolume === null || vol > prVolume)) prVolume = vol;
    }

    if (prWeight === null && prReps === null) return [];

    const prs      = [];
    const currMaxW = Math.max(...doneSets.map(s => s.w));
    const currMaxR = Math.max(...doneSets.map(s => s.r));
    const currVol  = doneSets.reduce((n, s) => n + s.w * s.r, 0);

    if (prWeight !== null && currMaxW > prWeight) prs.push('weight');
    if (prReps   !== null && currMaxR > prReps)   prs.push('reps');
    if (prVolume !== null && currVol  > prVolume) prs.push('volume');
    return prs;
  },

  sessionPRsFromEntry(appState, entry) {
    const result = {};
    const session = workouts.find(s => s.id === entry.sessionId)
      ?? (appState.sessions || []).find(s => s.id === entry.sessionId);
    if (!session) return result;

    const priorHistory  = (appState.history || []).filter(e => e.timestamp < entry.timestamp);
    const priorState    = { ...appState, history: priorHistory };

    for (const block of session.blocks) {
      for (const ex of block.exercises) {
        const exId      = ex.id;
        const entrySets = (entry.exercises[exId] || []).filter(s => s.s === 'done' && s.w !== null && s.r !== null);
        if (!entrySets.length) continue;

        const prior = query.exerciseHistory(priorState, exId);
        let prWeight = null, prReps = null, prVolume = null;
        for (const h of prior) {
          const sets = h.sets.filter(s => s.s === 'done' && s.w !== null && s.r !== null);
          for (const s of sets) {
            if (prWeight === null || s.w > prWeight) prWeight = s.w;
            if (prReps   === null || s.r > prReps)   prReps   = s.r;
          }
          const vol = sets.reduce((n, s) => n + s.w * s.r, 0);
          if (vol > 0 && (prVolume === null || vol > prVolume)) prVolume = vol;
        }

        const prs = [];
        if (prWeight === null && prReps === null) continue;
        const currMaxW = Math.max(...entrySets.map(s => s.w));
        const currMaxR = Math.max(...entrySets.map(s => s.r));
        const currVol  = entrySets.reduce((n, s) => n + s.w * s.r, 0);
        if (prWeight !== null && currMaxW > prWeight) prs.push('weight');
        if (prReps   !== null && currMaxR > prReps)   prs.push('reps');
        if (prVolume !== null && currVol  > prVolume) prs.push('volume');
        if (prs.length) result[exId] = prs;
      }
    }
    return result;
  },


  isSessionFinishedInCurrentWeek(appState, sessionId) {
    const spw = appState.sessionsPerWeek ?? 3;
    const n   = appState.completedWorkouts ?? 0;
    const currentCycleCount = n % spw;
    if (currentCycleCount === 0) return false;

    // Sort by timestamp before slicing so insertion order differences (post-import)
    // do not cause the wrong entries to be selected.
    const sorted = [...(appState.history || [])].sort((a, b) => a.timestamp - b.timestamp);
    const recentEntries = sorted.slice(-currentCycleCount);
    return recentEntries.some(entry => entry.sessionId === sessionId);
  }
};

