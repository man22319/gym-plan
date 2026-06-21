import { REST_DURATION, MAX_REST_DURATION } from '../state/state.js';

export let restTimerId = null;
let restRemaining = 0;
let restDuration = REST_DURATION;

const timerCallbacks = [];

export function onTimerUpdate(cb) {
  timerCallbacks.push(cb);
}

function notify(event) {
  const state = getRestState();
  timerCallbacks.forEach(cb => {
    try {
      cb(event, state);
    } catch (err) {
      console.error('[timer callback error]', err);
    }
  });
}

export function startRestTimer(duration = REST_DURATION) {
  clearInterval(restTimerId);
  restDuration = Math.min(duration, MAX_REST_DURATION);
  restRemaining = restDuration;

  notify('start');
  startRestTimerLoop();
}

export function startRestTimerLoop() {
  clearInterval(restTimerId);
  // Track the real wall-clock start so the countdown is immune to browser
  // throttling (tabs backgrounded, Spotify open, phone locked, etc.).
  // We poll at 500ms so the display stays smooth even if a tick fires late.
  const startTime      = Date.now();
  const startRemaining = restRemaining;

  restTimerId = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    restRemaining    = Math.max(0, startRemaining - elapsedSec);

    if (restRemaining <= 0) {
      clearInterval(restTimerId);
      restRemaining = 0;
      notify('complete');
    } else {
      notify('tick');
    }
  }, 500);
}

export function extendRestTimer(amount = 30) {
  // Already at or above max — no-op
  if (restRemaining >= MAX_REST_DURATION) return;

  const wasFinished = restRemaining <= 0;
  clearInterval(restTimerId);

  if (wasFinished) {
    restRemaining = Math.min(amount, MAX_REST_DURATION);
  } else {
    restRemaining = Math.min(restRemaining + amount, MAX_REST_DURATION);
  }
  // Always reset duration to match remaining so the bar fills from 100%
  // after each extension, instead of accumulating a denominator that
  // makes the bar impossible to visually refill.
  restDuration = restRemaining;

  notify('extend');
  startRestTimerLoop();
}

export function getRestState() {
  return {
    remaining: restRemaining,
    duration: restDuration,
    isMaxed: restRemaining >= MAX_REST_DURATION
  };
}

export function skipRestTimer() {
  clearInterval(restTimerId);
  restRemaining = 0;
  notify('stop');
}
