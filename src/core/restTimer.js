import { REST_DURATION, MAX_REST_DURATION } from '../store/state.js';

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
  restTimerId = setInterval(() => {
    restRemaining--;
    if (restRemaining <= 0) {
      clearInterval(restTimerId);
      restRemaining = 0;
      notify('complete');
    } else {
      notify('tick');
    }
  }, 1000);
}

export function extendRestTimer(amount = 30) {
  // Already at or above max — no-op
  if (restRemaining >= MAX_REST_DURATION) return;

  const wasFinished = restRemaining <= 0;
  clearInterval(restTimerId);

  if (wasFinished) {
    restRemaining = Math.min(amount, MAX_REST_DURATION);
    restDuration = restRemaining;
  } else {
    restRemaining = Math.min(restRemaining + amount, MAX_REST_DURATION);
    restDuration = Math.min(restDuration + amount, MAX_REST_DURATION);
  }

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
