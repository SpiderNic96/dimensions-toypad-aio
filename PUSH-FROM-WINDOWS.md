# Publish dimensions-toypad 3.3.11 from Windows

This folder is a Linux/Steam Deck project repository. Windows is used only to publish the source tree to GitHub.

## 1. Extract

Extract the ZIP anywhere, for example:

`D:\Games\LEGO\dimensions-toypad-repo-3.3.11`

Open PowerShell in that folder.

## 2. Publish the source repository

Run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\push-from-windows.ps1
```

Answer `Y` when the file list looks correct.

## 3. Why the previous push failed

The previous package contained an LFS *pointer* for the AIO ZIP, but not the actual 257 MB file. Git LFS therefore reported:

`missing or corrupt local objects`

Do **not** fix this with:

```powershell
git config lfs.allowincompletepush true
```

That would publish a broken LFS reference.

The publisher in this package detects the missing AIO file and removes only the placeholder pointer before the source push.

## 4. Optional: publish the actual AIO through GitHub Release

Copy the real file:

`dimensions-toypad-AIO-3_3_11(1).zip`

into:

`release\reference\dimensions-toypad-AIO-3.3.11.zip`

Then, if you specifically want the AIO tracked by Git LFS, install Git LFS and run:

```powershell
git lfs install
git lfs track "release/reference/dimensions-toypad-AIO-3.3.11.zip"
git add .gitattributes "release/reference/dimensions-toypad-AIO-3.3.11.zip"
git commit -m "Add 3.3.11 AIO reference artifact"
git push origin main
```

For a public project, the preferred approach is to keep the AIO ZIP out of normal Git history and upload it to the GitHub **3.3.11 Release** instead.

## 5. Verify GitHub

After the push:

```powershell
git status
git log -1 --oneline
git remote -v
```

The repository should be:

`https://github.com/SpiderNic96/dimensions-toypad-aio`

The source tree should include:

- `.github/workflows/`
- `docs/`
- `source/`
- `scripts/`
- `release/artifacts/`
- `release/source/`
- licensing and provenance files

## 6. Important Linux distinction

Publishing from Windows does not build the Linux application.

The project itself remains Linux/Steam Deck focused:

`SteamOS/Bazzite -> Decky Loader -> Toypad plugin -> patched Linux RPCS3`

The GitHub Actions workflows are responsible for Linux/RPCS3 reproduction.
