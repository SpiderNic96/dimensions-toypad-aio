// example_emulator.cpp - the smallest possible integration.
//
// This is what an emulator's Dimensions.cpp gets patched to look like.
// The Existing() bits are the code paths that already handle USB
// commands from the game; the NEW lines are what this spec adds. About
// 10 lines of real diff.
//
// Transport (accept, per-client send, fan-out) is left to the emulator's
// own I/O style. RPCS3 uses its `named_thread` pattern; Cemu uses
// boost::asio; shadPS4 uses Qt. Each project picks its own and calls
// broadcast(bytes) from where its socket layer expects.

#include "toypad_event.hpp"

#include <cstdint>
#include <mutex>
#include <vector>

// Placeholder: replace with the emulator's own socket/client abstraction.
struct Client {
    virtual ~Client() = default;
    virtual void send_bytes(const std::uint8_t* data, std::size_t n) = 0;
};

// Owned by the emulator's toypad singleton. Adding a client and removing
// on disconnect is the emulator's job; the shape below is only for
// illustration.
struct ToypadEventPublisher {
    std::mutex m;
    std::vector<Client*> clients;

    // Called by the emulator's USB command handler whenever the game asks
    // for a solid pad colour. This is the ONE line most emulators need to
    // add to fix Locate Keystone.
    void publish_color(toypad_event::Pad pad,
                       std::uint8_t r, std::uint8_t g, std::uint8_t b) {
        std::vector<std::uint8_t> frame;
        toypad_event::encode_color(frame, pad, r, g, b);
        broadcast(frame);
    }

    // Called on a flash command from the game.
    void publish_flash(toypad_event::Pad pad,
                       std::uint8_t on_ms, std::uint8_t off_ms,
                       std::uint8_t count, std::uint8_t r,
                       std::uint8_t g, std::uint8_t b) {
        std::vector<std::uint8_t> frame;
        toypad_event::encode_flash(frame, pad, on_ms, off_ms, count, r, g, b);
        broadcast(frame);
    }

    // Tag events are optional (see spec section 4). Include them if the
    // emulator already tracks pad state; skip if it doesn't.
    void publish_tag_placed(toypad_event::Pad pad, std::uint8_t slot,
                            const std::array<std::uint8_t, 7>& uid,
                            std::uint16_t tag_id, std::uint8_t tag_kind) {
        std::vector<std::uint8_t> frame;
        toypad_event::encode_tag_placed(frame, pad, slot, uid, tag_id, tag_kind);
        broadcast(frame);
    }

    void broadcast(const std::vector<std::uint8_t>& frame) {
        std::lock_guard<std::mutex> g(m);
        for (auto* c : clients) c->send_bytes(frame.data(), frame.size());
    }
};

// ============================================================================
// The single-file diff an emulator needs:
//
// In the USB command dispatcher (in RPCS3: Emu/Io/Dimensions.cpp around the
// line PR #15763's author flagged as "unimplemented"), replace the branch
// that currently swallows the colour command with:
//
//     case CMD_COLOUR: {
//         const auto pad = static_cast<toypad_event::Pad>(payload[0]);
//         const std::uint8_t r = payload[1];
//         const std::uint8_t g = payload[2];
//         const std::uint8_t b = payload[3];
//         g_toypad_events.publish_color(pad, r, g, b);
//         send_ack(request_id); // whatever the emulator already does
//         break;
//     }
//
// and equivalent for CMD_FLASH. That is the entire change on the emit side.
