---
title: "Invisible Spellcasting: Infrared and Microsecond-Precise Timing"
subtitle: "Morse code made of light, at 38kHz"
order: 7
slug: "ir-remote-rmt"
difficulty: 3
est_hours: 4
hardware:
  - "38kHz carrier modulation: why an IR receiver only listens for one flicker rate"
  - "NEC protocol frame format: leader / address / command / logical inverse"
  - "Pulse-width encoding: using duration to spell out 0 and 1"
  - "The jitter problem with software delay() timing, and the ESP32 RMT hardware peripheral"
  - "The TX-only limitation: Cardputer can send from a code library but can't learn-and-clone a remote"
  - "The IRremoteESP8266 library and common brand code-library workflows"
project: "Build a universal remote with an on-screen menu and keyboard channel selection, and invisibly turn off your own TV from across the living room."
summary: "Infrared remote control is layered: a 38kHz carrier lets the receiver filter the real signal out of ambient light, and the NEC protocol uses pulse length to encode address, command, and an inverse checksum. Microsecond-level timing can't survive on delay() alone — the ESP32's RMT peripheral generates precise pulses in hardware, so a code lookup is all it takes to control a real appliance."
---

## Goals

- [ ] Explain what the 38kHz carrier does — why the sun and a light bulb can't fool an IR receiver
- [ ] Draw out one NEC protocol frame: leader, address, command, inverse bits, and the pulse-width difference between 0 and 1
- [ ] Explain clearly why `delayMicroseconds()` can't carry a microsecond-precision protocol, and what problem the RMT peripheral solves
- [ ] Use the IRremoteESP8266 library to send a real TV control code from the Cardputer
- [ ] Complete the challenge: a universal remote with an on-screen menu and keyboard channel selection

## How the Hardware Works

The last two lessons were about sound — I2S turned digital samples into speaker vibrations, and PDM turned air vibrations back into a bitstream. This lesson swaps in a different invisible wave: infrared light. There's an IR LED hiding at the top of your Cardputer, emitting light around 940nm — invisible to your eyes, but crystal clear to a TV's receiver.

**Question one: infrared is everywhere. How does the TV know which beam of light is the remote?**

The sun is a massive source of infrared radiation, and incandescent bulbs, radiators, even your own body heat all radiate IR. If the TV's receiver reacted to "any infrared present," it would be drowned out by ambient noise. The solution is clever: the remote doesn't emit "steady light" — it emits **light flickering at 38kHz**. The receiver (commonly a TSOP-series chip) has a built-in bandpass filter that's only sensitive to a signal blinking 38,000 times a second — no matter how strong the sunlight is, it's DC, and gets filtered straight out. It's like agreeing with a friend to blink in a specific rhythm across a noisy bar to pass a message: the light itself isn't unusual, the **rhythm** is the signal. This 38kHz flicker is called the **carrier**.

**Question two: a carrier alone isn't enough — how is the actual content encoded?**

On top of the carrier sits a second layer: the protocol. The classic one is NEC, and it doesn't encode data by "how long the light stays on" — it encodes it through **combinations of pulse and gap duration**, called pulse-width encoding. A segment with the carrier on is called a mark; a silent segment is called a space:

```
One NEC frame (time flows left to right, ▓ = 38kHz carrier on, ░ = silence):

▓▓▓▓▓▓▓▓▓░░░░░  ▓░ ▓░░░ ▓░ ▓░░░ ... ▓
  9ms      4.5ms  |____ 32 data bits ____|  stop pulse
  leader

Logical 0:  ▓░        ~560µs mark + 560µs space   (total ~1.12ms)
Logical 1:  ▓░░░      ~560µs mark + 1690µs space  (total ~2.25ms)
```

The mark length never changes — the difference is entirely in how long the space lasts. That's **encoding 0 and 1 through duration**. The 32 data bits break down into: 8-bit address + 8-bit address-inverse + 8-bit command + 8-bit command-inverse. The inverse bits are a built-in checksum: the receiver XORs the command against its inverse, and the result must be all 1s or the frame gets dropped. Open air is a lossy channel — someone walks by, the angle drifts, sunlight interferes — so this "every byte proves itself" redundancy earns its keep. The address field distinguishes devices — press your TV remote, and the air conditioner doesn't flinch.

**Question three: why can't you just generate these pulses with delay()?**

The space for a logical 0 is 560µs, and NEC's tolerance window is roughly ±25%. You might think: `digitalWrite(HIGH); delayMicroseconds(560); ...` looped 32 times ought to do it. The problem is your code isn't the only tenant on the machine — Lesson 8 covers this properly, but underneath Arduino's `loop()` runs FreeRTOS, plus a WiFi stack and timer interrupts that can preempt you at any moment. One interrupt stealing a few dozen microseconds is enough to push a bit's duration outside the tolerance window, invalidating the whole frame. This is the same class of problem as the audio glitches back in Lesson 5: **the CPU is a bad fit for anything that has to watch a stopwatch down to the microsecond**.

Lesson 5's answer was DMA. This lesson's answer is **RMT (Remote Control Transceiver)** — a hardware peripheral the ESP32 built specifically for scenarios like infrared. You write your pulse sequence out as a "duration table" (an array of level + duration pairs), hand it to RMT, and hardware executes it item by item, independently and precisely — even layering the 38kHz carrier on top in hardware. The CPU submits the job and moves on to other things; even with WiFi interrupts flying everywhere, the waveform that goes out is dead accurate. The same idea shows up again: **hand real-time-critical work to dedicated hardware, and let the CPU just orchestrate**.

One last real-world constraint: the Cardputer only has an IR transmit LED — **no receiver** (TX-only). That means you can't point your old remote at it and have it "learn" a code. Fortunately, codes for popular appliances have long since been catalogued by the community — the LIRC database, IRDB, and the protocol support baked into IRremoteESP8266 — so it's a lookup, not a capture. You're a spellcaster consulting a grimoire, not an eavesdropper.

## Hands-on Lab

### Step 1: set up the project, pull in two libraries

Add IRremoteESP8266 to `platformio.ini` (it's the most complete IR protocol library in the ESP32/ESP8266 world, supporting well over a hundred protocols):

```ini
[env:cardputer]
platform = espressif32
board = m5stack-stamps3
framework = arduino
lib_deps =
    m5stack/M5Cardputer
    crankyoldgit/IRremoteESP8266
```

### Step 2: confirm the IR LED's pin

Open the [Cardputer page on docs.m5stack.com](https://docs.m5stack.com/en/core/Cardputer) and find the GPIO number assigned to the IR LED in the pinout table. **Don't copy a number from some forum post** — trust the official docs. This is the same fundamental habit you practiced in Lesson 1. Once you've found it, drop it into the constant in the code below.

### Step 3: send your first infrared command

```cpp
#include "M5Cardputer.h"
#include <IRremoteESP8266.h>
#include <IRsend.h>

// Check the official pinout docs and fill in the IR LED's GPIO number
const uint16_t kIrLedPin = /* IR pin from the official pinout */;

IRsend irsend(kIrLedPin);

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    irsend.begin();  // configure the transmit pin

    M5Cardputer.Display.setTextSize(2);
    // Note: the default font only supports ASCII; a CJK font would need separate setup
    M5Cardputer.Display.println("Press Enter: send NEC");
}

void loop() {
    M5Cardputer.update();
    if (M5Cardputer.Keyboard.isChange() && M5Cardputer.Keyboard.isPressed()) {
        auto st = M5Cardputer.Keyboard.keysState();
        if (st.enter) {
            // 0x20DF10EF is a common LG TV power code (NEC format, 32 bits)
            // Swap in your own TV's brand code -- see Step 4
            irsend.sendNEC(0x20DF10EF, 32);
            M5Cardputer.Display.println("Sent!");
        }
    }
}
```

`sendNEC()` translates the 32-bit value into a leader plus a sequence of 64 mark/space durations. An honest caveat: IRremoteESP8266 doesn't actually use RMT to send — to stay portable across ESP8266 and ESP32, it toggles the pin with a calibrated `delayMicroseconds()` software loop to produce the 38kHz carrier, exactly the kind of approach flagged in "question three" above. It usually gets away with it because one NEC frame is under 70ms, the library compensates for timing drift, and there's typically no WiFi activity fighting for the CPU at the instant you transmit — but the fragility is real. To see the actual hardware approach — handing a duration table to RMT and letting the CPU just orchestrate — go do Going Deeper #2 and send a frame with RMT yourself.

### Step 4: find your TV's code

Go look one up. Common sources:

- **IRDB** (github.com/probonopd/irdb): CSV code libraries organized by brand/device
- **LIRC remotes database** (lirc-remotes.sourceforge.net): the venerable Linux infrared code library
- IRremoteESP8266's [SupportedProtocols doc](https://github.com/crankyoldgit/IRremoteESP8266): check whether your brand needs `sendNEC` or `sendSamsung`, `sendSony`, etc.

Note: not every TV uses NEC. Sony uses its own SIRC protocol (12/15/20-bit), and Samsung uses an NEC-like variant with a different leader. The library has a matching `sendXxx()` function for each protocol — once you've found the code, send it with the right function.

### Step 5: make the invisible light visible

Point your phone's camera (the front-facing one usually lacks an IR filter, so it works better) at the IR LED on top of the Cardputer and hit send — you'll see the LED flash purple-white on screen. Pitch black to your eyes, lit up like a strobe on camera. Record a short clip — it's your prop for "explaining the spell" to a friend later.

### Step 6: point it at the TV and cast

Stand 2-3 meters from the TV, aim the LED at it (the receiver is usually along the bottom bezel), and press Enter. TV turned off? Nice. No response? Work through it in order: wrong code (try another code from the same brand), wrong protocol (NEC vs. a brand variant), wrong pin (back to Step 2).

## Challenge

**Before your friend even registers what happened, the TV across the living room has gone dark — and all you're holding is a little keyboard machine running firmware you wrote yourself, with 32 invisible bits that just flew through the air.** Build a universal remote: an on-screen menu plus keyboard channel selection, holding codes for your TV, projector, and other everyday devices. For the performance: first use your phone camera to reveal the IR LED flickering, then walk your friend through the pulses you just sent — "I didn't just press a button. I tapped out a burst of Morse code made of light: a 9-millisecond leader, then 32 bits, each one spelled out by how long the gap runs."

Just the approach here — write the code yourself:

1. **Milestone 1: data structure first.** Design a "button entry" struct: a name (for display), a protocol type, a code value, and a bit count. Store all your devices' codes in an array. Think about it: different protocols need different `sendXxx()` functions — how do you dispatch cleanly with one field plus a `switch`? (Hint: define an `enum` for protocol type.)

2. **Milestone 2: menu rendering.** Use the offscreen sprite buffer from Lesson 2 to draw a list menu — highlight the currently selected item, and scroll if the list doesn't fit on the 240x135 screen. The input/logic/render separation from Lesson 4 applies directly here — menu state (selected index, scroll offset) is logic, drawing the list is rendering.

3. **Milestone 3: keyboard navigation.** Use `;` and `.` (up/down on the Cardputer keyboard) to move the cursor, Enter to send, and optionally number keys 1-9 as "quick-fire slots." Recall Lesson 3: use `isChange()` for edge detection, so a held key doesn't turn into 30 rapid-fire sends.

4. **Milestone 4: transmit feedback.** IR is invisible, so give the user a sense of confirmation when they press: flash the selected item, show "Sent NEC 0x20DF10EF" in a status bar, maybe even add a beep using the buzzer from Lesson 5. Display the code value on screen — it doubles as your script line during the demo.

5. **Milestone 5 (bonus): repeat codes for held keys.** A volume button needs to keep incrementing while held. NEC has a dedicated mechanism for "held down": a repeat frame (9ms + 2.25ms + a short pulse) instead of resending the whole frame. Look at the `repeat` parameter on IRremoteESP8266's `sendNEC` and implement "hold the volume key to keep raising the volume."

**Acceptance criteria:** standing more than 3 meters from the TV, a friend with no instructions can turn it off using your menu within 10 seconds; and looking at the phone video of the IR flicker, you can point out exactly where the leader is and where the data bits are.

## Going Deeper

1. **View the protocol like an oscilloscope would.** No real scope needed: swap the IR LED for a plain GPIO output on the board (or just use the transmit pin), write code that expands the NEC frame you want to send into an array of mark/space durations, and print it over serial to check each segment against spec by hand. Take it further: calculate the total frame duration for `0xFF00FF00` versus `0x00000000` — how much do they differ? (Hint: a 1 bit takes roughly twice as long as a 0 — NEC frames are **variable length**.)

2. **Skip the library and drive RMT directly.** Using the ESP-IDF RMT driver (callable from the Arduino framework too), hand-write an NEC transmitter: build your own array of "level + duration" symbols, configure the 38kHz carrier, and submit it to hardware. Watch out — there are two generations of RMT driver API: Arduino core 3.x (built on IDF 5) uses `rmt_tx` with `rmt_symbol_word_t`, while core 2.x (built on IDF 4.4) uses the older `rmt_item32_t`. Check which core version your PlatformIO platform ships first, then read the matching ESP-IDF docs. Compared to IRremoteESP8266's software timing, you'll see exactly what "hardware holds the stopwatch" really buys you.

3. **Why are air conditioner codes absurdly long?** A TV code is 32 bits, but an AC unit (Daikin, Gree, etc.) often sends a frame over 100 bits long. That's because AC remotes send **full state**: every button press transmits the entire package — temperature, mode, fan speed, swing — all at once. Look at IRremoteESP8266's unified `IRac` interface and think about what this design implies for the problem of the remote's display drifting out of sync with the AC unit's actual state.

## Checkpoint

1. The sun's infrared radiation is far stronger than a remote's — so why doesn't it make the TV switch channels randomly? What role does "38kHz" play in this story?
2. In the NEC protocol, what's the waveform difference between logical 0 and logical 1? What are the address-inverse and command-inverse bits for?
3. Why is generating an NEC frame bit-by-bit with `delayMicroseconds()` unreliable on the ESP32? How does the RMT peripheral's approach fundamentally differ?
4. Why can't the Cardputer "learn" the code from your old remote? What's your alternative workflow?
5. When you hold down the volume button on a TV remote, what actually gets transmitted? (Hint: it's not the whole frame repeated.)

## References

- [M5Stack Cardputer official docs (pinout / schematic)](https://docs.m5stack.com/en/core/Cardputer)
- [IRremoteESP8266 library (GitHub)](https://github.com/crankyoldgit/IRremoteESP8266) and its [supported protocols list](https://github.com/crankyoldgit/IRremoteESP8266/blob/master/SupportedProtocols.md)
- [SB-Projects: NEC infrared protocol explained](https://www.sbprojects.net/knowledge/ir/nec.php)
- [ESP-IDF RMT peripheral docs (ESP32-S3)](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-reference/peripherals/rmt.html)
- [IRDB: community infrared code database](https://github.com/probonopd/irdb)
- [LIRC remotes code library](https://lirc-remotes.sourceforge.net/remotes-table.html)
