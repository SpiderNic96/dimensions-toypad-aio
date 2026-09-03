# Source Code Distribution Status

This AIO package contains the installable plugin source/backend and the exact prebuilt RPCS3 AppImage.

## Corresponding RPCS3 source

The bundled RPCS3 runtime is the public `NeverCookFirst/RPCS3-Seamless-Toypad-Build` repository at commit:

`6905c5ad82805af216a8addad40ee7dcea49f66b`

This is the commit used by the upstream v1.2 LED-mirroring build. The repository implements the Toypad LED state parser (`0xC0`–`0xC8`) and `GET_LED (0x04)` TCP snapshot endpoint.

## Runtime identity

- AppImage: `RPCS3-Toypad-x86_64.AppImage`
- SHA-256: `c9221b0178ec12308638d828408f1a9b638d59de432dc8df45aa9bcaedaaf07b`
- Size: `93,840,381` bytes
- Upstream v1.2 build: `v0.0.42-7-6905c5ad`
- Linux build artifact: GitHub Actions x64 clang AppImage from run `33050774919`

## LED architecture

The runtime is the actual current LED-mirroring RPCS3 build. Its `Dimensions.cpp` parses the game's HID LED commands into three region states, and `DimensionsListener.cpp` answers `GET_LED` with a fixed 30-byte snapshot.

The Decky reader sends exactly `04 00 00 00 00`, receives 30 bytes, validates `4C ?? 03`, and maps pad values 1/2/3 to centre/left/right. It sends no HELLO.

The 30-byte response fields are: `4C`, serial, region count, then three 9-byte records: `pad, mode, r, g, b, on_ms, off_ms, count, speed_ms`. The timing values are Toypad ticks (~40ms/tick), which the existing renderer converts to milliseconds.
