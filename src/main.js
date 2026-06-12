// ==========================================
// ─── BOOT ───
// ==========================================
// Entry point. No business logic here — only wires up modules and starts the app.

import { initWorkouts, loadState, state, setState, onRender, onSessionComplete, rebuildAllProgressions } from './core/engine.js';
import { render, setupEvents, openSessionSummaryModal } from './io/uiBarrel.js';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('../data/workouts.json');
    if (!res.ok) throw new Error(`Failed to load workouts.json: ${res.status}`);
    const data = await res.json();
    // Pass the full data object: { exercises, defaults, sessions }
    // initWorkouts extracts each layer and seeds the module-level caches.
    initWorkouts(data);
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