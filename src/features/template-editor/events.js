/**
 * templateEvents.js
 * ─────────────────────────────────────────────────────────
 * Domain: data & template management
 *   - Template editor open
 *   - Import data
 *   - Export data
 *   - Copy workout to clipboard
 * ─────────────────────────────────────────────────────────
 */

import { openTemplateEditor } from './editor.js';
import { importData, exportData, copyWorkout } from '../../io/fileActions.js';

export function setupTemplateEvents() {
  document.addEventListener('click', e => {
    if (e.target.closest('#template-editor-btn')) {
      openTemplateEditor();
      return;
    }

    if (e.target.closest('#import-data-btn')) {
      importData();
      return;
    }

    if (e.target.closest('#export-data-btn')) {
      exportData();
      return;
    }

    const copyBtn = e.target.closest('#copy-btn');
    if (copyBtn) {
      copyWorkout(copyBtn);
    }
  });
}
