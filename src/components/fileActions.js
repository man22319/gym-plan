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
    URL.revokeObjectURL(url);
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
  const lines = ['PLANET FITNESS — STRENGTH PLAN', '3525 Washington St', ''];
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
  const done = () => {
    btn.innerHTML = '&#10003; Copied';
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = 'Copy Workout'; btn.classList.remove('copied'); }, 2500);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done);
  } else {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    Object.assign(ta.style, { position: 'fixed', opacity: '0' });
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch(_) {}
    document.body.removeChild(ta);
  }
}
