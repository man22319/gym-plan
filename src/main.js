// ==========================================
// ─── BOOT ───
// ==========================================
// Entry point. No business logic here — only wires up modules and starts the app.

import { initWorkouts, loadState, state, setState, onRender, onPatchRender, onCardioRender, onSessionComplete, rebuildAllProgressions } from './core/engine.js';
import { render, renderSetUpdate, renderCardioUpdate, setupEvents, openSessionSummaryModal } from './io/uiBarrel.js';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [exRes, sessRes] = await Promise.all([
      fetch('./data/exercises.json'),
      fetch('./data/sessions.json'),
    ]);
    if (!exRes.ok)   throw new Error(`Failed to load exercises.json: ${exRes.status}`);
    if (!sessRes.ok) throw new Error(`Failed to load sessions.json: ${sessRes.status}`);
    const [exData, sessData] = await Promise.all([exRes.json(), sessRes.json()]);
    // Merge into the unified shape: { exercises, defaults, sessions }
    // initWorkouts extracts each layer and seeds the module-level caches.
    const data = { ...exData, ...sessData };
    initWorkouts(data);
  } catch (err) {
    console.error('[boot] Could not load data files:', err);
    return;
  }

  loadState();

  if (state && state.history && state.history.length > 0) {
    const rebuilt = rebuildAllProgressions(state);
    setState(rebuilt);
  }

  // Wire render callback — keeps engine DOM-free (no circular import).
  onRender(render);
  // Wire targeted patch-render for set-level actions (avoids full innerHTML rebuild).
  onPatchRender(renderSetUpdate);
  // Wire targeted cardio render for warm-up / finisher toggles.
  onCardioRender(renderCardioUpdate);

  // Wire session-complete callback with the 600ms delay the UI needs.
  onSessionComplete((entry, appState, isCycleComplete) =>
    setTimeout(() => openSessionSummaryModal(entry, appState, isCycleComplete), 600)
  );


  render(state);
  setupEvents();
});