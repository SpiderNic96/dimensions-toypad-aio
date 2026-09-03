# Dimensions Toypad AIO — Credits & Acknowledgements

This project is a community Steam Deck integration. It stands on the work of several upstream projects and contributors. This file intentionally distinguishes upstream work from the Steam Deck integration work in this package.

## RPCS3

**RPCS3 contributors** — the underlying PlayStation 3 emulator/debugger.

Official project: https://github.com/RPCS3/rpcs3

RPCS3's official repository identifies **Nekotekina** and **kd-11** as lead developers and states that most files are licensed under GNU GPL-2.0-only, with some files potentially carrying different notices. See the upstream repository and file headers for the authoritative attribution. 

This AIO uses the patched **NeverCookFirst/RPCS3-Seamless-Toypad-Build** fork described below.

## RPCS3 Seamless Toypad Build

**NeverCookFirst** — maintainer/author of the RPCS3 Seamless Toypad Build used by this release.

Project: https://github.com/NeverCookFirst/RPCS3-Seamless-Toypad-Build

The exact distributed build is commit `797f1e417f736a04e43319f27812228c4c8dbf6e`.

The fork history also records work merged from **harrysof**, including the Toypad move pickup delay/related build changes. The initial RPCS3 Seamless Toypad Build commits are attributed in Git history to NeverCookFirst; GitHub also displays an account named `claude` as a co-committer on some commits. `claude` is not listed here as a human project author; the human project attribution is to the repository contributors shown in its history.

## LegoToypad

**harrysof** — creator/maintainer of LegoToypad, its Toypad picker/overlay concepts, the web remote used by this AIO, controller-oriented UI, tag library integration and associated assets/data pipeline.

Project: https://github.com/harrysof/LegoToypad

The AIO's tag library downloader targets the upstream `v1.5` release/source tree. The upstream history shows harrysof as the primary author/committer, with NeverCookFirst contributing to the v1.5 feature branch and merge.

## Steam Deck / Decky Loader

**Decky Loader contributors** — plugin framework used by this project.

Project: https://github.com/SteamDeckHomebrew/decky-loader

Decky Loader's README credits the original plugin-loader concept to **marios8543's Steam Deck UI Inject project**. This project does not claim ownership of Decky Loader or its underlying framework.

## Controller icon sources

The upstream LegoToypad v1.5 `Assets/ControllerIcons/SOURCES.md` identifies:

- **Nicolae (Xelu) Berbece** — Free Controller & Keyboard Prompts pack; Xbox and DualShock4 icon sets are identified there as CC0.
- **Solid Mono / Dark theme** — source identified by LegoToypad for the Switch Button Icons pack. The upstream file explicitly says the license of each set should be confirmed before publishing; therefore this AIO does not represent the Switch icon set as having a confirmed license beyond the upstream notice.

Source: https://github.com/harrysof/LegoToypad/blob/v1.5/Assets/ControllerIcons/SOURCES.md

## Dimensions Toypad AIO

**MetalNic96** — Steam Deck/Decky integration, AIO packaging, launcher integration, RPCS3 runtime resolution, Steam/Game Mode integration, Deck UI integration, and release engineering for this package.

## AI-assisted development

Parts of the development/debugging process were assisted by AI tools. Human review, testing, integration and release decisions remain the responsibility of the project maintainer. No upstream project is represented as having endorsed this AIO package.

## Trademark / affiliation notice

LEGO, LEGO Dimensions and related names/logos are trademarks of their respective owners. RPCS3 and Decky Loader are independent open-source projects. This project is an unofficial community integration and is not affiliated with, endorsed by, or sponsored by LEGO, Valve, RPCS3, or Decky Loader.
