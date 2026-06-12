import { setupEvents as baseSetupEvents } from './eventsBridge.js';
import { initTimerUI } from '../features/timer/ui.js';

export { render, renderSetUpdate } from '../features/workout/rendering.js';
export { openSessionSummaryModal } from '../features/modals/index.js';

export function setupEvents() {
  baseSetupEvents();
  initTimerUI();
}
