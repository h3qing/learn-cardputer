---
title: "Shapeshifting: BLE HID, or How to Convince a Mac You're a Keyboard"
subtitle: "The magic of GATT, pairing, and standardized profiles"
order: 9
slug: "ble-hid-macro-pad"
difficulty: 4
est_hours: 5
hardware:
  - "BLE vs classic Bluetooth: advertising, connecting, low-power design"
  - "GATT: the Service / Characteristic / Descriptor hierarchy"
  - "The HID Profile and report descriptors: why the OS can't tell it apart from a real keyboard"
  - "HID keycodes and modifier report format (cross-referenced with the local key scan from Lesson 3)"
  - "The security model behind pairing and bonding"
  - "Time-slicing WiFi + BLE on a single radio, and why we picked the NimBLE stack"
project: "Turn the Cardputer into a BLE macro pad so convincing a Mac can't tell it apart from a real keyboard — fire off code snippets and git commands, or lock the screen, at the press of a key"
summary: "Understand BLE's advertise-then-connect low-power model and GATT's service/characteristic hierarchy; see how HID over GATT uses a standardized report descriptor to get driverless recognition from the host; understand the security model behind pairing and bonding, and tie HID keycodes back to the local matrix scan from Lesson 3."
---

## Goals

- [ ] Explain the real difference between BLE and classic Bluetooth, and the two-phase "advertise → connect" model
- [ ] Draw the three-tier GATT structure: Service / Characteristic / Descriptor
- [ ] Understand why an HID Report Map lets any OS recognize your device with zero drivers
- [ ] Hand-write an 8-byte HID keyboard report and explain what every byte means
- [ ] Complete a pairing/bonding cycle and understand where the keys are stored, and why a power cycle doesn't force you to re-pair

## How the Hardware Works

### BLE: a different flavor of Bluetooth, built for coin-cell batteries

Let's clear up a common misconception first: BLE (Bluetooth Low Energy) is not a "power-saving mode" bolted onto classic Bluetooth — it's a **separate protocol** introduced alongside Bluetooth 4.0 in 2010, sharing only the brand name and the 2.4GHz band. Classic Bluetooth was designed for audio streaming: once connected, it stays in constant communication, like a faucet left running. BLE's philosophy is the opposite — **sleep as much as possible**. Most of the time the device just broadcasts a short advertising packet at fixed intervals — "I'm Cardputer, I'm a keyboard, anyone want to connect?" — then goes right back to sleep. The host (your Mac, called the Central in BLE terminology) scans for this advertisement and initiates a connection; the two sides then agree on a connection interval and only wake up briefly, at each interval, to exchange data. A BLE keyboard running a year on a coin cell is entirely thanks to this "sleep whenever possible" design.

### GATT: data isn't a stream, it's a tree

So how is data transferred once a connection is established? Classic Bluetooth gives you a byte stream (think TCP); BLE instead gives you an **attribute tree**, governed by a rulebook called GATT (Generic Attribute Profile):

```
Peripheral = Cardputer
└── Service: HID Service (UUID 0x1812)
    ├── Characteristic: HID Information   ← version, country code
    ├── Characteristic: Report Map        ← the report descriptor (this is where the magic lives)
    └── Characteristic: Input Report      ← keypress data goes out from here
        └── Descriptor: CCCD              ← host writes 1 = "subscribe me to updates"
```

A Service is a container for a group of related functionality; a Characteristic is a value you can read, write, or subscribe to; a Descriptor adds metadata about a characteristic. Every node has a UUID; official standard services use a 16-bit short UUID (HID is 0x1812). Once connected, the host walks the whole tree (service discovery), and as soon as it spots 0x1812 it knows: ah, this is an HID device.

The key mechanism here is **Notify**: the host writes a 1 into the CCCD descriptor, meaning "push me an update whenever this characteristic changes." For bursty events like keypresses, polling is wasteful — subscribing to push notifications is the right call. It's the same "polling vs. events" tradeoff from Lesson 3, just reincarnated in the wireless world.

### The Report Map: a self-introduction every OS can read

Why don't macOS, Windows, or iPadOS need a driver to recognize your device? The secret lives in the Report Map characteristic. It stores a **report descriptor** written in the USB HID standard's syntax — a machine-readable spec sheet: "Every report I send is 8 bytes: byte 1 is a bitmap of 8 modifier keys, byte 2 is reserved, the next 6 bytes are the usage codes of the keys pressed…" The OS ships with a built-in parser for this syntax, so once it reads your descriptor it automatically knows how to interpret every packet you send afterward. A standard keyboard report looks like this:

```
Byte:     [0]         [1]        [2]    [3]    [4]    [5]    [6]    [7]
Meaning:  modifiers    reserved   key1   key2   key3   key4   key5   key6

modifier bitmap: bit0=LeftCtrl bit1=LeftShift bit2=LeftAlt bit3=LeftCmd(GUI)
                  bit4~7 = the four right-side modifiers
```

To type a capital "A": send `[0x02, 0, 0x04, 0,0,0,0,0]` (left Shift + keycode 0x04), then send all zeros to signal key-up. Note that 0x04 is *not* the ASCII code for 'A' (0x41) — it's the usage code from the HID Usage Tables. "What a character looks like" is the host's problem; the device only reports "which key at which position was pressed." Recall Lesson 3: you scan the matrix to get (row, col) coordinates, then look up a table to translate that into a character. Now the whole pipeline is complete: **matrix coordinates → HID keycode → radio waves → OS keyboard layout → character on screen**. Your Cardputer and a Logitech keyboard travel the exact same path — of course the OS can't tell them apart.

### Pairing and bonding: shake hands once, stay trusted forever

Anyone can sniff the open 2.4GHz airwaves, so keypress data has to be encrypted. **Pairing** is the process where both sides negotiate an encryption key (some keyboards make you type a 6-digit code during pairing specifically to guard against man-in-the-middle attacks; the library we're using defaults to "Just Works" mode — no code entry required, at the cost of MITM protection — the classic security-vs-convenience tradeoff). **Bonding** is storing that negotiated key in non-volatile storage — on the ESP32 side, that's the NVS partition in flash (you saw it in the partition table back in Lesson 1). After that, a power cycle just means both sides pull out the old key and start encrypted communication immediately — no need to repeat the pairing ritual.

One last engineering wrinkle: the ESP32-S3 only has **one 2.4GHz radio**. WiFi and BLE take turns using the antenna via time-slicing, arbitrated automatically by the protocol stack — coexistence works, but both get slower. For the Bluetooth stack we're using NimBLE: it only implements BLE, not classic Bluetooth, and its memory footprint is much smaller than ESP-IDF's bundled Bluedroid stack (see the Espressif docs in References for exact numbers). And since the ESP32-S3's radio only supports BLE in the first place — no classic Bluetooth — Bluedroid's classic-Bluetooth code is pure dead weight on this chip. Choosing NimBLE is a no-brainer.

## Hands-on Lab

### Step 1: Install the libraries

Add two dependencies to `platformio.ini`:

```ini
lib_deps =
    m5stack/M5Cardputer
    t-vk/ESP32 BLE Keyboard
build_flags =
    -D USE_NIMBLE
```

`USE_NIMBLE` tells the ESP32-BLE-Keyboard library to use the NimBLE stack (it needs to find NimBLE-Arduino — if the build complains about a missing header, add `h2zero/NimBLE-Arduino@^1.4` to `lib_deps` as well; make sure to pin 1.x, since 2.x changed the API and this library hasn't caught up). If PlatformIO can't find `t-vk/ESP32 BLE Keyboard`, just point it at the GitHub URL instead: `https://github.com/T-vK/ESP32-BLE-Keyboard.git`. Why use an off-the-shelf library? Because that Report Map is a pile of magic bytes, and this library has already written and debugged it — this lesson stands on its shoulders for now. If you want to hand-write the descriptor yourself, see Going Deeper.

### Step 2: A minimum viable keyboard

```cpp
#include <M5Cardputer.h>
#include <BleKeyboard.h>

// Params: device name (shown in the Mac's Bluetooth list), manufacturer name, battery percentage
BleKeyboard bleKeyboard("Cardputer-KB", "hhq works", 100);

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg, true);   // second arg true: enable key scanning (from Lesson 3)
    M5Cardputer.Display.setTextSize(2);
    M5Cardputer.Display.println("Advertising...");
    bleKeyboard.begin();   // build the GATT service tree + start advertising
}

void loop() {
    M5Cardputer.update();  // our old friend from Lesson 3: scan the key matrix

    // Show connection status on screen for easier debugging
    static bool wasConnected = false;
    if (bleKeyboard.isConnected() != wasConnected) {
        wasConnected = bleKeyboard.isConnected();
        M5Cardputer.Display.clear();
        M5Cardputer.Display.setCursor(0, 0);
        M5Cardputer.Display.println(wasConnected ? "Connected!" : "Advertising...");
    }

    if (bleKeyboard.isConnected() && M5Cardputer.Keyboard.isChange()) {
        if (M5Cardputer.Keyboard.isPressed()) {
            auto st = M5Cardputer.Keyboard.keysState();
            for (char c : st.word) {
                bleKeyboard.print(c);      // the library translates characters into HID reports and sends them
            }
            if (st.enter) bleKeyboard.write(KEY_RETURN);
            if (st.del)   bleKeyboard.write(KEY_BACKSPACE);
        }
    }
    delay(10);
}
```

### Step 3: Pair and observe

After flashing, open System Settings → Bluetooth on your Mac and you should see "Cardputer-KB" — click to connect. macOS might pop up its Keyboard Setup Assistant (it thinks you just plugged in a brand-new physical keyboard — which is itself the best proof this lesson worked). Open any text editor, type on the Cardputer, and watch the characters show up on the Mac's screen.

Do two more observation experiments — don't skip these:

1. **See the advertise/connect two-phase model with your own eyes**: once connected, install nRF Connect on your phone (it's free) and scan — you'll notice the Cardputer has vanished. That's because a BLE peripheral stops advertising by default once it's connected. Disconnect Bluetooth on the Mac, and it reappears.
2. **Verify bonding**: power-cycle the Cardputer without touching any settings on the Mac. It should auto-reconnect within a few seconds. The key lives in NVS — the pairing ritual only ever needs to happen once.

### Step 4 (optional): Explore the GATT tree with nRF Connect

First unpair from the Mac, then connect to the Cardputer with nRF Connect and expand the service list: look for UUID 0x1812 (HID) and 0x180F (Battery). That tree from the "How the Hardware Works" section is now sitting right there on your phone screen.

## Challenge

**Requirement**: your Mac already trusts your Cardputer as a legitimate keyboard — now cash that trust in for superpowers. Upgrade it into a **macro pad**: hold Fn (or whatever prefix key you choose) + a number key to inject preset content into the Mac:

- Fn+1: type out your email address
- Fn+2: type out a multi-line code snippet (including newlines)
- Fn+3: type `git add -A && git commit -m ""` and leave the cursor sitting between the quotes (hint: send the string, then send a Left Arrow keypress)
- Fn+L: lock the screen (Mac shortcut is Ctrl+Cmd+Q; hint: the library has `press()`/`release()` for combining modifiers, and constants like `KEY_LEFT_CTRL`, `KEY_LEFT_GUI` live in the library's header file)
- Show the current macro list and connection status on screen so it looks like a real product

**Milestones**:

1. First make sure the Fn combo is recognized correctly and **doesn't leak through** (Fn+1 must not also send a '1') — think about how you'd modify the key-state machine from Lesson 3
2. Implement single-line text macros, then tackle multi-line ones (think about it: there's no '\n' character in an HID report at all, only a Return keypress — try `print()`-ing a string containing '\n' directly, then go read the library source to see what translation it's doing for you)
3. Implement a modifier-combo macro (screen lock) — remember you must call `releaseAll()` after `press()`, or the Mac will think you're holding Cmd down forever
4. Pull the macro definitions out into a table (an array of structs) so adding a macro is just adding one row of data — this sets up a clean interface for the persistent config work in Lesson 11
5. Final acceptance test: bring it into the office and have a coworker type a line with it without realizing anything's off — then tell them you built the keyboard yourself

## Going Deeper

- **Hand-write your own Report Map**: skip the BleKeyboard library and build the HID service directly with NimBLE-Arduino, writing the report descriptor out byte by byte (cross-reference the USB HID Usage Tables spec). Add a Consumer Control report so the Cardputer can control the Mac's volume and play/pause — this is where you'll truly understand "the descriptor *is* the protocol."
- **6-Key Rollover**: a standard report only has 6 keycode slots. What happens when you press a 7th key at the same time? Write some code and find out, then compare it to the ghost-key problem from Lesson 3: one is a limitation of the electrical matrix layer, the other is a limitation of the report format layer — completely different levels of the stack.
- **Coexistence stress test**: run Lesson 8's web server and this lesson's BLE keyboard at the same time, and measure whether keypress latency becomes noticeably worse. Then use `ESP.getFreeHeap()` to compare memory usage with WiFi on vs. off, and see for yourself why NimBLE was the right call.

## Checkpoint

1. What problem does "advertising" solve, and what problem does "connecting" solve, for a BLE peripheral? Why does it stop advertising by default once connected?
2. What's the relationship between Service, Characteristic, and Descriptor? What is the CCCD for?
3. The OS has no driver installed for your device — so how does it correctly interpret every keypress packet you send?
4. What are the 8 bytes of the HID report for a capital "A"? Why don't keycodes just use ASCII directly?
5. What's the difference between pairing and bonding? Where does the Cardputer store its key?

## References

- M5Stack Cardputer official docs and pinout: <https://docs.m5stack.com/en/core/Cardputer>
- ESP32-BLE-Keyboard library (T-vK): <https://github.com/T-vK/ESP32-BLE-Keyboard>
- NimBLE-Arduino: <https://github.com/h2zero/NimBLE-Arduino>
- Bluetooth SIG — HID over GATT Profile (HOGP) specification: <https://www.bluetooth.com/specifications/specs/>
- USB HID Usage Tables (the authoritative source for keycodes): <https://www.usb.org/document-library/hid-usage-tables-15>
- Espressif ESP32-S3 Bluetooth docs (including WiFi/BLE coexistence): <https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-guides/coexist.html>
- M5Cardputer Arduino library: <https://github.com/m5stack/M5Cardputer>
