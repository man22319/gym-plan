import { setupEvents as baseSetupEvents } from './eventHandlers.js';
import { initTimerUI } from './timerUI.js';

export { render } from './rendering.js';
export { openSessionSummaryModal } from './modals.js';

export function setupEvents() {
  baseSetupEvents();
  initTimerUI();
}
