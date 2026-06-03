import { workouts, EXERCISE_INDEX, EX_SESSION_INDEX } from './workouts.js';

export const query = {
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
  // Returns Set[] or null.
  lastExerciseSets(appState, exId) {
    const sessionId = EX_SESSION_INDEX[exId];
    const entry = this.lastSession(appState, sessionId);
    if (!entry) return null;
    return entry.exercises[exId] || null;
  },

  // Last N entries for an exercise (for trend analysis).
  exerciseHistory(appState, exId, n = Infinity) {
    const sessionId = EX_SESSION_INDEX[exId];
    return this.sessionHistory(appState, sessionId, n).map(e => ({
      timestamp: e.timestamp,
      sets: e.exercises[exId] || []
    }));
  },

  // Derived: last completed timestamp for a session (from history, not lastDone).
  lastDoneTimestamp(appState, sessionId) {
    const entry = this.lastSession(appState, sessionId);
    return entry ? entry.timestamp : null;
  },

  // Derived: is the current working session complete?
  // Depends ONLY on state.exercises — never on history.
  isSessionComplete(appState, sessionId) {
    const session = workouts.find(s => s.id === sessionId);
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

  sessionProgress(appState, sessionId) {
    const session = workouts.find(s => s.id === sessionId);
    if (!session) return 0;
    const allEx = session.blocks.flatMap(b => b.exercises);
    const total = allEx.reduce((n, ex) => n + ex.sets, 0);
    if (!total) return 0;
    const resolved = allEx.reduce((n, ex) => {
      const sets = appState.exercises[ex.id] || [];
      return n + sets.filter(s => s.s === 'done' || s.s === 'failed').length;
    }, 0);
    return Math.round((resolved / total) * 100);
  },

  // ── Derived metrics (NEVER persisted) ──

  // Volume for a set array: Σ(w × r) — skips null/failed
  setVolume(sets) {
    return sets.reduce((sum, s) => {
      if (s.w !== null && s.r !== null && s.s !== 'failed') {
        return sum + s.w * s.r;
      }
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

  // ── A: Progression recommendation ──
  // Examines the last 1–2 logged sessions for exId.
  // Returns { action: 'increase'|'maintain'|'reduce'|'watch', suggestedWeight, label } or null.
  progressionRecommendation(appState, exId) {
    const history = this.exerciseHistory(appState, exId, 2);
    if (!history.length) return null;

    const lastEntry = history[history.length - 1];
    const prevEntry = history.length >= 2 ? history[history.length - 2] : null;
    const sets = lastEntry.sets;
    if (!sets || !sets.length) return null;

    const ex = EXERCISE_INDEX[exId];
    const doneSets = sets.filter(s => s.s === 'done' && s.w !== null && s.r !== null);
    if (!doneSets.length) return null;

    const failedSets = sets.filter(s => s.s === 'failed');
    const totalSets = sets.length;
    const repMax = ex?.reps ? (('max' in ex.reps) ? ex.reps.max : (ex.reps.fixed ?? ex.reps.value ?? null)) : null;
    const repMin = ex?.reps ? (('min' in ex.reps) ? ex.reps.min : (ex.reps.fixed ?? ex.reps.value ?? null)) : null;
    const avgW = doneSets.reduce((n, s) => n + s.w, 0) / doneSets.length;
    const reduction = avgW >= 50 ? 5 : 2.5;
    const increment = avgW >= 50 ? 5 : 2.5;

    // ≥25% failed sets → reduce
    if (failedSets.length > 0 && (failedSets.length / totalSets) >= 0.25) {
      const suggestedWeight = Math.max(0, +(avgW - reduction).toFixed(1));
      return { action: 'reduce', suggestedWeight, label: `↓ Reduce to ${suggestedWeight} lbs` };
    }

    // All done sets hit repMax → increase
    const allAtTop = repMax !== null && doneSets.every(s => s.r >= repMax);
    if (allAtTop) {
      const suggestedWeight = +(avgW + increment).toFixed(1);
      return { action: 'increase', suggestedWeight, label: `✓ Increase to ${suggestedWeight} lbs` };
    }

    // Below rep min: check consecutive sessions
    const anyBelowMin = repMin !== null && doneSets.some(s => s.r < repMin);
    if (anyBelowMin) {
      // Check if previous session was also below min
      let prevAlsoBelowMin = false;
      if (prevEntry && prevEntry.sets) {
        const prevDone = prevEntry.sets.filter(s => s.s === 'done' && s.w !== null && s.r !== null);
        prevAlsoBelowMin = repMin !== null && prevDone.length > 0 && prevDone.some(s => s.r < repMin);
      }

      if (prevAlsoBelowMin) {
        // 2 consecutive sessions below min → reduce
        const suggestedWeight = Math.max(0, +(avgW - reduction).toFixed(1));
        return { action: 'reduce', suggestedWeight, label: `↓ Reduce to ${suggestedWeight} lbs` };
      } else {
        // Single session below min → watch
        return { action: 'watch', suggestedWeight: avgW, label: `⚠ Watch — below range` };
      }
    }

    // Within range → maintain
    return { action: 'maintain', suggestedWeight: avgW, label: `→ Maintain ${avgW} lbs` };
  },

  // ── D: Personal Records ──
  // Returns { heaviestSet, highestVolume, mostReps } for an exercise across all history.
  // Each record: { w, r, date (timestamp), volume }
  personalRecords(appState, exId) {
    const history = this.exerciseHistory(appState, exId);
    let heaviestSet = null;
    let highestVolume = null;
    let mostReps = null;

    for (const entry of history) {
      const doneSets = entry.sets.filter(s => s.s === 'done' && s.w !== null && s.r !== null);
      const volume = doneSets.reduce((n, s) => n + s.w * s.r, 0);

      for (const s of doneSets) {
        // Heaviest weight
        if (!heaviestSet || s.w > heaviestSet.w || (s.w === heaviestSet.w && s.r > heaviestSet.r)) {
          heaviestSet = { w: s.w, r: s.r, date: entry.timestamp };
        }
        // Most reps at any weight
        if (!mostReps || s.r > mostReps.r || (s.r === mostReps.r && s.w > mostReps.w)) {
          mostReps = { w: s.w, r: s.r, date: entry.timestamp };
        }
      }
      // Highest session volume
      if (volume > 0 && (!highestVolume || volume > highestVolume.volume)) {
        highestVolume = { volume, date: entry.timestamp };
      }
    }
    return { heaviestSet, highestVolume, mostReps };
  },

  // Check whether the current live sets for exId set any PRs vs historical records.
  // Returns array of PR type strings: 'weight', 'reps', 'volume'
  currentSetPRs(appState, exId) {
    const currentSets = appState.exercises[exId] || [];
    const doneSets = currentSets.filter(s => s.s === 'done' && s.w !== null && s.r !== null);
    if (!doneSets.length) return [];

    // Get records WITHOUT the current (in-progress) session — compare against history only
    const sessionId = EX_SESSION_INDEX[exId];
    const histEntries = this.sessionHistory(appState, sessionId).filter(e => {
      // Exclude the most recent entry if it matches the live exercise state
      // (it might be a just-completed session that was auto-added)
      return true;
    });

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

    if (prWeight === null && prReps === null) return []; // no history to compare against

    const prs = [];
    const currMaxW = Math.max(...doneSets.map(s => s.w));
    const currMaxR = Math.max(...doneSets.map(s => s.r));
    const currVol  = doneSets.reduce((n, s) => n + s.w * s.r, 0);

    if (prWeight !== null && currMaxW > prWeight) prs.push('weight');
    if (prReps   !== null && currMaxR > prReps)   prs.push('reps');
    if (prVolume !== null && currVol  > prVolume) prs.push('volume');
    return prs;
  },

  // ── C: Session PRs from a completed history entry ──
  // Returns map of exId → array of PR types ('weight', 'reps', 'volume')
  sessionPRsFromEntry(appState, entry) {
    const result = {};
    const session = workouts.find(s => s.id === entry.sessionId);
    if (!session) return result;

    // History excluding this entry
    const priorHistory = (appState.history || []).filter(e => e.timestamp < entry.timestamp);
    const priorState = { ...appState, history: priorHistory };

    for (const block of session.blocks) {
      for (const ex of block.exercises) {
        const exId = ex.id;
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
        if (prWeight === null && prReps === null) continue; // no prior history
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

    let volume = 0;
    let totalSets = 0;
    let completedSets = 0;
    Object.values(lastEntry.exercises).forEach(sets => {
      totalSets += sets.length;
      sets.forEach(s => {
        if (s.s === 'done' || s.s === 'failed') completedSets++;
        if (s.s === 'done' && s.w !== null && s.r !== null) {
          volume += s.w * s.r;
        }
      });
    });

    let prevVolume = 0;
    let prevTotalSets = 0;
    let prevCompletedSets = 0;
    if (prevEntry) {
      Object.values(prevEntry.exercises).forEach(sets => {
        prevTotalSets += sets.length;
        sets.forEach(s => {
          if (s.s === 'done' || s.s === 'failed') prevCompletedSets++;
          if (s.s === 'done' && s.w !== null && s.r !== null) {
            prevVolume += s.w * s.r;
          }
        });
      });
    }

    const durationMs = lastEntry.startTimestamp ? lastEntry.timestamp - lastEntry.startTimestamp : null;
    const prs = this.sessionPRsFromEntry(appState, lastEntry);

    return {
      timestamp: lastEntry.timestamp,
      volume,
      prevVolume,
      totalSets,
      completedSets,
      prevTotalSets,
      prevCompletedSets,
      durationMs,
      prs
    };
  },

  recoveryDashboard(appState) {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * oneDay;
    const fourteenDaysAgo = now - 14 * oneDay;
    const thirtyDaysAgo = now - 30 * oneDay;

    const entryVolume = entry => {
      let vol = 0;
      Object.values(entry.exercises || {}).forEach(sets => {
        sets.forEach(s => {
          if (s.s === 'done' && s.w !== null && s.r !== null) {
            vol += s.w * s.r;
          }
        });
      });
      return vol;
    };

    const entryDuration = entry => {
      if (entry.startTimestamp && entry.timestamp > entry.startTimestamp) {
        return entry.timestamp - entry.startTimestamp;
      }
      return null;
    };

    const history = appState.history || [];

    const last7DaysEntries = history.filter(e => e.timestamp >= sevenDaysAgo);
    const workoutsLast7Days = last7DaysEntries.length;

    const vol7 = last7DaysEntries.reduce((sum, e) => sum + entryVolume(e), 0);
    const prev7DaysEntries = history.filter(e => e.timestamp >= fourteenDaysAgo && e.timestamp < sevenDaysAgo);
    const volPrev7 = prev7DaysEntries.reduce((sum, e) => sum + entryVolume(e), 0);

    let volumeTrend = null;
    if (volPrev7 > 0) {
      volumeTrend = +(((vol7 - volPrev7) / volPrev7) * 100).toFixed(1);
    }

    const last30DaysEntries = history.filter(e => e.timestamp >= thirtyDaysAgo);
    const durations = last30DaysEntries.map(entryDuration).filter(d => d !== null);
    const avgDurationMs = durations.length ? (durations.reduce((sum, d) => sum + d, 0) / durations.length) : null;

    let daysSinceLastWorkout = null;
    if (history.length > 0) {
      const lastWorkoutTs = Math.max(...history.map(e => e.timestamp));
      daysSinceLastWorkout = +((now - lastWorkoutTs) / oneDay).toFixed(1);
    }

    return {
      workoutsLast7Days,
      volumeLast7Days: vol7,
      volumePrev7Days: volPrev7,
      volumeTrend,
      avgDurationMs,
      daysSinceLastWorkout
    };
  }
};
