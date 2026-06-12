/**
 * eventHandlers.js
 * ─────────────────────────────────────────────────────────
 * Orchestrator — registers all domain-specific event handlers.
 *
 * Domain modules:
 *   workoutEvents   — set dots, session tabs, finish, reset
 *   exerciseEvents  — edit panel, history modal, cardio, rest timer
 *   templateEvents  — template editor, import, export, copy
 * ─────────────────────────────────────────────────────────
 */

import { setupWorkoutEvents }  from '../features/workout/events.js';
import { setupExerciseEvents } from '../features/exercise/events.js';
import { setupTemplateEvents } from '../features/template-editor/events.js';

export function setupEvents() {
  setupWorkoutEvents();
  setupExerciseEvents();
  setupTemplateEvents();
}
