---
title: "Final Boss: Forge Your Pocket Artifact"
subtitle: "Get every bus running at once, and turn a toy into a product"
order: 11
slug: "capstone-pocket-artifact"
difficulty: 5
est_hours: 12
hardware:
  - "Concurrent multi-peripheral work: FreeRTOS task decomposition, priorities, and queues"
  - "Mutual exclusion for shared buses and shared data (mutex, message queues)"
  - "Event-driven architecture and multi-file project organization"
  - "NVS/Preferences config persistence (WiFi credentials, etc.)"
  - "Heap monitoring (ESP.getFreeHeap) and fragmentation crash triage"
  - "Power and battery realities, failure-mode design (dropped WiFi/pulled SD card/buffer overflow)"
  - "System-level debugging: serial logging and module-by-module triage methodology"
project: "Pick one of four, or design your own: forge a pocket artifact that spans at least four buses and sees daily use, then open-source it and add it to the course's hall of fame"
summary: "Graduation exam: pick a capstone project spanning at least four buses and carry it through the full engineering loop — requirements, architecture, implementation, polish, release — while confronting concurrent multi-peripheral challenges head-on: FreeRTOS task decomposition, mutual exclusion, and failure-mode design. Ship something finished enough for daily use."
---

## Goals

- [ ] Break a capstone project into several FreeRTOS tasks, and clearly explain each task's responsibility, priority, and communication method
- [ ] Use a mutex and message queues to protect shared buses and shared data, and explain "why does the screen glitch when two tasks draw to it at once"
- [ ] Persist configuration with Preferences (NVS), so WiFi credentials survive a reboot
- [ ] Use `ESP.getFreeHeap()` to monitor memory and track down a real memory issue
- [ ] Ship a build that spans at least four buses, survives dropped WiFi/a pulled SD card/frantic key-mashing, and open-source it

## How the Hardware Works

Over the last ten lessons you learned to play with one peripheral at a time. The final boss reveals itself now: **every peripheral runs at once, and they're all fighting over the same pool of resources** — CPU time, the SPI bus, the SRAM heap, and that one strip of 2.4GHz radio spectrum.

**From loop() to tasks.** Back in Lesson 8 you discovered that `loop()` is just an ordinary FreeRTOS task running on the app core, while the WiFi stack has been quietly grinding away on the other core the whole time. Now it's your turn to create tasks of your own. Picture the system as a small restaurant: instead of one server (the mega-loop) taking orders, cooking, running the register, and bussing tables in sequence — where any single hiccup stalls the whole place — you hire specialists:

```
  [Keyboard task]──key event──▶┐
  [Network task]──data in──────▶├──queue──▶[UI task]──▶ screen (SPI)
  [Audio task]◀──beep───────────┘
       Each task: its own stack + priority, scheduled by the RTOS
```

The audio task gets the highest priority (starve the DMA buffer and you get a pop — Lesson 5's lesson learned the hard way), keyboard comes next (input lag is felt immediately), and network and UI sit at the bottom (a half-second delay there kills nobody). The scheduler guarantees high-priority tasks get the CPU the instant they need it — real-time behavior a bare `loop()` simply can't give you.

**More tasks means a new monster shows up: race conditions.** Two tasks writing to the screen "at the same time" can slice an SPI transfer in half, scrambling pixels into garbage; two tasks editing the same string at once can each leave half their content behind. There are two remedies:

- **Mutex**: think of it as the bus's restroom lock. Lock the door going in (`xSemaphoreTake`), unlock it coming out (`xSemaphoreGive`). In Lesson 10 the SD card and screen shared the SPI bus by toggling CS lines — that's safe within a single task, but under multitasking you need a mutex on top, or the UI task will steal the bus mid-write and corrupt the filesystem.
- **Message queues**: more elegant than a lock. Tasks don't share variables — they pass copies of "messages" instead (`xQueueSend` / `xQueueReceive`). The keyboard task just drops key events into the queue; the UI task consumes them at its own pace. No sharing, no race condition — this is the embedded-systems version of "immutability."

**Memory is the silent enemy.** The ESP32-S3 has roughly 512KB of SRAM, and after the WiFi stack, task stacks, and your sprite buffers, there isn't much left. Worse still is **fragmentation**: repeated `malloc`/`free` calls of varying sizes turn the heap into a parking lot smashed to pieces — plenty of total free space, but no single spot big enough to fit a bus. The symptom is a device that randomly reboots after running for a few hours. The fix: allocate big buffers once at startup, reuse them instead of constantly creating new ones, and log `ESP.getFreeHeap()` and `ESP.getMinFreeHeap()` periodically to watch the trend.

**Finally, a product mindset.** The difference between a toy and a product isn't feature count — it's **failure modes**. What shows on screen when WiFi drops? Does the device crash if the SD card is pulled? What happens when the API returns a 500? In production-grade code, the failure-handling paths often outnumber the happy path. That's the door this lesson is asking you to walk through.

## Hands-on Lab

Before diving into the real build, weld the concurrency trifecta into your muscle memory with three small experiments. Create a new PlatformIO project with `board = m5stack-stamps3` and the `M5Cardputer` library as a dependency.

**Experiment 1: two tasks + one queue.** Feel what it's like when tasks don't share variables, only messages:

```cpp
#include <M5Cardputer.h>

QueueHandle_t keyQueue;  // Queue: conveyor belt from keyboard task to UI task

// Keyboard task: only scans keys, drops each one into the queue
void keyboardTask(void* param) {
    while (true) {
        M5Cardputer.update();
        if (M5Cardputer.Keyboard.isChange() && M5Cardputer.Keyboard.isPressed()) {
            auto status = M5Cardputer.Keyboard.keysState();
            for (auto c : status.word) {
                xQueueSend(keyQueue, &c, 0);  // Send a "copy" of the char, nothing shared
            }
        }
        vTaskDelay(pdMS_TO_TICKS(10));  // Yield the CPU; scanning every 10ms is plenty
    }
}

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    M5Cardputer.Display.setTextSize(2);
    keyQueue = xQueueCreate(32, sizeof(char));  // Char queue with capacity 32
    // Args: function, task name, stack size (bytes), param, priority, handle
    xTaskCreate(keyboardTask, "kbd", 4096, nullptr, 2, nullptr);
}

void loop() {  // loop() is itself a task — here it doubles as the UI task
    char c;
    // Block on the queue; wake instantly on a message, cost zero CPU otherwise
    if (xQueueReceive(keyQueue, &c, portMAX_DELAY) == pdTRUE) {
        M5Cardputer.Display.print(c);
    }
}
```

Try typing on it. Notice that while `xQueueReceive` blocks, the UI task is "asleep" and the scheduler hands the CPU to someone else — that's what event-driven feels like. Compare it against Lesson 4's polling main loop.

**Experiment 2: cause a glitch on purpose, then fix it.** Create another task that draws a counter in the corner of the screen every 50ms, while `loop()` prints a flood of text — two tasks driving the SPI bus at once will almost certainly produce garbled or misaligned pixels. Then define `SemaphoreHandle_t lcdMutex = xSemaphoreCreateMutex();`, and wrap both drawing sections between `xSemaphoreTake(lcdMutex, portMAX_DELAY)` and `xSemaphoreGive(lcdMutex)`. The glitching disappears. Ten minutes of "commit the crime, then solve it" teaches more than ten tutorials.

**Experiment 3: config persistence + memory monitoring.** Use ESP32's built-in Preferences library (backed by the NVS partition from Lesson 1's partition table) to store a boot counter:

```cpp
#include <M5Cardputer.h>
#include <Preferences.h>

Preferences prefs;

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    M5Cardputer.Display.setTextSize(2);
    prefs.begin("myapp", false);              // Open namespace, false = read/write
    int boots = prefs.getInt("boots", 0) + 1; // Default to 0 if not found
    prefs.putInt("boots", boots);             // Write back to NVS, survives power loss
    M5Cardputer.Display.printf("Boot #%d\n", boots);
    M5Cardputer.Display.printf("Free heap: %u bytes\n", ESP.getFreeHeap());
}

void loop() {}
```

Hit reset over and over — the count keeps climbing. This is where you'll later store WiFi credentials and API keys (note: don't hardcode a key into your source and then open-source the repo!). Also jot down the free-heap number, then check it again after connecting to WiFi, to see how much memory the stack devours.

## Challenge

**Every skill point you've banked across ten lessons cashes out right now: forge an artifact you'll carry in your pocket every day from here on, one that makes people ask "where'd you buy that?" — and you get to answer "you can't, I built it."** Pick one of the four, or design your own (must span at least four buses):

1. **Pocket Claude Terminal** (the course's cover project) — type questions on the keyboard, stream responses from the Claude API over WiFi, watch the answer scroll up a tiny screen line by line, save the conversation to SD, play a tone on keypress. Buses: GPIO keyboard + SPI screen/SD + WiFi + I2S audio.
2. **Desktop weather station** — Grove I2C sensor + SD logging + network reporting + on-screen dashboard.
3. **Home commander** — IR remote + BLE macro keys + on-device web panel, all in one.
4. **Portable music workstation** — play notes on the keyboard + mic recording + SD playback.

No code handed to you here — just milestones. Each one is a checkable step; don't skip any:

- **M0 · Kickoff (it doesn't count until it's written down)**: a one-page requirements doc — who's the user, what's the core interaction flow, which buses does it touch; plus an architecture diagram — every task, its priority, its queues and mutexes, and who owns which bus. If you can't draw the diagram clearly, you haven't thought it through — don't start coding yet.
- **M1 · Skeleton**: a multi-file project (one .cpp/.h pair per task, `main.cpp` does nothing but init and wiring). All tasks spin idle end to end, each printing its own heartbeat and `ESP.getFreeHeap()` over serial.
- **M2 · Core loop**: the main flow runs end to end (e.g., type → request → answer on screen). Ugly is fine; faked is not.
- **M3 · All buses assembled**: bring in the remaining peripherals (sound effects, SD persistence, sensors...) and specifically verify concurrency: type while waiting on a network reply — no stutter, no screen glitch, no audio pop.
- **M4 · Failure modes**: run through each one in turn — drop WiFi (should reconnect, screen shows a status indicator), pull the SD card (degrade gracefully, don't crash), API timeout/error (UI shows an error, doesn't freeze), rapid-fire key mashing (queue full drops input instead of overflowing). Every failure needs a "script."
- **M5 · Stability**: run continuously for 2+ hours, logging free heap once a minute. A steadily declining curve = a memory leak — go hunt it down.
- **M6 · Release**: push to GitHub, write a README (photos/GIF, architecture diagram, failure-mode design notes, build steps), route config through Preferences instead of hardcoding it. Attach your fully lit-up bus map and submit it to the course site's hall of fame.

**Acceptance criteria**: covers ≥4 buses; doesn't crash under random key-mashing at any point; clear on-screen feedback for dropped WiFi/pulled SD card; 2 hours of stable runtime; public repo that others can rebuild from the README.

Troubleshooting methodology when you're stuck: **suspect exactly one module at a time**. Temporarily comment out the other tasks and run the suspect task alone; add serial logs tagged with the task name on every critical path (`Serial.printf("[net] ...")`); for random reboots, check stack overflow first (serial will print a `Stack canary` or `Guru Meditation` crash message — bump the task's stack size if it's too small) before chasing the heap.

## Going Deeper

- **See the scheduler in action**: call `vTaskList()` to print every task's state, priority, and stack high-water mark — note that it depends on FreeRTOS trace config, which the Arduino precompiled core doesn't always enable. If you get an "undefined" compile error, fall back to calling `uxTaskGetStackHighWaterMark()` (always available) on each task handle and print your own table. Go looking for the WiFi and Bluetooth stack's tasks — they've been there all along, and now you can finally see them.
- **Battery reality check**: at full brightness with WiFi always connected, how long does the battery last? Measure it. Then compare power draw between `WiFi.setSleep(false)` (radio always awake, low latency) and the default modem sleep, and see how much dimming the screen saves — battery life is the last piece of the product-thinking puzzle.
- **Squeeze both cores**: `xTaskCreatePinnedToCore` lets you pin a task to a specific core. Pin the audio task to a different core than the WiFi stack and see whether the odds of an audio pop change — this verifies the dual-core division of labor theory from Lesson 8.

## Checkpoint

1. Why should the audio task's priority be higher than the UI task's? What happens if the priorities are reversed?
2. Both a mutex and a message queue can prevent race conditions — what's each one best suited for? Why is "don't share data" less bug-prone than "lock the data"?
3. In Lesson 10, the SD card and screen shared the SPI bus safely just by toggling CS lines — so why does multitasking require adding a mutex on top?
4. Your device randomly reboots after running for a few hours — what's your troubleshooting process? (Name at least three steps.)
5. In your project, what's the failure script for dropped WiFi, and for a pulled SD card? Why is failure-mode design the line between a toy and a product?

## References

- Cardputer official docs and pinout: https://docs.m5stack.com/en/core/Cardputer
- M5Cardputer library (the examples folder is a goldmine): https://github.com/m5stack/M5Cardputer
- FreeRTOS tasks and queues (ESP-IDF edition): https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-reference/system/freertos.html
- Arduino-ESP32 Preferences library: https://docs.espressif.com/projects/arduino-esp32/en/latest/api/preferences.html
- ESP-IDF heap memory debugging guide: https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-reference/system/heap_debug.html
- Anthropic Claude API docs (Project 1): https://docs.anthropic.com/
