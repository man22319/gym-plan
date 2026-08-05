import { workouts, EXERCISE_INDEX, EX_SESSION_INDEX } from '../state/store.js';

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

  // Last completed sets for a specific exercise (by instanceId).
  // Searches all history entries — works even when the same exercise appears in multiple sessions.
  lastExerciseSets(appState, instanceId) {
    const hist = this.chronological(appState)
      .filter(e => e.exercises && e.exercises[instanceId]);
    if (!hist.length) return null;
    return hist[hist.length - 1].exercises[instanceId];
  },

  // All history entries containing a given exerciseRef (definition identity).
  // Uses the exerciseRefs map added to history entries on FINISH_WORKOUT (and backfilled on migration).
  exerciseRefHistory(appState, exerciseRef) {
    return this.chronological(appState).filter(entry =>
      entry.exerciseRefs && Object.values(entry.exerciseRefs).includes(exerciseRef)
    );
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
    return allEx.every(inst => {
      const sets = appState.exercises[inst.instanceId] || [];
      return sets.length > 0 && sets.every(s => s.s === 'done' || s.s === 'failed');
    });
  },

  isExerciseComplete(appState, instanceId) {
    const sets = appState.exercises[instanceId] || [];
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

    for (const inst of allEx) {
      const name = EXERCISE_INDEX[inst.instanceId]?.name ?? inst.instanceId;
      const sets = appState.exercises[inst.instanceId] || [];

      // All sets must have been interacted with (not blank)
      const allVisited = sets.every(s => s.s === 'done' || s.s === 'failed');
      if (!allVisited) {
        return { valid: false, reason: `Complete all sets for "${name}" before finishing.` };
      }

      // All done sets must have weight AND reps
      for (const s of sets) {
        if (s.s === 'done' && (s.w === null || s.r === null)) {
          return { valid: false, reason: `Set missing weight or reps in "${name}".` };
        }
      }
    }

    return { valid: true, reason: null };
  },

  sessionProgress(appState, sessionId) {
    const session = workouts.find(s => s.id === sessionId)
      ?? (appState.sessions || []).find(s => s.id === sessionId);
    if (!session) return 0;
    const lib    = appState.exerciseLibrary ?? {};
    const allEx  = session.blocks.flatMap(b => b.exercises);
    const total  = allEx.reduce((n, inst) => {
      const sets = inst.sets ?? EXERCISE_INDEX[inst.instanceId]?.sets ?? lib[inst.exerciseRef]?.sets ?? 3;
      return n + sets;
    }, 0);
    if (!total) return 0;
    const resolved = allEx.reduce((n, inst) => {
      const sets = appState.exercises[inst.instanceId] || [];
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
    // Cycle phase must account for inferred entries, so we use completedWorkouts
    // as the primary source of truth, falling back to history.length.
    const n    = appState?.completedWorkouts ?? appState?.history?.length ?? 0;
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
   * @returns {{ suggestedWeight: number, decision: string, classification: string } | null}
   */
  progressionSuggestion(appState, exId) {
    const ex = EXERCISE_INDEX[exId];
    if (ex?.invariant) return null;

    const ps = appState?.progressionState?.[exId];
    if (!ps || ps.currentWeight === null || ps.currentWeight === undefined) return null;

    return {
      suggestedWeight:     ps.lastSuggested        ?? null,
      decision:            ps.lastDecision          ?? 'hold',
      classification:      ps.lastClassification    ?? null,
      restInflationFactor: ps.restInflationFactor   ?? 0,
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
      for (const inst of block.exercises) {
        const instanceId = inst.instanceId;
        const entrySets  = (entry.exercises[instanceId] || []).filter(s => s.s === 'done' && s.w !== null && s.r !== null);
        if (!entrySets.length) continue;

        const prior = query.exerciseHistory(priorState, instanceId);
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
        if (prs.length) result[instanceId] = prs;
      }
    }
    return result;
  },


  isSessionFinishedInCurrentWeek(appState, sessionId) {
    const spw = appState.sessionsPerWeek ?? 3;
    // Cycle phase must account for inferred entries, so we use completedWorkouts
    // as the primary source of truth, falling back to history.length.
    const n   = appState?.completedWorkouts ?? appState?.history?.length ?? 0;
    const currentCycleCount = n % spw;
    if (currentCycleCount === 0) return false;

    // Sort by timestamp before slicing so insertion order differences (post-import)
    // do not cause the wrong entries to be selected.
    const sorted = [...(appState.history || [])].sort((a, b) => a.timestamp - b.timestamp);
    const recentEntries = sorted.slice(-currentCycleCount);
    return recentEntries.some(entry => entry.sessionId === sessionId);
  },

  // ── Session Timing ─────────────────────────────────────────────────────────

  /**
   * Derive the effective session start time from either the persisted
   * sessionStarted timestamp or the earliest completedAt across the
   * active session's exercises.
   *
   * Handles:
   *  - Normal case: sessionStarted is set → return it.
   *  - Corrupted case: sessionStarted was lost but sets exist → derive from timestamps.
   *  - No session: no data → null.
   */
  activeSessionStartTime(appState) {
    if (appState.sessionStarted) return appState.sessionStarted;
    // Fallback: earliest completedAt in the active session's exercises
    const session = workouts.find(s => s.id === appState.activeSessionId);
    if (!session) return null;
    let earliest = Infinity;
    for (const block of session.blocks) {
      for (const inst of block.exercises) {
        for (const s of (appState.exercises[inst.instanceId] || [])) {
          if (s.completedAt && s.completedAt < earliest) earliest = s.completedAt;
        }
      }
    }
    return earliest === Infinity ? null : earliest;
  },

  /**
   * Get the latest completedAt timestamp across all exercises in a session.
   * Returns null if no sets have been completed.
   */
  lastSetTimestamp(appState, sessionId) {
    const session = workouts.find(s => s.id === sessionId)
      ?? (appState.sessions || []).find(s => s.id === sessionId);
    if (!session) return null;
    let latest = 0;
    for (const block of session.blocks) {
      for (const inst of block.exercises) {
        for (const s of (appState.exercises[inst.instanceId] || [])) {
          if (s.completedAt && s.completedAt > latest) latest = s.completedAt;
        }
      }
    }
    return latest || null;
  },

  // ── Session Suggestion ─────────────────────────────────────────────────────

  /**
   * Return the ID of the session the user should do next.
   *
   * Priority:
   *   1. Among sessions NOT finished this cycle, pick the one whose scheduled
   *      day is soonest from today (calendar-aware). Ties break by template order.
   *   2. If all sessions are finished this cycle, fall back to the one after the
   *      last completed session in history (rotation order).
   *
   * Moved from rendering.js — this is a state query, not a render helper.
   * Used by: buildTabs (DUE badge) and FINISH_WORKOUT (activeSessionId advance).
   *
   * @param {object} appState
   * @returns {string|null}
   */
  getSuggestedSessionId(appState) {
    if (!workouts.length) return null;

    // 1. Find sessions NOT finished in the current cycle
    const unfinished = workouts.filter(
      s => !this.isSessionFinishedInCurrentWeek(appState, s.id)
    );

    if (unfinished.length > 0) {
      // 2. Among unfinished, pick the one whose scheduled day is soonest
      //    from today (next reachable session on the calendar).
      //    e.g. if today is Sunday: MON = 1 day away, THU = 4 days away → pick MON.
      //    Ties fall back to template order (earlier in workouts array wins).
      const DAY_MAP = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
      const todayDow = new Date().getDay(); // 0 = Sunday

      function daysUntil(session) {
        const label = (session.dayLabel || '').toUpperCase();
        const targetDow = DAY_MAP[label];
        if (targetDow === undefined) return 7; // unknown label → sort last
        // Days from today to the target day (0 = today, 7 if same day wraps to next week)
        // Use 0 for "today" so a session on the current day is most urgent
        const diff = (targetDow - todayDow + 7) % 7;
        return diff === 0 ? 0 : diff;
      }

      // ── Fresh-cycle guard ──────────────────────────────────────────────
      // When the cycle just reset, ALL sessions appear unfinished.  The
      // calendar logic below would pick the session whose day matches
      // today — which is the one the user just completed.  Detect this
      // case and fall through to Step 3 (rotation) instead.
      if (unfinished.length === workouts.length) {
        const history = this.chronological(appState);
        if (history.length) {
          const lastEntry = history[history.length - 1];
          const lastDate  = new Date(lastEntry.timestamp);
          const now       = new Date();
          const sameDay   = lastDate.getFullYear() === now.getFullYear()
                         && lastDate.getMonth()    === now.getMonth()
                         && lastDate.getDate()     === now.getDate();

          if (sameDay) {
            // Compute which session the calendar logic *would* pick
            let calendarBest = unfinished[0];
            let calendarDist = daysUntil(calendarBest);
            for (let i = 1; i < unfinished.length; i++) {
              const dist = daysUntil(unfinished[i]);
              if (dist < calendarDist) {
                calendarBest = unfinished[i];
                calendarDist = dist;
              }
            }

            // If the calendar would re-pick today's just-completed session,
            // skip calendar logic and let Step 3 handle rotation.
            if (calendarBest.id === lastEntry.sessionId) {
              // Fall through to Step 3 below
            } else {
              return calendarBest.id;
            }
          } else {
            // Last workout was on a different day — normal calendar logic
            let best = unfinished[0];
            let bestDist = daysUntil(best);
            for (let i = 1; i < unfinished.length; i++) {
              const dist = daysUntil(unfinished[i]);
              if (dist < bestDist) {
                best = unfinished[i];
                bestDist = dist;
              }
            }
            return best.id;
          }
        } else {
          return workouts[0].id;
        }
      } else {
        // Mid-cycle: normal calendar-based selection
        let best = unfinished[0];
        let bestDist = daysUntil(best);

        for (let i = 1; i < unfinished.length; i++) {
          const dist = daysUntil(unfinished[i]);
          if (dist < bestDist) {
            best = unfinished[i];
            bestDist = dist;
          }
        }
        return best.id;
      }
    }

    // 3. All sessions finished this cycle — fall back to next-in-cycle
    const history = this.chronological(appState);
    if (!history.length) return workouts[0].id;
    const lastSessionId = history[history.length - 1].sessionId;
    const lastIndex = workouts.findIndex(s => s.id === lastSessionId);
    const nextIndex = (lastIndex + 1) % workouts.length;
    return workouts[nextIndex]?.id || workouts[0].id;
  },
};
