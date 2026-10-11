// Escape reaches conflicting menu handlers in the upstream web build. Route it
// through the virtual Xbox Start button (the same input used by the touch pad)
// instead of passing a keyboard key to both the controller and menu widgets.
let held = false, startDown = false, pressedAt = 0, frameAtPress = 0, timer = null;

function pad() {
  // Reuse the touch controller if present; preserve movement/triggers/buttons.
  return globalThis.skateTouch || (globalThis.skateTouch = [0, 0, 0, 0, 0, 0, 0]);
}

function release() {
  clearTimeout(timer);
  timer = null;
  if (!startDown) return;
  startDown = false;
  pad()[0] &= ~0x0010;
}

function releaseAfterFrame() {
  const elapsed = performance.now() - pressedAt;
  const frames = globalThis.__skatePerformance?.stats.frames;
  // Even a fast tap must survive long enough for the controller poll to see
  // Start. Slow machines may not run a frame between the real down and up.
  if (elapsed < 75 || (frames === frameAtPress && elapsed < 500)) {
    timer = setTimeout(releaseAfterFrame, 25);
  } else release();
}

function escape(event) {
  if (event.code !== 'Escape' && event.key !== 'Escape' && event.key !== 'Esc') return;
  const typing = event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable="true"]');
  // Native selects and text fields keep their own Escape behavior without
  // leaking the same key into the game's global menu listener.
  event.stopImmediatePropagation();
  if (typing && !held) return;
  event.preventDefault();
  if (event.type === 'keydown') {
    if (event.repeat || held || startDown) return;
    held = true;
    startDown = true;
    pressedAt = performance.now();
    frameAtPress = globalThis.__skatePerformance?.stats.frames;
    pad()[0] |= 0x0010;
  } else {
    held = false;
    clearTimeout(timer);
    releaseAfterFrame();
  }
}

// Capture before the canvas, egui document listener, and window controller
// listener. Only Escape is intercepted; movement and real Enter stay native.
window.addEventListener('keydown', escape, true);
window.addEventListener('keyup', escape, true);
window.addEventListener('blur', () => { held = false; release(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { held = false; release(); }
});
