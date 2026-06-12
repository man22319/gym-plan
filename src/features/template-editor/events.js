/**
 * templateEvents.js
 * ─────────────────────────────────────────────────────────
 * Domain: data & template management
 *   - Template editor open
 *   - Import data
 *   - Export data
 *   - Copy workout to clipboard
 *   - Dropdown toggle (iOS-safe: click-based, not :hover)
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
      closeDropdowns();
      return;
    }

    if (e.target.closest('#export-data-btn')) {
      exportData();
      closeDropdowns();
      return;
    }

    const copyBtn = e.target.closest('#copy-btn');
    if (copyBtn) {
      copyWorkout(copyBtn);
      return;
    }

    // ── Dropdown toggle (iOS-safe: click-based) ─────────────
    const dropdownTrigger = e.target.closest('.dropdown-trigger');
    if (dropdownTrigger) {
      const dropdown = dropdownTrigger.closest('.dropdown');
      const isOpen = dropdown?.classList.contains('open');
      closeDropdowns();
      if (!isOpen && dropdown) dropdown.classList.add('open');
      return;
    }

    // Close dropdown when clicking outside
    if (!e.target.closest('.dropdown')) {
      closeDropdowns();
    }
  });
}

function closeDropdowns() {
  document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
}
