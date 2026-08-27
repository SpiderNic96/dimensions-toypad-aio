# Push the complete repository to GitHub

Repository target:

`https://github.com/SpiderNic96/dimensions-toypad-aio`

This handoff contains the intended repository structure, source, documentation, workflows, release metadata, the 3.3.11 plugin build artifact, and the 3.3.11 source archive.

## 1. Extract the ZIP

Extract this handoff so that the files below are at the repository root:

```text
.github/
docs/
release/
scripts/
source/
LICENSE
README.md
THIRD-PARTY-NOTICES.md
.gitattributes
.gitignore
```

## 2. Open a terminal in the extracted folder

Linux/macOS/WSL:

```bash
cd dimensions-toypad-repo-handoff
```

PowerShell:

```powershell
cd .\dimensions-toypad-repo-handoff
```

## 3. Configure Git

```bash
git config --global user.name "SpiderNic96"
git config --global user.email "nicolaslouvel@gmail.com"
```

## 4. Connect the existing GitHub repository

```bash
git init
git branch -M main
git remote add origin https://github.com/SpiderNic96/dimensions-toypad-aio.git
```

If a remote named `origin` already exists:

```bash
git remote set-url origin https://github.com/SpiderNic96/dimensions-toypad-aio.git
```

## 5. Check the files before publishing

```bash
git status
git add --all
git status
```

Do not commit `node_modules/` or generated build directories.

## 6. If the GitHub repo already contains only the small starter README

The safest path is to preserve that history and merge the new tree:

```bash
git fetch origin main
git merge origin/main --allow-unrelated-histories
```

Resolve any README/LICENSE conflict deliberately, then:

```bash
git add --all
git commit -m "Import complete 3.3.11 source and release structure"
git push -u origin main
```

If the remote is intentionally disposable and you want this handoff to become the exact `main` tree instead, use the force-push option only after checking `git status`:

```bash
git add --all
git commit -m "Import complete 3.3.11 source and release structure"
git push -u origin main --force-with-lease
```

## 7. Git LFS for the large AIO ZIP

The handoff deliberately does **not** contain the 246+ MB AIO ZIP itself. It contains the reference LFS pointer:

```text
release/reference/dimensions-toypad-AIO-3.3.11.zip.lfs-pointer
```

On the machine that has the real AIO ZIP:

```bash
git lfs install
git lfs track "release/reference/*.zip"
mkdir -p release/reference
cp /path/to/dimensions-toypad-AIO-3_3_11\(1\).zip release/reference/dimensions-toypad-AIO-3.3.11.zip
git add .gitattributes release/reference/dimensions-toypad-AIO-3.3.11.zip
git commit -m "Add 3.3.11 AIO reference artifact"
git push origin main
```

Verify it is actually tracked by LFS:

```bash
git lfs ls-files
```

## 8. Publish a GitHub Release

Create a release for version `3.3.11` after the source is on `main`.

Recommended release files:

```text
Dimensions Toypad AIO 3.3.11
├── dimensions-toypad-AIO-3.3.11.zip       # large AIO release artifact
├── dimensions-toypad-SOURCE-3.3.11.zip    # source snapshot
└── dimensions-toypad-plugin-3.3.11.zip    # successful Actions plugin artifact
```

The small plugin artifact in this handoff is the successful GitHub Actions output and contains the generated plugin bundle plus `plugin.json`.

Using the GitHub CLI, the large release asset can be published without putting it in normal Git history:

```bash
gh release create v3.3.11 \
  release/source/dimensions-toypad-SOURCE-3.3.11.zip \
  release/artifacts/dimensions-toypad-plugin-3.3.11.zip \
  --title "Dimensions Toypad AIO 3.3.11" \
  --notes-file docs/RELEASE-NOTES-3.3.11.md
```

Then add the large AIO ZIP as a release asset from the machine that has it:

```bash
gh release upload v3.3.11 /path/to/dimensions-toypad-AIO-3.3.11.zip
```

## 9. Verify the published tree

```bash
git ls-tree -r --name-only origin/main
```

You should see at minimum:

```text
.github/workflows/build-plugin.yml
.github/workflows/build-rpcs3-appimage.yml
.github/workflows/repro-aio.yml
docs/ARCHITECTURE.md
docs/BUILD-GUIDE.md
docs/BUILD-RESULT.md
docs/LINUX-CODE-LINEAGE.md
docs/REPRODUCIBILITY.md
source/plugin/AIO-MANIFEST.json
source/plugin/main.py
source/plugin/src/index.tsx
source/plugin/package.json
source/plugin/plugin.json
source/plugin/rollup.config.mjs
source/plugin/tsconfig.json
source/protocol/SPEC.md
source/rpcs3-patch/apply-color-forwarding.sh
release/source/dimensions-toypad-SOURCE-3.3.11.zip
release/artifacts/dimensions-toypad-plugin-3.3.11.zip
```

## 10. Run the plugin build yourself

```bash
cd source/plugin
npm install --no-audit --no-fund
npm run build
node --check dist/index.js
```

The GitHub Actions workflow performs the same build.

## 11. Important release integrity rule

Do not replace the bundled RPCS3 AppImage with an arbitrary build and then call it the 3.3.11 reference release. The manifest records the reference AppImage SHA-256 and the exact Toypad/RPCS3 source commit used for the 3.3.11 AIO.

The outer AIO ZIP checksum can change when a ZIP is repacked because ZIP metadata can differ. Compare the extracted payload files and their hashes instead.

## One-command helper

From the extracted handoff directory on Linux/macOS/WSL:

```bash
./scripts/push-to-github.sh
```

The helper stages and commits the repository and pushes `main`. It deliberately does not force-push and does not upload the large AIO binary automatically.
