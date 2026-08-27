// toypad_event.hpp - reference implementation for LEGO Dimensions Toypad
// Event Protocol v1. Drop this file into your emulator project as-is; it
// depends only on <cstdint>, <cstddef>, <vector> and <string_view> from
// the standard library. Bring your own socket type.
//
// The header exposes two small facilities:
//
//   1. toypad_event::encode_* free functions that fill a caller-owned
//      buffer with the exact bytes an emulator should push to a connected
//      client.
//
//   2. toypad_event::Parser, a byte-oriented state machine that a client
//      feeds arbitrary chunks to; it emits fully-formed events via a
//      caller-supplied callback and handles resync, unknown versions and
//      unknown event types the way the spec requires.
//
// The transport (accept(), send(), select() etc.) is intentionally not
// this file's problem - every emulator has its own I/O style, and mixing
// asio / boost::asio / raw sockets / POSIX polling into a shared header
// would defeat the point of a portable spec. See example_emulator.cpp
// and example_client.cpp for how to wire this to a real socket.
//
// SPDX-License-Identifier: 0BSD (or CC0 - anyone can copy this in)

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <functional>
#include <string>
#include <string_view>
#include <vector>

namespace toypad_event {

// ------------------------------------------------------------- wire constants
inline constexpr std::uint8_t MAGIC   = 0x55;
inline constexpr std::uint8_t VERSION = 0x01;

enum class EventType : std::uint8_t {
    Color      = 0x01,
    Flash      = 0x02,
    TagPlaced  = 0x03,
    TagRemoved = 0x04,
    TagMoved   = 0x05,
};

enum class Pad : std::uint8_t {
    Center = 0x00,
    Left   = 0x01,
    Right  = 0x02,
    All    = 0xFF,
};

// ----------------------------------------------------------- typed event data
// The parser fills one of these; the encoder helpers accept the equivalent
// scalar arguments so an emulator never has to construct these to send.

struct ColorEvent {
    Pad pad;
    std::uint8_t r, g, b;
};

struct FlashEvent {
    Pad pad;
    std::uint8_t on_ms;
    std::uint8_t off_ms;
    std::uint8_t count;   // 0xFF = indefinite
    std::uint8_t r, g, b;
};

struct TagPlacedEvent {
    Pad pad;
    std::uint8_t slot;
    std::array<std::uint8_t, 7> uid;
    std::uint16_t tag_id;
    std::uint8_t tag_kind;  // 0 = minifig, 1 = vehicle/gadget
};

struct TagRemovedEvent {
    Pad pad;
    std::uint8_t slot;
};

struct TagMovedEvent {
    Pad pad;
    std::uint8_t from_slot;
    std::uint8_t to_slot;
};

// ============================================================== encode side
// Each function appends the exact frame bytes to `out`. Existing content of
// `out` is preserved so an emulator can batch several frames into one send
// call if it likes; the parser handles either shape.

namespace detail {
    inline void write_header(std::vector<std::uint8_t>& out, EventType t,
                             Pad pad, std::uint8_t payload_len) {
        out.push_back(MAGIC);
        out.push_back(VERSION);
        out.push_back(static_cast<std::uint8_t>(t));
        out.push_back(static_cast<std::uint8_t>(pad));
        out.push_back(payload_len);
    }
}

// A Color event: 3-byte payload, sRGB.
inline void encode_color(std::vector<std::uint8_t>& out, Pad pad,
                         std::uint8_t r, std::uint8_t g, std::uint8_t b) {
    detail::write_header(out, EventType::Color, pad, 3);
    out.push_back(r);
    out.push_back(g);
    out.push_back(b);
}

// A Flash event: 6-byte payload.
inline void encode_flash(std::vector<std::uint8_t>& out, Pad pad,
                         std::uint8_t on_ms, std::uint8_t off_ms,
                         std::uint8_t count, std::uint8_t r,
                         std::uint8_t g, std::uint8_t b) {
    detail::write_header(out, EventType::Flash, pad, 6);
    out.push_back(on_ms);
    out.push_back(off_ms);
    out.push_back(count);
    out.push_back(r);
    out.push_back(g);
    out.push_back(b);
}

// A Tag placed event: 11-byte payload. `uid` must be 7 bytes.
inline void encode_tag_placed(std::vector<std::uint8_t>& out, Pad pad,
                              std::uint8_t slot,
                              const std::array<std::uint8_t, 7>& uid,
                              std::uint16_t tag_id, std::uint8_t tag_kind) {
    detail::write_header(out, EventType::TagPlaced, pad, 11);
    out.push_back(slot);
    for (auto byte : uid) out.push_back(byte);
    out.push_back(static_cast<std::uint8_t>(tag_id & 0xFF));         // LE lo
    out.push_back(static_cast<std::uint8_t>((tag_id >> 8) & 0xFF));  // LE hi
    out.push_back(tag_kind);
}

// A Tag removed event: 1-byte payload.
inline void encode_tag_removed(std::vector<std::uint8_t>& out, Pad pad,
                               std::uint8_t slot) {
    detail::write_header(out, EventType::TagRemoved, pad, 1);
    out.push_back(slot);
}

// A Tag moved event: 2-byte payload.
inline void encode_tag_moved(std::vector<std::uint8_t>& out, Pad pad,
                             std::uint8_t from_slot, std::uint8_t to_slot) {
    detail::write_header(out, EventType::TagMoved, pad, 2);
    out.push_back(from_slot);
    out.push_back(to_slot);
}

// Handshake reply string per SPEC section 5. Emulators write this exact
// text (including the trailing newline) after receiving "HELLO\n" from
// a client, before pushing binary frames to that client.
inline std::string handshake_reply(std::string_view emulator_name,
                                   std::string_view emulator_version) {
    std::string s = "TOYPAD/1 ";
    s.append(emulator_name);
    s.push_back('/');
    s.append(emulator_version);
    s.push_back('\n');
    return s;
}

// ================================================================ parse side
// A Parser owns a small internal buffer and yields fully-formed frames to
// the caller. Feed it whatever bytes you have with feed(); it decides when
// there's enough for a frame and invokes the callbacks below. Unknown
// versions and unknown event types are skipped as the spec requires; the
// parser NEVER throws or requires the caller to disconnect.

struct Handlers {
    std::function<void(const ColorEvent&)>      on_color;
    std::function<void(const FlashEvent&)>      on_flash;
    std::function<void(const TagPlacedEvent&)>  on_tag_placed;
    std::function<void(const TagRemovedEvent&)> on_tag_removed;
    std::function<void(const TagMovedEvent&)>   on_tag_moved;
    // Called for any frame with an unknown version or unknown event type.
    // The parser has already advanced past the frame; this callback is
    // informational (log it in debug builds, ignore in release).
    std::function<void(std::uint8_t version, std::uint8_t event_type,
                       std::size_t payload_len)> on_unknown;
};

class Parser {
public:
    explicit Parser(Handlers h) : h_(std::move(h)) {}

    // Push arbitrary bytes into the parser. Safe to call with any length,
    // including zero. Invokes handlers synchronously for each complete
    // frame in the buffer.
    void feed(const std::uint8_t* data, std::size_t n) {
        buf_.insert(buf_.end(), data, data + n);
        drain();
    }

    // Discard everything the parser has buffered. Useful when a client
    // reconnects and wants a known state.
    void reset() { buf_.clear(); }

private:
    // Resynchronise on the next MAGIC byte. Consumes bytes one at a time.
    // Returns true if a MAGIC was found (and buf_[0] is now MAGIC), false
    // if the buffer was exhausted without one.
    bool find_magic() {
        while (!buf_.empty() && buf_[0] != MAGIC) {
            buf_.erase(buf_.begin());
        }
        return !buf_.empty();
    }

    void drain() {
        while (true) {
            if (!find_magic()) return;
            if (buf_.size() < 5) return;   // need the full header first
            const std::uint8_t version     = buf_[1];
            const std::uint8_t event_type  = buf_[2];
            const std::uint8_t pad_byte    = buf_[3];
            const std::uint8_t payload_len = buf_[4];
            const std::size_t total = 5 + payload_len;
            if (buf_.size() < total) return; // wait for the payload

            // Extract the frame's bytes, then advance the buffer up front so
            // an exception in a user handler doesn't leave us stuck.
            std::vector<std::uint8_t> frame(buf_.begin(), buf_.begin() + total);
            buf_.erase(buf_.begin(), buf_.begin() + total);

            if (version != VERSION) {
                if (h_.on_unknown) h_.on_unknown(version, event_type, payload_len);
                continue;
            }

            const Pad pad = static_cast<Pad>(pad_byte);
            const auto* p = frame.data() + 5;

            switch (static_cast<EventType>(event_type)) {
                case EventType::Color:
                    if (payload_len == 3 && h_.on_color)
                        h_.on_color(ColorEvent{pad, p[0], p[1], p[2]});
                    break;
                case EventType::Flash:
                    if (payload_len == 6 && h_.on_flash)
                        h_.on_flash(FlashEvent{pad, p[0], p[1], p[2], p[3], p[4], p[5]});
                    break;
                case EventType::TagPlaced:
                    if (payload_len == 11 && h_.on_tag_placed) {
                        TagPlacedEvent e{pad, p[0], {}, 0, 0};
                        std::memcpy(e.uid.data(), p + 1, 7);
                        e.tag_id   = static_cast<std::uint16_t>(p[8] | (p[9] << 8));
                        e.tag_kind = p[10];
                        h_.on_tag_placed(e);
                    }
                    break;
                case EventType::TagRemoved:
                    if (payload_len == 1 && h_.on_tag_removed)
                        h_.on_tag_removed(TagRemovedEvent{pad, p[0]});
                    break;
                case EventType::TagMoved:
                    if (payload_len == 2 && h_.on_tag_moved)
                        h_.on_tag_moved(TagMovedEvent{pad, p[0], p[1]});
                    break;
                default:
                    if (h_.on_unknown)
                        h_.on_unknown(version, event_type, payload_len);
                    break;
            }
        }
    }

    Handlers h_;
    std::vector<std::uint8_t> buf_;
};

} // namespace toypad_event
