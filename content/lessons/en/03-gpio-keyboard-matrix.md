---
title: "The Dark Art of Input: GPIO and Keyboard Matrix Scanning"
subtitle: "How 56 keys squeeze onto a dozen-odd pins"
order: 3
slug: gpio-keyboard-matrix
difficulty: 2
est_hours: 4
hardware:
  - "The GPIO electrical model: input/output, pull-up/pull-down resistors, high and low levels"
  - "Keyboard matrix: row/column crossings, row-by-row driving, and the scan timing for reading columns"
  - "The 74HC138 3-to-8 decoder: a pin-saving trick that turns 3 input bits into 8 output lines"
  - "Mechanical contact bounce and software debounce"
  - "How ghosting happens, and why diodes fix it"
  - "Polling vs events: scan rate, input latency, and key state machines"
project: "A 20-line typewriter, upgraded into a word-rain typing game; hidden achievement: summon a ghost key with your own hands"
summary: "Understand what GPIO really is at the electrical level and how pull-up/pull-down resistors work; get comfortable with keyboard matrix row/column scanning and the pin-saving magic of the 74HC138 decoder; understand why debouncing matters, why ghost keys appear out of nowhere, write reliable key-event handling, and reproduce the matrix circuit's physical flaw live."
---

## Goals

- [ ] Explain why a floating GPIO input pin "reads random garbage," and how pull-up/pull-down resistors fix it
- [ ] Draw the row/column layout of a keyboard matrix and narrate the timing of one full scan cycle
- [ ] Explain how the 74HC138 selects 8 rows using just 3 pins, and calculate how many pins the Cardputer keyboard saves in total
- [ ] Write debounced key-event handling that distinguishes "just pressed" from "held down"
- [ ] Reproduce a ghost key on real hardware and explain the circuit cause to a friend

## How the Hardware Works

### GPIO: a "programmable finger" sticking out of the chip

GPIO (General Purpose Input/Output) is the most primitive interface an MCU has to the outside world: one pin, and software decides whether it's a "mouth" or an "ear."

- **Output mode**: the chip actively drives the pin to high (3.3V) or low (0V), like flipping a light switch.
- **Input mode**: the chip measures the voltage on the pin and reads back a 1 or a 0.

Input mode has a classic beginner trap: **floating**. An input pin connected to nothing is like an antenna sticking out into thin air — the value it reads drifts randomly with temperature, a finger getting close, or the WiFi router next door. The fix is to give it a "default stance": a **pull-up resistor** defaults it to high, a **pull-down resistor** defaults it to low. Every GPIO on the ESP32-S3 has a configurable weak pull-up/pull-down built in — one line, `pinMode(pin, INPUT_PULLUP)`, and you're set. Remember this pattern: **pull-up + button tied to ground = 1 when not pressed, 0 when pressed**. This is the single most common button wiring in embedded systems, and the Cardputer's keyboard matrix follows the same logic (active-low).

### The keyboard matrix: pin economics for 56 keys

If every key got its own GPIO, 56 keys would need 56 pins — the entire StampS3 module doesn't have that many. The matrix trick is to arrange the keys in a grid, with each key sitting at the **intersection** of a row line and a column line:

```
        col0  col1  col2  col3 ...
row0 ───┬─────┬─────┬─────┬────
        [K]   [K]   [K]   [K]
row1 ───┼─────┼─────┼─────┼────
        [K]   [K]   [K]   [K]
row2 ───┼─────┼─────┼─────┼────
        [K]   [K]   [K]   [K]
```

Pressing a key = **connecting** its row line to its column line. The scan process is like a roll call:

1. Drive row 0 low, set all other rows to "inactive" (in a direct-GPIO matrix this usually means high-impedance / floating; the Cardputer's decoder instead holds them high — see the next section);
2. Read each column line one by one (with pull-ups): whichever column reads low means "the key at row 0 × that column" is pressed;
3. Switch to driving row 1 low, repeat; after scanning every row you've completed one frame, which finishes in a few milliseconds.

8 rows × 7 columns = 56 keys, needing only 8 + 7 = 15 pins. But the Cardputer wants even fewer —

### 74HC138: commanding 8 rows with 3 pins

The 74HC138 is a classic **3-to-8 decoder**: feed it a 3-bit binary number (000 through 111), and it drives the correspondingly numbered output low while holding the other 7 high. Think of it as an "8-line switchboard operator" — you tell it a room number, and it only rings that one room.

```
  3× GPIO ──> ┌─────────┐──> row0
   (A2 A1 A0) │ 74HC138 │──> row1
   e.g. 011   │  3-to-8 │──> ...
              │ decoder │──> row7   (only the row with index=011, row3, outputs low)
              └─────────┘
```

So driving 8 rows takes only 3 GPIOs: 3 (row select) + 7 (column read) = **10 pins to handle 56 keys**, five fewer than a direct matrix. The cost is that only one row is ever selected at a time — which happens to be exactly what matrix scanning needs anyway, so the hardware naturally cooperates with the algorithm. As for which specific GPIOs are used, don't memorize it — go check the official schematic (see References).

### Bounce and ghosting: the matrix's two "physical bugs"

**Bounce**: a mechanical contact doesn't close cleanly in one instant — the metal contacts physically bounce for a few hundred microseconds to a few milliseconds, and the signal chatters wildly between 0 and 1. The chip scans fast enough to see every single chatter, and without handling it, one keypress gets read as several. The **debounce** fix: after a state change, it only counts once the level has **stayed stable for a minimum window** (commonly 5–20ms).

**Ghosting**: hold down three keys that happen to form an L shape — (row1, col1), (row1, col2), (row2, col1) — and while scanning row2, the low level can sneak along a "smuggling path": row2 → (key at row2,col1) → col1 → (key at row1,col1) → row1 → (key at row1,col2) → col2, making col2 read low too. So a fourth key, (row2, col2), reads as "pressed" even though nobody touched it. High-end mechanical keyboards put a **diode** in series with every key so current can only flow one direction, blocking the smuggling path entirely — that's the real cost behind the marketing term "N-key rollover (NKRO)": 104 diodes. The Cardputer's keyboard doesn't have that budget, so in theory it *does* ghost when enough keys are held at once — you'll verify this experimentally in this lesson's challenge. (One wrinkle worth noting: the classic analysis above assumes unselected rows are floating, but the 74HC138 actively drives unselected rows high, which fights against the smuggling path — so the real-world behavior can be subtler than the textbook story.)

## Hands-on Lab

### Lab 1: A 20-line typewriter

Create a new PlatformIO project (`board = m5stack-stamps3`, config carried over from Lesson 2) and write:

```cpp
#include <M5Cardputer.h>

void setup() {
  auto cfg = M5.config();
  M5Cardputer.begin(cfg, true);   // second argument true: enable keyboard scanning
  M5Cardputer.Display.setTextSize(2);
  M5Cardputer.Display.setTextScroll(true); // auto-scroll when full, otherwise a few lines run off screen
  M5Cardputer.Display.print("> ");
}

void loop() {
  M5Cardputer.update();           // drives one round of keyboard scanning every loop
  if (M5Cardputer.Keyboard.isChange() &&    // state changed
      M5Cardputer.Keyboard.isPressed()) {   // and some key is currently pressed
    auto st = M5Cardputer.Keyboard.keysState();
    for (auto c : st.word) {      // word: all currently-held printable characters
      M5Cardputer.Display.print(c);
    }
    if (st.enter) M5Cardputer.Display.println();
  }
}
```

Flash it and type a few characters. Pay attention to who's doing what:

- `M5Cardputer.update()` is the "scanning machine": internally it drives the 74HC138, selects rows, reads columns, and maintains the key list. It must be called at high frequency inside `loop()` — if you don't call it, the keyboard is dead. This is the **polling** model: the keyboard doesn't notify you, you keep asking it instead.
- `isChange()` is the library's built-in **edge detection**: it's only true on the one frame where the set of pressed keys changed. Try removing it — every frame will re-print all currently-held keys, and you'll instantly grasp the difference between "level" and "event."

### Lab 2: Watching the aftershocks of bounce

Remove the `isChange()` condition, add a counter, and count how many frames `isPressed()` is true during "hold key A for one second." Then compare it against "tap A rapidly 10 times" — check whether `isChange()` fires exactly 20 times (10 presses + 10 releases). If you occasionally get a few extra, that's bounce slipping through. How much slips through, and how consistent it is, depends on how thoroughly the library debounces things — don't guess, go read the Keyboard class source (see References) and check it against your experimental data. Later, when you read a bare button directly with `digitalRead()` (say, on a Grove port), you'll have to write debouncing yourself: record the timestamp of each state flip, and only accept it once the `millis()` delta exceeds 10ms.

### Lab 3: Measuring input latency

Timestamp with `micros()` whenever `isChange()` fires, and print the interval between consecutive scans over serial. Think about it: if `loop()` has a `delay(100)` stuffed into it, what's the worst-case key latency? This question becomes a matter of life and death for game feel when you build a game in Lesson 4.

## Challenge

**Goal: a word-rain typing game.** This little 1.14-inch screen is about to get hit with a rainstorm of words, and your only weapon is the 56 keys under your fingers: blast a word before it hits the bottom of the screen to score; miss it and lose a life; every 5 words cleared, the rain speeds up. Reuse the sprite double-buffering from Lesson 2 — don't let the screen flicker.

Milestones:

1. **Static word**: show one word in the center of the screen; typing the correct prefix highlights it in a different color; finishing the whole word advances to the next one. Core data structure: target string + index of how much has matched so far.
2. **Falling**: give the word a `y` coordinate that increments every frame based on speed; drive the movement amount off a `millis()` delta, not `delay()` (think back to Lab 3).
3. **Multiple words on screen at once**: 2-3 words on screen simultaneously; typing auto-matches whichever word starts with the current input. A hardcoded `const char*` array of 30 words is plenty for a word bank.
4. **Game feel**: score, lives, progressive speed-up, a Game Over screen. Feel free to cheat on the explosion effect — just draw a few frames of an expanding circle.
5. **Hidden achievement, "Ghost Hunter"**: write a matrix-observer mode (say, entered by holding Fn) that lists every currently-held key from `keysState().word` live on screen. Then hold down three keys at once and systematically try different combinations until a **fourth key you never pressed** shows up on screen — the ghost has appeared. Note: the L shape is formed in the **electrical matrix**'s rows and columns, not the physical layout of the keycaps, so you'll have to find it experimentally (that's half the fun). Once you find it, narrate the current's smuggling path to a friend and explain why adding a diode would block it. If you try every combination and can't summon a clean fourth key — congratulations, you may have just witnessed the 74HC138's push-pull output suppressing the ghost in real time. Write down which combinations drop keys or add phantom ones — that experimental report is worth just as much as catching a ghost.

Acceptance criteria: play continuously for 3 minutes with no crash and no screen tearing; key response has no perceptible lag; you can demo a ghost key live and clearly explain why it happens.

## Going Deeper

- **Skip the library, read the matrix raw**: find the 74HC138's 3 select lines and 7 column lines on the official schematic, and write your own minimal scanner using `digitalWrite()` / `digitalRead()`, then compare it against the library's results. This is the ultimate test of "do I actually get it."
- **N-key stress test**: use matrix-observer mode to find out how many keys the Cardputer can reliably recognize at once. Which combinations conflict with just two keys? Sketch out the partial electrical matrix you infer from your tests.
- **Interrupts vs polling**: the ESP32's GPIOs support level-change interrupts (`attachInterrupt`). Think about it: why do matrix keyboards almost never use interrupt-driven scanning, while a single standalone button often does? (Hint: the row lines themselves are constantly changing during a scan.)

## Checkpoint

1. What value does a GPIO configured as input, with nothing connected to it, read? Why? How do you fix it?
2. Without the 74HC138, what's the minimum number of GPIOs a 56-key matrix needs? With it, how many? Where did the saved pins go (hint: go back to the bus map from Lesson 1)?
3. What goes wrong if you set the debounce window to 1ms? What about 200ms?
4. Narrate the ghost key's current path out loud: with three keys held down, how does the scan end up reading a fourth "ghost" key?
5. What does `M5Cardputer.Keyboard.isChange()` do for you? If it didn't exist, what data would you have to maintain yourself to get the same effect?

## References

- [M5Stack Cardputer official docs (schematic / pinout)](https://docs.m5stack.com/en/core/Cardputer)
- [M5Cardputer Arduino library (GitHub — the Keyboard class source is worth reading)](https://github.com/m5stack/M5Cardputer)
- [74HC138 datasheet (TI or Nexperia, either works)](https://www.ti.com/product/SN74HC138)
- [Ganssle: A Guide to Debouncing — the definitive empirical writeup on debouncing](http://www.ganssle.com/debouncing.htm)
- [ESP32-S3 Technical Reference Manual: IO MUX and GPIO chapter (Espressif)](https://www.espressif.com/en/support/documents/technical-documents)
