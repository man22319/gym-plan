/**
 * pressInteraction.js
 * ─────────────────────────────────────────────────────────────────────────────
 * iOS-pattern press-and-hold state machine for .set-dot elements.
 *
 * State model:
 *   IDLE → PRESSED → HOLDING → COMPLETED
 *                            ↘ CANCELLED
 *
 * Timing:
 *   DEBOUNCE_MS  (80 ms)  — minimum press time before the ring even appears.
 *                           A release before this is always a plain tap.
 *   HOLD_MS      (600 ms) — total hold duration from ring-start → completion.
 *                           Total activation = DEBOUNCE_MS + HOLD_MS ≈ 680 ms.
 *
 * Design constraints:
 *   • The SVG ring is injected imperatively (not part of the HTML string from
 *     buildDot), so it survives across render cycles without needing special
 *     care from the renderer.
 *   • All transforms use spring easing (cubic-bezier(0.34,1.56,0.64,1)) to
 *     mirror UIKit's spring parameters.
 *   • navigator.vibrate() is called on hold-start for Android tactile feedback;
 *     it silently no-ops on iOS/desktop.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { dispatch } from '../../core/logic/reducer.js';
import { openLogModal } from '../modals/index.js';

// ── Timing constants ──────────────────────────────────────────────────────────
const DEBOUNCE_MS = 80;   // tap vs. hold discriminator
const HOLD_MS     = 600;  // ring-fill duration → completion

// ── State keys ───────────────────────────────────────────────────────────────
const STATE = Object.freeze({
  IDLE:      'IDLE',
  PRESSED:   'PRESSED',
  HOLDING:   'HOLDING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});

// ── Per-dot active session (only one can be active at a time on touch devices)
let session = null; // { dot, exId, idx, state, rafId, debounceId, holdId, startTs }

// ── SVG ring geometry ─────────────────────────────────────────────────────────
const RING_R = 28; // radius — tuned to sit just outside a 52px dot (+3px inset)
const CIRCUMFERENCE = 2 * Math.PI * RING_R;

function buildRingEl() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'set-dot-ring');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('aria-hidden', 'true');

  const circle = document.createElementNS(ns, 'circle');
  circle.setAttribute('cx', '32');
  circle.setAttribute('cy', '32');
  circle.setAttribute('r', String(RING_R));
  circle.style.strokeDasharray  = String(CIRCUMFERENCE);
  circle.style.strokeDashoffset = String(CIRCUMFERENCE); // starts empty

  svg.appendChild(circle);
  return { svg, circle };
}

// ── Animation loop ────────────────────────────────────────────────────────────
function driveRing(circle, holdStartTs) {
  const elapsed  = performance.now() - holdStartTs;
  const progress = Math.min(elapsed / HOLD_MS, 1);
  // Linear time → eased visual: ease-out cubic on the offset for smooth decel
  const eased    = 1 - Math.pow(1 - progress, 2);
  circle.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - eased));

  if (progress < 1) {
    session.rafId = requestAnimationFrame(() => driveRing(circle, holdStartTs));
  } else {
    // Progress reached 1 — trigger completion
    completePress();
  }
}

// ── State transitions ─────────────────────────────────────────────────────────

function enterPressed(dot, exId, idx) {
  session = {
    dot, exId, idx,
    state: STATE.PRESSED,
    rafId: null,
    debounceId: null,
    holdId: null,
    ring: null,
    holdStartTs: null,
  };

  // Immediate press-lift visual
  dot.classList.add('set-dot--pressed');

  // Schedule ring appearance after debounce
  session.debounceId = setTimeout(() => enterHolding(), DEBOUNCE_MS);
}

function enterHolding() {
  if (!session || session.state !== STATE.PRESSED) return;
  session.state = STATE.HOLDING;

  // Haptic: 10 ms pulse on Android/Chrome; silently no-ops elsewhere
  navigator.vibrate?.(10);

  // Inject SVG ring
  const { svg, circle } = buildRingEl();
  session.dot.appendChild(svg);
  session.ring = { svg, circle };

  // Start rAF-driven fill
  session.holdStartTs = performance.now();
  session.rafId = requestAnimationFrame(() => driveRing(circle, session.holdStartTs));
}

function completePress() {
  if (!session) return;
  const { dot, exId, idx, ring, rafId } = session;
  session.state = STATE.COMPLETED;

  // Cancel rAF loop (already at 1 but guard just in case)
  if (rafId) cancelAnimationFrame(rafId);

  // Remove ring
  ring?.svg.remove();

  // Remove press-lift class; add spring-complete bounce
  dot.classList.remove('set-dot--pressed');
  dot.classList.add('set-dot--spring-complete');

  // Haptic: double-pulse on completion
  navigator.vibrate?.([15, 40, 15]);

  // Dispatch action — opens log modal (long-press intent)
  openLogModal(exId, idx);

  // Clean up spring class after animation ends
  dot.addEventListener('animationend', () => {
    dot.classList.remove('set-dot--spring-complete');
  }, { once: true });

  session = null;
}

function cancelPress(isTap = false) {
  if (!session) return;
  const { dot, exId, idx, debounceId, rafId, ring, state } = session;
  const wasHolding = state === STATE.HOLDING;

  clearTimeout(debounceId);
  if (rafId) cancelAnimationFrame(rafId);
  ring?.svg.remove();

  dot.classList.remove('set-dot--pressed');
  dot.classList.remove('set-dot--spring-complete');
  session = null;

  if (isTap) {
    // Quick-tap path: flash opacity + dispatch toggle
    dot.classList.add('set-dot--tap-flash');
    dot.addEventListener('animationend', () => {
      dot.classList.remove('set-dot--tap-flash');
    }, { once: true });
    dispatch('TOGGLE_SET', { exId, idx });
  } else if (wasHolding) {
    // Was holding but released early — just cancel, no dispatch
    // Spring back to rest
    dot.classList.add('set-dot--cancelled');
    dot.addEventListener('animationend', () => {
      dot.classList.remove('set-dot--cancelled');
    }, { once: true });
  }
}

// ── Public setup ──────────────────────────────────────────────────────────────

let pressStartX = 0;
let pressStartY = 0;

export function setupPressInteraction() {

  // ── Touch/pointer down ───────────────────────────────
  document.addEventListener('pointerdown', e => {
    const dot = e.target.closest('.set-dot');
    if (!dot || dot.dataset.exId === undefined) return;

    // Cancel any lingering session (shouldn't happen on normal use)
    if (session) cancelPress(false);

    pressStartX = e.clientX;
    pressStartY = e.clientY;
    enterPressed(
      dot,
      dot.dataset.exId,
      parseInt(dot.dataset.setIdx, 10)
    );
  });

  // ── Pointer up ──────────────────────────────────────
  document.addEventListener('pointerup', e => {
    if (!session) return;
    const dot = e.target.closest('.set-dot');

    if (dot && dot === session.dot) {
      // Released on the same dot
      const holdingLongEnough = session.state === STATE.HOLDING;
      // If we're in HOLDING but haven't completed yet — early release = tap
      // If still in PRESSED (debounce not done yet) — also a tap
      cancelPress(!holdingLongEnough);
    } else {
      // Released off the dot — cancel with no dispatch
      cancelPress(false);
    }
  });

  // ── Pointer cancel (scroll gesture, OS interruption, etc.) ──
  document.addEventListener('pointercancel', () => {
    cancelPress(false);
  });

  // ── Pointer move: cancel if drifted > 4 px ──────────
  document.addEventListener('pointermove', e => {
    if (!session) return;
    const dx = e.clientX - pressStartX;
    const dy = e.clientY - pressStartY;
    if (dx * dx + dy * dy > 16) {
      cancelPress(false);
    }
  });
}
