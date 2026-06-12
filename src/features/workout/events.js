/**
 * workoutEvents.js
 * ─────────────────────────────────────────────────────────
 * Domain: workout execution
 *   - Session tab selection
 *   - Set dot tap (toggle) / long-press (open log modal)
 *   - Finish Workout button
 *   - Reset session
 * ─────────────────────────────────────────────────────────
 */

import { dispatch } from '../../core/logic/reducer.js';
import { skipRestTimer } from '../../core/utils/restTimer.js';
import { openLogModal } from '../modals/index.js';

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

    // ── Reset session ────────────────────────────────────
    if (e.target.closest('#reset-btn')) {
      if (confirm('Reset current session? This will clear your set inputs and cardio. Your workout history and progression data will be kept.')) {
        skipRestTimer();
        dispatch('RESET_SESSION', {});
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  });
}
