import { workouts, state } from '../core/workouts.js';
import { dispatch } from '../core/reducer.js';
import { formatReps, formatWeight } from './rendering.js';

export function exportData() {
  try {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    const filename = `gym-plan-backup_${mm}${dd}${yy}.json`;

    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Defer revocation — some browsers (iOS Safari) need a tick to start the
    // download before the blob URL is invalidated.
    setTimeout(() => URL.revokeObjectURL(url), 100);
  } catch (e) { alert('Export failed: ' + e.message); }
}

export function importData() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' });
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const parsed = JSON.parse(evt.target.result);
        if (!parsed.sessions || !Array.isArray(parsed.sessions)) {
          throw new Error('Missing "sessions" array — not a valid backup file.');
        }
        if (!Array.isArray(parsed.history)) {
          throw new Error('Missing "history" array — not a valid backup file.');
        }
        dispatch('IMPORT_STATE', { data: parsed });
      } catch (err) { alert('Import failed: ' + err.message); }
    };
    reader.readAsText(file);
  };
  input.click();
}

export function copyWorkout(btn) {
  // Read gym name + address from the live DOM header so the clipboard output
  // stays in sync with whatever the header displays — no hardcoded strings.
  const gymName    = document.querySelector('.logo')?.textContent?.trim();
  const gymAddress = document.querySelector('.subtitle')?.textContent?.trim();
  const lines = [];
  if (gymName)    lines.push(gymName);
  if (gymAddress) lines.push(gymAddress);
  if (lines.length) lines.push('');

  workouts.forEach(session => {
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(`${session.dayLabel} — ${session.sessionLabel}`);
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(`Warm-up: ${session.warmup}`);
    lines.push('');
    session.blocks.forEach(block => {
      lines.push(block.label);
      block.exercises.forEach(ex => {
        lines.push(`  ${ex.letter ?? ''}  ${ex.name}`);
        lines.push(`     ${ex.sets} × ${formatReps(ex.reps)}  ${formatWeight(ex.load ?? ex.weight)}`);
        if (ex.notes) lines.push(`     Note: ${ex.notes}`);
        const alts = Array.isArray(ex.alternatives) ? ex.alternatives : [];
        if (alts.length) lines.push(`     Alt: ${alts.join(', ')}`);
      });
      lines.push('');
    });
    lines.push(`Finisher: ${session.finisher}`);
    lines.push('');
  });

  const text = lines.join('\n');

  // Checkmark only — no text, no emoji, font-size:0 via CSS suppresses any stray text nodes
  const CHECK_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  const originalHTML = btn.innerHTML;

  const done = () => {
    btn.innerHTML = CHECK_SVG;          // checkmark only, no "Copied!" text
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = originalHTML; btn.classList.remove('copied'); }, 2500);
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => {
      // Modern API failed — try legacy fallback
      legacyCopy(text, done);
    });
  } else {
    legacyCopy(text, done);
  }
}

function legacyCopy(text, onSuccess) {
  const ta = Object.assign(document.createElement('textarea'), { value: text });
  Object.assign(ta.style, { position: 'fixed', opacity: '0' });
  document.body.appendChild(ta);
  ta.select();
  try {
    const ok = document.execCommand('copy');
    if (!ok) throw new Error('execCommand returned false');
    onSuccess();
  } catch (err) {
    alert('Copy failed — please copy the text manually.\n\nError: ' + err.message);
  } finally {
    document.body.removeChild(ta);
  }
}
