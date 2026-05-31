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
    initWorkouts(await res.json());
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