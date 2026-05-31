// ==========================================
// ─── BOOT ───
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('workouts.json');
    if (!res.ok) throw new Error(`Failed to load workouts.json: ${res.status}`);
    workouts = await res.json();
    buildIndexes();
  } catch (err) {
    console.error('[boot] Could not load workouts.json:', err);
    return;
  }
  loadState();
  render(state);
  setupEvents();
});