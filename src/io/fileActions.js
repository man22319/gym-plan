import { state, setState, defaultWorkoutsData, resolveInstance, hydrateInstanceIds } from '../core/state/store.js';
import { dispatch } from '../core/logic/reducer.js';
import { formatReps, render } from '../features/workout/rendering.js';
import { persist, normalize, sanitizeSessions } from '../core/state/persistence.js';
import { compactExport, expandImport } from './compactFormat.js';



// ── Reload Workout Schema ─────────────────────────────────────────────────────

/**
 * Re-fetch exercises.json + sessions.json and apply the fresh schema to the
 * running state. History, progressionState, and all user-accumulated data are
 * preserved. Only sessions, exerciseLibrary, and programDefaults are replaced.
 */
export async function reloadWorkoutSchema() {
  const [exRes, sessRes] = await Promise.all([
    fetch('./data/exercises.json'),
    fetch('./data/sessions.json'),
  ]);
  if (!exRes.ok)   throw new Error(`Failed to fetch exercises.json: ${exRes.status}`);
  if (!sessRes.ok) throw new Error(`Failed to fetch sessions.json: ${sessRes.status}`);
  const [exData, sessData] = await Promise.all([exRes.json(), sessRes.json()]);
  const data = { ...exData, ...sessData };
  hydrateInstanceIds(data.sessions ?? []);

  const updated = sanitizeSessions(normalize({
    ...state,
    sessions:        JSON.parse(JSON.stringify(data.sessions  ?? [])),
    exerciseLibrary: JSON.parse(JSON.stringify(data.exercises ?? {})),
    programDefaults: JSON.parse(JSON.stringify(data.defaults  ?? {})),
    // Preserve active session if it still exists in the new schema, else reset to first
    activeSessionId: (data.sessions ?? []).some(s => s.id === state.activeSessionId)
      ? state.activeSessionId
      : (data.sessions?.[0]?.id ?? null),
  }));

  setState(updated);
  persist();
  render(state);
  console.log('[reloadWorkoutSchema] Schema refreshed — history and progression preserved.');
}

export function exportData() {
  try {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    const filename = `gym-plan-backup_${mm}${dd}${yy}.json`;

    // Encode as explicit UTF-8 bytes so the file content itself carries the
    // correct encoding regardless of what charset the receiving platform
    // (e.g. iOS Share Sheet / Files app) assumes when it reads the blob.
    // Passing a raw JS string to Blob lets the browser choose the encoding;
    // passing a Uint8Array bypasses that ambiguity entirely.
    const utf8Bytes = new TextEncoder().encode(JSON.stringify(compactExport(state), null, 2));
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, utf8Bytes], { type: 'application/json' });
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
        const raw = JSON.parse(evt.target.result);
        const parsed = expandImport(raw);
        if (!parsed.sessions || !Array.isArray(parsed.sessions)) {
          throw new Error('Missing "sessions" array — not a valid backup file.');
        }
        if (!Array.isArray(parsed.history)) {
          throw new Error('Missing "history" array — not a valid backup file.');
        }
        dispatch('IMPORT_STATE', { data: parsed });
      } catch (err) { alert('Import failed: ' + err.message); }
    };
    reader.readAsText(file, 'UTF-8');
  };
  input.click();
}

export function copyWorkout(btn) {
  // Copy the PROGRAM TEMPLATE (exercises.json + sessions.json), not the live session state.
  // This gives the user the original prescribed program for easy sharing.
  const template = defaultWorkoutsData;
  if (!template) { alert('Template data not loaded.'); return; }

  const library  = template.exercises ?? {};
  const defaults = template.defaults  ?? {};

  // Read gym name + address from the live DOM header so the clipboard output
  // stays in sync with whatever the header displays — no hardcoded strings.
  const gymName    = document.querySelector('.logo')?.textContent?.trim();
  const gymAddress = document.querySelector('.subtitle')?.textContent?.trim();
  const lines = [];
  if (gymName)    lines.push(gymName);
  if (gymAddress) lines.push(gymAddress);
  if (lines.length) lines.push('');

  const sessions = template.sessions ?? [];
  sessions.forEach(session => {
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(`${session.dayLabel} — ${session.sessionLabel}`);
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(`Warm-up: ${session.warmup ?? defaults.warmup ?? ''}`);
    lines.push('');
    (session.blocks ?? []).forEach(block => {
      lines.push(block.label);
      (block.exercises ?? []).forEach(inst => {
        const ex = resolveInstance(inst, library, defaults);
        lines.push(`  ${ex.letter ?? ''}  ${ex.name}`);
        lines.push(`     ${ex.sets} × ${formatReps(ex.reps)}  ${ex.baseWeight != null ? ex.baseWeight + ' lbs' : 'BW'}`);
        if (ex.notes) lines.push(`     Note: ${ex.notes}`);
      });
      lines.push('');
    });
    lines.push(`Finisher: ${session.finisher ?? defaults.finisher ?? ''}`);
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
      fallbackCopy(text, done);
    });
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, onSuccess) {
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
