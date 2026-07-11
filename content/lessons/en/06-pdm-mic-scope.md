---
title: "The Eye of Sound: PDM Microphones and a Pocket Oscilloscope"
subtitle: "One bit is all it takes for good sound"
order: 6
slug: "pdm-mic-scope"
difficulty: 3
est_hours: 5
hardware:
  - "PDM: how a 1-bit high-frequency pulse stream encodes amplitude through density"
  - "The intuition behind oversampling and decimation filtering"
  - "The SPM1423 MEMS microphone and the I2S peripheral's PDM receive mode"
  - "PDM vs I2S/PCM: the tradeoffs on the microphone side of the interface"
  - "Ring buffers and the capture-process-draw real-time pipeline"
  - "Resampled playback: the digital version of the classic tape speed/pitch effect"
project: "Pocket oscilloscope + voice changer: draw your sound wave live, record 3 seconds, then play it back at different speeds for a chipmunk or a demon voice"
summary: "Understand the counterintuitive encoding behind PDM: a MHz-rate 1-bit stream expresses amplitude through density, which decimation filtering turns back into PCM. Compare the tradeoffs of PDM on the microphone side versus I2S on the speaker side. Master the capture-process-draw pipeline, and see firsthand that changing the playback sample rate is exactly the same thing as changing speed and pitch."
---

## Goals

- [ ] Explain how PDM encodes a continuous sound amplitude using only 1 bit
- [ ] Clearly explain why oversampling + decimation filtering can conjure 16-bit precision seemingly "out of nothing"
- [ ] Compare why microphones use PDM while speakers use I2S
- [ ] Use `M5Cardputer.Mic` to capture real audio data and draw it to the screen in real time
- [ ] Build an oscilloscope + voice changer, and understand that "playing back at a different sample rate = changing speed and pitch"

## How the Hardware Works

Last lesson you were "spitting" sound outward: 16-bit PCM samples traveling over the I2S three-wire bus into the NS4168. This lesson goes the other direction — "inhaling" sound through a microphone. But the SPM1423 MEMS microphone on the Cardputer doesn't hand you the familiar 16-bit samples you'd expect — it spits out a stream with **only 1 bit per clock**, running at high speed. This is PDM (Pulse Density Modulation).

**How can a single bit possibly express volume?** Think of dimming an LED: it only has two states, on/off, but flick it on and off tens of thousands of times a second, and a higher proportion of "on" reads as brighter, a lower proportion reads as dimmer — the human eye is a natural low-pass filter that blurs the rapid switching into continuous brightness. PDM works exactly the same way: a higher density of 1s = the waveform's amplitude is high right now, a lower density of 1s = the amplitude is low.

```
Analog waveform:  /‾‾\            __
                  /    \_______/
PDM stream:  1101111011 1010 0100010 0101101
              ↑ high density = peak   ↑ low density = trough
```

The price is speed: to express fine amplitude detail through density, the clock has to run far higher than the audio frequency — the PDM clock typically sits at 1-3 MHz, roughly a hundred times the 16 kHz sample rate. This is called **oversampling**. The sigma-delta modulator inside the microphone has another clever trick up its sleeve: it pushes quantization noise up into the high-frequency band, while human speech lives down in the low-frequency band.

That tells you exactly what the receiving end needs to do: **decimation filtering** — low-pass filter out the high-frequency noise, then "condense" each large chunk (say, 64) of 1-bit pulses down into a single 16-bit PCM sample. Intuitively it's like "count how many of these 64 bits are 1" (in practice it's a more refined CIC/FIR filter). A 3.072 MHz 1-bit stream ÷ 64 = a 48 kHz 16-bit stream — precision bought with speed. The good news: the ESP32-S3's I2S peripheral has a hardware PDM receive mode that handles all this filtering for you, with DMA delivering ready-made PCM straight into memory — the same idea as the DMA from Lesson 5, just running in reverse.

**So why does the microphone favor PDM while the speaker side uses I2S?** It comes down to who can afford the complexity. A microphone has to be tiny — rice-grain sized, a few cents a piece — so PDM only needs two wires (clock + data), with almost zero logic on the sending side; all the hard work of filtering gets dumped onto the SoC. Bonus: two PDM microphones can share a single data line (each claiming the rising or falling edge of the clock), giving you stereo without extra wiring. I2S carries ready-made PCM, so the receiver (the amplifier) stays simple, but it needs three wires and heavier logic on the sending side. In short: **PDM keeps the microphone dumb and the main controller busy; I2S keeps the data tidy at the cost of more wires.** Each is optimal in its own spot.

The last piece of the puzzle is software: sound is a continuous river, but the screen only draws one frame at a time. That's why you need a **capture-process-draw pipeline** — DMA quietly fills a buffer in the background, and your code periodically grabs a chunk, crunches it, and draws it. The rate you consume has to keep up with the rate it's being filled, or data gets overwritten and the waveform tears. This is exactly the problem the ring buffer solves: the write pointer (DMA) loops around out front, the read pointer (your code) chases from behind — as long as it never gets lapped, not a single sample is lost.

## Hands-on Lab

### Step 1: Get the microphone talking

Create a new PlatformIO project (`board = m5stack-stamps3`, depending on the `M5Cardputer` library). There's one gotcha to clear first: **in M5Unified, Mic and Speaker cannot be enabled at the same time** — you must `end()` one before you `begin()` the other. Remember this constraint; the record/playback switch in the challenge task depends entirely on it.

```cpp
#include <M5Cardputer.h>

static constexpr size_t REC_LEN = 240;   // Capture 240 points at a time: exactly one per screen column
static int16_t recBuf[REC_LEN];          // What the library hands us is already 16-bit PCM
M5Canvas canvas(&M5Cardputer.Display);   // Off-screen buffer, an old friend from Lesson 2

void setup() {
  auto cfg = M5.config();
  M5Cardputer.begin(cfg);
  canvas.createSprite(240, 135);
  M5Cardputer.Speaker.end();   // Key step: turn off the speaker first
  M5Cardputer.Mic.begin();     // Then turn on the mic (pin config is already wrapped by the library)
}

void loop() {
  M5Cardputer.update();
  // record() is asynchronous: it hands the buffer to I2S+DMA to fill in the background
  // and returns true immediately once queued (it only blocks if the queue is full).
  // 240 points at 16kHz is about 15ms — you're drawing sound from "just now", 15ms of
  // latency, which your eye will never notice. If you want to confirm it finished,
  // check Mic.isRecording().
  if (M5Cardputer.Mic.record(recBuf, REC_LEN, 16000)) {
    canvas.fillSprite(BLACK);
    canvas.drawFastHLine(0, 67, 240, DARKGREY);   // Zero-level reference line
    for (int x = 1; x < 240; x++) {
      // 16-bit sample range is -32768~32767, mapped to ±60 pixels around the center line
      int y0 = 67 - recBuf[x - 1] * 60 / 32768;
      int y1 = 67 - recBuf[x]     * 60 / 32768;
      canvas.drawLine(x - 1, y0, x, y1, GREEN);
    }
    canvas.pushSprite(0, 0);   // Blit the whole frame at once, no flicker
  }
}
```

Flash it and talk to it — the green waveform dances along with your voice. **Why doesn't the word PDM appear anywhere in this code?** Because the library plus the ESP32-S3 hardware wraps the entire "PDM stream → decimation filter → PCM" chain for you; what you get in `recBuf` is already clean 16-bit samples. Knowing what's happening under the surface, versus just knowing which API to call, are two very different levels of understanding.

### Step 2: See a clean sine wave

**Whistle** at it. Speech produces a rough, jagged waveform (the human voice is a pile of overlapping harmonics), but a whistle is close to a single frequency — you'll see a textbook sine wave appear. Count it: 240 points on screen ÷ 16000 Hz = 15 ms wide; if you see 15 complete cycles fit on the screen, your whistle is around 1000 Hz. Congratulations — you're already using a homemade instrument to take a measurement.

### Step 3: Feel the amplitude

Hold a phone playing music close to the mic and turn the volume up from low to high, watching for when the waveform **flat-tops** (the peaks go flat) — that's clipping distortion from exceeding the 16-bit range, every audio engineer's nightmare, and now you've seen it with your own eyes.

## Challenge

**An entry-level oscilloscope costs hundreds of dollars, and voice-changer apps are all ad-riddled — today you're getting both for free from the little device already in your pocket:** normally it draws the sound wave live; press `R` to record 3 seconds; press `1`/`2`/`3` to play it back at 0.5×/1×/2× the sample rate — demon bass, original voice, chipmunk voice.

You get the plan; you write the code:

**Milestone 1: State machine.** Three states: `SCOPE` (live waveform), `RECORDING` (recording, drawing a progress bar), `PLAYING` (playback). The keyboard scanning and state machine from Lessons 3 and 4 get reused here — key presses just trigger state transitions.

**Milestone 2: Record 3 seconds.** 16000 Hz × 3 s = 48000 int16 samples = 96 KB, which fits fine in SRAM — `static int16_t tape[48000]` is all you need. Don't expect a single `record()` call to fill it all: record in chunks, a few thousand points at a time, looping until the big buffer is full, updating the progress bar along the way.

**Milestone 3: Draw 48000 points into 240 pixels.** This is the crux of the lesson: each column corresponds to 200 samples, and drawing only the first sample of each group will lose the peaks. The correct approach is to **take the min and max of those 200 samples and draw a vertical line spanning them** — this is exactly how every audio app draws its waveform thumbnail (a peak envelope). Once recording finishes, draw the full overview of the "tape."

**Milestone 4: Variable-speed playback.** Remember to call `Mic.end()` + `Speaker.begin()` before switching to playback. Play it back with `M5Cardputer.Speaker.playRaw(tape, 48000, rate)` — same data, but passing `rate` as 8000 gets you the demon voice, 32000 gets you the chipmunk voice. Work out why **changing speed necessarily changes pitch**: the samples themselves haven't changed, it's just that the "motor spinning the tape" is running faster — every frequency scales up proportionally while the duration scales down proportionally. This is the digital reincarnation of the classic tape-deck speed effect.

**Acceptance criteria:** the waveform is smooth and flicker-free in real time; a whistle shows a stable sine wave; recording shows progress feedback; the three playback speeds sound clearly different in pitch; switching between record/playback never crashes (think about the Mic/Speaker mutual exclusion).

**Hidden achievement [Resonance Hunter]:** Dig back into the piano firmware idea from Lesson 5 — have the Cardputer play a sustained tone while... wait, Mic and Speaker can't both be on at once? Then use two devices, or point one device's speaker at another device's microphone. Watch on the oscilloscope how the waveform gets "fed back" and keeps growing bigger and bigger — this is the complete feedback loop behind karaoke howl (acoustic feedback): microphone → amplifier → speaker → air → microphone. Explain: why does howl always lock onto one specific frequency?

## Going Deeper

1. **Write your own decimation filter by hand.** The ESP32-S3 does PDM→PCM for you, but you can simulate it in reverse: average every 4 samples of a 16 kHz recording down into 1 sample (4 kHz), then play it back. Listen for what gets lost — the high frequencies vanish first, which is the audible version of the Nyquist theorem.
2. **Add a trigger.** Right now the whistle waveform drifts left and right, because each frame's starting phase is random. A real oscilloscope's trick: find a "rising-edge zero crossing" in the buffer and use it as the drawing start point, and the waveform locks steady on screen. Implement it, and you'll understand the full meaning of the Trigger knob on an oscilloscope's front panel.
3. **Is speed change without pitch change possible?** Tape-style speed change locks pitch and duration together. Look up the ideas behind granular synthesis or the SOLA algorithm (slicing sound into tiny grains and overlap-stitching them back together) — you don't need to implement it, just work out why it can decouple the two.

## Checkpoint

1. A PDM stream only contains 0s and 1s — where is the amplitude information hiding? What does the receiving end use to reconstruct it into 16-bit samples?
2. Why must the PDM clock run at MHz-scale, while the final PCM sample rate only needs to be 16 kHz? What did the "extra" sampling get traded for?
3. Using PDM on the microphone side and I2S on the amplifier side each removes complexity from whom?
4. Drawing 48000 sample points into a 240-pixel-wide screen — why is "take the 1st sample out of every 200" wrong, while the min/max envelope is right?
5. Playing back audio recorded at 16 kHz using a 32 kHz rate — what happens to the pitch and the duration, respectively? Why must both change together?

## References

- M5Cardputer official docs and pinout (the authoritative source for microphone pins): <https://docs.m5stack.com/en/core/Cardputer>
- M5Unified library `Mic_Class` / `Speaker_Class` API and examples: <https://github.com/m5stack/M5Unified>
- SPM1423 PDM MEMS microphone datasheet (Knowles): search "SPM1423HM4H datasheet"
- ESP-IDF I2S PDM receive mode documentation: <https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-reference/peripherals/i2s.html>
- Understanding sigma-delta and decimation filtering: search "one bit delta sigma ADC explained"
