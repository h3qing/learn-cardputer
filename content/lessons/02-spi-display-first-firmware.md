---
title: 像素锻造:SPI 总线与你的第一个固件
subtitle: 每一个像素都是你亲手推出去的字节
order: 2
slug: spi-display-first-firmware
difficulty: 2
est_hours: 5
hardware:
  - SPI 协议:SCLK / MOSI / CS 时序与高速传输
  - ST7789V2 驱动芯片:DC 线区分命令与像素数据、显存窗口寻址
  - RGB565 像素格式与帧缓冲大小计算
  - 总线带宽推算帧率上限的方法
  - sprite 离屏缓冲与双缓冲:画在 SRAM、整帧 blit
  - 交叉编译与 PlatformIO 工具链(board = m5stack-stamps3)
project: 一块滚动弹幕电子胸牌——名字丝滑滚屏、按键换配色,还藏着一个"撕裂目击者"成就
summary: 搭好 PlatformIO 工程,理解交叉编译:在 Mac 上编出 Xtensa 机器码。看懂 SPI 四线加 DC 线如何区分命令与数据,算出 240x135 一帧多少字节、约 40MHz 下的帧率上限,并用 sprite 双缓冲消除闪烁——LCD 没有 GPU,每一帧都是你的代码在搬运。
---

## 本课目标

- [ ] 从零搭一个 PlatformIO 工程,说清楚"在 Mac 上编译出 ESP32-S3 能跑的固件"中间发生了什么
- [ ] 画出 SPI 四条线(SCLK / MOSI / CS + DC)的分工,解释 ST7789V2 怎么知道收到的是命令还是像素
- [ ] 徒手算出 240×135 @ RGB565 一帧的字节数,以及 40MHz SPI 下的理论帧率上限
- [ ] 用 M5Canvas(sprite)实现双缓冲,亲眼对比直接绘屏和整帧 blit 的区别
- [ ] 完成滚动弹幕电子胸牌,并能给朋友讲清楚它为什么不闪

## 硬件原理

### LCD 是一块"哑"像素网格

先纠正一个直觉:这块 1.14 寸屏幕不是显示器,它更像一张 240×135 格的 Excel 表。屏幕背后焊着一颗 **ST7789V2** 驱动芯片,芯片里有一块显存(GRAM),每个格子存一个像素的颜色。芯片只干一件事:把显存里的数字持续刷到液晶上。**没有 GPU,没有绘图指令,没有"画一个圆"这种操作**——你想让屏幕上出现什么,就得把对应的像素字节一个个塞进显存。谁来塞?ESP32-S3,也就是你的代码。

### 塞字节的管道:SPI

ESP32-S3 和 ST7789V2 之间的管道叫 **SPI**(Serial Peripheral Interface),第 1 课总线地图里那条"高速货运线"。核心就三根线:

```
ESP32-S3 (主机)                ST7789V2 (从机)
    SCLK  ──────────────▶  时钟:主机打拍子,一拍一位
    MOSI  ──────────────▶  数据:Master Out, Slave In
    CS    ──────────────▶  片选:拉低 = "我在跟你说话"
    DC    ──────────────▶  ST7789 特有(一根普通 GPIO,不属于 SPI 标准):命令还是数据?

SCLK  ▁▁┌─┐▁┌─┐▁┌─┐▁┌─┐▁    每个上升沿
MOSI  ══╡1╞═╡0╞═╡1╞═╡1╞═    采样 MOSI 上的一位
```

SPI 的美妙之处在于**同步**:SCLK 每走完一个时钟周期(常用的 mode 0 下是每个上升沿),从机就采样一位 MOSI。没有波特率协商,没有起止位,时钟多快数据就多快——所以它能轻松跑到几十 MHz,而 UART 跑 115200 就算体面了。屏幕这个场景基本只收不发,所以 MISO(从机回传线)在这里派不上用场(具体接线以官方原理图为准:<https://docs.m5stack.com/en/core/Cardputer>)。

那 **DC 线**(Data/Command)是干嘛的?SPI 只管运字节,不管字节的含义。ST7789V2 需要区分两种字节:"命令"(比如 `0x2A`:设置列地址窗口)和"数据"(命令的参数,或者像素本身)。DC 拉低 = 这个字节是命令,DC 拉高 = 这是数据。一次典型的画图流程:先发命令圈定一个显存矩形窗口(`CASET`/`RASET`),再发 `RAMWR` 命令,然后 DC 拉高,像素字节像传送带一样连续灌进去,芯片自动按窗口折行。这就是"显存窗口寻址"——刷全屏和刷一个 10×10 小块,用的是同一套动作。

### 一帧多重?算给你看

每个像素用 **RGB565** 格式:16 位里红 5 位、绿 6 位、蓝 5 位(绿多一位,因为人眼对绿最敏感)。于是:

```
240 × 135 像素 × 2 字节 = 64,800 字节 ≈ 63.3 KB / 帧
```

这块屏的 SPI 写时钟通常配置在 40MHz 一档(实际值以 M5GFX 库的面板配置为准),按 40MHz 算,每秒最多搬 40,000,000 位 ÷ 8 = 5 MB:

```
5,000,000 ÷ 64,800 ≈ 77 帧/秒(理论上限)
```

实际到不了 77——每帧还有命令开销、CPU 准备数据的时间。但这个数字告诉你两件事:全屏 60fps 是踮脚够得着的,而如果换成 320×240 的屏(一帧 150KB),同一条总线就只剩 33fps 了。**带宽预算是嵌入式图形的第一性原理**,第 4 课做游戏时你还会回来算这笔账。

### 为什么直接画屏会闪:双缓冲

直接往屏幕画的问题:你先 `fillScreen` 清屏、再画文字,这两步之间屏幕真实地"白过一下"。观众看到的是你**作画的过程**,而不是成品——这就是闪烁和撕裂。

解法是 **sprite(离屏缓冲)**:在 ESP32-S3 的 SRAM 里开一块 63.3KB 的画布,清屏、画字、画图全在内存里折腾(内存操作,观众看不见),最后一次性把整帧通过 SPI blit 到显存。屏幕上永远只有"完成的帧"。这招从上世纪八十年代的街机用到今天的每一块显卡,名字都没变:double buffering。

## 动手实验

### 第 1 步:建工程,理解你在编译什么

装好 VS Code + PlatformIO 插件,新建工程,把 `platformio.ini` 改成:

```ini
[env:cardputer]
platform = espressif32
board = m5stack-stamps3      ; Cardputer 的芯是 StampS3 模块
framework = arduino
lib_deps = m5stack/M5Cardputer
monitor_speed = 115200
```

**为什么是 `m5stack-stamps3`?** 第 1 课说过,Cardputer = StampS3 计算模块 + 键盘底板。编译器只关心芯片,不关心底板。

点一次编译(不用连板子)。这时发生的事叫**交叉编译**:你的 Mac 是 ARM/x86 架构,而 ESP32-S3 是 Xtensa LX7 架构,两者机器码互不相认。PlatformIO 自动下载了 `xtensa-esp32s3-elf-gcc` 这套工具链——一个跑在 Mac 上、但吐出 Xtensa 机器码的编译器。产物 `firmware.bin` 你的 Mac 根本执行不了,它只属于那颗芯片。上传时走的就是第 1 课讲过的 esptool 串口写 flash 流程。

### 第 2 步:Hello World(直接绘屏版)

```cpp
#include <M5Cardputer.h>

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);              // 初始化屏幕、键盘等,引脚配置库已封装好
    M5Cardputer.Display.setRotation(1);  // 横屏方向(官方示例同款设置)
    M5Cardputer.Display.setTextSize(2);
    M5Cardputer.Display.drawString("Hello, Cardputer!", 10, 60);
}

void loop() {}
```

编译上传,屏幕亮字。注意你没写过任何一个 GPIO 引脚号——`M5Cardputer.begin()` 里,库替你完成了 ST7789V2 的初始化命令序列(退出睡眠、设像素格式、开显示……几十条命令,全靠 DC 线在命令/数据间切换)。想看具体接线,查官方 pinout:<https://docs.m5stack.com/en/core/Cardputer>。

### 第 3 步:亲眼看见闪烁

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
    // 直接绘屏:清屏和画字之间的空白,观众全看在眼里
    M5Cardputer.Display.fillScreen(TFT_BLACK);
    M5Cardputer.Display.drawString("FLICKER!", x, 55);
    x = (x + 4) % 240;
}
```

跑起来,盯着看:文字在抖、在闪。**这不是 bug,这是物理**——每次 `fillScreen` 都是 64,800 字节实打实地压过 SPI 总线,期间屏幕就是黑的。

### 第 4 步:sprite 双缓冲,瞬间丝滑

```cpp
#include <M5Cardputer.h>

M5Canvas canvas(&M5Cardputer.Display);   // 离屏画布,挂在 Display 上
int x = 0;

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    M5Cardputer.Display.setRotation(1);
    canvas.createSprite(240, 135);       // 在 SRAM 里开 63.3KB 帧缓冲
    canvas.setTextSize(3);
}

void loop() {
    canvas.fillScreen(TFT_BLACK);        // 在内存里清屏:观众看不见
    canvas.drawString("SMOOTH!", x, 55); // 在内存里画字:观众也看不见
    canvas.pushSprite(0, 0);             // 整帧 blit:观众只看到成品
    x = (x + 4) % 240;
}
```

同样的逻辑,只是把画布从"屏幕"换成"内存",最后加一句 `pushSprite`。闪烁彻底消失。`pushSprite` 每次搬 64,800 字节——现在你知道这个数字怎么来的,也知道它为什么跑得动 60fps。

## 挑战任务

**滚动弹幕电子胸牌**:下次聚会,把 Cardputer 往胸前一挂——你的名字正以 60fps 丝滑滚过屏幕,全场第一个走过来的人就会问"这是什么,我也想要一个"。要求:文字像 LED 广告牌一样从右往左滚,滚出左边后从右边重新进场;按任意键切换配色主题(至少 3 套:背景色 + 文字色的组合)。全程零闪烁。

只给思路,代码自己写:

1. **里程碑 1 — 无限滚动**:文字 x 坐标每帧递减;用 `canvas.textWidth(文字)` 拿到文字像素宽度,当 `x < -宽度` 时把 x 重置到 240。想更讲究,让首尾相接(同一帧画两份文字)。
2. **里程碑 2 — 配色主题**:定义一个主题数组(每项含背景色、文字色),一个下标变量循环切换。检测按键先借用 `M5Cardputer.update()` + `M5Cardputer.Keyboard.isChange()` / `isPressed()`,当黑盒用——它的矩阵扫描原理是第 3 课的正菜。
3. **里程碑 3 — 观感打磨**:大字号、文字垂直居中(算一下 135 和字高的关系)、控制滚速(提示:每帧移动的像素数 × 帧率 = 滚动速度,别用 `delay` 卡死循环)。
4. **隐藏成就【撕裂目击者】**:留一个特殊按键,按住时切回"直接绘屏"模式——让朋友亲眼看弹幕从丝滑变成闪烁灾难,松手复原。然后你用一行算术收尾:"一帧 63KB,总线一秒只能过 5MB,直接画屏时你看到的就是这 63KB 在路上的样子。"这一刻,你会突然理解 1977 年的雅达利程序员——他们连帧缓冲都没有,只能追着电视的电子束逐行作画(racing the beam),而你手里有整整 63KB 的双缓冲,奢侈。

**验收标准**:滚动无跳变、切主题不闪屏、能脱稿讲出 64,800 这个数字的来历。

## 深入一层

- **实测真实帧率**:用 `millis()` 统计每秒 `pushSprite` 次数,画在屏幕角落。实测值和理论 77fps 差多少?差值去哪了?(提示:CPU 在 canvas 上画图的时间、SPI 命令开销)
- **半深度实验**:`createSprite` 前调用 `canvas.setColorDepth(8)`,帧缓冲减半(一像素 1 字节)。帧率变了吗?颜色损失肉眼可见吗?什么场景值得用这一招?
- **只搬脏的部分**:创建一个小 sprite(比如 240×40 只盖文字带),`pushSprite(0, 48)` 只更新那一条。算算带宽省了多少——这就是第 4 课"脏矩形更新"的雏形。

## 检查点

1. SPI 的 SCLK、MOSI、CS 各自负责什么?为什么屏幕这个场景不需要 MISO?
2. DC 线解决了什么问题?ST7789V2 收到 `RAMWR` 之后发生了什么?
3. 240×135 @ RGB565 一帧多少字节?40MHz SPI 下理论帧率上限约是多少?写出算式。
4. 直接绘屏为什么闪?双缓冲把"闪"消灭在了哪个环节?
5. 你 Mac 上编译出来的 `firmware.bin` 为什么在 Mac 上跑不了?

## 参考资料

- [M5Stack Cardputer 官方文档(引脚定义、原理图)](https://docs.m5stack.com/en/core/Cardputer)
- [M5Cardputer Arduino 库(GitHub)](https://github.com/m5stack/M5Cardputer)
- [M5GFX 库(M5Canvas / sprite 的实现)](https://github.com/m5stack/M5GFX)
- ST7789V2 数据手册:官网 [sitronix.com.tw](https://www.sitronix.com.tw/) 不直接提供下载,搜索 "ST7789V2 datasheet PDF" 即可找到,重点看命令表:CASET / RASET / RAMWR
- [PlatformIO ESP32 平台文档](https://docs.platformio.org/en/latest/platforms/espressif32.html)
- [ESP32-S3 技术参考手册 · SPI 章节(Espressif)](https://www.espressif.com/en/support/documents/technical-documents)
