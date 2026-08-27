# Building the Decky plugin

The plugin has two source components: the Python backend (`plugin/main.py`)
which runs unmodified, and the TypeScript frontend (`plugin/src/index.tsx`)
which compiles to `plugin/dist/index.js`.

## Prerequisites

- Node.js 20+ and npm
- The Decky CLI is optional but useful for local iteration

## Step 1 - install dependencies

```bash
cd plugin
npm install
```

`package.json` pins `@decky/ui`, `@decky/api`, `@decky/rollup`, plus the
usual `react` peer dependencies and TypeScript. `npm install` fetches
about ~150 MB into `node_modules/` on first run.

## Step 2 - build

```bash
npx rollup -c rollup.config.mjs
```

That produces `dist/index.js`. Compare against the shipping bundle:

```bash
node --check dist/index.js && echo "syntax OK"
# Optional byte-diff vs the reference:
diff -q dist/index.js dist-reference-index.js
```

The two will not be byte-identical - `dist-reference-index.js` is what
the shipping bundle contains, produced from a slightly different source
tree. Behavioural equivalence is what matters: same RPCs called, same UI
elements, same event handlers.

## Step 3 - verify locally

Symlink into a Deck's plugin directory (or copy):

```bash
ssh deck@steamdeck 'sudo systemctl stop plugin_loader'
scp -r . deck@steamdeck:~/homebrew/plugins/dimensions-toypad-dev/
ssh deck@steamdeck 'sudo systemctl start plugin_loader'
```

Then open the QAM in Steam Game Mode - the plugin appears as
"Dimensions Toypad".

## Step 4 - iterate

Any time `src/index.tsx` changes:

```bash
npx rollup -c rollup.config.mjs && scp dist/index.js \
  deck@steamdeck:~/homebrew/plugins/dimensions-toypad-dev/dist/
ssh deck@steamdeck 'sudo systemctl restart plugin_loader'
```

`main.py` changes are picked up on plugin reload without a rebuild:

```bash
scp main.py deck@steamdeck:~/homebrew/plugins/dimensions-toypad-dev/
ssh deck@steamdeck 'sudo systemctl restart plugin_loader'
```

## The two files' role

- **`main.py` is the source of truth for backend behaviour.** It runs
  as-is inside Decky Loader's Python interpreter. This file is safe to
  edit and re-copy without any build step.
- **`src/index.tsx` is the source of truth for frontend behaviour.** But
  Decky loads `dist/index.js`, so the TSX must be built into that bundle
  for changes to take effect. The `dist-reference-index.js` file in the
  source zip is exactly what the shipping AIO contains, kept as a
  reference to diff against.

## Assembling an AIO zip

After building `dist/index.js`, package the runtime tree in the shape
Decky expects:

```bash
cd plugin
mkdir -p ../release-staging/dimensions-toypad
cp -r main.py plugin.json AIO-MANIFEST.json dist/ assets/ \
      ../release-staging/dimensions-toypad/
# Add the RPCS3 AppImage
mkdir -p ../release-staging/dimensions-toypad/rpcs3
cp /path/to/RPCS3-Toypad-x86_64.AppImage \
   ../release-staging/dimensions-toypad/rpcs3/
cd ../release-staging
zip -r ../dimensions-toypad-AIO-3.3.11.zip dimensions-toypad
```

## What's actually in the frontend

`src/index.tsx` renders one component - a `<PanelSection>` containing:

1. **Setup checks** - RPCS3, tag library, game dump, launcher, phone
   remote, listener. Each with a green/red tick, one label, one detail
   line.
2. **LEDs diagnostic row** - three coloured dots (centre/left/right)
   showing the current LED state per pad, plus a "reader: N frames"
   text so it's obvious when the colour reader is working.
3. **Action buttons** - re-download library, rewrite launcher, toggle
   phone remote, re-check setup.
4. **Pad grid** - the actual 7-slot toypad layout, painted with LED
   colours on the fly via `get_pad_colors` polled every 500ms.

The Python side exposes all of this through the `callable(...)`
declarations at the top of `index.tsx`. Any RPC listed there must exist
in `main.py` with the same name and matching signature.
