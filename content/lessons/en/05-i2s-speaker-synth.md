---
title: "Bard Mode: I2S and Sound Synthesis"
subtitle: "Sound is just a stream of digits delivered on a schedule"
order: 5
slug: "i2s-speaker-synth"
difficulty: 3
est_hours: 5
hardware:
  - "Intuition for sample rate, bit depth, and the Nyquist theorem"
  - "PCM encoding and sample buffers"
  - "The I2S protocol: BCLK / LRCLK (WS) / DATA three-wire timing"
  - "NS4168 digital-input Class-D amp: why no DAC is needed"
  - "DMA: peripherals reading memory directly, the key to glitch-free audio"
  - "Waveform synthesis: sine/square/sawtooth and how they relate to timbre"
project: "A pocket piano you can actually play: two keyboard rows mapped to keys, on-screen key animation, switchable sine/square/sawtooth timbres — an 8-bit chiptune machine"
summary: "Understand sample rate, bit depth, and PCM encoding; see how the I2S three-wire bus moves digital audio on a strict beat; understand why the NS4168 digital amp eliminates the need for a DAC and why DMA keeps audio glitch-free; then synthesize sine, square, and sawtooth waves yourself and hear that timbre is just the shape of a wave."
---

## Goals

- [ ] Explain sample rate, bit depth, and the Nyquist theorem in your own words, and why CDs use 44.1kHz / 16-bit
- [ ] Understand what each of I2S's three wires (BCLK / LRCLK / DATA) does and how their timing relates
- [ ] Explain why a "digital-input Class-D amplifier" like the NS4168 means the whole audio chain doesn't need a separate DAC
- [ ] Understand how DMA buffering works, and why a buffer underrun makes an audible "click"
- [ ] Synthesize sine, square, and sawtooth waves with math formulas, and hear the timbre difference between all three with your own ears

## How the Hardware Works

### Turning sound into digits: PCM

Air pressure in front of a microphone varies continuously, but a computer only understands discrete numbers. PCM (Pulse Code Modulation) takes the blunt approach: **measure the voltage at a fixed interval and record it as an integer.** It's like burst-shooting photos of a dancer — one frame is frozen, but string together 44,100 of them per second and the dance comes alive.

Two parameters determine the fidelity of that "recording":

- **Sample rate**: how many measurements per second. The Nyquist theorem says that to faithfully reconstruct a signal of frequency f, you need a sample rate of at least 2f. Human hearing tops out around 20kHz, so CDs picked 44.1kHz — just enough headroom. Our pocket piano runs at 44100Hz, which is plenty.
- **Bit depth**: how many bits each measurement uses. 16-bit means amplitude is sliced into 65,536 levels (-32768 to +32767) — more levels means less quantization noise.

So "one second of 16-bit mono 44.1kHz audio" is just 44,100 `int16_t` values — 88,200 bytes. Sound is nothing more than an array.

### I2S: a conveyor belt that moves digits on the beat

An array sitting in memory doesn't make a sound by itself — something has to feed those samples to the amplifier **at a precise, unwavering tempo**. That's the job of the I2S (Inter-IC Sound) bus. It looks like the SPI from Lesson 2 (clock + data), but its personality is different: SPI is "burst when there's something to say," while I2S is a **metronome that never stops** — every sample must arrive exactly on time, or the sound distorts.

The three wires each have a job:

```
BCLK  ┐_┌┐_┌┐_┌┐_┌┐_┌┐_┌┐_┌┐_┌   Bit clock: every edge moves 1 bit
LRCLK ______________┌──────────   Channel select (WS): low = left channel, high = right channel
DATA  <---left channel 16 bit---><---right channel 16 bit--->
```

- **BCLK** (bit clock): the fastest heartbeat — 1 bit transferred per rising edge;
- **LRCLK** (aka WS, word select): the slow heartbeat — one flip switches the active channel, and its frequency equals the sample rate;
- **DATA**: the sample bitstream itself.

The three are locked into a strict ratio: `BCLK = sample rate x bit depth x channel count`. 44.1kHz x 16-bit x 2 channels = about 1.41MHz. Think of LRCLK as the downbeat and BCLK as the sixteenth notes within it — the whole band (sender and receiver) stays in sync off these two clocks alone, with no "start/stop" marker needed anywhere.

### NS4168: digital in, sound waves out

The Cardputer's speaker is driven by an NS4168. The traditional chain is "digital -> DAC turns it analog -> analog amp amplifies it," but the NS4168 is a **digital-input Class-D amplifier**: it eats the I2S digital signal directly, converts the PCM into a high-frequency PWM switching waveform inside the chip to drive the speaker, and lets the speaker's own inductance filter out the high-frequency switching noise — what's left is the sound wave you wanted.

The payoff is very practical: the signal stays digital the whole way, so power-supply noise on the board can't sneak into an analog signal (otherwise you'd hear the speaker buzz whenever WiFi is active); a Class-D amp's transistors only ever sit at "fully on" or "fully off," so heat dissipation is tiny and efficiency easily clears 85%+ — perfect for a battery-powered device. That's why the ESP32-S3 **needs no audio DAC at all** — the three I2S wires connect straight to the amp, and the whole chain stays clean and lean.

### DMA: the CPU doesn't do manual labor

44.1kHz means a new sample has to go out every 22.7 microseconds. If the CPU had to hand-deliver every one, it couldn't do anything else — no screen refresh, no keyboard scanning. The fix is **DMA** (Direct Memory Access): the CPU writes a whole block of samples into memory, tells the DMA controller "move this block to the I2S peripheral," and then walks away. DMA is like a restaurant's food-runner robot — the chef (CPU) just cooks the next dish (computes the next chunk of waveform), and delivery happens automatically.

I2S drivers typically use **multiple DMA buffers rotating in turn**: while DMA is playing block 1, the CPU fills block 2. As long as the CPU fills faster than DMA plays, the sound stays continuous. The moment it falls behind (a buffer underrun), the speaker repeats stale data or outputs silence — you'll hear a "click" or a dropout. This is the most common bug you'll hit in this lesson's challenge.

### Waveform shape = timbre

Play the same A4 (440Hz) on a piano and on a violin — why do they sound different? Because **the waveform shape differs**, meaning the overtone (harmonic) content differs:

- **Sine wave**: only the fundamental, no overtones at all. Sounds "pure, airy" — like a tuning fork;
- **Square wave**: contains all odd harmonics (3f, 5f, 7f...), decaying by 1/n. Sounds "bright and punchy" — the classic NES/Game Boy sound;
- **Sawtooth wave**: contains every harmonic, odd and even. The "thickest" of the three — the base timbre behind analog synth strings and brass patches.

In this lesson you'll write all three formulas by hand and then tell them apart with your eyes closed — from now on, when you hear chiptune music, you'll be able to call out which waveform is playing.

## Hands-on Lab

### Step 0: Confirm the audio path works

Create a new PlatformIO project (`board = m5stack-stamps3`, depends on the `m5stack/M5Cardputer` library, same config as Lesson 2). First use the library's built-in `tone()` to confirm the hardware is fine:

```cpp
#include <M5Cardputer.h>

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    M5Cardputer.Speaker.setVolume(128);   // Volume 0~255, don't max it out right away
    M5Cardputer.Speaker.tone(440, 500);   // 440Hz (A4), for 500ms
}

void loop() {}
```

After flashing, you should hear a "beep." What this proves: the M5Cardputer library has already handled the I2S pin config and NS4168 init for you, so you can make sound without looking up a single pin (see the official pinout in the references at the end if you're curious). Under the hood, `tone()` is generating square-wave samples and feeding them to I2S — next, we do that ourselves.

### Step 1: Hand-synthesize a sine wave

`tone()` is someone else's synthesis — now compute the samples yourself:

```cpp
#include <M5Cardputer.h>
#include <math.h>

static constexpr int   SAMPLE_RATE = 44100;   // Samples per second
static constexpr float FREQ        = 440.0f;  // A4 pitch
static constexpr int   N           = SAMPLE_RATE;  // 1 second's worth of samples

int16_t wave[N];

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    M5Cardputer.Speaker.setVolume(128);

    // Compute sample by sample: sample i corresponds to time t = i / SAMPLE_RATE
    for (int i = 0; i < N; i++) {
        float t = (float)i / SAMPLE_RATE;
        float s = sinf(2.0f * M_PI * FREQ * t);   // -1.0 ~ +1.0
        wave[i] = (int16_t)(s * 16000);           // Scale into 16-bit range (leave headroom to avoid clipping)
    }

    // Hand the whole PCM buffer to Speaker; underneath, I2S+DMA clocks it out at 44100Hz
    M5Cardputer.Speaker.playRaw(wave, N, SAMPLE_RATE, false /*mono*/);
}

void loop() {}
```

You'll hear one second of a "pure" A4. **Why scale to 16000 instead of 32767?** To leave dynamic headroom — once you start stacking multiple notes (a chord), hitting full scale causes clipping, which sounds ugly.

### Step 2: Swap the waveform, hear the timbre

Just swap out the line or two that compute `s`; leave everything else alone (two alternative formulas below, use one at a time):

```cpp
// Square wave: +1 when sine is positive, -1 when negative — the game-console sound
float s = (sinf(2.0f * M_PI * FREQ * t) >= 0) ? 1.0f : -1.0f;

// Sawtooth wave: phase ramps steadily from 0 to 1, then snaps back, mapped to -1~+1
float phase = fmodf(FREQ * t, 1.0f);
float s = 2.0f * phase - 1.0f;
```

Flash each one and listen with your eyes closed, three times through. Same 440Hz, but sine goes "ooh," square goes "beep," sawtooth goes "buzz" (with that electric, ear-grabbing edge) — the frequency never changed, only the shape did. That's your first-hand proof that "timbre = waveform."

### Step 3: The phase accumulator — the key to real-time synthesis

Step 1 pre-computed a whole buffer up front, but a piano key's hold duration is unpredictable — you have to synthesize block by block **in real time**. The industry-standard approach is a phase accumulator: instead of an absolute time t, you maintain a phase between 0 and 1 and advance it by `freq / SAMPLE_RATE` every sample:

```cpp
float phase = 0.0f;
float phase_inc = FREQ / SAMPLE_RATE;   // How far phase advances per sample

void fillBlock(int16_t* buf, int n) {
    for (int i = 0; i < n; i++) {
        buf[i] = (int16_t)(sinf(2.0f * M_PI * phase) * 16000);
        phase += phase_inc;
        if (phase >= 1.0f) phase -= 1.0f;   // Wrap around, never overflows
    }
}
```

**Why does it have to work this way?** First, a float's absolute time t loses precision the longer it runs, so pitch would drift after a few minutes; second, changing `phase_inc` retunes the pitch instantly while keeping phase continuous — no "click" when switching notes. Call `fillBlock` in a loop, then `playRaw` a small chunk at a time (say, 512 samples), and you've got the smallest possible real-time synthesizer. Watch for two traps: first, `playRaw` **does not copy your data** — the buffer must stay valid for the whole playback, so you need two buffers alternating duty (fill A while playing B, then fill B while playing A — this is called a ping-pong buffer); second, M5Unified's Speaker maintains several virtual channels internally, and `playRaw`'s `channel` argument defaults to -1, meaning "auto-pick any free channel" — back-to-back calls will land on **different channels and mix simultaneously** instead of playing one after another. Streaming playback requires explicitly passing the same channel number every time (e.g. `playRaw(buf, n, SAMPLE_RATE, false, 1, 0)`, where the trailing 0 is the channel), so the second block queues up and plays seamlessly after the first. As long as you produce samples faster than they're consumed, the sound stays gapless.

## Challenge

**Build a pocket piano** — next time you're hanging out with friends, pull this little machine out of your pocket and improvise an 8-bit rendition of a familiar tune on the spot; nobody will be able to resist asking "what is that thing?" Map the keyboard's third row (a s d f ...) to white keys and the second row to black keys; sound starts on key-down, stops on key-up; draw a row of piano keys on screen, and whichever key is pressed lights up and bounces; number keys 1/2/3 switch between sine/square/sawtooth timbres. **Acceptance bar: pressing three keys at once produces a chord with no clipping; the delay from key-press to sound is imperceptible (roughly under 20ms).**

No full solution here — just a roadmap:

1. **Pitch table.** Twelve-tone equal temperament: `f = 440 x 2^((n-69)/12)`, where n is the MIDI note number (A4 = 69). Build a "keyboard character -> frequency" lookup table first and verify it over serial print.
2. **Monophonic piano.** Use Step 3's phase accumulator and wire `M5Cardputer.Keyboard`'s key events (an old friend from Lesson 3) into `phase_inc`: key-down sets the frequency, key-up mutes it. Don't worry about graphics yet — get one key playing a note first.
3. **Polyphony.** An array of voice structs (say, 4 voices), each tracking its own phase, freq, and active flag; each sample = the **sum** of every active voice's output. The key trap: summing 4 voices at 16000 amplitude each will inevitably overflow int16 — think about how to handle it (divide each voice by the voice count? or sum first and then scale and clamp? the two approaches sound different in volume — try both).
4. **Timbre switching.** Extract the waveform formulas into a function pointer or a switch statement, toggled by the number keys. Think about: should phase reset when you switch timbres? What happens if it doesn't?
5. **Key animation.** Reuse Lesson 4's game loop directly: separate input, synthesis, and rendering; double-buffer the key display with a sprite. **Warning: rendering must never block audio filling** — if a full-frame blit takes too long, the DMA buffer underruns and the sound "clicks." Options: fill only a small audio chunk per frame, render after the audio fill, or enlarge the Speaker's buffer. This tension is the most interesting engineering problem in this whole lesson.
6. **Bonus flex (optional):** bake in a hardcoded melody array (notes + durations), and have the backtick key (`` ` ``) auto-play it in square-wave timbre for an instant retro-console BGM vibe. Screen-record it and share.

## Going Deeper

- **Clipping experiment**: deliberately push the amplitude to 40000 before casting to int16_t, and listen to how ugly integer wrap-around distortion sounds; then switch to clamping (to ±32767) and compare the two flavors of "broken sound." You'll understand why audio code is full of `constrain` calls.
- **ADSR envelope**: a real piano note is loudest the instant it's struck, then decays. Give each voice a time-varying amplitude coefficient (an Attack-Decay-Sustain-Release four-segment envelope) and your pocket piano instantly goes from "electronic beeping" to "an instrument with feel."
- **Lookup table instead of `sinf()`**: calling `sinf()` once per sample is fairly expensive. Precompute a 1024-point sine table and index it directly with the phase (this is exactly the principle behind DDS — Direct Digital Synthesis). Measure how much CPU usage drops — this optimization will save you in Lesson 6 when you do real-time audio processing.

## Checkpoint

1. Why can't 8kHz telephone-quality audio reproduce crisp highs? (Answer using the Nyquist theorem.)
2. What's the relationship between I2S's LRCLK frequency and the sample rate? What three quantities determine BCLK?
3. Why is there no separate DAC chip in the Cardputer's audio chain? What does the NS4168 do in its place?
4. What is a DMA buffer underrun? What does it sound like? How does your pocket piano avoid it?
5. A square wave and a sine wave at the same frequency sound completely different — why? Which waveform is behind classic game-console sound?

## References

- [M5Stack Cardputer official docs (pinout and schematics)](https://docs.m5stack.com/en/core/Cardputer)
- [M5Unified Speaker_Class API (tone / playRaw / setVolume)](https://github.com/m5stack/M5Unified)
- [ESP-IDF I2S peripheral docs (standard mode, DMA buffering mechanism)](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-reference/peripherals/i2s.html)
- NS4168 datasheet: search "NS4168 datasheet" (made by Nsiway, an I2S-input Class-D audio amplifier)
- [Wikipedia: Pulse-code modulation (PCM)](https://en.wikipedia.org/wiki/Pulse-code_modulation), [I²S bus](https://en.wikipedia.org/wiki/I%C2%B2S)
