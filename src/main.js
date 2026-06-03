// ==========================================
// ─── BOOT ───
// ==========================================
// Entry point. No business logic here — only wires up modules and starts the app.

import { initWorkouts, loadState, state, onRender, onSessionComplete } from './core/engine.js';
import { render, setupEvents, openSessionSummaryModal } from './components/ui.js';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('./src/store/workouts.json');
    if (!res.ok) throw new Error(`Failed to load workouts.json: ${res.status}`);
    const data = await res.json();
    // Support both legacy flat array and new { completed_sessions, sessions } envelope
    const sessions = Array.isArray(data) ? data : (data.sessions || []);
    const completedSessionsBase = Array.isArray(data) ? 0 : (data.completed_sessions ?? 0);
    initWorkouts(sessions, completedSessionsBase);
  } catch (err) {
    console.error('[boot] Could not load workouts.json:', err);
    return;
  }

  loadState();

  // Wire render callback — keeps engine DOM-free (no circular import).
  onRender(render);

  // Wire session-complete callback with the 600ms delay the UI needs.
  onSessionComplete((entry, appState) =>
    setTimeout(() => openSessionSummaryModal(entry, appState), 600)
  );

  render(state);
  setupEvents();
});