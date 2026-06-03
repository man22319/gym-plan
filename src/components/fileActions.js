import { workouts, state } from '../core/workouts.js';
import { dispatch } from '../core/reducer.js';
import { migrate, normalize, validate } from '../core/persistence.js';
import { formatReps, formatWeight } from './rendering.js';

export function exportTemplate() {
  try {
    const template = { version: 1, sessions: workouts };
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: `gym-template-${new Date().toISOString().slice(0,10)}.json`
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) { alert('Export template failed: ' + e.message); }
}

export function exportHistory() {
  try {
    const hist = { version: 1, history: state.history };
    const blob = new Blob([JSON.stringify(hist, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: `gym-history-${new Date().toISOString().slice(0,10)}.json`
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) { alert('Export history failed: ' + e.message); }
}

export function exportBackup() {
  try {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: `gym-backup-${new Date().toISOString().slice(0,10)}.json`
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) { alert('Export backup failed: ' + e.message); }
}

export function importTemplate() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' });
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const parsed = JSON.parse(evt.target.result);
        if (parsed.history && !parsed.sessions) {
          throw new Error('This looks like a history file, not a template.');
        }
        if (!parsed.sessions || !Array.isArray(parsed.sessions)) {
          throw new Error('Missing "sessions" array in template schema.');
        }
        dispatch('IMPORT_TEMPLATE', { sessions: parsed.sessions });
      } catch (err) { alert('Import failed: ' + err.message); }
    };
    reader.readAsText(file);
  };
  input.click();
}

export function importHistory() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' });
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const parsed = JSON.parse(evt.target.result);
        if (parsed.sessions) {
          throw new Error('This looks like a template file, not a history file.');
        }
        if (parsed.exercises && parsed.activeSessionId) {
          throw new Error('This looks like a full backup file, not a history file. Use "Import Backup" instead.');
        }
        if (!parsed.history || !Array.isArray(parsed.history)) {
          throw new Error('Missing "history" array in history schema.');
        }
        dispatch('IMPORT_HISTORY', { history: parsed.history });
      } catch (err) { alert('Import failed: ' + err.message); }
    };
    reader.readAsText(file);
  };
  input.click();
}

export function importBackup() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' });
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const parsed = JSON.parse(evt.target.result);
        if (parsed.sessions && !parsed.exercises) {
          throw new Error('This looks like a template file. Use "Import Template" instead.');
        }
        if (parsed.history && !parsed.exercises) {
          throw new Error('This looks like a history file. Use "Import History" instead.');
        }
        const migrated = migrate(parsed);
        const normal   = normalize(migrated);
        if (!validate(normal)) throw new Error('Schema mismatch');
        dispatch('IMPORT_STATE', { data: normal });
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
        lines.push(`  ${ex.letter}  ${ex.name}`);
        lines.push(`     ${ex.sets} × ${formatReps(ex.reps)}  ${formatWeight(ex.weight)}`);
        if (ex.notes) lines.push(`     Note: ${ex.notes}`);
        if (ex.alternatives?.length) lines.push(`     Alt: ${ex.alternatives.join(', ')}`);
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
    setTimeout(() => { btn.innerHTML = '<span>⎘</span> Copy Workout'; btn.classList.remove('copied'); }, 2500);
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
