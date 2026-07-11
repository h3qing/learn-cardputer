---
title: "The Gate to the Network: WiFi and the Dual-Core FreeRTOS Hiding Underneath"
subtitle: "Radio and the OS show up together"
order: 8
slug: "wifi-freertos-gate"
difficulty: 4
est_hours: 6
hardware:
  - "2.4GHz on-chip radio and antenna: the physical nature of an SoC"
  - "802.11 basics: SSID / channel / RSSI / beacon scanning"
  - "Dual-core division of labor: the WiFi stack core vs the app core, and the real relationship between FreeRTOS tasks and loop()"
  - "TCP/IP stack: DHCP, DNS, an HTTPS client, and JSON parsing (in a memory-constrained environment)"
  - "On-device web server, GET/POST routing, and mDNS (cardputer.local)"
  - "WiFi event callbacks and a disconnect/reconnect state machine"
project: "A trilogy: a WiFi signal-strength detector -> a desktop weather station -> a phone-driven marquee server, with automatic reconnect after a dropped connection and complete loading/error states as the acceptance bar."
summary: "Your first look behind the bare-metal illusion: the WiFi stack runs on one core, your code runs on the other, and underneath loop() is actually FreeRTOS. From 802.11 scanning to fetching JSON over HTTPS, then flipping the script to run a web server so your phone can control the device."
---

## Goals

- [ ] Walk through the full lifecycle of a WiFi connection: scan -> authenticate/associate -> get an IP via DHCP -> resolve via DNS
- [ ] Understand that `loop()` is just one task inside FreeRTOS, and prove with the API which core it runs on
- [ ] Write an HTTPS client that fetches JSON and parses it in a memory-constrained environment
- [ ] Run a web server on the Cardputer and reach it from your phone via `cardputer.local`
- [ ] Build a disconnect/auto-reconnect state machine using WiFi event callbacks

## How the Hardware Works

### The antenna has been right under your nose

For the first seven lessons we've been living in a "wired" world: SPI is a few copper traces, I2S is a few copper traces. This lesson's "wire" is the air itself. The ESP32-S3 chip has a complete 2.4GHz radio transceiver built in, with the antenna integrated right on the StampS3 module (see the official docs for exact placement: https://docs.m5stack.com/en/core/Cardputer) — that's the "mouth" it shouts into the world with. The radio signal runs at 2.4GHz, meaning a single cycle lasts just 0.4 nanoseconds, which is exactly why antenna design belongs to hardware engineers and all we programmers need to know is: **it's part of the chip, not a bolt-on module**. WiFi and BLE (next lesson) share this same radio hardware.

### 802.11: a broadcast station riding on air

Roughly every 100ms, your router shouts "I'm here" into the air — this is called a **beacon frame**, and it carries the SSID (network name), the channel (the 2.4GHz band is sliced into numbered channels, and which numbers are legal depends on local regulations: 1-11 in North America, 1-13 in Europe and China), and more. The WiFi list you see on your phone is just the result of listening for beacons. Signal strength is expressed as **RSSI**, in dBm, always negative: -40 is strong, -70 is so-so, -85 is basically unusable. Every 3dB drop halves the power — it's a logarithmic scale, and you'll get a gut feeling for it once you build the signal-strength detector later in this lesson.

### The bare-metal illusion, shattered

Here's the single most important reframe in this lesson. You think you're writing a "bare-metal program": `setup()` runs once, `loop()` runs forever. The truth is:

```
        ESP32-S3 dual core (240MHz each)
  +----------------+----------------+
  |   Core 0       |   Core 1       |
  |  (stack core)  |  (app core)    |
  +----------------+----------------+
  | WiFi task      | loopTask       |
  | TCP/IP task    |  \- your loop()|
  | event loop task| (any tasks you |
  | timer task     |  spawn go here |
  |                |  too)          |
  +----------------+----------------+
        ^ FreeRTOS scheduler runs the whole show ^
```

When the Arduino-ESP32 framework boots, it first starts **FreeRTOS** (a real-time operating system), then creates a task called `loopTask` that calls your `setup()` and `loop()` from inside it. The WiFi stack — all that 802.11 timing that needs microsecond-level responsiveness — is pinned to run on Core 0, while your code defaults to Core 1. That's why WiFi won't drop even if your `loop()` has a `delay(1000)` sitting in it: **the stack simply isn't at the mercy of your loop**. In Lesson 7 we reached for the RMT hardware peripheral to get microsecond-precise IR timing; WiFi's answer is blunter — just hand the stack an entire core. Two different strategies, same enemy: timing jitter.

### From radio waves to HTTPS

Joining a WiFi network is only the first layer. After that, **DHCP** asks the router for an IP address, **DNS** translates `api.example.com` into an IP, TCP opens a connection, TLS handshakes the encryption, and only then does the HTTP request actually go out. That whole TCP/IP stack (lwIP) is also made of FreeRTOS tasks quietly grinding away in the background. Watch your memory: a single TLS handshake can eat roughly 40KB of heap, and while the ESP32-S3 has 512KB of on-chip SRAM, once the system and the stack take their cut, what's left for you is usually around 300KB (check `ESP.getFreeHeap()` for the real number on your board) — and the full-screen sprite from Lesson 2 already claims 64KB of that. Starting with this lesson, `ESP.getFreeHeap()` becomes your constant companion.

## Hands-on Lab

### Experiment 1: Catch the OS in the act

Before you even touch WiFi, catch the "operating system" red-handed:

```cpp
#include "M5Cardputer.h"

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    M5Cardputer.Display.setTextSize(2);

    // xPortGetCoreID(): which core is this code running on?
    M5Cardputer.Display.printf("loop core: %d\n", xPortGetCoreID());
    // How many tasks are already running? (You haven't created a single one!)
    M5Cardputer.Display.printf("tasks: %d\n", uxTaskGetNumberOfTasks());
    // The current task's name
    M5Cardputer.Display.printf("name: %s\n", pcTaskGetName(NULL));
}

void loop() { delay(1000); }
```

**Why**: you'll see the core is 1, the task name is `loopTask`, and the task count is well above 1 — you haven't written a line of multitasking code, and a whole household of "tenants" is already living in there. The bare-metal illusion shatters on the spot.

### Experiment 2: Scan the air

```cpp
#include "M5Cardputer.h"
#include <WiFi.h>

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    M5Cardputer.Display.setTextSize(1);

    WiFi.mode(WIFI_STA);           // station mode: I'm a client
    int n = WiFi.scanNetworks();   // blocking scan, listens for beacons channel by channel
    for (int i = 0; i < n && i < 8; i++) {
        M5Cardputer.Display.printf("%-14.14s ch%2d %d\n",
            WiFi.SSID(i).c_str(),      // network name
            WiFi.channel(i),           // channel number
            WiFi.RSSI(i));             // signal strength in dBm
    }
}

void loop() {}
```

**Why**: `scanNetworks()` lingers on each channel for a short window to catch beacons, so it takes roughly 2 seconds. Notice how your neighbors are almost certainly crammed onto channels 1, 6, and 11 (the three that don't overlap).

### Experiment 3: Connect and fetch JSON

First add `bblanchon/ArduinoJson` as a dependency in `platformio.ini`.

```cpp
#include "M5Cardputer.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    M5Cardputer.Display.setTextSize(1);

    WiFi.begin("your-SSID", "your-password");
    while (WiFi.status() != WL_CONNECTED) delay(200); // wait for DHCP to hand out an IP
    M5Cardputer.Display.printf("IP: %s\n", WiFi.localIP().toString().c_str());
    M5Cardputer.Display.printf("heap: %u\n", ESP.getFreeHeap()); // remember this number

    HTTPClient http;
    // open-meteo is free, no key needed; swap the lat/lon for your city
    // Note: passing just a URL with no certificate silently falls back to
    // "don't verify the server" mode -- see item 3 in "Going Deeper"
    http.begin("https://api.open-meteo.com/v1/forecast"
               "?latitude=37.87&longitude=-122.27&current_weather=true");
    int code = http.GET();          // the TLS handshake happens here, eating ~40KB of heap
    M5Cardputer.Display.printf("HTTP %d heap: %u\n", code, ESP.getFreeHeap());

    if (code == 200) {
        JsonDocument doc;           // ArduinoJson v7 manages capacity automatically
        deserializeJson(doc, http.getString());
        float t = doc["current_weather"]["temperature"];
        M5Cardputer.Display.printf("Temp: %.1f C\n", t);
    }
    http.end();                     // release the connection, and a big chunk of heap comes back
}

void loop() {}
```

**Why**: compare `getFreeHeap()` before and after the TLS handshake and you'll see the memory cost of encryption with your own eyes. JSON parsing uses ArduinoJson instead of hand-rolled string handling because it's purpose-built for memory-constrained environments (zero-copy, bounded allocation).

### Experiment 4: Flip the script and become the server

```cpp
#include "M5Cardputer.h"
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>

WebServer server(80);

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    WiFi.begin("your-SSID", "your-password");
    while (WiFi.status() != WL_CONNECTED) delay(200);

    MDNS.begin("cardputer");   // now your phone's browser can just go to http://cardputer.local
    server.on("/", []() {
        server.send(200, "text/html",
            "<h1>Hello from my pocket!</h1>");
    });
    server.begin();
    M5Cardputer.Display.setTextSize(2);
    M5Cardputer.Display.println("cardputer.local");
    // print the IP too, as a fallback for phones that don't support mDNS
    M5Cardputer.Display.println(WiFi.localIP().toString());
}

void loop() {
    server.handleClient();  // process one pending HTTP request per loop -- don't skip this
}
```

**Why**: connect your phone to the same WiFi network as the Cardputer, then type `http://cardputer.local` into the browser — mDNS lets devices on the local network find each other without memorizing IP addresses. (iPhones and computers generally support `.local`, but plenty of Android browsers don't — in that case just type the IP shown on the screen.) Note that `handleClient()` must be called continuously inside `loop()`: this WebServer library is poll-based, request handling happens on your app core, and it's the exact same discipline as the "non-blocking main loop" from Lesson 4.

## Challenge

Tonight your pocket computer pulls a triple shift: first it's a radar sweeping out every WiFi dead zone in the building, then it becomes a desktop weather display that's always on, and finally it flips the tables entirely and runs its own server — so your friends can pull out their phones and fire messages straight onto the screen in your hand. The three builds unlock in order and share one acceptance bar: **automatic reconnect after a dropped connection; the UI must show loading and error states, never a blank screen of nothing.**

### Build 1: WiFi signal-strength detector

Walk around with the Cardputer and watch the screen show a live, RSSI-sorted network list to hunt down your router's dead zones.

- Milestone 1: loop the scan and display results sorted by RSSI (hint: `scanNetworks(true)` runs an async scan, and paired with `scanComplete()` the screen won't freeze while waiting)
- Milestone 2: map dBm to a color bar (strong = green, weak = red) — think carefully about how to map a logarithmic scale so it actually feels right
- Milestone 3: lock onto a single SSID and show its live RSSI in giant digits, watching the number jump as you walk — this is your own "signal Geiger counter"

### Build 2: Desktop weather station

Boot up, auto-connect to WiFi, fetch a weather API, render it as a dashboard, and refresh every 10 minutes.

- Milestone 1: state machine first — four states, `CONNECTING / FETCHING / SHOWING / ERROR`, each with its own screen
- Milestone 2: parse the JSON and draw the dashboard, reusing the sprite from Lesson 2 to avoid flicker
- Milestone 3: use `WiFi.onEvent()` to catch disconnect events and trigger a reconnect, instead of dumbly waiting inside `loop()`; back off on reconnects (1s, 2s, 4s...) so you don't turn the router into a DDoS target
- Milestone 4: pull the router's power and plug it back in — the station has to heal itself. This is the acceptance bar.

### Build 3: Pocket marquee server (the plot twist)

The Cardputer runs a web server; a friend opens `cardputer.local` in their phone's browser, types a message, hits send, and it scrolls across your device's screen.

- Milestone 1: GET `/` returns an HTML page with a text input (just write the HTML string straight into the firmware)
- Milestone 2: the form POSTs to `/send`, grab the text with `server.arg("msg")`, and print it over serial first to confirm it works
- Milestone 3: scrolling marquee animation — incoming messages go into a queue, and each frame in `loop()` shifts the x position and redraws; think about how `handleClient()` and rendering can peacefully coexist in the same loop (the frame-pacing trick from Lesson 4 drops right in)
- Milestone 4 (showoff mode): support multiple people sending at once, with several messages scrolling across the screen in different colors on different tracks

## Going Deeper

1. **Spin up a real FreeRTOS task by hand**: use `xTaskCreatePinnedToCore()` to move the marquee rendering into its own task pinned to Core 1. What happens when two tasks share a message queue? Try FreeRTOS's `xQueueSend`/`xQueueReceive` — a preview of Lesson 11.
2. **Sniff the beacons**: `esp_wifi_set_promiscuous(true)` puts the radio into promiscuous mode, delivering a callback for every 802.11 frame on the channel. Count how many frames per second fly across your channel 6, and you'll never think of the phrase "WiFi congestion" the same way again.
3. **The trust problem in HTTPS**: in Experiment 3, handing over just a URL was enough to connect over HTTPS, because Arduino-ESP32's HTTPClient silently calls `setInsecure()` whenever no certificate is supplied — the data is still encrypted, but the device never verifies who it's actually talking to, which does nothing against a man-in-the-middle attack. The correct approach: build a `WiFiClientSecure`, pin the server's root certificate into the firmware with `setCACert()`, and send the request via `http.begin(client, url)`. Try it out: what happens if you change a single character in the certificate?

## Checkpoint

1. From the moment you hit enter to the browser showing a page, what steps happen along the way, in order? (Hint: beacon/scan -> associate -> DHCP -> DNS -> TCP -> TLS -> HTTP)
2. If `loop()` has a `delay(5000)` in it, does WiFi drop? Why or why not? What's the essential difference between this and the jitter problem with `delayMicroseconds()` when sending IR codes back in Lesson 7?
3. If RSSI goes from -60 to -70, what fraction of the original power does that represent?
4. Why does `ESP.getFreeHeap()` differ by tens of KB before and after a TLS handshake? What does that mean for running a double-buffered sprite at the same time?
5. What problem does mDNS solve? Without it, how would your friend's phone find your Cardputer?

## References

- Official Cardputer docs and pinout: https://docs.m5stack.com/en/core/Cardputer
- ESP-IDF WiFi Driver docs (the foundation underneath the Arduino layer): https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-guides/wifi.html
- Arduino-ESP32 WiFi / HTTPClient / WebServer library docs: https://docs.espressif.com/projects/arduino-esp32/en/latest/libraries.html
- Official FreeRTOS introduction (tasks, queues, scheduling): https://www.freertos.org/Documentation/RTOS_book.html
- ArduinoJson official docs (v7): https://arduinojson.org/
- Open-Meteo free weather API: https://open-meteo.com/en/docs
