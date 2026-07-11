---
title: 变形术:BLE HID,让 Mac 相信你是一把键盘
subtitle: "GATT、配对与标准化协议的魔法"
order: 9
slug: "ble-hid-macro-pad"
difficulty: 4
est_hours: 5
hardware:
  - "BLE vs 经典蓝牙:广播、连接、低功耗设计"
  - "GATT 协议:Service / Characteristic / Descriptor 层次"
  - "HID Profile 与报文描述符:为什么操作系统分不清它和真键盘"
  - "HID keycode 与修饰键报文格式(与第 3 课本地键扫描对照)"
  - "配对与绑定(pairing/bonding)的安全模型"
  - "同一射频硬件分时跑 WiFi + BLE 的共存机制,NimBLE 库选型"
project: "把 Cardputer 变成 Mac 认不出真假的 BLE 宏键盘:一键输出代码模板、git 命令,一键锁屏"
summary: "理解 BLE 的广播加连接低功耗模型与 GATT 的服务、特征值层次,看懂 HID over GATT 如何用标准化报文描述符让主机免驱识别;理解配对绑定的安全模型,把 HID 键码与第 3 课的本地矩阵扫描前后呼应。"
---

## 本课目标

- [ ] 能说清 BLE 与经典蓝牙的本质区别,以及"广播 → 连接"两阶段模型
- [ ] 画得出 GATT 的 Service / Characteristic / Descriptor 三层结构
- [ ] 理解 HID Report Map 为什么能让任何操作系统免驱识别你的设备
- [ ] 能手写一个 8 字节的 HID 键盘报文,解释每个字节的含义
- [ ] 完成配对绑定,理解密钥存到哪里、断电重连为什么不用重新配对

## 硬件原理

### BLE:为纽扣电池而生的另一种蓝牙

先纠正一个常见误解:BLE(Bluetooth Low Energy)不是经典蓝牙的"省电模式",而是 2010 年随蓝牙 4.0 引入的**另一套协议**,只是共用了品牌和 2.4GHz 频段。经典蓝牙为音频流设计,连接后保持持续通信,像一直开着的水管;BLE 的哲学是**绝大部分时间睡觉**:设备平时以固定间隔发一小段广播(advertising)——"我叫 Cardputer,我是个键盘,谁要连我?"——发完立刻睡。主机(你的 Mac,BLE 术语叫 Central)扫描到广播后发起连接,之后双方约定一个连接间隔,只在每个间隔的瞬间醒来交换数据。一个 BLE 键盘用纽扣电池撑一年,靠的就是这套"能睡就睡"的设计。

### GATT:数据不是流,是一棵树

连接建立后怎么传数据?经典蓝牙给你一条字节流(像 TCP),BLE 给你的却是一棵**属性树**,这套规则叫 GATT(Generic Attribute Profile):

```
外设 (Peripheral) = Cardputer
└── Service: HID 服务 (UUID 0x1812)
    ├── Characteristic: HID Information   ← 版本、国别码
    ├── Characteristic: Report Map        ← 报文描述符(灵魂所在)
    └── Characteristic: Input Report      ← 按键数据从这里发出
        └── Descriptor: CCCD              ← 主机写 1 = "订阅推送"
```

Service 是一组功能的容器,Characteristic 是一个可读/可写/可订阅的值,Descriptor 是对特征值的补充说明。每个节点都有 UUID 编号,官方标准服务用 16 位短 UUID(HID 就是 0x1812)。主机连上后先"逛一遍这棵树"(service discovery),看到 0x1812 就知道:哦,这是个 HID 设备。

关键机制是**通知(Notify)**:主机在 CCCD 描述符里写个 1,表示"这个特征值变了就推给我"。按键这种突发事件,轮询是浪费,订阅推送才是正解——这和第 3 课讨论的"轮询 vs 事件"是同一个问题在无线世界的翻版。

### Report Map:一份让所有操作系统都看懂的自我介绍

为什么 Mac、Windows、iPad 都不需要装驱动就认识你的设备?秘密在 Report Map 这个特征值里。它存着一段用 USB HID 标准语法写的**报文描述符**——一份机器可读的说明书:"我每次会发 8 字节:第 1 字节是 8 个修饰键的位图,第 2 字节保留,后 6 字节是按键的 usage code……"操作系统内置了这套语法的解析器,读完描述符就自动知道怎么解读你后续的每一包数据。标准键盘报文长这样:

```
字节:  [0]        [1]    [2]  [3]  [4]  [5]  [6]  [7]
含义:  修饰键位图  保留   键1  键2  键3  键4  键5  键6

修饰键位图: bit0=左Ctrl bit1=左Shift bit2=左Alt bit3=左Cmd(GUI)
            bit4~7 = 右侧四个修饰键
```

想打大写 "A":发 `[0x02, 0, 0x04, 0,0,0,0,0]`(左 Shift + keycode 0x04),再发全零表示松开。注意 0x04 不是 ASCII 的 'A'(0x41),而是 HID Usage Table 里的编号——"字符长什么样"是主机的事,设备只报告"哪个位置的键被按了"。回想第 3 课:你扫描矩阵得到 (行,列) 坐标,查表翻译成字符;现在整条链路拼完整了——**矩阵坐标 → HID keycode → 无线电波 → 操作系统键盘布局 → 屏幕上的字符**。你的 Cardputer 和罗技键盘走的是同一条路,操作系统当然分不清。

### 配对与绑定:第一次握手,终身免密

任何人都能嗅探 2.4GHz 空口,所以按键数据必须加密。**配对(pairing)**是双方协商出加密密钥的过程(有些键盘配对时让你输入 6 位数字,就是在防中间人;我们用的库默认走"Just Works"模式,免输码,代价是防不了中间人——安全性和便利性的经典交换);**绑定(bonding)**则是把协商好的密钥存进非易失存储——ESP32 这边存在 flash 的 NVS 分区(第 1 课分区表里见过它)。之后断电重连,双方直接掏出旧密钥加密通信,不用重演配对仪式。

最后一个工程问题:ESP32-S3 只有**一套 2.4GHz 射频**,WiFi 和 BLE 靠时间片轮流使用天线,由协议栈自动仲裁——能共存,但都会变慢。蓝牙协议栈我们选 NimBLE:它只做 BLE 不做经典蓝牙,内存占用比 ESP-IDF 自带的 Bluedroid 小得多(具体数字见参考资料里的 Espressif 官方文档)。而 ESP32-S3 的射频本来就只支持 BLE、不支持经典蓝牙,Bluedroid 那部分能力在这块芯片上纯属死重——选 NimBLE 毫无悬念。

## 动手实验

### 第 1 步:装库

PlatformIO 的 `platformio.ini` 加两个依赖:

```ini
lib_deps =
    m5stack/M5Cardputer
    t-vk/ESP32 BLE Keyboard
build_flags =
    -D USE_NIMBLE
```

`USE_NIMBLE` 让 ESP32-BLE-Keyboard 库走 NimBLE 协议栈(需要它能找到 NimBLE-Arduino,若编译报错缺头文件,把 `h2zero/NimBLE-Arduino@^1.4` 也加进 lib_deps——注意锁 1.x,2.x 改了 API,这个库跟不上)。若 PlatformIO 提示找不到 `t-vk/ESP32 BLE Keyboard`,直接换成 GitHub 地址:`https://github.com/T-vK/ESP32-BLE-Keyboard.git`。为什么用现成库?因为 Report Map 那段描述符是一堆魔法字节,库已经写好并调通了——本课先站在它肩膀上,想徒手写描述符的看"深入一层"。

### 第 2 步:最小可用键盘

```cpp
#include <M5Cardputer.h>
#include <BleKeyboard.h>

// 参数:设备名(Mac 蓝牙列表里显示的)、厂商名、电量百分比
BleKeyboard bleKeyboard("Cardputer-KB", "hhq works", 100);

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg, true);   // 第二个参数 true:启用键盘扫描(第 3 课讲过)
    M5Cardputer.Display.setTextSize(2);
    M5Cardputer.Display.println("Advertising...");
    bleKeyboard.begin();   // 建 GATT 服务树 + 开始广播
}

void loop() {
    M5Cardputer.update();  // 第 3 课的老朋友:扫一遍键盘矩阵

    // 屏幕上显示连接状态,方便调试
    static bool wasConnected = false;
    if (bleKeyboard.isConnected() != wasConnected) {
        wasConnected = bleKeyboard.isConnected();
        M5Cardputer.Display.clear();
        M5Cardputer.Display.setCursor(0, 0);
        M5Cardputer.Display.println(wasConnected ? "Connected!" : "Advertising...");
    }

    if (bleKeyboard.isConnected() && M5Cardputer.Keyboard.isChange()) {
        if (M5Cardputer.Keyboard.isPressed()) {
            auto st = M5Cardputer.Keyboard.keysState();
            for (char c : st.word) {
                bleKeyboard.print(c);      // 库把字符翻译成 HID 报文发出去
            }
            if (st.enter) bleKeyboard.write(KEY_RETURN);
            if (st.del)   bleKeyboard.write(KEY_BACKSPACE);
        }
    }
    delay(10);
}
```

### 第 3 步:配对并观察

刷入后打开 Mac 的系统设置 → 蓝牙,应该能看到 "Cardputer-KB",点连接。macOS 可能弹出键盘设置助理(它以为你接了把新买的实体键盘——这本身就是本课最好的验收证明)。打开任意文本编辑器,在 Cardputer 上敲字,字符出现在 Mac 屏幕上。

再做两个观察实验,别跳过:

1. **看清广播与连接两阶段**:连接成功后,用手机装个 nRF Connect(免费),扫描——你会发现 Cardputer 消失了。因为 BLE 外设一旦被连接,默认就停止广播。断开 Mac 蓝牙,它又出现了。
2. **验证绑定**:给 Cardputer 断电重启,不碰 Mac 任何设置,几秒内自动重连。密钥在 NVS 里,配对仪式只需要一次。

### 第 4 步(可选):用 nRF Connect 逛 GATT 树

先解除 Mac 配对,用 nRF Connect 连接 Cardputer,展开服务列表:找找 UUID 0x1812(HID)、0x180F(Battery)。原理小节里那棵树,现在就在你手机屏幕上。

## 挑战任务

**需求**:Mac 已经把你的 Cardputer 当成正经键盘供起来了——现在把这份信任兑换成超能力:升级为**宏键盘(macro pad)**,按住 Fn(或你自定的前缀键)+ 数字键,一键向 Mac 注入预设内容:

- Fn+1:输出你的邮箱地址
- Fn+2:输出一段代码模板(多行,含换行)
- Fn+3:输出 `git add -A && git commit -m ""` 并把光标停在引号中间(提示:发完字符串再发一次左方向键)
- Fn+L:锁屏(Mac 快捷键 Ctrl+Cmd+Q,提示:库有 `press()`/`release()` 可以组合修饰键,`KEY_LEFT_CTRL`、`KEY_LEFT_GUI` 这些常量在库头文件里)
- 屏幕显示当前宏列表和连接状态,让它看起来像个正经产品

**里程碑**:

1. 先让 Fn 组合键被正确识别且**不透传**(Fn+1 不能同时把 '1' 发出去)——想想第 3 课的按键状态机怎么改
2. 实现单行文本宏,再攻多行(想想:HID 报文里根本没有 '\n' 这个字符,只有 Return 这个键——直接 print 一个带 '\n' 的字符串试试,再翻库源码看它替你做了什么翻译)
3. 实现修饰键组合宏(锁屏),注意 press 之后必须 releaseAll,否则 Mac 会以为你一直按着 Cmd
4. 把宏定义抽成一张表(结构体数组),加宏就是加一行数据——为第 11 课的配置持久化留好接口
5. 终极验收:带去办公室,让同事在不知情的情况下用它打一行字,然后告诉他这键盘是你写的

## 深入一层

- **徒手写 Report Map**:不用 BleKeyboard 库,直接用 NimBLE-Arduino 自建 HID 服务,把报文描述符一个字节一个字节写出来(对照 USB HID Usage Tables 文档)。加一个 Consumer Control 报文,让 Cardputer 能控制 Mac 的音量和播放暂停——你会真正理解"描述符即协议"。
- **6 键上限(6-Key Rollover)**:标准报文只有 6 个 keycode 槽位,同时按下第 7 个键会发生什么?写代码试试,然后对照第 3 课的鬼键问题想想:一个是矩阵电气层的限制,一个是报文格式层的限制,层次完全不同。
- **共存压力测试**:同时跑第 8 课的 Web Server 和本课的 BLE 键盘,测量按键延迟有没有肉眼可感的变化;再用 `ESP.getFreeHeap()` 对比开关 WiFi 时的内存差,体会为什么选 NimBLE。

## 检查点

1. BLE 外设的"广播"和"连接"分别解决什么问题?为什么被连接后默认停止广播?
2. Service、Characteristic、Descriptor 三者是什么关系?CCCD 是干什么用的?
3. 操作系统没装任何驱动,为什么能正确解读你发的每一包按键数据?
4. 大写 "A" 的 HID 报文是哪 8 个字节?为什么 keycode 不直接用 ASCII?
5. 配对和绑定的区别是什么?Cardputer 这边的密钥存在哪里?

## 参考资料

- M5Stack Cardputer 官方文档与 pinout:<https://docs.m5stack.com/en/core/Cardputer>
- ESP32-BLE-Keyboard 库(T-vK):<https://github.com/T-vK/ESP32-BLE-Keyboard>
- NimBLE-Arduino:<https://github.com/h2zero/NimBLE-Arduino>
- Bluetooth SIG — HID over GATT Profile (HOGP) 规范:<https://www.bluetooth.com/specifications/specs/>
- USB HID Usage Tables(keycode 权威出处):<https://www.usb.org/document-library/hid-usage-tables-15>
- Espressif ESP32-S3 蓝牙文档(含 WiFi/BLE 共存):<https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-guides/coexist.html>
- M5Cardputer Arduino 库:<https://github.com/m5stack/M5Cardputer>
