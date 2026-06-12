import { setupEvents as baseSetupEvents } from './eventsBridge.js';
import { initTimerUI } from '../features/timer/ui.js';
import { initETAUI } from '../features/workout/rendering.js';

export { render, renderSetUpdate, renderCardioUpdate } from '../features/workout/rendering.js';
export { openSessionSummaryModal } from '../features/modals/index.js';

export function setupEvents() {
  baseSetupEvents();
  initTimerUI();
  initETAUI();
}
