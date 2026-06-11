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
   * Derive current week and session from completedWorkouts + uiOffset (§3).
   *
   * displayIndex = completedWorkouts + uiOffset
   * week         = floor(displayIndex / sessionsPerWeek) + 1
   * session      = (displayIndex % sessionsPerWeek) + 1
   *
   * No calendar dependency. Missed sessions do not shift indexing.
   */
  weekAndSession(appState) {
    const n    = appState?.completedWorkouts ?? 0;
    const b    = appState?.uiOffset          ?? 0;
    const spw  = Math.max(1, appState?.sessionsPerWeek ?? 3);
    const idx  = n + b;
    const week    = Math.floor(idx / spw) + 1;
    const session = (((idx % spw) + spw) % spw) + 1; // handles negative offset safely
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

  // ── Cardio Streak System (§9/§26) ─────────────────────────────────────────

  /**
   * Count consecutive completed sessions (from newest backwards) where
   * cardio[field] === true. Breaks on the first miss.
   *
   * @param {object}  appState
   * @param {'warmupDone'|'finisherDone'} field
   * @returns {number}
   */
  cardioStreak(appState, field) {
    const sorted = this.chronological(appState);
    let streak = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      const cardio = sorted[i].cardio;
      if (cardio && cardio[field] === true) {
        streak++;
      } else {
        break;  // one miss breaks the streak
      }
    }
    return streak;
  },

  /** Consecutive sessions with warmupDone = true */
  warmupStreak(appState)   { return this.cardioStreak(appState, 'warmupDone');   },

  /** Consecutive sessions with finisherDone = true */
  finisherStreak(appState) { return this.cardioStreak(appState, 'finisherDone'); },

  // ── Fatigue Index (§11) ───────────────────────────────────────────────────

  /**
   * Per-exercise fatigue index from the LIVE set array:
   *   FatigueIndex = 1 − (lastSet.w×r / firstSet.w×r)
   *
   * Based on entry order; ignores failed sets.
   * Returns null if fewer than 2 completed sets with data.
   *
   * @param {object} appState
   * @param {string} exId
   * @returns {number|null}
   */
  fatigueIndex(appState, exId) {
    const sets = (appState.exercises[exId] || [])
      .filter(s => s.s === 'done' && s.w !== null && s.r !== null);
    if (sets.length < 2) return null;
    const first = sets[0].w * sets[0].r;
    const last  = sets[sets.length - 1].w * sets[sets.length - 1].r;
    if (first === 0) return null;
    return +(1 - last / first).toFixed(3);
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

  /**
   * Returns a human-readable progression recommendation for display on an exercise card.
   * Derives action label from progressionState T/F/lastSuggested vs current working weight.
   *
   * Returns null if no progression data exists yet (first session).
   *
   * @param {object} appState
   * @param {string} exId
   * @returns {{ action: 'increase'|'reduce'|'maintain'|'watch', label: string } | null}
   */
  progressionRecommendation(appState, exId) {
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
    if (!ps || ps.T === null || ps.lastSuggested === null || ps.lastSuggested === undefined) return null;

    // Derive the current working weight from the exercise index or overrides
    const overrides = appState?.exerciseOverrides?.[exId];
    const base = EXERCISE_INDEX_local[exId];
    const loadObj = overrides?.weight ?? base?.load;
    const currentW = loadObj
      ? (loadObj.value ?? loadObj.min ?? null)
      : null;

    const suggested = ps.lastSuggested;
    const suppressed = ps.lastSuppressed ?? false;
    const riskScore  = ps.lastRisk ?? 0;

    if (suppressed || riskScore > 0.65) {
      return { action: 'watch', label: `Hold at ${suggested} lbs · high risk` };
    }

    if (currentW === null) {
      // No current weight to compare — just show suggestion
      return { action: 'maintain', label: `Target ${suggested} lbs` };
    }

    const delta = suggested - currentW;
    if (delta > 0) {
      return { action: 'increase', label: `↑ ${suggested} lbs (+${delta.toFixed(1)})` };
    } else if (delta < 0) {
      return { action: 'reduce', label: `↓ ${suggested} lbs (${delta.toFixed(1)})` };
    } else {
      return { action: 'maintain', label: `Maintain ${suggested} lbs` };
    }
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

  sessionAnalytics(appState, sessionId) {
    const history = this.sessionHistory(appState, sessionId, 2);
    if (!history.length) return null;

    const lastEntry = history[history.length - 1];
    const prevEntry = history.length >= 2 ? history[history.length - 2] : null;

    let volume = 0, totalSets = 0, completedSets = 0;
    Object.values(lastEntry.exercises).forEach(sets => {
      totalSets += sets.length;
      sets.forEach(s => {
        if (s.s === 'done' || s.s === 'failed') completedSets++;
        if (s.s === 'done' && s.w !== null && s.r !== null) volume += s.w * s.r;
      });
    });

    let prevVolume = 0, prevTotalSets = 0, prevCompletedSets = 0;
    if (prevEntry) {
      Object.values(prevEntry.exercises).forEach(sets => {
        prevTotalSets += sets.length;
        sets.forEach(s => {
          if (s.s === 'done' || s.s === 'failed') prevCompletedSets++;
          if (s.s === 'done' && s.w !== null && s.r !== null) prevVolume += s.w * s.r;
        });
      });
    }

    const durationMs = lastEntry.startTimestamp ? lastEntry.timestamp - lastEntry.startTimestamp : null;
    const prs        = this.sessionPRsFromEntry(appState, lastEntry);

    return {
      timestamp: lastEntry.timestamp,
      volume, prevVolume,
      totalSets, completedSets,
      prevTotalSets, prevCompletedSets,
      durationMs, prs
    };
  },

  // ── Recovery Dashboard ────────────────────────────────────────────────────

  recoveryDashboard(appState) {
    const now             = Date.now();
    const oneDay          = 24 * 60 * 60 * 1000;
    const sevenDaysAgo    = now - 7 * oneDay;
    const fourteenDaysAgo = now - 14 * oneDay;
    const thirtyDaysAgo   = now - 30 * oneDay;

    const entryVolume = entry => {
      let vol = 0;
      Object.values(entry.exercises || {}).forEach(sets =>
        sets.forEach(s => { if (s.s === 'done' && s.w !== null && s.r !== null) vol += s.w * s.r; })
      );
      return vol;
    };

    const entryDuration = entry => {
      if (entry.startTimestamp && entry.timestamp > entry.startTimestamp)
        return entry.timestamp - entry.startTimestamp;
      return null;
    };

    const history            = appState.history || [];
    const last7DaysEntries   = history.filter(e => e.timestamp >= sevenDaysAgo);
    const workoutsLast7Days  = last7DaysEntries.length;
    const vol7               = last7DaysEntries.reduce((sum, e) => sum + entryVolume(e), 0);
    const prev7DaysEntries   = history.filter(e => e.timestamp >= fourteenDaysAgo && e.timestamp < sevenDaysAgo);
    const volPrev7           = prev7DaysEntries.reduce((sum, e) => sum + entryVolume(e), 0);

    let volumeTrend = null;
    if (volPrev7 > 0) volumeTrend = +(((vol7 - volPrev7) / volPrev7) * 100).toFixed(1);

    const last30DaysEntries = history.filter(e => e.timestamp >= thirtyDaysAgo);
    const durations         = last30DaysEntries.map(entryDuration).filter(d => d !== null);
    const avgDurationMs     = durations.length
      ? (durations.reduce((sum, d) => sum + d, 0) / durations.length)
      : null;

    let daysSinceLastWorkout = null;
    if (history.length > 0) {
      const lastTs          = Math.max(...history.map(e => e.timestamp));
      daysSinceLastWorkout  = +((now - lastTs) / oneDay).toFixed(1);
    }

    return {
      workoutsLast7Days,
      volumeLast7Days:     vol7,
      volumePrev7Days:     volPrev7,
      volumeTrend,
      avgDurationMs,
      daysSinceLastWorkout,
      sessionsPerWeek:     appState?.sessionsPerWeek ?? 3,
      warmupStreak:        this.warmupStreak(appState),
      finisherStreak:      this.finisherStreak(appState)
    };
  }
};
