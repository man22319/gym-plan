import { onTimerUpdate } from '../../core/utils/restTimer.js';

export function initTimerUI() {
  onTimerUpdate((event, data) => {
    const bar = document.getElementById('rest-timer-bar');
    const fill = document.getElementById('rest-timer-fill');
    const count = document.getElementById('rest-timer-count');
    const btn = document.getElementById('rest-timer-extend');
    
    if (!bar || !fill || !count) return;

    const updateExtendButton = (isMaxed) => {
      if (!btn) return;
      if (isMaxed) {
        btn.classList.add('disabled');
        btn.textContent = 'MAX';
      } else {
        btn.classList.remove('disabled');
        btn.textContent = '+30s';
      }
    };

    if (event === 'start') {
      bar.classList.remove('hidden', 'done-state');
      count.textContent = data.remaining;
      fill.style.transition = 'none';
      fill.style.width = '100%';
      void fill.offsetWidth; // Force layout calculation to reset transition
      fill.style.transition = '';
      updateExtendButton(data.isMaxed);
    } else if (event === 'tick' || event === 'extend') {
      bar.classList.remove('hidden', 'done-state');
      count.textContent = data.remaining > 0 ? data.remaining : 'GO';
      fill.style.width = Math.max(0, (data.remaining / data.duration) * 100) + '%';
      updateExtendButton(data.isMaxed);
    } else if (event === 'complete') {
      bar.classList.add('done-state');
      count.textContent = 'GO';
      fill.style.width = '0%';
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      
      setTimeout(() => {
        // Only hide if a new rest timer hasn't started or been extended (which would reset remaining)
        // Since event closure has state from tick 'complete', we check current DOM text/classes or get fresh state
        // To be safe, we can inspect if count text is still 'GO' or if the timer is not running
        if (count.textContent === 'GO') {
          bar.classList.add('hidden');
          bar.classList.remove('done-state');
        }
      }, 4000);
    } else if (event === 'stop') {
      bar.classList.add('hidden');
      bar.classList.remove('done-state');
    }
  });
}
