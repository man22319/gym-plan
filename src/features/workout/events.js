/**
 * workoutEvents.js
 * ─────────────────────────────────────────────────────────
 * Domain: workout execution
 *   - Session tab selection
 *   - Set dot tap (toggle) / long-press (open log modal)
 *   - Finish Workout button
 *   - Reset dropdown (Reset Session / Reload Data / Factory Reset)
 * ─────────────────────────────────────────────────────────
 */

import { dispatch } from '../../core/logic/reducer.js';
import { skipRestTimer } from '../../core/utils/restTimer.js';
import { showConfirmModal } from '../modals/index.js';
import { reloadWorkoutSchema, exportData } from '../../io/fileActions.js';
import { setupPressInteraction } from './pressInteraction.js';

// Press-and-hold interaction is handled entirely by pressInteraction.js.
// See that module for the full state machine (IDLE → PRESSED → HOLDING → COMPLETED/CANCELLED).

// ── Reset dropdown helpers ────────────────────────────────

function closeResetDropdown() {
  const dd = document.getElementById('reset-dropdown');
  if (dd) dd.classList.remove('open');
}

function setupResetDropdown() {
  const trigger = document.getElementById('reset-dropdown-trigger');
  const dropdown = document.getElementById('reset-dropdown');
  if (!trigger || !dropdown) return;

  // Toggle on trigger click
  trigger.addEventListener('click', e => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  // Close on outside click
  document.addEventListener('click', e => {
    if (!dropdown.contains(e.target)) closeResetDropdown();
  });

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeResetDropdown();
  });
}

export function setupWorkoutEvents() {
  // ── Set dot: iOS-style press-and-hold state machine ──
  setupPressInteraction();

  // ── Session tab click ────────────────────────────────
  document.addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (tab) {
      dispatch('SET_ACTIVE_SESSION', { sessionId: tab.dataset.sessionId });
      return;
    }

    // ── Finish workout ───────────────────────────────────
    const finishBtn = e.target.closest('.finish-workout-btn');
    if (finishBtn) {
      dispatch('FINISH_WORKOUT', { sessionId: finishBtn.dataset.sessionId });
      return;
    }

    // ── Export data (inline button) ──────────────────────
    if (e.target.closest('.export-inline-btn')) {
      exportData();
      return;
    }

    // ── Reset Session ───────────────────────────────────
    if (e.target.closest('#reset-session-btn')) {
      closeResetDropdown();
      showConfirmModal(
        'Reset Session',
        'Clear all set inputs and cardio for this session.<br><br>Your workout history and progression data will be kept.',
        () => {
          skipRestTimer();
          dispatch('RESET_SESSION', {});
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        { dangerous: false, confirmLabel: 'Reset Session', cancelLabel: 'Cancel' }
      );
      return;
    }

    // ── Reload Imported Data ─────────────────────────────
    if (e.target.closest('#reload-data-btn')) {
      closeResetDropdown();
      showConfirmModal(
        'Reload Imported Data',
        'Fetch a fresh copy of the workout schema from the source file.<br><br>Your history and progression data will be preserved.',
        async () => {
          try {
            await reloadWorkoutSchema();
          } catch (err) {
            console.error('[Reload] Failed to reload workout schema:', err);
            alert('Reload failed: ' + err.message);
          }
        },
        { dangerous: false, confirmLabel: 'Reload', cancelLabel: 'Cancel' }
      );
      return;
    }

    // ── Factory Reset ────────────────────────────────────
    if (e.target.closest('#factory-reset-btn')) {
      closeResetDropdown();
      showConfirmModal(
        'Factory Reset',
        '<strong>This will permanently wipe all workout history, progression data, and session logs.</strong><br><br>The app will return to a fresh install state. This cannot be undone.',
        () => {
          skipRestTimer();
          dispatch('FACTORY_RESET', {});
          window.scrollTo({ top: 0, behavior: 'smooth' });
        },
        { dangerous: true, confirmLabel: 'Wipe Everything', cancelLabel: 'Cancel' }
      );
      return;
    }
  });

  // ── Reset dropdown toggle ─────────────────────────────
  setupResetDropdown();
}
