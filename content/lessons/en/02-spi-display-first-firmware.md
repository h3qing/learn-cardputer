---
title: "Pixel Forging: The SPI Bus and Your First Firmware"
subtitle: "Every pixel is a byte you personally pushed out the door"
order: 2
slug: spi-display-first-firmware
difficulty: 2
est_hours: 5
hardware:
  - "SPI protocol: SCLK / MOSI / CS timing and high-speed transfer"
  - "ST7789V2 driver chip: DC line separates commands from pixel data, framebuffer window addressing"
  - "RGB565 pixel format and framebuffer size math"
  - "Estimating the frame-rate ceiling from bus bandwidth"
  - "Sprite off-screen buffering and double buffering: draw in SRAM, blit the whole frame"
  - "Cross-compilation and the PlatformIO toolchain (board = m5stack-stamps3)"
project: "A scrolling marquee e-badge — your name glides across the screen buttery-smooth, a key press swaps the color scheme, and there's a hidden 'Tear Witness' achievement"
summary: "Set up a PlatformIO project and understand cross-compilation — building Xtensa machine code on your Mac. See how the SPI four wires plus a DC line separate commands from data, work out how many bytes a 240x135 frame costs and the frame-rate ceiling at roughly 40MHz, and use sprite double buffering to kill flicker — the LCD has no GPU, every single frame is your code doing the moving."
---

## Goals

- [ ] Set up a PlatformIO project from scratch, and be able to explain exactly what happens when you "compile firmware on a Mac that runs on an ESP32-S3"
- [ ] Sketch out what each of the four SPI lines (SCLK / MOSI / CS + DC) does, and explain how the ST7789V2 knows whether an incoming byte is a command or a pixel
- [ ] Work out, by hand, how many bytes a 240×135 @ RGB565 frame takes, and the theoretical frame-rate ceiling at 40MHz SPI
- [ ] Use M5Canvas (sprite) to implement double buffering, and see with your own eyes the difference between drawing straight to the screen and blitting a whole frame at once
- [ ] Finish the scrolling marquee e-badge, and be able to explain to a friend exactly why it doesn't flicker

## How the Hardware Works

### The LCD is a "dumb" pixel grid

First, let's correct an intuition: this 1.14-inch screen isn't a display in the computer-monitor sense — think of it more like a 240×135-cell spreadsheet. Soldered behind the glass is an **ST7789V2** driver chip, which holds a chunk of graphics RAM (GRAM), one cell per pixel color. The chip does exactly one job: continuously push whatever is in that GRAM out to the liquid crystal. **There's no GPU, no drawing commands, no "draw a circle" operation** — whatever you want to appear on screen, you have to push the corresponding pixel bytes into GRAM yourself, one at a time. Who does the pushing? The ESP32-S3 — which is to say, your code.

### The pipe that pushes the bytes: SPI

The pipe between the ESP32-S3 and the ST7789V2 is called **SPI** (Serial Peripheral Interface) — the "high-speed freight line" from Lesson 1's bus map. At its core it's just three wires:

```
ESP32-S3 (Master)              ST7789V2 (Slave)
    SCLK  ──────────────▶  Clock: master keeps the beat, one bit per tick
    MOSI  ──────────────▶  Data: Master Out, Slave In
    CS    ──────────────▶  Chip Select: pulled low = "I'm talking to you"
    DC    ──────────────▶  ST7789-specific (a plain GPIO, not part of the SPI standard): command or data?

SCLK  ▁▁┌─┐▁┌─┐▁┌─┐▁┌─┐▁    every rising edge
MOSI  ══╡1╞═╡0╞═╡1╞═╡1╞═    samples one bit on MOSI
```

The elegance of SPI is that it's **synchronous**: every SCLK cycle (in the commonly used mode 0, every rising edge), the slave samples one bit off MOSI. No baud-rate negotiation, no start/stop bits — the clock goes as fast as the data goes, which is why it can casually hit tens of MHz while UART at 115200 baud already feels respectable. In this scenario the screen is basically receive-only, so MISO (the slave's return line) doesn't come into play here (check the official schematic for the exact wiring: <https://docs.m5stack.com/en/core/Cardputer>).

So what does the **DC line** (Data/Command) do? SPI just moves bytes around — it doesn't care what they mean. The ST7789V2 needs to tell apart two kinds of bytes: "commands" (e.g. `0x2A`: set the column address window) and "data" (a command's parameters, or raw pixel values). DC low = this byte is a command; DC high = this is data. A typical draw sequence: send commands to define a rectangular window in GRAM (`CASET`/`RASET`), then send the `RAMWR` command, then pull DC high and stream pixel bytes in like a conveyor belt — the chip automatically wraps them line by line inside the window. That's "framebuffer window addressing" — refreshing the whole screen and refreshing a 10×10 patch use exactly the same moves.

### How heavy is one frame? Let's do the math

Each pixel uses the **RGB565** format: 16 bits split into 5 bits red, 6 bits green, 5 bits blue (green gets the extra bit because human eyes are most sensitive to it). So:

```
240 × 135 pixels × 2 bytes = 64,800 bytes ≈ 63.3 KB per frame
```

This screen's SPI write clock is typically configured around 40MHz (check the M5GFX library's panel config for the actual value). At 40MHz, the max throughput is 40,000,000 bits per second ÷ 8 = 5 MB/s:

```
5,000,000 ÷ 64,800 ≈ 77 frames/sec (theoretical ceiling)
```

You won't actually hit 77 — there's command overhead per frame, plus CPU time spent preparing the data. But this number tells you two things: full-screen 60fps is within reach if you're on your toes, and if you swapped in a 320×240 screen (150KB per frame), the same bus would drop you to 33fps. **Bandwidth budgeting is the first-principles constraint of embedded graphics** — you'll come back to this math in Lesson 4 when we build a game.

### Why drawing straight to the screen flickers: double buffering

The problem with drawing directly to the screen: you call `fillScreen` to clear it, then draw some text — and in between those two steps, the screen genuinely goes blank for a moment. What the viewer sees is your **drawing process**, not the finished product — that's flicker and tearing.

The fix is a **sprite** (off-screen buffer): open up a 63.3KB canvas in the ESP32-S3's SRAM, do all your clearing, drawing, and fiddling entirely in memory (memory operations — invisible to the viewer), and only at the very end blit the whole frame to GRAM over SPI in one shot. The screen only ever shows a "finished frame." This trick goes back to 1980s arcade cabinets and is still used in every graphics card today, under the same name it always had: double buffering.

## Hands-on Lab

### Step 1: Set up the project, understand what you're compiling

Install VS Code + the PlatformIO extension, create a new project, and set `platformio.ini` to:

```ini
[env:cardputer]
platform = espressif32
board = m5stack-stamps3      ; the Cardputer's brain is the StampS3 module
framework = arduino
lib_deps = m5stack/M5Cardputer
monitor_speed = 115200
```

**Why `m5stack-stamps3`?** As covered in Lesson 1, the Cardputer = StampS3 compute module + keyboard baseboard. The compiler only cares about the chip, not the baseboard.

Hit compile once (no need to have the board plugged in). What happens here is called **cross-compilation**: your Mac is ARM/x86, while the ESP32-S3 is Xtensa LX7 — the two architectures don't speak the same machine code. PlatformIO automatically downloads the `xtensa-esp32s3-elf-gcc` toolchain — a compiler that runs on your Mac but spits out Xtensa machine code. The resulting `firmware.bin` can't be executed on your Mac at all; it belongs exclusively to that chip. Uploading it goes through the same esptool serial-flash-write flow covered in Lesson 1.

### Step 2: Hello World (direct-to-screen version)

```cpp
#include <M5Cardputer.h>

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);              // init display, keyboard, etc. — pin config is handled by the library
    M5Cardputer.Display.setRotation(1);  // landscape orientation (same as the official examples)
    M5Cardputer.Display.setTextSize(2);
    M5Cardputer.Display.drawString("Hello, Cardputer!", 10, 60);
}

void loop() {}
```

Compile, upload, and text lights up on screen. Notice you never wrote a single GPIO pin number — inside `M5Cardputer.begin()`, the library handles the entire ST7789V2 init command sequence for you (exit sleep, set pixel format, turn on display... dozens of commands, all relying on the DC line flipping between command and data mode). To see the actual wiring, check the official pinout: <https://docs.m5stack.com/en/core/Cardputer>.

### Step 3: Witness the flicker with your own eyes

```cpp
#include <M5Cardputer.h>

int x = 0;

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    M5Cardputer.Display.setRotation(1);
    M5Cardputer.Display.setTextSize(3);
}

void loop() {
    // Direct-to-screen drawing: the gap between clearing and drawing is fully visible to the viewer
    M5Cardputer.Display.fillScreen(TFT_BLACK);
    M5Cardputer.Display.drawString("FLICKER!", x, 55);
    x = (x + 4) % 240;
}
```

Run it and stare: the text judders and flickers. **This isn't a bug, it's physics** — every `fillScreen` call is 64,800 bytes actually crossing the SPI bus in real time, and the screen is genuinely black for the duration.

### Step 4: Sprite double buffering, instantly smooth

```cpp
#include <M5Cardputer.h>

M5Canvas canvas(&M5Cardputer.Display);   // off-screen canvas, attached to Display
int x = 0;

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    M5Cardputer.Display.setRotation(1);
    canvas.createSprite(240, 135);       // open a 63.3KB framebuffer in SRAM
    canvas.setTextSize(3);
}

void loop() {
    canvas.fillScreen(TFT_BLACK);        // clear in memory: invisible to the viewer
    canvas.drawString("SMOOTH!", x, 55); // draw in memory: also invisible to the viewer
    canvas.pushSprite(0, 0);             // blit the whole frame: viewer only sees the finished product
    x = (x + 4) % 240;
}
```

Same logic, just swap the canvas from "the screen" to "memory," and tack on one `pushSprite` call at the end. The flicker is completely gone. `pushSprite` moves 64,800 bytes each time — and now you know exactly where that number comes from, and why it can keep up at 60fps.

## Challenge

**Scrolling marquee e-badge**: at your next meetup, hang the Cardputer around your neck — your name gliding across the screen at a buttery-smooth 60fps — and the first person who walks over will ask "what is that, I want one too." Requirements: text scrolls right-to-left like an LED billboard, wrapping back in from the right edge once it exits on the left; pressing any key cycles the color theme (at least 3 sets of background-color + text-color combos). Zero flicker throughout.

Approach only — write the code yourself:

1. **Milestone 1 — Infinite scroll**: decrement the text's x coordinate every frame; use `canvas.textWidth(text)` to get the pixel width of the string, and reset x to 240 once `x < -width`. For extra polish, make the ends meet seamlessly (draw two copies of the text in the same frame).
2. **Milestone 2 — Color themes**: define an array of themes (each with a background color and a text color), and an index variable that cycles through them. For now, treat key detection as a black box using `M5Cardputer.update()` + `M5Cardputer.Keyboard.isChange()` / `isPressed()` — the matrix-scanning mechanics behind it are the main course in Lesson 3.
3. **Milestone 3 — Polish the feel**: bump up the font size, vertically center the text (work out the relationship between 135 and the character height), and control the scroll speed (hint: pixels moved per frame × frame rate = scroll speed — don't lock the loop with `delay`).
4. **Hidden achievement [Tear Witness]**: reserve a special key that, while held, switches back to "direct-to-screen" mode — let a friend watch the marquee go from buttery-smooth to a flickering trainwreck in real time, then let go to restore it. Wrap it up with one line of arithmetic: "One frame is 63KB, the bus can only push 5MB a second, and when you draw straight to the screen, what you're seeing is that 63KB in transit." In this moment you'll suddenly understand the Atari programmers of 1977 — they didn't even have a framebuffer, they had to chase the TV's electron beam and paint it line by line in real time (racing the beam), while you're sitting on a luxurious 63KB of double buffering.

**Acceptance criteria**: scrolling with no jumps, no flash when switching themes, and you can explain off the top of your head where the number 64,800 comes from.

## Going Deeper

- **Measure the real frame rate**: use `millis()` to count `pushSprite` calls per second and display it in a corner of the screen. How far off is the measured value from the theoretical 77fps? Where did the difference go? (Hint: CPU time spent drawing onto the canvas, SPI command overhead)
- **Half-depth experiment**: call `canvas.setColorDepth(8)` before `createSprite` to halve the framebuffer (1 byte per pixel). Does the frame rate change? Is the color loss visible to the naked eye? When would this trick actually be worth using?
- **Only move the dirty part**: create a small sprite (say, 240×40 covering just the text band) and call `pushSprite(0, 48)` to update only that strip. Work out how much bandwidth you save — this is the seed of "dirty rectangle updates," which shows up properly in Lesson 4.

## Checkpoint

1. What does each of SPI's SCLK, MOSI, and CS lines do? Why doesn't this screen scenario need MISO?
2. What problem does the DC line solve? What happens after the ST7789V2 receives `RAMWR`?
3. How many bytes is one 240×135 @ RGB565 frame? What's the theoretical frame-rate ceiling at 40MHz SPI? Show your work.
4. Why does direct screen drawing flicker? At which step does double buffering eliminate the flicker?
5. Why can't the `firmware.bin` you compiled on your Mac run on your Mac?

## References

- [M5Stack Cardputer official docs (pinout, schematics)](https://docs.m5stack.com/en/core/Cardputer)
- [M5Cardputer Arduino library (GitHub)](https://github.com/m5stack/M5Cardputer)
- [M5GFX library (implementation of M5Canvas / sprites)](https://github.com/m5stack/M5GFX)
- ST7789V2 datasheet: not directly downloadable from the official site [sitronix.com.tw](https://www.sitronix.com.tw/) — search "ST7789V2 datasheet PDF" to find it; focus on the command table: CASET / RASET / RAMWR
- [PlatformIO ESP32 platform docs](https://docs.platformio.org/en/latest/platforms/espressif32.html)
- [ESP32-S3 Technical Reference Manual, SPI chapter (Espressif)](https://www.espressif.com/en/support/documents/technical-documents)
