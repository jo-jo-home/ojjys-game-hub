# Skate 3 — experimental hub integration

Browser build from https://github.com/andrewnakas/skate3-cleanroom (`gh-pages`),
copied from the supplied local download. This is the Rust/Bevy clean-room web
rewrite, not an Xbox emulator. The engine/assets were not rebuilt for the hub.

Requires a browser with WebGPU and a working GPU adapter. The default StartPark
load is approximately 156 MB; all nine maps plus shared resources are about
388 MB. The game's loader caches assets in `skate3-pack` and fetches new maps
as selected.

## Graphics / Chromebook performance

The Graphics selector saves a per-browser preference and reloads the current
map, preserving the login and map parameters:

- **Auto:** Performance on ChromeOS, touch devices, or devices reporting at
  most 4 GB RAM / 4 CPU threads; Balanced elsewhere.
- **Performance:** at most 960×540 (landscape), half-resolution textures,
  and multisample anti-aliasing disabled by the engine's lite mode.
- **Balanced:** at most 1280×720, with the same lite textures / MSAA setting.
- **Original quality:** the upstream resolution, textures, and anti-aliasing.

Press **Esc** to pause and show the **Game mode** panel alongside the engine's
menu. Choose **Chromebook mode** (Performance / 540p) or **Normal mode** (original
graphics). The toolbar also has a Chromebook mode on/off toggle. Both controls
use the same saved graphics preference; changes reload the current map and
reset the skater's position, retaining the map, room and hub login parameters.
The pause panel follows the engine's reported pause state, so it also appears
when pausing with a gamepad or the touch Start button.

Resolution limits preserve aspect ratio and apply to the engine only, including
Chromium's physical ResizeObserver sizing. The page and touch controls retain
their normal dimensions. `?quality=performance|balanced|quality|auto` overrides
the saved choice; `?lite=0` or `?lite=1` can override texture/MSAA settings.
KenneyPark is the lightest built-in map. Heavy maps and CPU-bound physics can
still limit frame rate; WebGPU availability is required in every graphics mode.

The loader compiles WebAssembly directly from a stream, throttles loading UI
updates, and avoids duplicating files that the hub has already saved offline.
The compiled engine and original asset packs are unchanged.

## Menu input

The pause panel includes a collapsible **Tricks guide** with basic and advanced
right-stick gestures, air/grab/grind tips, and keyboard/controller mappings.
Gesture directions come from the bundled `core.pack` joystick PAT files; flip
names can be mirrored by stance. Analog-only actions (such as manuals) are
marked for controller/touch use. The guide scrolls on smaller screens and uses
native keyboard-accessible disclosures. Disclosure/scroll keys stay in the
guide while focused there; Escape still resumes the engine normally. All guide
content is bundled in the launcher, so it is included in offline downloads.

Escape is routed to the engine's virtual Xbox Start button. This avoids the
upstream web build's conflicting Escape menu handling, which briefly opens and
closes the menu. One physical press produces one toggle, held-key repeats are
ignored, and short taps stay active until the engine can poll the input. Real
Enter, movement keys, and the native gamepad/touch controls remain available.

Built-in single-player parks are available offline after a hub download.
Community maps and multiplayer need skatemods.com and its room relay. This
integration does not provide a separate relay. Map changes preserve the hub's
session URL token; shared room invites strip it so each visitor signs in with
their own access.

The upstream page credits the KTM 450 EXC model to mx-3d (Sketchfab), CC BY 4.0,
and skate sounds to CC0 Freesound recordings (credits inside the core pack).
Those on-page credits are retained. See the upstream repositories for the
engine source and asset provenance:

- https://github.com/andrewnakas/skate3-cleanroom
- https://github.com/andrewnakas/skate-3-rust-engine

The hub catalog, deployment exclusion, and offline manifest are configured
for `/skate3/`. Deno serves the game locally when present and proxies the
published files from the hub's GitHub repository when excluded from deployment.
