# Dimensions Toypad 3.3.12 — Pad Redesign, Real LED Timing, In-Game Overlay, Fixed Display Profile

> **Superseded timing note:** the historical §4 wording described a possible 1/16-second (62.5 ms) tick interpretation. 3.3.18 verified the current Harry/NeverCookFirst path uses Toypad ticks at approximately 40 ms/tick; see `CHANGELOG-3.3.18.md`.

No RPCS3 changes. The bundled AppImage, its SHA256 and its commit are identical
to 3.3.11. Everything here is `main.py` and `dist/index.js`.

---

## 1. Per-pad LED colours never worked

`SLOTS` describes each position twice:

```python
{"slot": 0, "pad": 2, "index": 0, "zone": "left",   "label": "Left · upper"}
```

`pad` is the wire-protocol pad id (an int, 1/2/3). `zone` is the human section
name. Both the backend and the frontend built their LED lookup like this:

```python
{"centre": "0", "left": "1", "right": "2"}.get(str(s["pad"]).lower())
```

`str(2).lower()` is `"2"`, which is not a key in that dict, so the lookup
returned `None` on every slot, every time. `pc.get(None)` then fell through to
the broadcast colour.

The visible symptom: Chroma Keystone and Locate Keystone hints painted all
three sections the same, or nothing at all. The fix is one field name in two
files — `s["pad"]` → `s["zone"]`.

## 2. Names were unreadable in the lower cells

The two-up cells under each section get roughly 30px of content width in the
Quick Access panel. The name element was then clamped to `maxWidth: 58%` to
avoid the portrait behind it, leaving about 17px, with `wordBreak: break-word`
to finish the job. "The Black Thunder" arrived as a vertical column of letters.

### The redesign

- **The portrait is the tile.** 84% height, centred, drop-shadowed, no text over it.
- Occupied slots with no artwork fall back to a small centred name.
- Empty slots show their section label (`Left · lower R`) so orientation survives.
- Build numbers moved to a small amber corner chip (`B2`).
- The grid is shaped like the hardware: a dark base plate holding two rounded
  three-slot sections around a taller rounded centre.
- Idle sections carry their own tint — left red, centre amber, right blue.

## 3. LED colour fills the tile, not just its border

Both the cell and its parent section now render a colour wash:

- Section: tinted background, vertical gradient, inner and outer glow
- Cell: radial wash beneath the portrait, plus a glowing border

A whole section lights as one unit, which is what the real pad does.

## 4. Flash timing now comes from the game

Event `0x02` always carried six bytes:

```
[on_ms, off_ms, count, r, g, b]
```

Only bytes 3–5 were read. Bytes 0–2 were dropped, so every flash rendered at
one hardcoded frontend rate regardless of what the game asked for.

`_pad_colors_json` now emits `onMs`, `offMs` and `count`, plus `rawOn` /
`rawOff` for diagnostics. A CSS keyframe split cannot be driven by a variable,
so the frontend mints one `@keyframes dt-f-<on>-<off>` per distinct duty cycle
actually in play — only ever a handful alive at once.

| Game sends | Result |
|---|---|
| `100 / 100`, count 0 | 200ms cycle, 50% duty, infinite |
| `200 / 60`, count 0 | 260ms cycle, 77% duty — correctly asymmetric |
| `150 / 150`, count 3 | blinks 3 times, then settles lit (`animation-fill-mode: forwards`) |
| `0 / 0` | falls back to 250/250 |
| `5 / 5` | clamped to 40/40 |

### Historical verification note

At the time of 3.3.17 the LED timing unit was not yet verified, so this section
intentionally did not establish a millisecond conversion. That uncertainty was
resolved in 3.3.18 by comparing the AIO implementation with the current
NeverCookFirst RPCS3 listener and Harry's current LegoToypad client: the fields
are Toypad ticks, approximately 40 ms per tick. See `CHANGELOG-3.3.18.md`.

## 5. Controller navigation

Opening the plugin landed focus on **Browse figures** — the last `ButtonItem` in
the panel — so you had to scroll back up to reach the pad. Same story in the
submenus.

The Quick Access menu runs its own focus pass shortly after a panel mounts, and
it wins against a plain `autoFocus`. Each view now carries a landing ref that is
re-asserted on a short timer ladder (0 / 60 / 180 / 400ms), which beats that
pass without fighting Steam's navigation once you start moving the stick.

| View | Lands on |
|---|---|
| Pad | the pad grid |
| Setup | the Hotkey section |
| Franchises | the first franchise row |
| Figures | the first figure |

## 6. In-game overlay + hotkey

Reaching the pad in Game Mode meant STEAM → Decky → scroll to the plugin, every
time. There is now a global overlay you can summon with a controller chord from
anywhere, including on top of a running game.

The overlay shows the live pad with its LED state, lets you take a figure off,
and offers a **recent figures** strip (last 12 placed) for quick swaps. Full
browsing stays in the Quick Access panel — the recents list covers the actual
gameplay loop of rotating a handful of characters.

### Chords are learned, not hardcoded

Steam's controller button bitmasks move around between client builds, so
guessing an L4/R4 constant would be a coin flip. Instead:

1. Quick Access → Setup → **Hotkey** → *Set hotkey chord*
2. Hold the combination you want for about half a second
3. It stores the raw mask

Pick something the game does not use — the rear grip buttons are usually safe.

Also available: **Ctrl+Shift+T** with a keyboard, for Desktop Mode and docked
play.

### If the overlay does not appear

It mounts through `routerHook.addGlobalComponent`. If your Decky build does not
expose that, the plugin logs a warning and everything else keeps working — the
Quick Access panel is unaffected. Likewise, the chord watcher needs
`SteamClient.Input.RegisterForControllerStateChanges`; if that is missing, the
keyboard fallback still works.


## 7. Display settings: three toggles become one profile

**Removed:** the fullscreen / windowed toggle and the 60 fps toggle.

Three independent switches could disagree with each other, and nobody ever
wanted the windowed option — with `--no-gui` it produced a small window that
gamescope then centred on a black field.

### The Steam shortcut always launches fullscreen

`run_setup` applies the profile as a new step 6, and `run-both.sh` re-asserts
`Start games in fullscreen mode: true` immediately before `exec`. That second
part matters: opening the RPCS3 GUI manually can flip the flag back, and
trusting stored state meant the next shortcut launch came up windowed.

### The profile

| Setting | Value |
|---|---|
| Vblank Rate | 120 |
| Resolution Scale | 140% |
| Resolution Scale Threshold | 16 |
| Output Scaling Mode | Bilinear |
| FidelityFX CAS Sharpening Intensity | 50 |
| Aspect ratio | 16:9 |
| Resolution | 1280x720 |
| Frame limit | Auto |
| Start games in fullscreen mode | true |

Writes are idempotent and leave unrelated keys alone — `Renderer`, per-game
overrides and anything else in the config survive untouched. A `.yml.bak-toypad`
backup is taken once per config before the first write.

### Frame rate moved into the game

Press **Start + Select together** while playing to open RPCS3's in-game home
menu, and change the frame rate there. That is a better home for it than a
Decky switch rewriting config behind a running game — the change takes effect
immediately and does not persist unless you want it to.

### One conflict worth knowing about

**RPCS3 gates CAS sharpening behind FidelityFX output scaling.** With Output
Scaling Mode set to Bilinear, the sharpening intensity is written but inert.

The value is set to 50 anyway so that switching output scaling to FidelityFX in
the home menu picks up something sensible rather than whatever was there before.
If you want sharpening active, that switch is the way to get it — at some cost
in GPU time versus bilinear.

### RPC changes

| Removed | Replaced by |
|---|---|
| `set_sixty_fps` | `apply_display_profile` |
| `set_fullscreen` | `apply_display_profile` |
| `get_sixty_fps` | `get_display_profile` |

`get_display_profile` returns the values actually found in the configs plus an
`applied` boolean, so the Setup panel can show drift rather than assuming.

---

## Upgrading

Drop-in over 3.3.11. Only `main.py` and `dist/index.js` changed, plus version
strings in `plugin.json` / `package.json` and the manifest changelog.

Restart Decky (or reboot) after installing so `main.py` reloads — a frontend-only
refresh will leave the old backend running and the LED colours will still look
broken.

Your tag files, config and figure library are untouched.

## Known limitations

- Flash timing units are unverified on hardware — see §4.
- The overlay places from recents only; first placement of any figure still goes
  through the Quick Access browser (or the phone remote).
- The hotkey mask is stored in browser `localStorage`, so it does not survive a
  Steam client data wipe. Re-capturing takes about five seconds.
- CAS sharpening is inert while output scaling is Bilinear — see §7.
- 140% render scale is a deliberate compromise for the Deck's APU. If you are
  playing docked on stronger hardware there is headroom to raise it in the
  RPCS3 home menu.

---

# 3.3.13 — Field fixes

Two things in 3.3.12 did not survive contact with hardware.

## Focus still landed on Browse figures

3.3.12 put the landing ref on the **PadGrid wrapper**. Steam only honours
`focus()` on an element its navigation layer has registered as a focus target,
and a `Focusable` that merely *contains* other Focusables is not one. The call
was a silent no-op, so the QAM's own focus pass took the first `ButtonItem`
exactly as before.

The ref now lands on the **first pad cell** — a leaf with `onActivate`, which is
a genuine target. The helper also handles the wrapper shapes Steam uses across
builds (`el`, `el.element`, `el.m_element`), scrolls the target into view, and
extends its retry ladder to 1100ms.

## "Set hotkey chord" hung on Listening... forever

The watcher assumed one API name and one field layout, and when either was
wrong it failed **mute** — no error, no toast, just a button that never
resolved. That was the real defect; the wrong API name was only the symptom.

Now it:

- Probes `RegisterForControllerStateChanges`, `RegisterForControllerInputMessages`,
  `RegisterForControllerCommandMessages` and `RegisterForControllerAnalogInputMessages`,
  attaching to every one that accepts a callback
- Normalises button fields across layouts (`ulButtons` / `unButtons` / `buttons`,
  `ulUpperButtons` / `unUpperButtons` / `upperButtons`) and one level of nesting
  (`.state`, `.controllerState`)
- **Times out after 15 seconds** instead of hanging, and the button doubles as a
  cancel while listening

### The diagnostic line

Under the Hotkey section there is now a monospace readout:

```
input OK · api RegisterForControllerStateChanges · ev 412 · 8000/0
```

- `input OK` / `input DOWN` — whether anything attached
- `api` — which entry point bound, or `none`
- `ev` — events received; **if this stays at 0 while you press buttons, no API on
  this build is delivering controller state to plugins**
- the hex pair — the live button mask, so you can watch it change as you press
- a second line lists which API names exist at all (`name:y` / `name:n`)

Screenshot that line if capture still fails — it identifies the cause exactly.

### Overlay test button

**Open overlay now (test)** summons the overlay directly, so you can confirm the
overlay itself works independently of whether the chord does.

## Known: Ctrl+Shift+T on a back button does not work

Steam delivers back-button keyboard bindings to the **focused application** —
in Game Mode that is the game, not the SteamUI context where the plugin's
listener lives. The keystroke never reaches it.

The fallback still works with a real USB or Bluetooth keyboard in Desktop Mode.
Binding it to a controller button is not a route that can work from inside a
Decky plugin.

---

# 3.3.14 — Interactive overlay, and the hotkey rebuilt from the diagnostic

## The overlay was never focusable

`routerHook.addGlobalComponent` renders a component. It does **not** give it
gamepad focus. That is the whole explanation for B doing nothing and nothing
being navigable — the overlay was a picture, not a UI.

Replaced with `DFL.showModal` + `ModalRoot`, which is the supported route for a
modal that takes exclusive controller focus. `ModalRoot` wires B and Escape to
close for free.

### What the overlay does now

- **Tap an occupied pad** — lifts that figure off
- **Tap an empty pad** — opens a searchable picker
- **Search** — a `TextField` that raises the Steam virtual keyboard in Game
  Mode; debounced 220ms, capped at 60 results, searches name and franchise
- **Move** — tap the figure, then tap the destination
- **Remove** — tap any pad to clear it
- **Clear all**
- **B** — steps back one level (picker → pad → closed)

Styling is unchanged: same pad grid component, same LED wash, same portraits.

## The hotkey: stop parsing field names

The diagnostic from 3.3.13 answered it:

```
RegisterForControllerStateChanges:n
RegisterForControllerInputMessages:y
RegisterForControllerCommandMessages:y
RegisterForControllerAnalogInputMessages:y
ev 4 · 0/0
```

`RegisterForControllerStateChanges` **does not exist** on current SteamOS. The
three that do exist were firing — events were arriving — but they deliver
discrete *input messages* whose fields are named nothing the parser looked for,
so it read `0/0` every time.

Guessing a fourth set of field names would have been the same mistake a third
time. So the model changed:

1. Flatten every event to a map of `path -> number`, whatever its shape
2. During capture, note which paths go **hot** (non-zero) while you hold a combination
3. At runtime, fire when those same paths go hot again

No knowledge of the payload shape is required.

### Two hardening details

**Intersection capture.** Samples across the hold window are intersected, keeping
only paths whose value held steady. A churning counter that slipped the key
filter gets dropped rather than blocking capture forever. Keys matching
`time|stamp|tick|seq|frame|count|packet|serial|uptime|battery` are filtered up
front.

**Subset matching.** Runtime uses a subset test, not exact signature equality, so
an unrelated hot path riding along does not suppress the chord.

### Diagnostics now show what matters

```
input OK · ev 128
hot: 0.bPressed=1 0.eButton=34
raw: [{"nController":0,"eButton":34,"bPressed":true,...
```

3.3.13 collected the key list and then never rendered it — my error. The raw
payload and hot-path list are both printed now. If capture still fails, that
`raw:` line is the thing to screenshot.

## Removed

`routerHook.addGlobalComponent` registration, now unused.

---

# 3.3.15 — evdev hotkey, franchise grid

## SteamClient.Input was never going to work

Your diagnostic settled it:

```
input OK · ev 262
hot: v=15
raw: 15
```

`raw: 15` is the **entire payload** — a bare integer, not an object.
`hot: v=15` is my flattener wrapping a scalar. `RegisterForControllerState-
Changes` does not exist on this build, and the three that do exist hand back
something like a controller index, not button state.

That also explains the 15-second delay: the captured "chord" was `v=15`, which
nearly every event matched, so it fired essentially at random.

### Detection moved to the kernel

`main.py` runs as root, so it now reads `/dev/input/event*` directly. Every
readable node is opened non-blocking and polled with `select()`; `EV_KEY`
press/release maintains a held-keycode set.

- Chord matching is a **subset test** on kernel keycodes, with a 0.5s re-fire guard
- Capture needs the combination held 0.4s
- The chord lives in the plugin config, not browser `localStorage`, so a Steam
  data wipe no longer loses it
- Frontend polls at **120ms** and edge-detects a monotonic counter — worst case
  about an eighth of a second, against ~15s before
- The first reading only primes the counter, so reloading the plugin can never
  trigger a phantom open

Buttons are shown by name now (`L4 + R4`) rather than hex.

**Toggle:** pressing the chord with the overlay open closes it, rather than
stacking a second modal.

### The one thing that could still block this

Steam may hold an `EVIOCGRAB` on the controller, which routes events only to
Steam. The diagnostic now prints **per-device key-event counts**:

```
live: event3:412 event7:88
```

If that line says no device has produced a key event, the grab is the reason —
stated plainly rather than failing silently. A wired USB controller or the
Deck's own keyboard device would then be the fallback to try.

## Franchise grid

The flat list is gone. Tapping an empty pad now opens:

- **Search box** on top — always wins. Type and results drop straight down as a
  navigable list. Global from the grid, scoped to the franchise once inside one.
- **Franchise grid** below — five tiles across, wrapping and scrollable by
  controller, using each franchise's existing logo artwork with a name fallback
  and a figure count.
- **Select a franchise** → its characters, same flow as the panel.

B steps back one level at a time: figures → franchises → pad → closed.

### Starters is a real franchise now

It was phone-remote-only. It is now pinned first in the Decky grid too.

### Franchise logo overrides

Any PNG or JPG dropped in:

```
~/toypad/logos/<Franchise>.png
```

wins over the tag-library logo. This is the **only** way to give Starters
artwork, since it is synthetic and has no `Logo` directory. The phone remote
reads the same override, so one file covers both.

## One toypad, one poll loop

The overlay polls LEDs at **250ms** so flashes and Chroma hints render at the
rate the game actually sends them.

To avoid two loops driving one pad, the Quick Access panel now stands down
while the overlay is open — it stops polling and shows a handoff message
instead of rendering a second live pad.

---

# 3.3.16 — Starters artwork, and what "stands down" actually meant

## To answer the question directly

**Yes — the overlay carries the full live LED state.** It is the same
`PadGrid` component the panel uses, reading the same `padColors` payload,
with the same per-pad and broadcast routing and the same flash keyframes.
Solid colours, Chroma hints, Locate hints, warning strobes: all of it.

My wording was bad. "The panel stands down" meant only that the **Quick
Access sidebar stops its own polling loop** while the overlay is open, so
one toypad is not being polled twice over. Nothing about the pad or its
colour routing is suspended. The sidebar message now reads "Live pad is
showing in the overlay" instead of implying something was switched off.

### How the strobe actually renders

Worth being clear, because it affects what the poll rate has to do:

- The **blink itself** is rendered locally, from the `onMs` / `offMs` /
  `count` the game sent, as a CSS keyframe at exactly that duty cycle
- The **poll** only has to catch a *change* of colour or kind

So the poll rate is not the strobe rate. It was 250ms; it is now **150ms**,
which means even a short 3-blink warning burst — roughly 900ms end to end —
is picked up near its start rather than partway through.

Finite bursts still settle lit via `animation-fill-mode: forwards`, matching
a real pad holding its last colour.

## Starters artwork

Now **ships with the plugin** at `assets/logos/Starters.jpg` (512×288, 47KB).
No manual file drop. Both the Decky franchise grid and the phone remote's
Starters category read it.

JPEG rather than PNG deliberately — it is a photographic frame, and PNG cost
250KB for the same thing.

### Logo precedence, lowest first

1. Tag library — `<Franchise>/Logo/*.png`
2. Plugin bundle — `assets/logos/`
3. User override — `~/toypad/logos/`

`png`, `jpg`, `jpeg` and `webp` all accepted. So the bundled art is the
default and you can still replace it without touching the install.

### Tiles scale art to the slot

Artwork now fills the whole tile with `object-fit: contain`, so a 16:9 key-art
frame and a transparent wordmark both render intact and neither crops. The
figure count moved to a corner chip so it stops competing with the image.

---

# 3.3.17 — The grab is confirmed, and the hotkey works around it

## `key events 0` was the answer

The nodes opened fine. Zero key events arrived. That is **Steam holding an
`EVIOCGRAB`** on the controller — a grab routes events to the grabbing process
only, so no plugin-side read of the physical pad can ever see a button press.
Not a bug I can patch out.

### The route that does work

Steam Input's **emulated keyboard** is a `uinput` device that Steam *creates*
rather than grabs. Its events reach us normally.

So the hotkey is now a **key bound in a Steam controller layout**, not a raw
button chord:

1. Steam → Controller Settings → edit your layout
2. Put a keyboard key on a back button — **F13** is ideal, no game uses it
3. In the plugin: Setup → Hotkey → **Set hotkey chord**, then press that button

Everything downstream is unchanged — same capture, same 120ms poll, same toggle
behaviour.

### Two things that were quietly broken

**One-shot device scan.** Steam's virtual keyboard appears *after* the plugin
starts, so scanning `/dev/input` once at boot could never have found it. The
reader now rescans every 3 seconds.

**Nameless devices.** Nodes are resolved through `/proc/bus/input/devices`, so
the diagnostic reads `Steam Virtual Keyboard:14` instead of `event14:14` — you
can see at a glance whether the right device is producing events.

The diagnostic also separates "no nodes opened" from "nodes open but grabbed",
and now states the fix inline instead of leaving you with an error string.

## Overlay: centring, chrome, and the scroll bleed

**Centred and stable.** Fixed 660px / 92vw width, 88vh cap, laid out as a
column: the pad keeps its size and only the list below scrolls. The modal no
longer changes height as search results come and go.

**Borders gone.** Modal chrome, pad base plate, idle zone outlines, franchise
tiles, figure rows and action buttons are all transparent or translucent now.
The only coloured edge left is a **live LED**, which is the one border that
carries information.

**The scroll bleed.** Franchise tiles were painting over the modal edge
mid-scroll — visible in your capture. Scroll containers now carry
`position: relative`, `isolation: isolate` and `contain: paint`, and clip
horizontally, so nothing renders outside the modal during a transition.
