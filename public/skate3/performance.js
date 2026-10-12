// Graphics policy for the compiled engine. Hooks are restricted to its browser
// bridge: the page, touch controls and other games keep their normal sizing.
const params = new URLSearchParams(location.search);
const PROFILES = {
  performance: { long: 960, short: 540, lite: true },
  balanced: { long: 1280, short: 720, lite: true },
  quality: { long: Infinity, short: Infinity, lite: false },
};
const KEY = 'skate3-quality';
let saved = 'auto';
try { saved = localStorage.getItem(KEY) || 'auto'; } catch { /* blocked storage */ }
const valid = value => value === 'auto' || Object.hasOwn(PROFILES, value);
const requested = params.get('quality') || saved;
const selection = valid(requested) ? requested : 'auto';
const lowPower = /CrOS/.test(navigator.userAgent) ||
  (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
  (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
  matchMedia('(pointer: coarse)').matches;
const profile = selection === 'auto' ? (lowPower ? 'performance' : 'balanced') : selection;
const config = PROFILES[profile];
globalThis.SKATE_LITE = params.has('lite') ? params.get('lite') === '1' : config.lite;

function ratio(actual = window.devicePixelRatio || 1) {
  const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
  return Math.min(actual, config.long / Math.max(w, h), config.short / Math.min(w, h));
}

const stats = { frames: 0, fps: 0, profile, lite: globalThis.SKATE_LITE };
let last = 0, elapsed = 0, count = 0;
function recordFrame(t) {
  stats.frames++;
  if (last && !document.hidden) { elapsed += t - last; count++; }
  last = t;
  if (elapsed >= 1000) {
    stats.fps = Math.round(count * 1000 / elapsed);
    elapsed = 0;
    count = 0;
  }
}
document.addEventListener('visibilitychange', () => { last = 0; elapsed = 0; count = 0; });

const modePanel = document.getElementById('mode-panel');
let paused = false;
function report(message) {
  // The engine's state reports cover keyboard, controller, touch and UI-driven
  // pause changes. Observe them in the WASM bridge instead of guessing from
  // Escape presses or wrapping the browser's console API.
  if (typeof message !== 'string' ||
      !(message.startsWith('REPORT_TRANSITION ') || message.startsWith('REPORT_META state='))) return;
  const match = message.match(/\bpaused:(true|false)\b/);
  if (!match) return;
  const next = match[1] === 'true';
  if (next === paused) return;
  paused = next;
  document.documentElement.classList.toggle('skate-paused', paused);
  if (modePanel) {
    const focused = modePanel.contains(document.activeElement);
    modePanel.hidden = !paused;
    if (!paused && focused) document.getElementById('bevy').focus();
  }
}

// Native disclosure/scroll keys must not also operate the engine's pause menu.
// Keep browser defaults (including Tab and Space), and leave Escape to input.js.
const guideKeys = new Set(['Enter', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Tab']);
window.addEventListener('keydown', event => {
  if (paused && guideKeys.has(event.code) && event.target instanceof Element &&
      event.target.closest('#tricks-guide')) event.stopImmediatePropagation();
}, true);
// Let key releases through: a key pressed on the canvas before the guide got
// focus must still be released in the engine instead of remaining held.

globalThis.__skatePerformance = {
  profile, selection, stats, ratio, recordFrame, report,
  get paused() { return paused; },
  // Winit prefers physical ResizeObserver sizes on Chromium. Scale that path
  // too, otherwise it immediately undoes the lower pixel ratio on Chromebooks.
  pixelBox(entry) {
    if (profile === 'quality') return entry.devicePixelContentBoxSize;
    const rect = entry.contentRect;
    return [{ inlineSize: Math.max(1, Math.round(rect.width * ratio())),
      blockSize: Math.max(1, Math.round(rect.height * ratio())) }];
  },
};

const selector = document.getElementById('quality');
selector.value = selection;
function setQuality(value) {
  if (!valid(value)) return;
  try { localStorage.setItem(KEY, value); } catch { /* URL still works */ }
  const url = new URL(location.href);
  url.searchParams.set('quality', value);
  url.searchParams.delete('lite');
  location.href = url.href; // textures and MSAA are chosen at engine startup
}
selector.addEventListener('change', () => setQuality(selector.value));

const toggle = document.getElementById('mode-toggle');
if (toggle) {
  toggle.setAttribute('aria-pressed', String(profile === 'performance'));
  toggle.textContent = `Chromebook mode: ${profile === 'performance' ? 'on' : 'off'}`;
  toggle.addEventListener('click', () => setQuality(profile === 'performance' ? 'quality' : 'performance'));
}
const names = { performance: 'Chromebook mode', balanced: 'Balanced graphics', quality: 'Normal mode' };
const current = document.getElementById('mode-current');
if (current) current.textContent = `Current: ${names[profile]}`;
document.querySelectorAll('[data-mode]').forEach(button => {
  const active = button.dataset.mode === profile && !params.has('lite');
  button.setAttribute('aria-pressed', String(active));
  button.disabled = active;
  button.addEventListener('click', () => setQuality(button.dataset.mode));
});
const label = document.getElementById('quality-info');
function describe() {
  const cv = document.getElementById('bevy');
  label.textContent = `${profile} · ${cv.width}×${cv.height}`;
  label.title = `${globalThis.SKATE_LITE ? 'Half-size textures; MSAA off.' : 'Original textures and anti-aliasing.'} Graphics changes reload this map.`;
}
describe();
setInterval(() => { if (!document.hidden) describe(); }, 2000);
