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

import { setupWorkoutEvents }  from './workoutEvents.js';
import { setupExerciseEvents } from './exerciseEvents.js';
import { setupTemplateEvents } from './templateEvents.js';

export function setupEvents() {
  setupWorkoutEvents();
  setupExerciseEvents();
  setupTemplateEvents();
}
