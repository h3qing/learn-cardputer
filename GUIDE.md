# Cardputer Hardware Adventure Guide

A level-based path through the M5Stack Cardputer. Each level teaches one hardware
subsystem by making it do something fun. Do them in order — each builds on the last.

---

## Level 0 — Know your machine (no cables needed)

The Cardputer is two boards sandwiched together:

1. **The StampS3 module** (the small board with the antenna) — this is the actual
   computer. An ESP32-S3 chip: two 240 MHz cores, 8 MB flash, WiFi, Bluetooth LE.
   Everything else on the device is a peripheral wired to this chip's GPIO pins.
2. **The keyboard base** — carries the 56-key keyboard, the 1.14" 240×135 LCD
   (ST7789V2 driver, SPI bus), a PDM microphone, an I2S speaker amplifier, an IR
   LED on the top edge, a microSD slot, the battery, and a Grove port (the white
   connector) for plugging in external sensors.

**The one mental model that explains everything:** the ESP32-S3 talks to each
peripheral over a handful of standard protocols — SPI (fast, for display + SD card),
I2S (audio in/out), plain GPIO (keyboard matrix, IR LED), and UART/I2C (Grove port).
Every level below is "learn one of these buses by playing with the thing attached to it."

**Do:** power it on, play with the stock demo firmware. Everything you see — the
menu, the piano, the mic visualizer — is just a program using those buses. By the
end of this guide you can rebuild all of it.

---

## Level 1 — Flashing: how code gets onto the chip

**Hardware lesson:** the ESP32-S3 has a ROM bootloader. Hold the correct key (G0/BtnA)
while plugging in USB and the chip enumerates as a serial device instead of running
your program; a tool on your Mac then writes a firmware image into the 8 MB flash.
That's all "flashing" is — a file copy over serial.

**Do:**
1. Install M5Burner (GUI) from m5stack.com, or `pip install esptool` if you prefer CLI.
2. Plug in via USB-C. Check it appears: `ls /dev/cu.usbmodem*`
3. Flash **M5Launcher** (in M5Burner's Cardputer section). It's an on-device app
   store: it can download community firmwares over WiFi or load `.bin` files from
   the SD card, so you can hot-swap apps without a computer.
4. Fun payoff: browse the launcher's catalog and try a few community apps
   (games, emulators, tools). Notice you can always get back — the bootloader is
   in ROM and can't be bricked by a bad flash.

---

## Level 2 — The display: your first own program

**Hardware lesson:** the LCD is a dumb pixel grid; the ST7789V2 driver chip receives
pixel data over SPI at up to ~40 MHz. There's no GPU — every frame is your code
pushing bytes.

**Do:**
1. Install PlatformIO (`brew install platformio` or the VS Code extension).
2. New project: board `m5stack-stamps3`, framework `arduino`, add the
   `M5Cardputer` library to `platformio.ini` (`lib_deps = m5stack/M5Cardputer`).
3. Hello world:
   ```cpp
   #include <M5Cardputer.h>
   void setup() {
     auto cfg = M5.config();
     M5Cardputer.begin(cfg);
     M5Cardputer.Display.setTextSize(2);
     M5Cardputer.Display.print("Hello, hardware!");
   }
   void loop() {}
   ```
4. `pio run -t upload` — you just compiled C++ for a different CPU architecture
   and flashed it. That's cross-compilation.
5. Fun payoff: make a bouncing-ball animation. Learn about `startWrite()`/sprites
   (off-screen buffers) — draw to RAM, blit once per frame, and flicker disappears.
   That's double buffering, the same trick every game console uses.

---

## Level 3 — The keyboard: scanning a matrix

**Hardware lesson:** 56 keys but nowhere near 56 free pins. The keys are wired in a
grid; the chip drives one row at a time (through a 74HC138 demultiplexer to save
even more pins) and reads which columns go low. Firmware sweeps the rows hundreds
of times a second — pressing a key just connects one row wire to one column wire.

**Do:**
1. Use `M5Cardputer.Keyboard.keysState()` to get pressed keys, and echo them to
   the screen — a typewriter in ~20 lines.
2. Fun payoff: build a tiny text editor or a "type the falling words" game.
   Bonus insight: hold three keys in an L-shape and you may see a fourth "ghost"
   key register — that's a real matrix-scanning artifact and now you know why
   gaming keyboards advertise "anti-ghosting."

---

## Level 4 — Sound: I2S out, PDM in

**Hardware lesson:** two audio paths. Out: the ESP32 streams digital samples over
I2S to an NS4168 amplifier chip driving the speaker — no DAC needed, the amp takes
digital audio directly. In: the SPM1423 microphone outputs PDM (a 1-bit stream at
MHz rates) that the chip filters down to normal samples.

**Do:**
1. `M5Cardputer.Speaker.tone(440, 200);` — concert A. Map keyboard rows to notes:
   you've built a piano.
2. Read the mic with `M5Cardputer.Mic.record(...)` and draw the waveform live on
   screen — an oscilloscope. Whistle at it and watch the sine wave appear.
3. Fun payoff: record a clip to a buffer, play it back pitch-shifted (just play it
   at a different sample rate — that's literally how tape-speed effects work).

---

## Level 5 — IR: invisible light remote control

**Hardware lesson:** the IR LED on the top edge blinks at 38 kHz; a TV's receiver
only sees light modulated at that carrier. Commands are timed patterns of
carrier-on/carrier-off (the NEC protocol is the most common). It's one GPIO pin
plus precise timing.

**Do:**
1. Add the `IRremoteESP8266` library, send a power-toggle code for your TV brand
   (NEC codes are easy to find online).
2. Fun payoff: build a universal remote with an on-screen menu. Point it at your
   TV from across the room. (Cardputer has TX only — it can send but not learn
   codes from your existing remote, so look codes up rather than capturing them.)

---

## Level 6 — WiFi: the internet part

**Hardware lesson:** the radio is on the same chip as your CPU. The WiFi stack runs
on one core while your code runs on the other — your first taste of the ESP32
being a dual-core system running FreeRTOS underneath the Arduino veneer.

**Do:**
1. WiFi scanner: `WiFi.scanNetworks()`, list SSIDs + signal strength on screen,
   sorted live. Walk around the house and watch signal bars change — you've made
   a WiFi survey tool.
2. Connect to your network and fetch something: weather from a free API, drawn
   on screen. Now it's a desk gadget.
3. Fun payoff: run a tiny web server *on* the Cardputer and control the screen
   from your phone's browser. The pocket device is now serving HTTP.

---

## Level 7 — Bluetooth LE: pretend to be a keyboard

**Hardware lesson:** BLE devices advertise standardized "profiles." HID (Human
Interface Device) is the same profile your real keyboard uses — implement it and
computers can't tell the difference.

**Do:**
1. Use the `ESP32-BLE-Keyboard` (or NimBLE) library, pair the Cardputer with
   your Mac.
2. Fun payoff: every key you type on the Cardputer appears on your Mac. Then make
   macro keys — one press types a whole snippet. You've built a hardware macro pad.

---

## Level 8 — Storage and the Grove port

**Hardware lesson:** the microSD card shares the SPI bus with the display — two
devices, one bus, separate chip-select lines; that's how SPI scales. The Grove
port exposes two GPIOs + power, usually as I2C or UART, and M5Stack sells dozens
of plug-in "Units" (sensors, relays, GPS...) that speak I2C.

**Do:**
1. Log something to SD: timestamped WiFi scan results, or mic-level readings.
   Pop the card into your Mac and graph the CSV.
2. If you grab any Grove sensor (an ENV sensor is ~$5): read temperature/humidity
   over I2C and display it. Run an I2C bus scan first and find the sensor's
   address — a rite of passage.

---

## Boss level — combine them

Pick one and build it end to end:

- **Pocket weather station** — Grove ENV sensor + WiFi upload + SD logging + display dashboard.
- **Party piano** — keyboard + speaker + animations, save recordings to SD.
- **Home remote** — IR codes + on-screen menu + BLE macro keys for your Mac.
- **Claude terminal** — WiFi + keyboard + display: talk to the Claude API from your pocket.

At that point you'll have touched every bus on the board and know *why* each
piece works, not just that it does.

---

## Reference

- Docs: https://docs.m5stack.com/en/core/Cardputer
- Library: https://github.com/m5stack/M5Cardputer (examples folder is gold)
- Community firmware index: M5Burner app, or the M5Launcher on-device catalog
- Note: if you have the **Cardputer ADV**, it adds a better keyboard, an IMU
  (motion sensor — tilt-controlled games!) and improved mic/audio. Everything
  above still applies.
