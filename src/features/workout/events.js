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
import { openLogModal, showConfirmModal } from '../modals/index.js';
import { reloadWorkoutSchema } from '../../io/fileActions.js';

const pressTimers = new Map();

const LONG_PRESS_MS = 480;
// Track pointer start position to cancel long-press on move.
// iOS Safari doesn't reliably supply e.movementX/Y, so we track manually.
let pressStartX = 0;
let pressStartY = 0;

function pressKey(exId, idx) { return `${exId}:${idx}`; }

function startPress(exId, idx, clientX, clientY) {
  const key = pressKey(exId, idx);
  cancelPress(key);
  pressStartX = clientX ?? 0;
  pressStartY = clientY ?? 0;
  pressTimers.set(key, setTimeout(() => {
    pressTimers.delete(key);
    openLogModal(exId, idx);
  }, LONG_PRESS_MS));
}

function cancelPress(key) {
  if (pressTimers.has(key)) {
    clearTimeout(pressTimers.get(key));
    pressTimers.delete(key);
  }
}

function cancelAllPresses() {
  for (const [key] of pressTimers) cancelPress(key);
}

function commitPress(exId, idx) {
  const key = pressKey(exId, idx);
  if (pressTimers.has(key)) {
    cancelPress(key);
    dispatch('TOGGLE_SET', { exId, idx });
  }
}

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
  // ── Set dot: press start ─────────────────────────────
  document.addEventListener('pointerdown', e => {
    const dot = e.target.closest('.set-dot');
    if (dot) {
      startPress(dot.dataset.exId, parseInt(dot.dataset.setIdx, 10), e.clientX, e.clientY);
    }
  });

  // ── Set dot: press end (tap = toggle, held = log modal already opened) ──
  document.addEventListener('pointerup', e => {
    const dot = e.target.closest('.set-dot');
    if (dot) {
      commitPress(dot.dataset.exId, parseInt(dot.dataset.setIdx, 10));
    } else {
      cancelAllPresses();
    }
  });

  document.addEventListener('pointercancel', () => {
    cancelAllPresses();
  });

  document.addEventListener('pointermove', e => {
    // Cancel long-press if pointer drifted more than 4px from start.
    // We do NOT use e.movementX/Y because iOS Safari doesn't populate them.
    const dx = e.clientX - pressStartX;
    const dy = e.clientY - pressStartY;
    if (dx * dx + dy * dy > 16) {
      cancelAllPresses();
    }
  });

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
        '⚠ Factory Reset',
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
