# Public Release Checklist

Before publishing the AIO release, physically test the installed package on the target Steam Deck.

- [ ] Fresh AIO install
- [ ] Decky plugin loads
- [ ] Web UI loads
- [ ] Bundled RPCS3 is detected
- [ ] Bundled AppImage is the executable actually launched
- [ ] No system/PATH/container RPCS3 fallback
- [ ] Steam shortcut creation works
- [ ] Steam shortcut launches LEGO Dimensions
- [ ] Native Game Mode launch works
- [ ] Gamescope works
- [ ] Fullscreen works
- [ ] 16:9 presentation works
- [ ] Existing RPCS3 saves/configuration remain available
- [ ] External controller tested
- [ ] Deck controls tested
- [ ] Figure artwork displays
- [ ] Collection artwork displays
- [ ] Pad/figure state displays correctly
- [ ] Tag library loads
- [ ] Missing tag retrieval works
- [ ] Tag navigation works
- [ ] Focus state remains readable
- [ ] Dark artwork remains readable
- [ ] Phone/web remote works
- [ ] Toypad listener initially reports Waiting
- [ ] Toypad listener transitions to Connected when the game is ready
- [ ] Figure load works
- [ ] Figure move works
- [ ] Figure remove works
- [ ] 60 FPS configuration tested
- [ ] Stock/30 FPS configuration tested
- [ ] RPCS3 GUI setup path works
- [ ] Direct LEGO launch does not unnecessarily show RPCS3 GUI
- [ ] Reboot and repeat launch tested

Do not mark a test as passed from source inspection alone. If it was not physically tested, record `NOT TESTED`.


## 3.3.18 repair-specific checks

- [ ] Sidebar contains no live seven-slot Toypad renderer
- [ ] Opening the overlay does not create a second Toypad/state/LED polling loop
- [ ] B/Escape backs out one modal level at a time and only closes at the Toypad root
- [ ] Search -> franchise -> roster focus does not jump or reset unexpectedly
- [ ] Franchise grid is centered with the search field
- [ ] No redundant visible background boxes appear behind the active modal surface
- [ ] Move into an occupied slot swaps both figures without loss
- [ ] Clear All empties all seven slots and the visual state immediately matches
- [ ] DeLorean appears under Back to the Future and not in Starters/Story
- [ ] Powered idle Toypad has the soft white/pale-blue base glow
- [ ] Game Colour events override the correct physical LED region
- [ ] Flash/strobe timing follows Toypad ticks (~40 ms/tick) and finite counts behave correctly
- [ ] Fade events interpolate continuously at the supplied speed
- [ ] Explicit LED OFF suppresses the base glow for that region
- [ ] LED animation continues while browsing/searching without restarting on unchanged polls
- [ ] Hotkey capture instructs release-before-capture and reports Steam Input/evdev fallback clearly
- [ ] Bundled RPCS3 AppImage SHA256 remains unchanged

Use `python3 -m py_compile main.py` and `node --check dist/index.js` as release-time static checks.
