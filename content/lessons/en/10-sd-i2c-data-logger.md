---
title: "Expanding the Backpack: SD Cards, SPI Sharing, and the I2C Ecosystem"
subtitle: "One bus, multiple passengers - hundreds of devices on two wires"
order: 10
slug: sd-i2c-data-logger
difficulty: 4
est_hours: 6
hardware:
  - "SPI multi-device sharing: chip-select (CS) time-slicing and bus contention"
  - "microSD and the FAT filesystem: what actually happens behind open/write/flush"
  - "Flash wear and write strategy: buffering, batched writes, power-loss safety"
  - "I2C protocol: two wires (SDA/SCL), 7-bit addressing, ACK/NACK, open-drain and pull-up resistors"
  - "I2C bus scanning and the register read/write model: a methodology for driving any I2C chip from its datasheet"
  - "The Grove connector standard and the M5Stack Unit ecosystem, I2C vs SPI head to head"
project: "A data logger that rides in your pocket all day: WiFi or volume data gets timestamped and written to a CSV on the SD card; pull the card, plug it into your Mac, and plot the whole day's curve in Python. If you have a Grove ENV sensor, write your own I2C scanner to find it first, then build a temperature/humidity trend station."
summary: "Recycle and level up lesson 2's SPI: how a chip-select line lets multiple devices share one bus, why FAT lets your Mac read the card directly, flash wear and power-loss safety. Then tackle the last classic bus, I2C: open-drain plus pull-up, 7-bit addressing, the ACK handshake, and a bus scan over the Grove port as the embedded-systems rite of passage."
---

## Goals

- [ ] Explain how a chip-select (CS) line lets the screen and SD card share SCLK/MOSI, and what bandwidth cost "sharing" actually carries
- [ ] Write a CSV file to the SD card that your Mac can open directly, and explain exactly what `open` / `write` / `flush` each do
- [ ] Name the three design decisions that let I2C hang a hundred-plus devices off just two wires: open-drain output, pull-up resistors, 7-bit addressing
- [ ] Write an I2C bus scanner by hand, and understand that it's fundamentally "knocking on every door and listening for an ACK"
- [ ] Finish the challenge: a pocket logger that records data all day long and hands you an analyzable file the moment you pull the card

## How the Hardware Works

### SPI's expansion trick: one more CS, one more passenger

In lesson 2, SPI was the screen's private line: SCLK keeps the beat, MOSI carries data, and CS pulled low means "I'm talking to you." Now the SD card wants a seat too - what do you do? The answer is almost disappointingly simple: **the clock and data lines are shared by everyone, and each device gets its own dedicated CS line.** Whoever's CS goes low perks up and listens; everyone else sees their own CS sitting high and switches its pins to high-impedance, playing deaf.

```
            SCLK  ────┬──────────┬─────
            MOSI  ────┼──┬───────┼──┬──
            MISO  ────┼──┼───┬───┼──┼──
ESP32-S3              │  │   │   │  │
            CS_LCD ───┤ [Screen ST7789V2]
            CS_SD  ──────────────┤ [microSD]
                      (only one CS is low at any instant)
```

The cost is just as blunt: the bus is time-shared, so only one device can be spoken to at any given moment. During the milliseconds you're hammering data onto the SD card, the screen refresh has to wait in line - that's **bus contention**. Lesson 4 did the bandwidth math for a full-screen refresh; now we're squeezing one more tenant onto the same bill. One caveat: whether the Cardputer's screen and SD card literally share one set of pins, or each sits on its own SPI controller (the ESP32-S3 has more than one), is something you should verify against the official schematic - but either way, the CS time-sharing principle holds.

### FAT: the common language between an SD card and a Mac

The SD card itself only understands "read/write sector number N, 512 bytes" - it has no concept of a "file." The thing that lets your Mac read the card the instant you plug it in is the **FAT filesystem** - a table designed in 1977 that, remarkably, every operating system still speaks: which sectors belong to which file, what names live in which directory. Calling `open` registers an entry in the directory table; `write` mostly just lands in a RAM buffer; **it's `flush`/`close` that actually commits the data and the updated table back to the card.** So the most dangerous moment for a power loss is exactly when the buffer is holding data that hasn't hit the card yet.

Under the hood, an SD card is NAND flash, and every block has a limited erase-cycle lifespan (anywhere from a few hundred to tens of thousands of cycles depending on the chip, with consumer-grade cards usually on the low end). Writing byte by byte, constantly, wears the same batch of blocks over and over. The right move is: **batch writes, flush at second- or kilobyte-level granularity, and flush periodically** - you'll implement exactly this strategy in the challenge below.

### I2C: the two-wire social network

SPI scales by adding more CS lines, and once you have enough devices, you run out of pins. I2C takes the opposite approach: **just two wires (SDA for data, SCL for clock), with devices told apart purely by address.** The host speaks first, broadcasting a 7-bit address; whoever matches, answers. Seven bits gives 128 possible addresses, and after subtracting the small range reserved by the protocol, one pair of wires can in principle carry 112 devices (which lines up exactly with the 0x08-0x77 range our scanner sweeps below).

The trick that makes multi-device sharing work electrically is **open-drain output plus pull-up resistors**: any device can only pull the line low; when nobody's talking, the pull-up resistor lets the line float back high. It's like a meeting-room rule where everyone can only "raise a hand to push the line down," never "force it high" - so you can never get two devices fighting each other electrically, one driving high while another drives low.

```
        VCC ──[pull-up R]──┬────────┬────────┬──
        SDA ────────────────┴────────┴────────┴──
        VCC ──[pull-up R]──┬────────┬────────┬──
        SCL ────────────────┴────────┴────────┴──
                    [host]  [sensor A]  [sensor B]
                   (address)  (0x44)     (0x68)
```

The 9th clock cycle is the soul of I2C: after the host finishes sending 8 bits, it lets go of the line, and **whichever device matches the address pulls SDA low - that's an ACK ("that's me")**; if nobody pulls it down, the line stays high - that's a NACK ("no such address here"). The entire principle behind a bus scanner is: call out every address from 0x08 to 0x77 one by one, and note who answers.

The general model for reading and writing any I2C chip: internally, every chip is a row of numbered **registers**, and the pattern is "address the chip -> pick a register number -> read or write data." Get your hands on any new chip, find its register table in the datasheet, and you can drive it - that's the master key this lesson hands you.

The white **Grove connector** on the side of the Cardputer is just 4 wires: VCC, GND, plus two signal lines (configured here as I2C). M5Stack's entire Unit ecosystem - temperature/humidity, GPS, relays, ToF distance sensors - dozens of modules, all plug-and-play through this one connector.

### I2C vs SPI at a glance

| | SPI | I2C |
|---|---|---|
| Wire count | 3 + 1 CS per device | Always 2 |
| Speed | Tens of MHz, good for screens/storage | 100kHz (Standard Mode) / 400kHz (Fast Mode), good for sensors |
| Addressing | Hardware CS line | Software 7-bit address |
| Electrical | Push-pull, crisp signaling | Open-drain + pull-up, speed-limited but bus-shareable |
| Typical use | High throughput: displays, SD, flash | Low-speed, multi-device: temperature, IMU, RTC |

## Hands-on Lab

### Lab 1: Write text to the SD card, read it back on your Mac

Create a new PlatformIO project (`board = m5stack-stamps3`, same as lesson 2), and insert a FAT32-formatted microSD card:

```cpp
#include "M5Cardputer.h"
#include <SPI.h>
#include <SD.h>

// Warning: double-check these pin numbers against the official pinout (docs.m5stack.com/en/core/Cardputer)
// Find the SCK / MISO / MOSI / CS GPIOs for the microSD slot and fill them in:
constexpr int SD_SPI_SCK  = 40;  // Commonly seen value, verify against official docs
constexpr int SD_SPI_MISO = 39;
constexpr int SD_SPI_MOSI = 14;
constexpr int SD_SPI_CS   = 12;

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);

    // Manually initialize the SPI bus, then hang the SD library off it
    SPI.begin(SD_SPI_SCK, SD_SPI_MISO, SD_SPI_MOSI, SD_SPI_CS);
    if (!SD.begin(SD_SPI_CS, SPI)) {
        M5Cardputer.Display.println("SD mount FAILED");
        return;  // Common causes: card not seated / wrong pins / card is exFAT
                 // (cards 64GB+ usually ship exFAT out of the box - reformat as FAT32)
    }

    // open: registers (or locates) this filename in the FAT directory table
    File f = SD.open("/hello.csv", FILE_APPEND);
    // write: most likely just lands in a RAM buffer, hasn't touched the card yet
    f.printf("%lu,hello from cardputer\n", millis());
    // close triggers a flush internally: buffer commits to disk + FAT table updates - only now is the data actually safe
    f.close();

    M5Cardputer.Display.println("Wrote /hello.csv");
}

void loop() {}
```

Flash it, run it, pull the card, and plug it into your Mac (you'll need a card reader) - `hello.csv` opens with a double-click, **no drivers, no conversion needed**. That's the whole point of FAT as a common language.

Why `SPI.begin` before `SD.begin`? Because the SD library has no idea by default which pins your board wired the card to. Initializing explicitly makes it clear that "the bus" and "the device on the bus" are two separate layers.

### Lab 2: An I2C bus scanner (the embedded rite of passage)

Whether or not you have a sensor on hand, write the scanner first - plug in a Grove device if you have one, or just take a look at what an "empty bus" looks like:

```cpp
#include "M5Cardputer.h"
#include <Wire.h>

// Warning: the Grove port's SDA/SCL pins should also be verified against the official pinout
constexpr int GROVE_SDA = 2;   // Commonly seen value, double-check it
constexpr int GROVE_SCL = 1;

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    Wire.begin(GROVE_SDA, GROVE_SCL);   // Host mode, defaults to 100kHz

    M5Cardputer.Display.println("I2C scan:");
    for (uint8_t addr = 0x08; addr <= 0x77; addr++) {
        Wire.beginTransmission(addr);       // Send START + 7-bit address
        uint8_t err = Wire.endTransmission(); // 0 means an ACK came back
        if (err == 0) {
            M5Cardputer.Display.printf("  found 0x%02X\n", addr);
        }
    }
    M5Cardputer.Display.println("done.");
}

void loop() {}
```

The `beginTransmission` + `endTransmission` pair, under the hood, is exactly what we described above: send START, call out the address, check whether anyone pulls SDA low on the 9th clock. Plug in a Grove Unit (say, an ENV temperature/humidity sensor), and the hex number that pops up on screen is the factory address printed right in its datasheet - the common SHT30 humidity/temperature chip, for instance, sits at `0x44`. The moment your scanner first turns up a real device is worth a screenshot.

### Lab 3: Feel bus contention for yourself (optional but fun)

In `loop`, run some animation from lesson 4 continuously on screen while appending 1KB to the SD card every second. Watch whether the animation visibly stutters the instant a write happens, then try bumping each write up to 32KB and compare. If you see the stutter, you're watching the cost of time-sharing in real time. If you barely notice anything, don't be disappointed either - it may mean the Cardputer wired the screen and SD card to two separate SPI controllers (in which case any stutter is mostly the CPU being busy writing, not bus queuing). Go check the official schematic for the answer - walking the chain from "experimental result" to "hardware explanation" is worth more than the stutter itself.

## Challenge

**Build a pocket data logger**: carry the Cardputer in your pocket through an otherwise unremarkable day, pull the SD card that evening, and let Python turn the day into a curve - what time you walked past that WiFi-saturated coffee shop, what time your meeting hit peak noise. Your data remembers better than you do. Specifics: logging starts automatically on boot, a timestamped record gets written to a CSV on the SD card at a fixed interval; the screen draws a live line chart of the last N points; back home, a few lines of Python (pandas + matplotlib) turn it into a plot.

Pick one data source (you've learned both):

- **Electromagnetic mode**: the WiFi scan from lesson 8, logging `timestamp, AP count found, strongest RSSI`
- **Noise mode**: the microphone from lesson 6, logging `timestamp, average volume (RMS)`

Milestone breakdown:

1. **Get the pipeline working first**: sample one fake data point every 5 seconds (say, `millis()%100`), write it to CSV, pull the card and confirm your Mac can read it with the right format.
2. **Wire up the real data source**: swap in the WiFi scan or mic RMS. Note that the WiFi scan is blocking - think about what cadence makes sense around it.
3. **Write strategy** (the core test of this lesson): don't `open`/`close` on every single sample. Batch 10-20 records, write them at once, `flush` afterward - weigh "how many records you'd lose on a power cut" against "card lifespan/performance."
4. **Line chart on screen**: use the offscreen sprite buffer from lesson 2, keep an array of the last 60 points, and redraw the whole frame after every sample.
5. **Failure modes**: if the card isn't inserted or a write fails, the screen should give a clear message rather than hanging; if you pull the card mid-run and reinsert it, can the program recover? (Hint: call `SD.begin` again.)
6. **Wrap-up**: on the Python side, `pd.read_csv` + `plot`, and remember to convert `millis()` into hours:minutes:seconds on the x-axis.

**Bonus points (about five dollars' worth of joy)**: get your hands on a Grove ENV Unit. Use your own scanner to find its address first, then cross-reference the M5Stack docs or the chip's datasheet to read temperature and humidity (a ready-made Arduino library exists, but it's worth reading the register table at least once to understand what the library is doing for you). Turn it into a third data source - breathe on the sensor and watch the humidity curve jump on screen in real time.

Acceptance criteria: runs and logs for over an hour without crashing; pull the card, plug into a Mac, and it's directly readable; the Python plot can tell a story ("at 3pm I walked past the coffee shop and the AP count spiked").

## Going Deeper

1. **The numbers game of pull-up resistors**: too large a pull-up (say, 100kΩ) and SDA's bounce from low back to high slows down (RC charging), rounding off the edges of the waveform and causing bit errors at high speed; too small (say, 100Ω) and a device pulling the line low draws excessive current. Look into why the typical value is 4.7kΩ, and how you'd need to adjust it when multiple devices (and their accumulated capacitance) share the bus.
2. **What happens with address conflicts**: if two identical chips share the same address, don't they collide on the bus? Look into "I2C address translator," a chip's ADDR pin, and how a multiplexer like the TCA9548A solves the problem.
3. **Advanced power-loss safety**: if the logger loses power midway through a `flush`, the FAT table can end up corrupted. Look into why log-structured filesystems (like LittleFS, used for on-chip flash) are inherently power-loss resistant, and what FAT gave up for the sake of universal compatibility.

## Checkpoint

1. The screen and SD card sit on the same SPI bus - why don't the two ever "talk at the same time" and collide electrically? Which line acts as referee?
2. If `f.write(...)` returns success and the device loses power immediately afterward, is the data guaranteed to be on the card? Why or why not? After which call does it actually become safe?
3. Why must I2C use open-drain output plus pull-up resistors, instead of push-pull like SPI?
4. What specific event in the bus timing does your I2C scanner's "there's a device at this address" judgment actually correspond to?
5. You've just bought a new I2C chip with no ready-made library. Walk through the complete process from opening the datasheet to reading your first piece of data.

## References

- [M5Stack Cardputer official docs and pinout](https://docs.m5stack.com/en/core/Cardputer) - the one authoritative source for verifying SD card and Grove port pins
- [M5Cardputer Arduino library](https://github.com/m5stack/M5Cardputer) - the API used in this lesson's examples
- [Arduino SD library docs](https://docs.arduino.cc/libraries/sd/) and the ESP32 SD example (`libraries/SD` in the `arduino-esp32` repo)
- [I2C-bus specification (NXP UM10204)](https://www.nxp.com/docs/en/user-guide/UM10204.pdf) - the original definition of the I2C protocol, complete with open-drain and ACK timing diagrams
- [M5Stack Unit ecosystem catalog](https://docs.m5stack.com/en/products?id=unit) - see what else you can plug into the Grove port
- SHT30 temperature/humidity sensor datasheet (Sensirion's website) - good practice material for "read the register table, drive the chip"
