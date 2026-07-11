---
title: 隐形法术:红外与微秒级精确定时
subtitle: "38kHz 上的光之摩斯电码"
order: 7
slug: "ir-remote-rmt"
difficulty: 3
est_hours: 4
hardware:
  - "38kHz 载波调制:为什么 IR 接收头只认这个频率的闪烁"
  - "NEC 协议帧格式:引导码 / 地址 / 命令 / 逻辑反码"
  - "脉宽编码:用时长表达 0 和 1"
  - "软件 delay 定时的抖动问题与 ESP32 RMT 硬件外设"
  - "TX-only 的局限:Cardputer 只能查码库不能对拷学码"
  - "IRremoteESP8266 库与常见品牌码库工作流"
project: "做一个带屏幕菜单、键盘选台的万能遥控器,从客厅另一头无形地关掉自家电视。"
summary: "红外遥控是分层的:38kHz 载波帮接收端从环境光里滤出信号,NEC 协议用脉冲长短编码地址、命令和反码校验。微秒级定时不能靠 delay() 硬抗,ESP32 的 RMT 外设用硬件生成精确脉冲,查码表就能控制真实家电。"
---

## 本课目标

- [ ] 能解释 38kHz 载波的作用:为什么太阳和灯泡骗不过 IR 接收头
- [ ] 能画出一帧 NEC 协议:引导码、地址、命令、反码,以及 0 和 1 的脉宽区别
- [ ] 能说清为什么 `delayMicroseconds()` 撑不起微秒级协议,RMT 外设解决了什么
- [ ] 用 IRremoteESP8266 库从 Cardputer 发出一条真实的电视控制码
- [ ] 完成挑战:带屏幕菜单和键盘选台的万能遥控器

## 硬件原理

前两课你玩的是声音——I2S 把数字样本变成扬声器的振动,PDM 把空气的振动变回比特流。这一课换一种"看不见的波":红外光。你的 Cardputer 顶部藏着一颗 IR LED,发出约 940nm 的红外线,人眼看不见,但电视的接收头看得一清二楚。

**问题一:世界上到处都是红外线,电视怎么知道哪束光是遥控器?**

太阳是巨大的红外辐射源,白炽灯、暖气片、你的体温都在发红外。如果电视接收头对"有红外光"就做出反应,它会被环境噪声淹没。解决方案很聪明:遥控器不发"持续的光",而是发**以 38kHz 频率闪烁的光**。接收头(比如常见的 TSOP 系列)内部有一个带通滤波器,只对"每秒闪 38000 次"的光信号敏感——太阳光再强,它是直流的,直接被滤掉。这就像在嘈杂的酒吧里,你朋友约定用特定节奏眨眼向你传话:光本身不稀奇,**节奏**才是暗号。这个 38kHz 的闪烁叫**载波(carrier)**。

**问题二:光有载波还不够,内容怎么编码?**

载波之上是第二层:协议层。最经典的是 NEC 协议,它不靠"亮多久"传数据,而是靠**脉冲和间隔的时长组合**——这叫脉宽编码。发送"有载波"的一段叫 mark,静默的一段叫 space:

```
一帧 NEC(时间轴从左到右,▓ = 38kHz 载波开,░ = 静默):

▓▓▓▓▓▓▓▓▓░░░░░  ▓░ ▓░░░ ▓░ ▓░░░ ... ▓
  9ms      4.5ms  |____ 32 个数据位 ____|  结束脉冲
  引导码(leader)

逻辑 0:  ▓░        约 560µs mark + 560µs space   (总长 ~1.12ms)
逻辑 1:  ▓░░░      约 560µs mark + 1690µs space   (总长 ~2.25ms)
```

mark 长度永远一样,区别全在 space 的长短——**用时长表达 0 和 1**。32 个数据位的结构是:8 位地址 + 8 位地址反码 + 8 位命令 + 8 位命令反码。反码是自带的校验:接收端把命令和命令反码按位异或,结果必须全 1,否则丢弃。空气是一个丢包严重的信道(有人走过、角度偏了、阳光干扰),这种"每字节自证清白"的冗余设计非常实用。地址用来区分设备——你按电视遥控器,空调不会理你。

**问题三:为什么不能用 delay() 来生成这些脉冲?**

一个逻辑 0 的 space 是 560µs,NEC 的容错窗口大约只有 ±25%。你可能想:`digitalWrite(HIGH); delayMicroseconds(560); ...` 循环 32 次不就行了?问题在于你的代码不是机器上唯一的居民——第 8 课会正式介绍,Arduino 的 `loop()` 底下跑着 FreeRTOS,还有 WiFi 协议栈、定时器中断随时可能打断你。一次中断耽误几十微秒,某个位的时长就飘出容错窗,整帧作废。这和第 5 课音频卡顿是同一类问题:**CPU 不适合干"掐着微秒表"的活**。

音频课的答案是 DMA,这一课的答案是 **RMT(Remote Control Transceiver)**——ESP32 专为红外这类场景设计的硬件外设。你把脉冲序列写成一张"时长表"(电平 + 持续时间的数组)交给 RMT,它就用硬件独立地、精确地逐项执行,还能在硬件里叠加 38kHz 载波。CPU 提交完任务就可以去干别的,哪怕 WiFi 中断满天飞,发出的波形也分毫不差。同一个思想再次出现:**把有实时性要求的活交给专用硬件,CPU 只负责编排**。

最后一个现实约束:Cardputer 只有 IR 发射 LED,**没有接收头**(TX-only)。这意味着你不能把家里的旧遥控器对着它"学码"。好在流行家电的码早被社区整理成库——LIRC 数据库、IRDB、IRremoteESP8266 自带的协议支持,查表即可。你是查字典的施法者,不是窃听者。

## 动手实验

### 第 1 步:建工程,拉两个库

在 `platformio.ini` 里加上 IRremoteESP8266(这是 ESP32/ESP8266 世界最全的 IR 协议库,支持上百种协议):

```ini
[env:cardputer]
platform = espressif32
board = m5stack-stamps3
framework = arduino
lib_deps =
    m5stack/M5Cardputer
    crankyoldgit/IRremoteESP8266
```

### 第 2 步:确认 IR LED 的引脚

打开 [docs.m5stack.com 的 Cardputer 页面](https://docs.m5stack.com/en/core/Cardputer),在 pinout 表里找到 IR LED 对应的 GPIO 号。**不要抄网上帖子里的数字**,以官方文档为准——这是你第 1 课练过的基本功。找到后填进代码里的常量。

### 第 3 步:发出你的第一条红外命令

```cpp
#include "M5Cardputer.h"
#include <IRremoteESP8266.h>
#include <IRsend.h>

// 查官方 pinout 文档,填入 IR LED 的 GPIO 号
const uint16_t kIrLedPin = /* 官方 pinout 中的 IR 引脚 */;

IRsend irsend(kIrLedPin);

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    irsend.begin();  // 配置发送引脚

    M5Cardputer.Display.setTextSize(2);
    // 注意:默认字体只支持 ASCII,想显示中文需另设 CJK 字体
    M5Cardputer.Display.println("Press Enter: send NEC");
}

void loop() {
    M5Cardputer.update();
    if (M5Cardputer.Keyboard.isChange() && M5Cardputer.Keyboard.isPressed()) {
        auto st = M5Cardputer.Keyboard.keysState();
        if (st.enter) {
            // 0x20DF10EF 是 LG 电视常见的电源码(NEC 格式,32 位)
            // 换成你家电视的品牌码——见第 4 步
            irsend.sendNEC(0x20DF10EF, 32);
            M5Cardputer.Display.println("Sent!");
        }
    }
}
```

`sendNEC()` 把 32 位数据翻译成引导码 + 64 段 mark/space 的时长序列。一个诚实的提醒:IRremoteESP8266 发送时**并没有用 RMT**——为了跨 ESP8266/ESP32 通用,它用校准过的 `delayMicroseconds()` 软件循环翻转引脚来生成 38kHz 载波,正是"问题三"里说的那种方案。它平时够用,是因为一帧 NEC 不到 70ms、库做了时间补偿,而且发送瞬间通常没有 WiFi 在抢 CPU;但这个脆弱性是真实存在的。想看真正的硬件做法——把时长表交给 RMT、CPU 只管编排——去做"深入一层"第 2 题,亲手用 RMT 发一帧。

### 第 4 步:找到你家电视的码

去查码,常用来源:

- **IRDB**(github.com/probonopd/irdb):按品牌/设备分类的 CSV 码库
- **LIRC remotes 数据库**(lirc-remotes.sourceforge.net):老牌 Linux 红外码库
- IRremoteESP8266 的 [SupportedProtocols 文档](https://github.com/crankyoldgit/IRremoteESP8266):看你的品牌该用 `sendNEC` 还是 `sendSamsung`、`sendSony` 等

注意:不是所有电视都用 NEC。Sony 用自家的 SIRC 协议(12/15/20 位),Samsung 用类 NEC 但引导码不同的变体。库里每种协议都有对应的 `sendXxx()` 函数,查到码后用对的函数发。

### 第 5 步:让不可见光现形

把手机相机(前置摄像头通常没有红外滤镜,效果更好)对准 Cardputer 顶部的 IR LED,按下发送——你会在屏幕上看到 LED 发出紫白色的闪光。肉眼一片漆黑,相机里灯火通明。拍段视频,这是你稍后向朋友"讲解法术"的道具。

### 第 6 步:对着电视,施法

站在电视前 2~3 米,LED 对准电视(接收头一般在屏幕下边框),按 Enter。电视关了?恭喜。没反应?依次排查:码对不对(试同品牌其他码)、协议对不对(NEC vs 品牌变体)、引脚对不对(回到第 2 步)。

## 挑战任务

**朋友还没反应过来,客厅另一头的电视已经黑屏——你手里只有一台自己写满固件的小键盘机,空气中刚飞过 32 个看不见的比特。** 做一个万能遥控器:屏幕菜单 + 键盘选台,收录电视/投影/常用设备的码。表演环节:先用手机摄像头拍 IR LED 让闪烁现形,再向朋友逐段讲解你发出的脉冲——"我不是按了个按钮,我是用光拍了一段摩斯电码:9 毫秒引导码,然后 32 个位,每个位用间隔长短表示 0 和 1。"

只给思路,代码自己写:

1. **里程碑一:数据结构先行。** 设计一个"按键条目"结构:名字(显示用)、协议类型、码值、位数。用一个数组存下你家所有设备的码。想想:不同协议要调不同的 `sendXxx()` 函数,怎么用一个字段 + `switch` 干净地分发?(提示:定义一个 `enum` 表示协议类型。)

2. **里程碑二:菜单渲染。** 用第 2 课的 sprite 离屏缓冲画一个列表菜单:当前选中项高亮,240x135 的屏幕一屏放不下就滚动。第 4 课的"输入-逻辑-渲染分离"在这里直接复用——菜单状态(选中下标、滚动偏移)是逻辑,画列表是渲染。

3. **里程碑三:键盘导航。** 用 `;` 和 `.`(Cardputer 键盘上的上下方向)移动光标,Enter 发送,可以再加数字键 1-9 作为"快捷发射位"。回忆第 3 课:用 `isChange()` 做边沿检测,别让长按变成连发 30 条。

4. **里程碑四:发射反馈。** IR 是看不见的,用户按下后要有确认感:屏幕闪一下选中项、状态栏显示"已发送 NEC 0x20DF10EF"、甚至用第 5 课的蜂鸣配个音效。把码值显示出来——表演讲解时它就是你的台词。

5. **里程碑五(加分):连发与重复码。** 音量键需要按住连续加。NEC 对"按住"有专门设计:重复帧(9ms + 2.25ms + 短脉冲),而不是把整帧重发一遍。查 IRremoteESP8266 里 `sendNEC` 的 `repeat` 参数,实现"按住音量键持续加音量"。

**验收标准:**在离电视 3 米以上处,不看说明书的朋友能用你的菜单在 10 秒内关掉电视;你能对着手机拍下的 IR 闪烁视频,准确说出引导码和数据位分别在哪。

## 深入一层

1. **示波器视角看协议。** 不用真示波器:把 IR LED 换成板上普通 GPIO 输出(或者就用发送引脚),写一段代码把你要发的 NEC 帧展开成 mark/space 时长数组打印到串口,手动核对每一段是否符合协议规格。再进一步:算一算发送 `0xFF00FF00` 和 `0x00000000` 两个码,帧的总时长差多少?(提示:1 比 0 长约一倍——NEC 帧是**变长**的。)

2. **绕过库,直接驱动 RMT。** 用 ESP-IDF 的 RMT 驱动(Arduino 框架里也能调)手写一个 NEC 发送器:自己构造"电平 + 时长"的符号数组,配置 38kHz 载波,提交给硬件。注意 RMT 驱动有新旧两代 API:Arduino core 3.x(基于 IDF 5)用 `rmt_tx` 的 `rmt_symbol_word_t`,core 2.x(基于 IDF 4.4)用旧版 `rmt_item32_t`——先查你 PlatformIO 平台带的 core 版本,再看对应版本的 ESP-IDF 文档。对比 IRremoteESP8266 的软件定时,你会真正看到"硬件掐表"意味着什么。

3. **空调码为什么长得离谱?** 电视码是 32 位,而空调(如大金、格力)一帧常常超过 100 位。因为空调遥控是**全状态发送**:每次按键都把温度、模式、风速、摆风整包发出去。看看 IRremoteESP8266 的 `IRac` 统一空调接口,想想这种设计对"遥控器和空调状态不同步"问题意味着什么。

## 检查点

1. 太阳的红外辐射比遥控器强得多,为什么不会让电视乱跳台?"38kHz"在这个故事里扮演什么角色?
2. NEC 协议里,逻辑 0 和逻辑 1 在波形上的区别是什么?地址反码和命令反码是干什么用的?
3. 为什么用 `delayMicroseconds()` 逐位生成 NEC 帧在 ESP32 上不可靠?RMT 外设的工作方式和它有什么本质区别?
4. Cardputer 为什么不能"学习"你家旧遥控器的码?你的替代工作流是什么?
5. 你按住电视遥控器的音量键不放,遥控器发的是什么?(提示:不是重复整帧。)

## 参考资料

- [M5Stack Cardputer 官方文档(pinout / 原理图)](https://docs.m5stack.com/en/core/Cardputer)
- [IRremoteESP8266 库(GitHub)](https://github.com/crankyoldgit/IRremoteESP8266) 及其 [支持协议列表](https://github.com/crankyoldgit/IRremoteESP8266/blob/master/SupportedProtocols.md)
- [SB-Projects:NEC 红外协议详解](https://www.sbprojects.net/knowledge/ir/nec.php)
- [ESP-IDF RMT 外设文档(ESP32-S3)](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-reference/peripherals/rmt.html)
- [IRDB:社区红外码数据库](https://github.com/probonopd/irdb)
- [LIRC remotes 码库](https://lirc-remotes.sourceforge.net/remotes-table.html)
