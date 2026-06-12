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

function pressKey(exId, idx) { return `${exId}:${idx}`; }

function startPress(exId, idx) {
  const key = pressKey(exId, idx);
  cancelPress(key);
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
      startPress(dot.dataset.exId, parseInt(dot.dataset.setIdx, 10));
    }
  });

  // ── Set dot: press end (tap = toggle, held = log modal already opened) ──
  document.addEventListener('pointerup', e => {
    const dot = e.target.closest('.set-dot');
    if (dot) {
      commitPress(dot.dataset.exId, parseInt(dot.dataset.setIdx, 10));
    } else {
      for (const [key] of pressTimers) cancelPress(key);
    }
  });

  document.addEventListener('pointercancel', () => {
    for (const [key] of pressTimers) cancelPress(key);
  });

  document.addEventListener('pointermove', e => {
    if (e.movementX ** 2 + e.movementY ** 2 > 16) {
      for (const [key] of pressTimers) cancelPress(key);
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
