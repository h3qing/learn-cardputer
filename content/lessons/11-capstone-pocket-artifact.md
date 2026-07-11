---
title: 最终 Boss:铸造你的口袋神器
subtitle: "让所有总线同时工作,把玩具打磨成产品"
order: 11
slug: "capstone-pocket-artifact"
difficulty: 5
est_hours: 12
hardware:
  - "多外设并发:FreeRTOS 任务划分、优先级与队列"
  - "共享总线与共享数据的互斥保护(mutex、消息队列)"
  - "事件驱动架构与多文件工程组织"
  - "NVS/Preferences 配置持久化(WiFi 凭据等)"
  - "堆内存监控(ESP.getFreeHeap)与碎片化崩溃排查"
  - "功耗与电池现实约束、失败模式设计(断网/拔卡/缓冲溢出)"
  - "系统级调试:串口日志与分模块排查方法论"
project: "四选一或自拟:铸造一个覆盖至少四条总线、可日常使用的口袋神器,开源发布并挂上通关名人堂"
summary: "毕业考核:选定一个覆盖至少四条总线的综合项目,走完需求、架构、实现、打磨、发布的完整工程闭环,直面多外设并发难题——FreeRTOS 任务划分、互斥保护、失败模式设计,交付可日常使用的完成度。"
---

## 本课目标

- [ ] 能把一个综合项目拆成若干 FreeRTOS 任务,说清每个任务的职责、优先级和通信方式
- [ ] 会用 mutex 和消息队列保护共享总线与共享数据,解释"为什么两个任务同时画屏会花屏"
- [ ] 会用 Preferences(NVS)持久化配置,重启后 WiFi 凭据还在
- [ ] 能用 `ESP.getFreeHeap()` 监控内存,定位一次真实的内存问题
- [ ] 交付一个覆盖至少四条总线、能扛住断网/拔卡/乱按键盘的作品,并开源发布

## 硬件原理

前十课你学的是"一次玩一个外设"。最终 Boss 的真面目是:**所有外设同时工作,而它们抢的是同一批资源**——CPU 时间、SPI 总线、SRAM 堆、还有那一块 2.4GHz 射频。

**从 loop() 到任务。** 第 8 课你已经发现,`loop()` 只是 FreeRTOS 里一个跑在应用核上的普通任务,WiFi 协议栈一直在另一个核上偷偷干活。现在轮到你自己建任务了。把系统想成一个小餐馆:与其让一个服务员(超级 loop)轮流点菜、炒菜、收银、擦桌子——任何一步卡住全店停摆——不如雇几个专人:

```
  [键盘任务]──按键事件──▶┐
  [网络任务]──收到数据──▶├──队列──▶[UI 任务]──▶ 屏幕(SPI)
  [音频任务]◀──提示音────┘
       每个任务:独立栈 + 优先级,由调度器分配 CPU
```

音频任务优先级最高(DMA 缓冲一饿就爆音,第 5 课的教训),键盘次之(输入延迟直接影响手感),网络和 UI 垫底(慢半拍没人死)。调度器保证高优先级任务随叫随到——这是裸 loop() 给不了的实时性。

**任务多了,新怪物就来了:竞态。** 两个任务"同时"写屏幕,SPI 传输被切成两半,像素错位、花屏;两个任务同时改一个字符串,内容各剩一半。解药有两味:

- **mutex(互斥锁)**:总线的"洗手间门锁"。进去先锁门(`xSemaphoreTake`),出来开锁(`xSemaphoreGive`)。第 10 课 SD 卡和屏幕共享 SPI 总线,靠 CS 线分时——但那只在单任务里安全;多任务下必须再加 mutex,否则 SD 写到一半被 UI 抢走总线,文件系统直接损坏。
- **消息队列**:比锁更优雅。任务间不共享变量,而是传递"消息"的副本(`xQueueSend` / `xQueueReceive`)。键盘任务只管往队列里丢按键事件,UI 任务慢慢消费。没有共享,就没有竞态——这是嵌入式版的"immutability"。

**内存是最沉默的敌人。** ESP32-S3 的 SRAM 只有约 512KB,刨去 WiFi 栈、任务栈、你的 sprite 缓冲,所剩无几。更阴的是**碎片化**:反复 `malloc`/`free` 不同大小的块,堆会像被打碎的停车场——总空位够,但没有一个连续车位停得下大巴。表现为设备跑几小时后随机重启。对策:启动时一次性分配大缓冲、复用而不反复新建、用 `ESP.getFreeHeap()` 和 `ESP.getMinFreeHeap()` 定期打日志盯趋势。

**最后是产品心态。** 玩具和产品的区别,不在功能多少,而在**失败模式**:断网了显示什么?SD 卡被拔了会不会崩?API 返回 500 怎么办?产品级代码里,处理失败的代码往往比正常路径还多。这就是本课要你跨过的那道门。

## 动手实验

正式动工前,先用三个小实验把并发三件套焊进手感里。工程用 PlatformIO 新建,`board = m5stack-stamps3`,依赖 `M5Cardputer` 库。

**实验 1:两个任务 + 一条队列。** 体验"任务间不共享变量,只传消息":

```cpp
#include <M5Cardputer.h>

QueueHandle_t keyQueue;  // 队列:键盘任务 → UI 任务的传送带

// 键盘任务:只管扫键,扫到就往队列里丢
void keyboardTask(void* param) {
    while (true) {
        M5Cardputer.update();
        if (M5Cardputer.Keyboard.isChange() && M5Cardputer.Keyboard.isPressed()) {
            auto status = M5Cardputer.Keyboard.keysState();
            for (auto c : status.word) {
                xQueueSend(keyQueue, &c, 0);  // 发送字符的"副本",不共享内存
            }
        }
        vTaskDelay(pdMS_TO_TICKS(10));  // 让出 CPU,10ms 扫一次足够
    }
}

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    M5Cardputer.Display.setTextSize(2);
    keyQueue = xQueueCreate(32, sizeof(char));  // 容量 32 的字符队列
    // 参数:函数、任务名、栈大小(字节)、参数、优先级、句柄
    xTaskCreate(keyboardTask, "kbd", 4096, nullptr, 2, nullptr);
}

void loop() {  // loop() 本身就是一个任务,这里当 UI 任务用
    char c;
    // 阻塞等队列,有消息立刻醒,没消息不占 CPU
    if (xQueueReceive(keyQueue, &c, portMAX_DELAY) == pdTRUE) {
        M5Cardputer.Display.print(c);
    }
}
```

打字试试。注意 `xQueueReceive` 阻塞时 UI 任务在"睡觉",调度器把 CPU 让给别人——事件驱动就是这个感觉,和第 4 课的轮询主循环对比一下。

**实验 2:亲手制造一次花屏,再治好它。** 再建一个任务,在屏幕角落每 50ms 画一个计数器,同时让 loop() 大量打印文字——两个任务同时驱动 SPI,大概率出现错位或花屏。然后定义 `SemaphoreHandle_t lcdMutex = xSemaphoreCreateMutex();`,把两处画屏代码都包进 `xSemaphoreTake(lcdMutex, portMAX_DELAY)` 和 `xSemaphoreGive(lcdMutex)` 之间,花屏消失。这十分钟的"先犯罪再破案",比十篇教程都管用。

**实验 3:配置持久化 + 内存监控。** 用 ESP32 自带的 Preferences 库(底层是第 1 课分区表里那个 NVS 分区)存一个开机计数:

```cpp
#include <M5Cardputer.h>
#include <Preferences.h>

Preferences prefs;

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    M5Cardputer.Display.setTextSize(2);
    prefs.begin("myapp", false);              // 打开命名空间,false = 可读写
    int boots = prefs.getInt("boots", 0) + 1; // 读不到就用默认值 0
    prefs.putInt("boots", boots);             // 写回 NVS,掉电不丢
    M5Cardputer.Display.printf("第 %d 次开机\n", boots);
    M5Cardputer.Display.printf("空闲堆: %u 字节\n", ESP.getFreeHeap());
}

void loop() {}
```

按 reset 反复重启,计数一直涨——这就是以后存 WiFi 凭据、API key 的地方(注意:真项目里别把 key 硬编码进代码再开源!)。同时记下空闲堆数字,连上 WiFi 后再看一次,感受协议栈吃掉了多少内存。

## 挑战任务

**十课攒下的技能点,现在一次性全部兑现:铸一件从今往后天天揣在兜里、掏出来就有人追问"这在哪买的?"的神器——而你可以答:"买不到,我写的。"** 四选一,或自拟(自拟需覆盖至少四条总线):

1. **口袋 Claude 终端**(课程封面作品)——键盘打字提问,WiFi 流式调用 Claude API,回答一行行滚上小屏,会话存 SD,按键有提示音。总线:GPIO 键盘 + SPI 屏幕/SD + WiFi + I2S 音频。
2. **桌面气象站**——Grove I2C 传感器 + SD 日志 + 联网上报 + 屏幕仪表盘。
3. **家庭指挥官**——IR 遥控 + BLE 宏键 + 设备端 Web 面板三合一。
4. **随身音乐工作站**——键盘弹奏 + 麦克风录音 + SD 存取回放。

不给代码,给里程碑。每个里程碑都是可验收的一步,别跳:

- **M0 · 立项(写下来才算数)**:一页需求文档——用户是谁、核心操作流、覆盖哪些总线;一张架构图——列出所有任务、优先级、队列和 mutex,标出谁拥有哪条总线。画不清架构图,说明还没想清楚,别开工。
- **M1 · 骨架**:多文件工程(每个任务一个 .cpp/.h,`main.cpp` 只做初始化和组装),所有任务空转跑通,串口打印各自心跳和 `ESP.getFreeHeap()`。
- **M2 · 核心闭环**:主流程端到端跑通(如:打字 → 请求 → 回答上屏)。允许丑,不允许假。
- **M3 · 全总线合体**:接入剩余外设(音效、SD 持久化、传感器……),重点验证并发:一边等网络回包一边打字,不卡、不花屏、不爆音。
- **M4 · 失败模式**:依次演习——断 WiFi(该重连重连,屏幕有状态提示)、拔 SD 卡(降级运行,不崩)、API 超时/出错(界面报错,不假死)、连续快速输入(队列满了丢弃而非溢出)。每种失败都要有"剧本"。
- **M5 · 稳定性**:连续运行 2 小时以上,每分钟日志一次空闲堆。曲线持续下滑 = 内存泄漏,回去抓。
- **M6 · 发布**:传 GitHub,写 README(照片/GIF、架构图、失败模式设计说明、复刻步骤),配置走 Preferences 而非硬编码。附上你那张全部涂亮的总线地图,提交课程网站通关名人堂。

**验收标准**:覆盖 ≥4 条总线;任意时刻乱按键盘不崩;断网/拔卡有明确的界面反馈;2 小时稳定运行;仓库公开且他人可按 README 复刻。

卡住时的排查方法论:**一次只怀疑一个模块**。把其他任务临时注释掉,让嫌疑任务单独跑;给每个任务的关键路径加带任务名的串口日志(`Serial.printf("[net] ...")`);随机重启先查栈溢出(串口会打印 `Stack canary` 或 `Guru Meditation` 崩溃信息,任务栈不够就加大)再查堆。

## 深入一层

- **看穿调度器**:调用 `vTaskList()` 打印所有任务的状态、优先级和栈高水位——注意它依赖 FreeRTOS 的 trace 配置,Arduino 预编译核心不一定开启,编译报"未定义"就退而求其次:对每个任务句柄调用 `uxTaskGetStackHighWaterMark()`(始终可用)自己打印一张表。找一找 WiFi、蓝牙协议栈的任务——它们一直都在,你现在终于看得见了。
- **电池现实**:满亮度 + WiFi 常连,电池能撑多久?实测一下。再对比 `WiFi.setSleep(false)`(射频常醒,延迟低)与默认的 modem sleep 各耗多少电,以及降低屏幕亮度能省多少——产品思维的最后一块拼图是续航。
- **双核压榨**:`xTaskCreatePinnedToCore` 可以把任务钉在指定核上。把音频任务钉到与 WiFi 协议栈不同的核,对比爆音概率有没有变化,验证第 8 课的双核分工理论。

## 检查点

1. 为什么音频任务的优先级应该高于 UI 任务?优先级设反了会出现什么现象?
2. mutex 和消息队列都能避免竞态,各自适合什么场景?为什么说"不共享数据"比"锁住数据"更不容易出 bug?
3. 第 10 课里 SD 卡和屏幕靠 CS 线共享 SPI 就够了,为什么多任务下还必须加 mutex?
4. 设备连续运行几小时后随机重启,你的排查步骤是什么?(至少说出三步)
5. 你的作品里,断网和拔卡各自的失败剧本是什么?为什么说失败模式设计是玩具和产品的分水岭?

## 参考资料

- Cardputer 官方文档与 pinout:https://docs.m5stack.com/en/core/Cardputer
- M5Cardputer 库(examples 目录是金矿):https://github.com/m5stack/M5Cardputer
- FreeRTOS 任务与队列(ESP-IDF 版):https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-reference/system/freertos.html
- Arduino-ESP32 Preferences 库:https://docs.espressif.com/projects/arduino-esp32/en/latest/api/preferences.html
- ESP-IDF 堆内存调试指南:https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-reference/system/heap_debug.html
- Anthropic Claude API 文档(项目一):https://docs.anthropic.com/
