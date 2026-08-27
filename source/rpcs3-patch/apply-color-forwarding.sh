#!/usr/bin/env bash
# apply-color-forwarding.sh - patches the fork's Dimensions.cpp and
# DimensionsListener.{cpp,h} to forward LED colour/flash commands to
# connected companion apps per the LEGO Dimensions Toypad Event Protocol
# v1. Idempotent: safe to re-run; detects "already patched" and exits 0.
#
# After running, cd into the build tree and let ninja incrementally
# rebuild - only the two touched .cpp files recompile, then a relink.
# Roughly 3-8 minutes on Deck internal storage.

set -euo pipefail

ROOT="${ROOT:-$HOME/rpcs3-dist}"
IO="$ROOT/rpcs3/Emu/Io"
H="$IO/DimensionsListener.h"
LC="$IO/DimensionsListener.cpp"
DC="$IO/Dimensions.cpp"

for f in "$H" "$LC" "$DC"; do
    [ -f "$f" ] || { echo "ERROR: not found: $f" >&2; exit 1; }
done

# Backup once - never overwrite an existing .orig, so re-runs don't lose
# the pristine baseline.
for f in "$H" "$LC" "$DC"; do
    [ -f "$f.orig" ] || cp "$f" "$f.orig"
done

echo "==> Patching $H"
if grep -q "dimensions_listener_broadcast" "$H"; then
    echo "    already patched"
else
    # Append the broadcast API declaration + required includes.
    python3 - "$H" <<'PY'
import sys, io
path = sys.argv[1]
src = open(path).read()
add_includes = "#include <cstddef>\n#include <cstdint>\n\n"
if "#include <cstddef>" not in src:
    src = src.replace("#pragma once\n", "#pragma once\n\n" + add_includes, 1)
addition = """
// Push a raw byte sequence to every connected companion app. Used by the
// USB command handler to forward outbound events (colour, flash, tag
// state) per the LEGO Dimensions Toypad Event Protocol v1. Thread-safe;
// silently a no-op when no clients are connected. Slow or wedged clients
// are dropped rather than allowed to stall the emulator's USB path.
void dimensions_listener_broadcast(const std::uint8_t* data, std::size_t len);
"""
if "dimensions_listener_broadcast" not in src:
    src = src.rstrip() + "\n" + addition
open(path, "w").write(src)
PY
    echo "    added broadcast API"
fi

echo "==> Patching $LC"
if grep -q "dimensions_listener_broadcast" "$LC"; then
    echo "    already patched"
else
    python3 - "$LC" <<'PY'
import sys, re
path = sys.argv[1]
src = open(path).read()

# 1. Ensure <mutex> and <algorithm> are included alongside the existing
#    <atomic>/<thread>/<vector> block.
if "#include <mutex>" not in src:
    src = src.replace("#include <atomic>\n", "#include <atomic>\n#include <algorithm>\n#include <mutex>\n", 1)

# 2. Add the client-list state + broadcast_bytes helper right after the
#    existing g_listen_sock / move_pickup_delay block. Anchor on the
#    unique 'move_pickup_delay' line.
anchor = "\tconstexpr auto move_pickup_delay = std::chrono::milliseconds(500);"
addition = anchor + """

\t// Every accepted client is registered here so outbound events (colour,
\t// flash, tag state) can be fanned out from the USB thread. The old
\t// implementation was single-client; we now keep the socket alive in
\t// this vector until the client disconnects or the listener shuts down.
\tstd::mutex g_clients_mu;
\tstd::vector<socket_t> g_clients;

\tvoid register_client(socket_t s)
\t{
\t\tstd::lock_guard<std::mutex> lock(g_clients_mu);
\t\tg_clients.push_back(s);
\t}

\tvoid unregister_client(socket_t s)
\t{
\t\tstd::lock_guard<std::mutex> lock(g_clients_mu);
\t\tg_clients.erase(std::remove(g_clients.begin(), g_clients.end(), s), g_clients.end());
\t}

\t// Non-blocking send to every registered client. Any socket that fails
\t// or would block is dropped: colour events fire on a hot USB path and
\t// blocking here would stall the game's toypad polling loop.
\tvoid broadcast_bytes(const std::uint8_t* data, std::size_t len)
\t{
\t\tif (len == 0) return;
\t\tstd::vector<socket_t> to_drop;
\t\t{
\t\t\tstd::lock_guard<std::mutex> lock(g_clients_mu);
\t\t\tfor (socket_t s : g_clients)
\t\t\t{
\t\t\t\tstd::size_t sent = 0;
\t\t\t\twhile (sent < len)
\t\t\t\t{
#ifdef _WIN32
\t\t\t\t\tconst int n = ::send(s, reinterpret_cast<const char*>(data) + sent,
\t\t\t\t\t                     static_cast<int>(len - sent), 0);
#else
\t\t\t\t\tconst ssize_t n = ::send(s, data + sent, len - sent, MSG_NOSIGNAL | MSG_DONTWAIT);
#endif
\t\t\t\t\tif (n <= 0) { to_drop.push_back(s); break; }
\t\t\t\t\tsent += static_cast<std::size_t>(n);
\t\t\t\t}
\t\t\t}
\t\t}
\t\tfor (socket_t s : to_drop) { unregister_client(s); close_sock(s); }
\t}
"""
if "broadcast_bytes" not in src:
    src = src.replace(anchor, addition, 1)

# 3. Replace the accept loop body so each client runs in its own detached
#    reader thread AND is registered for broadcasts.
old_accept = """\t\t\tconst socket_t client = ::accept(listen_sock, nullptr, nullptr);
\t\t\tif (client == invalid_sock)
\t\t\t\tbreak; // socket closed by dimensions_listener_stop()
\t\t\thandle_client(client);
\t\t\tclose_sock(client);"""
new_accept = """\t\t\tconst socket_t client = ::accept(listen_sock, nullptr, nullptr);
\t\t\tif (client == invalid_sock)
\t\t\t\tbreak; // socket closed by dimensions_listener_stop()
\t\t\t// One reader thread per client. Inbound LOAD/REMOVE/MOVE drain
\t\t\t// as before; broadcast_bytes() can push outbound frames from any
\t\t\t// other thread while the socket is registered.
\t\t\tregister_client(client);
\t\t\tstd::thread([client]{
\t\t\t\thandle_client(client);
\t\t\t\tunregister_client(client);
\t\t\t\tclose_sock(client);
\t\t\t}).detach();"""
if "One reader thread per client" not in src:
    if old_accept not in src:
        raise SystemExit("could not find the accept loop to patch")
    src = src.replace(old_accept, new_accept, 1)

# 4. Insert a client-socket cleanup step into the existing stop() body,
#    between the listen-socket close and the thread join. Anchor on the
#    exact line that closes the listen socket.
stop_anchor = "\t\tclose_sock(sock); // unblocks accept()"
stop_add = stop_anchor + """

\t// Close every client socket so their reader threads exit their recv loops.
\t{
\t\tstd::lock_guard<std::mutex> lock(g_clients_mu);
\t\tfor (socket_t s : g_clients) close_sock(s);
\t\tg_clients.clear();
\t}"""
if "Close every client socket" not in src:
    src = src.replace(stop_anchor, stop_add, 1)

# 5. Add the public broadcast entry point at the very end of the file.
if "void dimensions_listener_broadcast" not in src:
    src = src.rstrip() + """

void dimensions_listener_broadcast(const std::uint8_t* data, std::size_t len)
{
\tif (!g_listener_running.load()) return;
\tbroadcast_bytes(data, len);
}
"""

open(path, "w").write(src)
PY
    echo "    added client tracking + broadcast"
fi

echo "==> Patching $DC"
if grep -q "dimensions_listener_broadcast" "$DC"; then
    echo "    already patched"
else
    python3 - "$DC" <<'PY'
import sys, re
path = sys.argv[1]
src = open(path).read()

# Add the header include next to the existing DimensionsListener include or
# after Dimensions.h if that's the pattern used.
if '#include "DimensionsListener.h"' not in src:
    src = src.replace('#include "Dimensions.h"',
                      '#include "Dimensions.h"\n#include "DimensionsListener.h"', 1)

# The colour/flash case block currently falls through all variants to a single
# blank-response body. Match it as a regex so indentation depth doesn't
# matter: the fork nests this switch several levels deep and the exact tab
# count differs between the sed anchor and the file. We capture the leading
# whitespace and reuse it in the replacement so the new code lines up.
case_re = re.compile(
    r"([ \t]*)case 0xC0: // Color\s*\n"
    r"\1case 0xC1: // Get Pad Color\s*\n"
    r"\1case 0xC2: // Fade\s*\n"
    r"\1case 0xC3: // Flash\s*\n"
    r"\1case 0xC4: // Fade Random\s*\n"
    r"\1case 0xC6: // Fade All\s*\n"
    r"\1case 0xC7: // Flash All\s*\n"
    r"\1case 0xC8: // Color All\s*\n"
    r"\1\{\s*\n"
    r"\1\t// Send a blank response to acknowledge color has been sent to toypad\s*\n"
    r"\1\tg_dimensionstoypad\.get_blank_response\(0x01, sequence, q_result\);\s*\n"
    r"\1\tbreak;\s*\n"
    r"\1\}"
)

def build_replacement(indent):
    body_indent = indent + "\t"
    return (
        f"{indent}case 0xC0: // Color (per-pad solid)\n"
        f"{indent}case 0xC1: // Get Pad Color (game reads current colour; not forwarded)\n"
        f"{indent}case 0xC2: // Fade (per-pad fade to colour)\n"
        f"{indent}case 0xC3: // Flash (per-pad flash)\n"
        f"{indent}case 0xC4: // Fade Random\n"
        f"{indent}case 0xC6: // Fade All\n"
        f"{indent}case 0xC7: // Flash All (broadcast flash)\n"
        f"{indent}case 0xC8: // Color All (broadcast solid)\n"
        f"{indent}{{\n"
        f"{body_indent}// Forward the pad's new visual state to connected companion apps\n"
        f"{body_indent}// per the LEGO Dimensions Toypad Event Protocol v1 before sending\n"
        f"{body_indent}// the blank ack the game expects. The game's own USB flow is\n"
        f"{body_indent}// unchanged; this only ADDS an outbound TCP frame per command.\n"
        f"{body_indent}auto to_spec_pad = [](u8 fork_pad) -> u8 {{\n"
        f"{body_indent}\t// Fork wire: 1=center, 2=left, 3=right; spec wire: 0/1/2.\n"
        f"{body_indent}\t// Anything else, including the 'all pads' sentinel, maps to 0xFF.\n"
        f"{body_indent}\tswitch (fork_pad) {{ case 1: return 0x00; case 2: return 0x01; case 3: return 0x02; default: return 0xFF; }}\n"
        f"{body_indent}}};\n"
        f"{body_indent}const u8 fork_pad = buf[3];\n"
        f"{body_indent}const u8 spec_pad = (command == 0xC6 || command == 0xC7 || command == 0xC8) ? 0xFF : to_spec_pad(fork_pad);\n"
        f"{body_indent}std::vector<u8> frame;\n"
        f"{body_indent}frame.reserve(5 + 6);\n"
        f"{body_indent}auto push_header = [&](u8 event_type, u8 payload_len) {{\n"
        f"{body_indent}\tframe.push_back(0x55); frame.push_back(0x01);\n"
        f"{body_indent}\tframe.push_back(event_type); frame.push_back(spec_pad);\n"
        f"{body_indent}\tframe.push_back(payload_len);\n"
        f"{body_indent}}};\n"
        f"{body_indent}switch (command)\n"
        f"{body_indent}{{\n"
        f"{body_indent}case 0xC0: // Color:   [pad][r][g][b]\n"
        f"{body_indent}case 0xC8: // Color All: [_][r][g][b]\n"
        f"{body_indent}\tpush_header(0x01, 3);\n"
        f"{body_indent}\tframe.push_back(buf[4]); frame.push_back(buf[5]); frame.push_back(buf[6]);\n"
        f"{body_indent}\tbreak;\n"
        f"{body_indent}case 0xC2: // Fade: [pad][pulse_time][pulse_count][r][g][b]\n"
        f"{body_indent}\tpush_header(0x01, 3); // Fade renders as final solid colour for spec v1\n"
        f"{body_indent}\tframe.push_back(buf[7]); frame.push_back(buf[8]); frame.push_back(buf[9]);\n"
        f"{body_indent}\tbreak;\n"
        f"{body_indent}case 0xC3: // Flash: [pad][white_ms][black_ms][count][r][g][b]\n"
        f"{body_indent}case 0xC7: // Flash All: same shape without pad addressing\n"
        f"{body_indent}\tpush_header(0x02, 6);\n"
        f"{body_indent}\tframe.push_back(buf[4]); frame.push_back(buf[5]); frame.push_back(buf[6]);\n"
        f"{body_indent}\tframe.push_back(buf[7]); frame.push_back(buf[8]); frame.push_back(buf[9]);\n"
        f"{body_indent}\tbreak;\n"
        f"{body_indent}default:\n"
        f"{body_indent}\t// 0xC1 read and 0xC4 random-fade have no meaningful RGB to forward under v1.\n"
        f"{body_indent}\tbreak;\n"
        f"{body_indent}}}\n"
        f"{body_indent}if (!frame.empty())\n"
        f"{body_indent}\tdimensions_listener_broadcast(frame.data(), frame.size());\n"
        f"\n"
        f"{body_indent}// Preserve original behaviour: acknowledge to the game exactly as before.\n"
        f"{body_indent}g_dimensionstoypad.get_blank_response(0x01, sequence, q_result);\n"
        f"{body_indent}break;\n"
        f"{indent}}}"
    )

if "dimensions_listener_broadcast(frame.data()" in src:
    pass  # already patched
else:
    m = case_re.search(src)
    if not m:
        raise SystemExit("could not find the colour case block to patch")
    src = src[:m.start()] + build_replacement(m.group(1)) + src[m.end():]

open(path, "w").write(src)
PY
    echo "    split colour case; wired broadcast"
fi

cat <<'EOF'

All patches applied. Next steps:

  1. Rebuild inside the container (only touched .cpp files recompile):

       distrobox enter rpcs3dist -- ninja -C /home/deck/rpcs3-dist/build

  2. If ninja succeeds, repackage the AppImage:

       bash /home/deck/Downloads/make-rpcs3-appimage.sh

  3. Test with the reference client BEFORE touching the plugin:

       # In a terminal:
       nc 127.0.0.1 9191 | xxd    # you should see 0x55 frames as the
                                   # game changes pad colours

  4. Then update the plugin backend to parse the frames (separate change).

To revert:

    cd /home/deck/rpcs3-dist/rpcs3/Emu/Io
    for f in DimensionsListener.h DimensionsListener.cpp Dimensions.cpp; do
        mv "$f.orig" "$f"
    done
EOF
