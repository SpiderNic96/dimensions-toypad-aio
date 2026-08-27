// example_client.cpp - a print-every-event client. About 60 lines of
// real code, most of it socket boilerplate. Compile with any C++17
// compiler on Linux/macOS:
//
//   g++ -std=c++17 example_client.cpp -o toypad-tap
//
// Run against a toypad-capable emulator on the same machine:
//
//   ./toypad-tap 127.0.0.1 9191
//
// You should see one line printed per colour/flash/tag event the game
// emits. Use this to prove an emulator's implementation before wiring
// a real UI to the socket.

#include "toypad_event.hpp"

#include <arpa/inet.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

int main(int argc, char** argv) {
    const char* host = (argc > 1) ? argv[1] : "127.0.0.1";
    const int port   = (argc > 2) ? std::atoi(argv[2]) : 9191;

    int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) { std::perror("socket"); return 1; }
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port   = htons(static_cast<std::uint16_t>(port));
    if (::inet_pton(AF_INET, host, &addr.sin_addr) != 1) {
        std::fprintf(stderr, "bad host: %s\n", host); return 1;
    }
    if (::connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
        std::perror("connect"); return 1;
    }

    // Optional handshake - identifies which emulator we're talking to.
    // Emulators that don't implement HELLO ignore this send and start
    // pushing binary frames when they have one.
    const char* hello = "HELLO\n";
    ::send(fd, hello, std::strlen(hello), 0);

    toypad_event::Handlers h;
    h.on_color = [](const toypad_event::ColorEvent& e) {
        std::printf("color  pad=%u rgb=(%3u,%3u,%3u)\n",
                    static_cast<unsigned>(e.pad), e.r, e.g, e.b);
    };
    h.on_flash = [](const toypad_event::FlashEvent& e) {
        std::printf("flash  pad=%u rgb=(%3u,%3u,%3u) on=%ums off=%ums count=%u\n",
                    static_cast<unsigned>(e.pad), e.r, e.g, e.b,
                    e.on_ms, e.off_ms, e.count);
    };
    h.on_tag_placed = [](const toypad_event::TagPlacedEvent& e) {
        std::printf("place  pad=%u slot=%u tag_id=%u kind=%u\n",
                    static_cast<unsigned>(e.pad), e.slot, e.tag_id, e.tag_kind);
    };
    h.on_tag_removed = [](const toypad_event::TagRemovedEvent& e) {
        std::printf("remove pad=%u slot=%u\n",
                    static_cast<unsigned>(e.pad), e.slot);
    };
    h.on_tag_moved = [](const toypad_event::TagMovedEvent& e) {
        std::printf("move   pad=%u %u -> %u\n",
                    static_cast<unsigned>(e.pad), e.from_slot, e.to_slot);
    };
    h.on_unknown = [](std::uint8_t v, std::uint8_t t, std::size_t n) {
        std::printf("unknown v=%u type=0x%02x payload_len=%zu (skipped)\n",
                    v, t, n);
    };

    toypad_event::Parser parser(std::move(h));

    std::uint8_t buf[4096];
    for (;;) {
        ssize_t n = ::recv(fd, buf, sizeof(buf), 0);
        if (n <= 0) break;
        parser.feed(buf, static_cast<std::size_t>(n));
    }
    ::close(fd);
    return 0;
}
