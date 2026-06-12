// ==========================================
// ─── BOOT ───
// ==========================================
// Entry point. No business logic here — only wires up modules and starts the app.

import { initWorkouts, loadState, state, setState, onRender, onSessionComplete, rebuildAllProgressions } from './core/engine.js';
import { render, setupEvents, openSessionSummaryModal } from './components/ui.js';

/**
 * Resolves session block exercise arrays from bare string IDs into full exercise objects.
 * Sessions in workouts.json store exercise IDs as strings; all downstream code (rendering,
 * queries, analytics) expects full objects with id, name, sets, reps, load, etc.
 *
 * Local rule: exercise_library is the canonical source. Sessions reference only IDs.
 * This resolver runs once at boot — sessions in memory become resolved; the JSON stays unchanged.
 *
 * @param {object[]} sessions  - Array of session objects from workouts.json
 * @param {object}   library   - exercise_library map from workouts.json
 * @returns {object[]} Sessions with block exercises fully resolved
 */
function resolveSessionExercises(sessions, library) {
  if (!library || typeof library !== 'object') return sessions;
  return sessions.map(session => ({
    ...session,
    blocks: (session.blocks || []).map(block => ({
      ...block,
      exercises: (block.exercises || []).map(entry => {
        if (typeof entry === 'string') {
          const resolved = library[entry];
          if (!resolved) {
            console.warn(`[boot] exercise_library missing entry: "${entry}"`);
            return { id: entry, name: entry, sets: 0, reps: null, load: null };
          }
          return resolved;
        }
        // Already a full object (e.g. legacy flat format)
        return entry;
      })
    }))
  }));
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('./src/store/workouts.json');
    if (!res.ok) throw new Error(`Failed to load workouts.json: ${res.status}`);
    const data = await res.json();
    // Support both legacy flat array and new { completed_sessions, exercise_library, sessions } envelope
    const rawSessions = Array.isArray(data) ? data : (data.sessions || []);
    const library = Array.isArray(data) ? {} : (data.exercise_library || {});
    const sessions = resolveSessionExercises(rawSessions, library);
    const completedSessionsBase = Array.isArray(data) ? 0 : (data.completed_sessions ?? 0);
    initWorkouts(sessions, completedSessionsBase);
  } catch (err) {
    console.error('[boot] Could not load workouts.json:', err);
    return;
  }

  loadState();

  if (state && state.history && state.history.length > 0) {
    const rebuilt = rebuildAllProgressions(state);
    setState(rebuilt);
  }

  // Wire render callback — keeps engine DOM-free (no circular import).
  onRender(render);

  // Wire session-complete callback with the 600ms delay the UI needs.
  onSessionComplete((entry, appState) =>
    setTimeout(() => openSessionSummaryModal(entry, appState), 600)
  );

  render(state);
  setupEvents();
});