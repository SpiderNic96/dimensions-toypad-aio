# Dimensions Toypad AIO 3.3.11

## Highlights

- Decky Loader Toypad integration for Steam Deck/Linux.
- Patched RPCS3 colour/event forwarding integration.
- Phone/web Toypad companion path based on the documented LegoToypad lineage.
- Bundled-only RPCS3 runtime policy for the AIO reference package.
- Per-pad versus Colour-All LED resolution based on event recency.
- Keystone hints no longer survive a newer Colour-All reset event.

## Build status

The plugin source builds successfully in GitHub Actions after fixing the Decky Rollup preset import, restoring the frontend source tree, switching TypeScript to the React automatic JSX transform, and removing the conflicting custom Rollup output override.

The full RPCS3/AppImage reproduction remains a separate Linux build target and must be evaluated independently from the plugin build.

## Reference integrity

See `source/plugin/AIO-MANIFEST.json`, `docs/REFERENCE-HASHES.txt`, and `docs/REPRODUCIBILITY.md` for the recorded reference hashes and source lineage.
