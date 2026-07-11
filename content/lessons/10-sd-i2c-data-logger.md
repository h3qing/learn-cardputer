---
title: 背包扩容:SD 卡、SPI 共享与 I2C 生态
subtitle: "一条总线多个乘客,两根线上百个设备"
order: 10
slug: sd-i2c-data-logger
difficulty: 4
est_hours: 6
hardware:
  - "SPI 多设备共享:片选(CS)分时复用与总线争用"
  - "microSD 与 FAT 文件系统:open/write/flush 背后发生了什么"
  - "flash 磨损与写入策略:缓冲、批量写、掉电安全"
  - "I2C 协议:SDA/SCL 两线、7-bit 地址、ACK/NACK、开漏与上拉电阻"
  - "I2C 总线扫描与寄存器读写模型:读 datasheet 驱动任意 I2C 芯片的方法论"
  - "Grove 接口标准与 M5Stack Unit 生态,I2C vs SPI 全面对比"
project: "一台揣兜里跑一整天的数据记录仪:WiFi 或音量数据按时间戳写入 SD 卡 CSV,拔卡插 Mac 用 Python 画出全天曲线;有 Grove ENV 传感器的话,先用自写的 I2C 扫描仪找到它,再做温湿度趋势站。"
summary: "回收并升维第 2 课的 SPI:片选线如何让多设备共享总线、FAT 为什么让 Mac 能直接读卡、flash 磨损与掉电安全;再攻克最后一条经典总线 I2C:开漏加上拉、7 位地址、ACK 机制,用 Grove 口完成总线扫描这个嵌入式成人礼。"
---

## 本课目标

- [ ] 能解释片选(CS)线如何让屏幕和 SD 卡共用 SCLK/MOSI,以及"共享"要付出的带宽代价
- [ ] 在 SD 卡上写出一个 Mac 能直接打开的 CSV 文件,并说清 `open` / `write` / `flush` 各自发生了什么
- [ ] 说出 I2C 只用两根线就能挂上百个设备的三个关键设计:开漏输出、上拉电阻、7-bit 地址
- [ ] 亲手写一个 I2C 总线扫描仪,并理解它本质上是在"挨家挨户敲门等 ACK"
- [ ] 完成挑战:一台能连续记录一整天数据、拔卡就能在电脑上分析的口袋记录仪

## 硬件原理

### SPI 的扩容魔法:多一根 CS,多一个乘客

第 2 课里 SPI 是屏幕的专线:SCLK 打拍子,MOSI 送数据,CS 拉低表示"我在跟你说话"。现在 SD 卡也想上车怎么办?答案简单得让人意外——**时钟线和数据线大家共用,每个设备单独拉一根 CS**。谁的 CS 被拉低,谁就竖起耳朵;其他设备看到自己的 CS 是高电平,就把引脚切成高阻态装聋作哑。

```
            SCLK  ────┬──────────┬─────
            MOSI  ────┼──┬───────┼──┬──
            MISO  ────┼──┼───┬───┼──┼──
ESP32-S3              │  │   │   │  │
            CS_LCD ───┤ [屏幕 ST7789V2]
            CS_SD  ──────────────┤ [microSD]
                      (同一时刻只有一个 CS 为低)
```

代价也很直白:总线是分时的,同一瞬间只能跟一个设备说话。你在往 SD 卡狂写数据的那几毫秒里,屏幕刷新只能排队——这就是**总线争用**。第 4 课算过全屏刷新的带宽账,现在要在同一张账单上再挤进一个租客。顺带一提:Cardputer 上屏幕和 SD 卡具体是共享同一组引脚、还是各占 ESP32-S3 的一个 SPI 控制器(它有多个),请以官方原理图为准;但无论哪种接法,CS 分时的原理都一样。

### FAT:SD 卡与 Mac 的通用语

SD 卡本体只认"读写第 N 个 512 字节扇区",没有"文件"概念。让 Mac 拔卡即读的功臣是 **FAT 文件系统**——一张 1977 年设计、至今通吃所有操作系统的表格:哪些扇区属于哪个文件、目录里有什么名字。你调用 `open` 是在目录表登记,`write` 大多只是写进 RAM 缓冲,**`flush`/`close` 才真正把数据和更新后的表写回卡**。所以掉电最危险的时刻,就是缓冲里攒着还没落盘的数据时。

SD 卡内部是 NAND flash,每个块的擦写寿命有限(取决于颗粒类型,从数百次到数万次不等,消费级卡通常在低端)。逐字节频繁写入会让同一批块反复擦写,正确姿势是:**攒一批、按秒级或 KB 级批量写、定期 flush**——挑战任务里你会亲手实现这套策略。

### I2C:两根线的社交网络

SPI 靠加 CS 线扩容,设备一多,引脚就不够用。I2C 的思路截然相反:**只用两根线(SDA 数据、SCL 时钟),靠"地址"区分设备**。主机开口先广播 7-bit 地址,谁匹配谁应答——7 bit 共 128 个地址,刨去协议保留的一小段,理论上一对线能挂 112 个设备(正好对应下面扫描仪的 0x08~0x77 范围)。

它能做到多设备共线,靠的是**开漏(open-drain)+ 上拉电阻**:任何设备都只能把线往低拉,没人说话时由上拉电阻把线浮回高电平。这就像会议室规则——人人只能"举手压低",不许"强推高",于是永远不会出现两个设备一个输出高一个输出低的电气打架。

```
        VCC ──[上拉R]──┬────────┬────────┬──
        SDA ───────────┴────────┴────────┴──
        VCC ──[上拉R]──┬────────┬────────┬──
        SCL ───────────┴────────┴────────┴──
                    [主机]  [传感器A]  [传感器B]
                     (地址)  (0x44)    (0x68)
```

第 9 个时钟周期是 I2C 的灵魂:主机发完 8 bit 后松手,**被叫到地址的设备把 SDA 拉低,就是 ACK("我在")**;没人拉,线保持高,就是 NACK("查无此人")。总线扫描仪的全部原理就是:对 0x08~0x77 逐个喊名字,记下谁 ACK 了。

读写一个 I2C 芯片的通用模型:每个芯片内部是一排编号的**寄存器**,"写地址 → 写寄存器号 → 读/写数据"三步走。拿到任何一块新芯片,datasheet 里找到寄存器表,你就能驱动它——这是本课送你的万能钥匙。

Cardputer 侧面的白色 **Grove 口**就是 4 根线:VCC、GND、加两根信号线(此处配置为 I2C)。M5Stack 的整个 Unit 生态——温湿度、GPS、继电器、ToF 测距——几十种模块全靠这个口即插即用。

### I2C vs SPI 一张表

| | SPI | I2C |
|---|---|---|
| 线数 | 3 + 每设备 1 根 CS | 恒定 2 根 |
| 速度 | 几十 MHz,适合屏幕/存储 | 100kHz(标准模式)/ 400kHz(Fast Mode),适合传感器 |
| 寻址 | 硬件 CS 线 | 软件 7-bit 地址 |
| 电气 | 推挽,信号干脆 | 开漏+上拉,速度受限但可挂总线 |
| 典型场景 | 大流量:显示、SD、flash | 低速多设备:温度、IMU、RTC |

## 动手实验

### 实验 1:把字写进 SD 卡,让 Mac 读出来

新建 PlatformIO 工程(`board = m5stack-stamps3`,同第 2 课),插入一张 FAT32 格式的 microSD 卡:

```cpp
#include "M5Cardputer.h"
#include <SPI.h>
#include <SD.h>

// ⚠️ 引脚号务必对照官方 pinout 核实(docs.m5stack.com/en/core/Cardputer)
// 找到 microSD 对应的 SCK / MISO / MOSI / CS 四个 GPIO 填入:
constexpr int SD_SPI_SCK  = 40;  // 常见参考值,以官方文档为准
constexpr int SD_SPI_MISO = 39;
constexpr int SD_SPI_MOSI = 14;
constexpr int SD_SPI_CS   = 12;

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);

    // 手动初始化 SPI 总线,再把 SD 库挂上去
    SPI.begin(SD_SPI_SCK, SD_SPI_MISO, SD_SPI_MOSI, SD_SPI_CS);
    if (!SD.begin(SD_SPI_CS, SPI)) {
        M5Cardputer.Display.println("SD mount FAILED");
        return;  // 常见原因:卡没插好 / 引脚不对 / 卡是 exFAT
                 //(64GB 以上的卡出厂多为 exFAT,需重新格式化成 FAT32)
    }

    // open:在 FAT 目录表里登记(或找到)这个文件名
    File f = SD.open("/hello.csv", FILE_APPEND);
    // write:大概率只进了 RAM 缓冲,还没碰到卡
    f.printf("%lu,hello from cardputer\n", millis());
    // close 内部会 flush:缓冲落盘 + 更新 FAT 表,此刻数据才真正安全
    f.close();

    M5Cardputer.Display.println("Wrote /hello.csv");
}

void loop() {}
```

烧录运行后拔卡、插进 Mac(需要读卡器),`hello.csv` 直接双击就能打开——**没有任何驱动和转换**,这就是 FAT 作为通用语的意义。

为什么先 `SPI.begin` 再 `SD.begin`?因为 SD 库默认不知道你的板子把卡接在哪几个脚上;显式初始化让你看清"总线"和"总线上的设备"是两层东西。

### 实验 2:I2C 总线扫描仪(嵌入式成人礼)

不管手头有没有传感器,先把扫描仪写出来——有 Grove 设备就插上,没有就先看"空总线"长什么样:

```cpp
#include "M5Cardputer.h"
#include <Wire.h>

// ⚠️ Grove 口的 SDA/SCL 引脚同样以官方 pinout 为准
constexpr int GROVE_SDA = 2;   // 常见参考值,务必核实
constexpr int GROVE_SCL = 1;

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    Wire.begin(GROVE_SDA, GROVE_SCL);   // 主机模式,默认 100kHz

    M5Cardputer.Display.println("I2C scan:");
    for (uint8_t addr = 0x08; addr <= 0x77; addr++) {
        Wire.beginTransmission(addr);       // 发 START + 7-bit 地址
        uint8_t err = Wire.endTransmission(); // 0 表示收到了 ACK
        if (err == 0) {
            M5Cardputer.Display.printf("  found 0x%02X\n", addr);
        }
    }
    M5Cardputer.Display.println("done.");
}

void loop() {}
```

`beginTransmission + endTransmission` 这对组合,底层就是硬件原理里说的:发 START、喊地址、看第 9 个时钟有没有人把 SDA 拉低。插上一个 Grove Unit(比如 ENV 温湿度传感器),屏幕上跳出的那个十六进制数,就是它 datasheet 里印着的出厂地址——比如 SHT30 温湿度芯片的常见地址是 `0x44`。第一次扫出真实设备的那一刻,值得发朋友圈。

### 实验 3:感受总线争用(可选但有趣)

在 loop 里让屏幕持续播放第 4 课的某个动画,同时每秒往 SD 卡追加 1KB 数据。观察写卡瞬间动画是否有肉眼可见的顿挫,再试着把每次写入量调大到 32KB 对比。看到了顿挫,你在直接目击"分时复用"的代价;如果几乎看不出来,也别失望——可能是 Cardputer 把屏幕和 SD 卡接在了两个独立的 SPI 控制器上(此时顿挫主要来自 CPU 忙于写卡而非总线排队),去官方原理图里找答案,把"实验结果 → 硬件解释"这条链走通,比看到卡顿本身更有价值。

## 挑战任务

**做一台口袋数据记录仪**:把 Cardputer 揣兜里过完平平无奇的一天,晚上拔出 SD 卡,让 Python 把这一天画成一条曲线——几点路过 WiFi 爆炸的咖啡店、几点的会议吵到峰值,你的数据比你记得还清楚。具体要求:开机后自动开始记录,每隔固定间隔把一条带时间戳的数据写入 SD 卡 CSV;屏幕实时画出最近 N 个点的折线;回家后用几行 Python(pandas + matplotlib)出图。

数据源二选一(都学过):
- **电磁模式**:第 8 课的 WiFi 扫描,记录 `时间戳,发现的 AP 数量,最强 RSSI`
- **噪音模式**:第 6 课的麦克风,记录 `时间戳,音量均值(RMS)`

里程碑拆解:

1. **先跑通管道**:每 5 秒采一个假数据(比如 `millis()%100`)写入 CSV,拔卡验证 Mac 能读、格式正确。
2. **接入真数据源**:换成 WiFi 扫描或麦克风 RMS。注意 WiFi 扫描是阻塞的,想想放在什么节奏里合适。
3. **写入策略**(本课核心考点):不要每条数据都 `open/close`。攒 10~20 条再批量写一次、写完 `flush`;权衡一下"掉电最多丢多少条"和"卡的寿命/性能"。
4. **屏幕折线**:用第 2 课的 sprite 离屏缓冲,维护一个最近 60 个点的数组,每次采样后整帧重画。
5. **失败模式**:没插卡/写入失败时屏幕给出明确提示而不是死机;运行中拔卡再插回,程序能恢复吗?(提示:重新 `SD.begin`。)
6. **收尾**:Python 侧 `pd.read_csv` + `plot`,横轴记得把 `millis()` 换算成时分秒。

**加分项(约 5 美元的快乐)**:入手一个 Grove ENV Unit。先用你的扫描仪找出它的地址,再对照 M5Stack 文档或芯片 datasheet 读出温湿度(有现成 Arduino 库可用,但建议至少读一次寄存器表,理解库替你做了什么),把它变成第三种数据源——对着传感器呵一口气,看屏幕上的湿度曲线瞬间跳起来。

验收标准:连续记录 1 小时以上不崩溃;拔卡插 Mac 直接可读;Python 图上能讲出一个故事("下午三点我路过了咖啡店,AP 数量暴涨")。

## 深入一层

1. **上拉电阻的数值游戏**:上拉太大(如 100kΩ),SDA 从低回弹到高会变慢(RC 充电),波形边沿变"钝",高速下会误码;太小(如 100Ω),设备拉低时电流过大。查一下典型值为什么是 4.7kΩ,以及总线上挂多个设备(电容累加)时该怎么调。
2. **地址冲突怎么办**:两个相同芯片地址一样,总线上不就打架了?查查 "I2C address translator"、芯片的 ADDR 引脚,以及 TCA9548A 多路复用器各是怎么解决的。
3. **掉电安全进阶**:如果记录仪在 `flush` 进行到一半时断电,FAT 表可能损坏。了解一下日志式文件系统(如 LittleFS,用于片内 flash)为什么天生抗掉电,而 FAT 为了兼容性放弃了什么。

## 检查点

1. SPI 总线上挂了屏幕和 SD 卡,为什么两者不会"同时说话"导致电气冲突?哪根线在起裁判作用?
2. `f.write(...)` 返回成功后立刻断电,数据一定在卡上吗?为什么?哪个调用之后才算安全?
3. I2C 为什么必须用开漏输出加上拉电阻,而不能像 SPI 那样用推挽输出?
4. 你的 I2C 扫描仪判断"地址上有设备"的依据,对应总线时序上的哪一个具体动作?
5. 新买了一块没有现成库的 I2C 芯片,说出你从拿到 datasheet 到读出第一个数据的完整步骤。

## 参考资料

- [M5Stack Cardputer 官方文档与 pinout](https://docs.m5stack.com/en/core/Cardputer) — 核实 SD 卡与 Grove 口引脚的唯一权威来源
- [M5Cardputer Arduino 库](https://github.com/m5stack/M5Cardputer) — 本课示例使用的 API
- [Arduino SD 库文档](https://docs.arduino.cc/libraries/sd/) 与 ESP32 SD 示例(`arduino-esp32` 仓库 `libraries/SD`)
- [I2C-bus specification (NXP UM10204)](https://www.nxp.com/docs/en/user-guide/UM10204.pdf) — I2C 协议的原始定义,开漏与 ACK 时序图都在里面
- [M5Stack Unit 生态目录](https://docs.m5stack.com/en/products?id=unit) — 看看 Grove 口还能插什么
- SHT30 温湿度传感器 datasheet(Sensirion 官网)— 练习"读寄存器表驱动芯片"的好素材
