---
title: "Boss Fight I: Pocket Arcade"
subtitle: "No new hardware — forge the skills you've already unlocked into a real handheld game"
order: 4
slug: "boss-handheld-arcade"
difficulty: 2
est_hours: 5
hardware:
  - "The main game loop and fixed frame pacing"
  - "Separating input, logic, and rendering; state-machine design"
  - "SPI bandwidth budgeting: full-screen refresh vs. dirty-rect updates"
  - "millis() timing and non-blocking programming"
  - "The quantified relationship between frame rate, input latency, and game feel"
project: "Pick one — Snake, Tetris, or Flappy Bird — with a title screen, scoring, and a Game Over screen that lets you restart"
summary: "Your first big integration test: no new hardware, just the display and keyboard combined into a complete handheld game. You'll nail four programming patterns that run through the whole course — the main game loop, fixed frame pacing, input/logic/render separation, and state machines."
---

## Goals

- [ ] Explain why `delay()` is the natural enemy of games (and of any real-time program), and write a non-blocking, fixed-frame-rate main loop using `millis()`
- [ ] Sketch the "Input → Logic → Render" three-stage loop and explain why the three stages must stay separate
- [ ] Use an `enum` state machine to manage transitions between three scenes: "title screen / playing / game over"
- [ ] Calculate the SPI time cost of a full 240×135 screen refresh, and use that to figure out your frame-rate ceiling
- [ ] Ship a complete game you could hand to a friend: it has a title, keeps score, restarts on death, and never flickers

## How the Hardware Works

This is your first boss fight: no new chip, no new bus. By Lesson 2 you already knew how to drive the ST7789V2 display, and by Lesson 3 you already knew how to scan the keyboard matrix. But there's a gap between "I can light up a screen and read a key" and "I made a game that actually feels good to play" — and that gap is filled by four software patterns. Just like SPI and GPIO, you'll lean on these in every lesson that follows.

**1. The main game loop: a perpetual-motion three-stroke engine**

Every real-time program — games, oscilloscopes, web servers — boils down to the same loop:

```
        ┌──────────────────────────────────┐
        │  ┌───────┐  ┌───────┐  ┌───────┐ │
   ───► │  │ Input │─►│ Update│─►│ Render│ │ ───► back to top
        │  └───────┘  └───────┘  └───────┘ │
        │     one lap = one frame           │
        └──────────────────────────────────┘
```

Why split it into three stages? Imagine mashing "press a key, move one cell, draw it immediately" all into one blob: the snake's speed ends up tied to your keyboard scan rate, a rendering hiccup drags down your game logic, and logic that grows more complex starts dropping keypresses. Split apart, each stage does exactly one job: input **snapshots** the current key state, logic updates the game world off that snapshot (pure data, never touches the screen), and render draws the world (pure drawing, never touches the data). This is what old hands call "separating data from presentation" — game engines, React, even the network state machine in Lesson 8, are all built on this idea.

**2. Fixed frame rate: millis() is your metronome**

`delay(33)` looks like it gets you 30fps, but it's **blocking** — during the delay the CPU does absolutely nothing, including scanning the keyboard. Worse, your real frame length is 33ms plus however long your code takes, so the longer your snake gets, the slower each frame runs, and your game speed drifts. The right approach is a non-blocking beat driven by `millis()` (milliseconds since boot):

```
Timeline ──────────────────────────────────────►
Frame budget: |←── 33ms ──→|←── 33ms ──→|←── 33ms ──→|
Actual work:  [██ work ██..idle..][███ work ███.idle.]
                          ↑ millis() says "go" — next frame starts
```

Every lap through `loop()` first asks: "has it been 33ms since the last frame?" If not, just return (and during that idle stretch you can still do other things, like scanning the keyboard). Only when the budget is up does a frame actually run. That way the pacing stays constant no matter how fast or slow your logic runs. You'll see this "wait until it's time" pattern again in Lesson 7's IR timing and Lesson 8's reconnect logic.

**3. State machines: a game is really several games stapled together**

Title screen, playing, and game over are three worlds with completely different rules: on the title screen a keypress means "start," during play a keypress means "turn," and on game over a keypress means "restart." A pile of tangled `bool isPlaying, isDead` flags spirals out of control fast. The right move is one `enum` variable plus a `switch` — at any given moment the program is **in exactly one state**, and transitions only happen along clearly labeled arrows:

```
   ┌────────┐ any key ┌────────┐  hit wall/self ┌───────────┐
   │ TITLE  │ ───────► │PLAYING │ ─────────────► │ GAME_OVER │
   └────────┘          └────────┘                └───────────┘
        ▲                                              │
        └───────────────── press R to restart ◄─────────┘
```

**4. SPI bandwidth budget: the physical ceiling on your frame rate**

Recall Lesson 2: one full-screen frame = 240 × 135 × 2 bytes (RGB565) = 64,800 bytes ≈ 518,400 bits. At roughly 40MHz SPI write clock (the figure from Lesson 2, M5GFX's default config — check the [M5GFX source](https://github.com/m5stack/M5GFX) for the exact value), transfer alone takes about 13ms — meaning even with zero logic cost, a full-frame blit caps out around ~77fps. That's the "bandwidth budgeting" mindset: work out the physical ceiling first, then decide your strategy. Pushing a full-screen sprite (the double buffering from Lesson 2) costs a fixed 13ms per frame — simple and reliable. "Dirty rects," on the other hand, only redraw the regions that changed — in Snake, really only the head and tail cells change each frame, and two 8×8 cells are just 256 bytes, 1/250th of a full frame. This lesson sticks with full-screen sprites (the budget comfortably covers it), but keep this math in your back pocket — it'll be a matter of life and death when you're drawing real-time waveforms in Lesson 6.

## Hands-on Lab

First build a "minimal game skeleton": a square block, moved by the keyboard, with fixed frame pacing and an FPS readout. This skeleton is the foundation for your challenge project.

**Step 1: Feel the anti-pattern first.** Create a new PlatformIO project (board = `m5stack-stamps3`, same config as Lesson 2, depending on the `M5Cardputer` library). In `loop()`, use `delay(500)` to move a block and draw it straight to the screen. You'll see two symptoms: keypresses often don't register (the keyboard scan stops dead during the delay), and the picture flickers (drawing straight to the screen — the tearing you learned about in Lesson 2). Remember these symptoms; we're about to cure them one by one.

**Step 2: Non-blocking main loop + off-screen rendering.** This is the core code for the lesson — compile and run it as-is:

```cpp
#include <M5Cardputer.h>

M5Canvas canvas(&M5Cardputer.Display);  // off-screen buffer, an old friend from Lesson 2

// ---- Game world: pure data, no drawing code at all ----
struct World {
  int x = 120, y = 67;   // block position
  int dx = 2, dy = 0;    // velocity
};
World world;

const uint32_t FRAME_MS = 33;   // frame budget: 33ms ≈ 30fps
uint32_t lastFrame = 0;

void setup() {
  auto cfg = M5.config();
  M5Cardputer.begin(cfg, true);           // second arg true: enable keyboard scanning (Lesson 3)
  canvas.createSprite(240, 135);          // full-frame canvas lives in SRAM
}

// ---- Input: only translates keypresses into "intent" ----
void readInput(World &w) {
  M5Cardputer.update();                   // trigger one keyboard matrix scan (Lesson 3)
  // the four keys with arrow glyphs printed on their caps: ; = up  . = down  , = left  / = right
  if (M5Cardputer.Keyboard.isKeyPressed(',')) { w.dx = -2; w.dy = 0; }
  if (M5Cardputer.Keyboard.isKeyPressed('/')) { w.dx =  2; w.dy = 0; }
  if (M5Cardputer.Keyboard.isKeyPressed(';')) { w.dx = 0; w.dy = -2; }
  if (M5Cardputer.Keyboard.isKeyPressed('.')) { w.dx = 0; w.dy =  2; }
}

// ---- Logic: only mutates data, never touches the screen ----
void update(World &w) {
  w.x += w.dx;  w.y += w.dy;
  if (w.x < 0 || w.x > 232) w.dx = -w.dx;  // bounce off the wall
  if (w.y < 0 || w.y > 127) w.dy = -w.dy;
}

// ---- Render: only reads data, draws to the off-screen buffer, then pushes the whole frame ----
void render(const World &w) {
  canvas.fillSprite(TFT_BLACK);
  canvas.fillRect(w.x, w.y, 8, 8, TFT_GREEN);
  canvas.pushSprite(0, 0);                // one SPI burst, ~13ms
}

void loop() {
  readInput(world);                       // read input every single lap — never miss a keypress
  uint32_t now = millis();
  if (now - lastFrame < FRAME_MS) return; // not time yet — this frame hasn't started
  lastFrame = now;
  update(world);
  render(world);
}
```

Notice that `readInput` sits **outside** the frame pacing: the keyboard gets scanned every lap of `loop()` (under 1ms each time), but logic and rendering only fire on the 33ms beat. That's how input latency gets decoupled from frame rate — a keypress takes effect at most one frame late, not one whole `delay(500)` late.

**Step 3: Add an FPS counter.** Keep a counter variable that increments on every render call; whenever `millis()` crosses a 1000ms boundary, stash the count as `fps` and reset it to zero. During render, draw it in the corner with `canvas.setCursor(200, 0); canvas.printf("%d", fps);`. Flash it and you should see a steady 30 — then try changing `FRAME_MS` to 16 (~60fps) and 100 (10fps) to feel the relationship between frame rate and "game feel" for yourself: at 10fps the block moves like a slideshow, and input response gets visibly "sticky."

**Step 4: Add the state-machine skeleton.** Define `enum class Scene { TITLE, PLAYING, GAME_OVER };` and dispatch on it with a `switch` in the logic stage of `loop()`. In the TITLE state, render a big line of text reading "PRESS ANY KEY"; when you detect `M5Cardputer.Keyboard.isChange() && M5Cardputer.Keyboard.isPressed()`, switch to PLAYING. Once you can idle through all three states and switch between them cleanly, the skeleton is done.

## Challenge

**By the time you clock out tonight, you'll have a pocket game console — pick one of Snake, Tetris, or Flappy Bird, and build it well enough that you can hand it to a friend and they won't want to give it back.** For a first attempt, Snake is recommended — the simplest logic, and 240×135 with 8×8 cells tiles perfectly into a 30×16 board (240×128 pixels, leaving 7 pixels of slack at the bottom for a border or divider line). Ship criteria: the game is genuinely playable, never flickers, has zero input lag, and shows the score on Game Over with a restart key.

Here's the roadmap — write the code yourself:

1. **Milestone 1 — Data modeling.** The snake is a string of cell coordinates (use a fixed-length array with head/tail indices as a ring buffer — no dynamic memory). Food is one random cell. Before you write a line of code, answer this on paper: when the snake moves one step, what actually changes in the data? (Hint: not every cell moves — only one new cell gets added at the head and one gets dropped from the tail. That insight is also the key to your dirty-rect optimization.)
2. **Milestone 2 — Get the snake moving.** Replace the block in the skeleton with the snake; arrow keys change the direction of travel (careful: 180° reversals must be blocked — should that check live in the input stage or the logic stage?). The snake's movement cadence (say, one step every 150ms) and the render frame rate (30fps) are two independent metronomes — use two separate `millis()` timers.
3. **Milestone 3 — Eating and dying.** Head touches food: grow one cell, add a point, relocate the food (careful not to spawn it on the snake's body). Head touches the wall or itself: switch to the GAME_OVER state.
4. **Milestone 4 — Polish it into a real product.** A title screen (game name + key hints), a persistent score display while playing, and a Game Over screen (score + high score + "Press R to restart"). When you restart, remember to reset the entire `World` — if your initialization is scattered all over the place, this step will force you to consolidate it into one `resetWorld()` function. That's the architectural dividend the state machine pays you.

**Hidden achievement [FPS Police]:** Keep Step 3's FPS counter running in the corner for the whole game. Then run an experiment: change rendering to call `M5Cardputer.Display.fillRect()` once per snake segment, drawing straight to the screen (no canvas), and watch how the FPS curve drops as the snake grows. Then switch back to the full-screen sprite and compare. Write a short explanation: why does drawing straight to the screen cause FPS to fall as the snake gets longer (N small SPI transfers, each with its own command/addressing overhead), while the full-screen sprite stays a constant 13ms (one big burst, overhead amortized across it)? Once you can explain that, you truly understand SPI bandwidth budgeting.

## Going Deeper

- **Dirty rects in practice:** Building on the Milestone 1 insight, try redrawing only three cells per frame (the new head, the erased tail, and the food) instead of pushing the whole sprite. How high can FPS go? Where does this approach start to break down? (Hint: the score text, and the full-screen transition to Game Over.)
- **Input buffering:** Mash "up, left" quickly hoping the snake zigzags, but if both keypresses land in the same movement tick, the second one just overwrites the first. Use a small queue to buffer turn intents and consume one per step — this is a classic arcade-game feel fix.
- **Fixed timestep:** In our design, what happens if logic + render for some frame takes longer than 33ms? Look up the classic game-dev article "Fix Your Timestep!" and compare the "catch up" vs. "drop frames" strategies — think about which one fits Snake.

## Checkpoint

1. What's the fundamental difference in CPU behavior between `delay(100)` and "wait 100ms using `millis()`"? Why doesn't the latter drop keypresses?
2. Of the input, logic, and render stages, which one is allowed to modify the game world's data? Which one is allowed to call drawing APIs? Why enforce that boundary?
3. How many bytes is one full 240×135 RGB565 frame? At 40MHz SPI, how long does transferring one frame take? What frame-rate ceiling does that imply for pure transfer time?
4. What states does your game have? Draw the state transition diagram and label the trigger condition on each arrow.
5. As the snake grows, how does the time cost change for "draw each segment straight to the screen" versus "push a full-screen sprite"? Why?

## References

- [M5Cardputer official docs and pinout](https://docs.m5stack.com/en/core/Cardputer) (treat this as the source of truth for pin details)
- [M5Cardputer Arduino library (GitHub)](https://github.com/m5stack/M5Cardputer) — keyboard API and sample code
- [M5GFX / M5Canvas docs](https://github.com/m5stack/M5GFX) — sprites, `pushSprite`, and the drawing API
- Glenn Fiedler, [Fix Your Timestep!](https://gafferongames.com/post/fix_your_timestep/) — the classic article on game loop timing
- [Game Programming Patterns · Game Loop chapter](https://gameprogrammingpatterns.com/game-loop.html) — a systematic look at main-loop patterns
