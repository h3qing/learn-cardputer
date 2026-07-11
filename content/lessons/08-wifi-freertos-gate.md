---
title: 网络之门:WiFi 与藏在下面的双核 FreeRTOS
subtitle: "射频和操作系统一起现身"
order: 8
slug: "wifi-freertos-gate"
difficulty: 4
est_hours: 6
hardware:
  - "2.4GHz 片上射频与天线:SoC 的物理本质"
  - "802.11 基础:SSID / 信道 / RSSI / beacon 扫描"
  - "双核分工:WiFi 协议栈核 vs 应用核,FreeRTOS 任务与 loop() 的真实关系"
  - "TCP/IP 栈:DHCP、DNS、HTTPS 客户端与 JSON 解析(内存受限环境)"
  - "设备端 Web Server、GET/POST 路由与 mDNS(cardputer.local)"
  - "WiFi 事件回调与断线重连状态机"
project: "三连作:WiFi 热力探测器 → 桌面天气小站 → 手机弹幕服务器,验收线是断网自动重连和完整的加载/错误状态。"
summary: "首次揭开裸机幻觉:WiFi 协议栈跑在一个核、你的代码跑在另一个核,loop() 之下其实是 FreeRTOS。从 802.11 扫描到 HTTPS 抓 JSON,再反转角色开 Web 服务器让手机控制设备。"
---

## 本课目标

- [ ] 说清一次 WiFi 连接的完整过程:扫描 → 认证/关联 → DHCP 拿 IP → DNS 解析
- [ ] 理解 `loop()` 只是 FreeRTOS 里的一个任务,并能用 API 证明它跑在哪个核上
- [ ] 写出一个 HTTPS 客户端,抓取 JSON 并在内存受限环境下解析
- [ ] 在 Cardputer 上跑起 Web 服务器,手机通过 `cardputer.local` 访问
- [ ] 用 WiFi 事件回调实现断线自动重连的状态机

## 硬件原理

### 天线就在你眼皮底下

前七课我们玩的都是"有线"的世界:SPI 是几根铜线,I2S 是几根铜线。这一课的"线"是空气。ESP32-S3 芯片内部集成了完整的 2.4GHz 射频收发器(radio),天线就集成在 StampS3 模块上(具体形态和位置参考官方文档:https://docs.m5stack.com/en/core/Cardputer)——那就是它对世界喊话的"嘴"。射频信号频率是 2.4GHz,一个周期只有 0.4 纳秒,这也是为什么天线设计归硬件工程师管,而我们程序员只需要知道:**它是芯片的一部分,不是外挂模块**。WiFi 和 BLE(下一课)共用这同一套射频硬件。

### 802.11:空气中的广播站

路由器每隔约 100ms 就往空气里喊一次"我在这儿"——这叫 **beacon 帧**,里面带着 SSID(网络名)、信道(2.4GHz 频段切成编号信道,能用几号随地区法规而定:北美 1~11,欧洲和中国 1~13)等信息。你手机上看到的 WiFi 列表,就是监听 beacon 的结果。信号强度用 **RSSI** 表示,单位 dBm,是负数:-40 很强,-70 一般,-85 基本没法用。每差 3dB 功率就差一倍——这是对数刻度,后面做热力探测器时你会对它有肉体记忆。

### 裸机幻觉的破灭

现在是本课最重要的观念反转。你以为你写的是"裸机程序":`setup()` 跑一次,`loop()` 死循环。真相是:

```
        ESP32-S3 双核 (各 240MHz)
  ┌────────────────┬────────────────┐
  │   Core 0       │   Core 1       │
  │  (协议栈核)     │  (应用核)       │
  ├────────────────┼────────────────┤
  │ WiFi 任务       │ loopTask       │
  │ TCP/IP 任务     │  └─ 你的 loop()│
  │ 事件循环任务    │ (你后面自己建的  │
  │ 定时器任务      │  任务也在这)    │
  └────────────────┴────────────────┘
        ↑ FreeRTOS 调度器统一指挥 ↑
```

Arduino-ESP32 框架启动时,先启动 **FreeRTOS**(一个实时操作系统),然后创建一个叫 `loopTask` 的任务,在这个任务里调用你的 `setup()` 和 `loop()`。WiFi 协议栈——那些要求微秒级响应的 802.11 时序处理——被安排在 Core 0 上跑,你的代码默认在 Core 1。这就是为什么你的 `loop()` 里就算写了 `delay(1000)`,WiFi 也不会断:**协议栈根本不归你的循环管**。第 7 课我们为了微秒级 IR 时序求助 RMT 硬件,而 WiFi 的做法是直接给协议栈一整个核。两种思路,同一个敌人:时序抖动。

### 从无线电波到 HTTPS

连上 WiFi 只是第一层。之后 **DHCP** 向路由器要一个 IP 地址,**DNS** 把 `api.example.com` 翻译成 IP,TCP 建立连接,TLS 握手加密,最后才是 HTTP 请求。这一整套 TCP/IP 栈(lwIP)也是 FreeRTOS 任务,在后台默默干活。要留意的是内存:一次 TLS 握手要吃掉约 40KB 堆内存,而 ESP32-S3 虽有 512KB 片上 SRAM,扣掉系统和协议栈的占用后,留给你的堆通常只剩 300KB 上下(具体以 `ESP.getFreeHeap()` 实测为准),第 2 课的全屏 sprite 已经占了 64KB——从这一课开始,`ESP.getFreeHeap()` 会成为你的老朋友。

## 动手实验

### 实验 1:证明 FreeRTOS 的存在

先别连 WiFi,先抓"操作系统"的现行:

```cpp
#include "M5Cardputer.h"

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    M5Cardputer.Display.setTextSize(2);

    // xPortGetCoreID():当前代码跑在哪个核?
    M5Cardputer.Display.printf("loop core: %d\n", xPortGetCoreID());
    // 系统里已经有多少个任务在跑?(你一个都没建过!)
    M5Cardputer.Display.printf("tasks: %d\n", uxTaskGetNumberOfTasks());
    // 当前任务的名字
    M5Cardputer.Display.printf("name: %s\n", pcTaskGetName(NULL));
}

void loop() { delay(1000); }
```

**为什么**:你会看到 core 是 1、任务名是 `loopTask`、任务数远大于 1——你还没写任何多任务代码,系统里已经住了一群"房客"。裸机幻觉当场破灭。

### 实验 2:扫描空气

```cpp
#include "M5Cardputer.h"
#include <WiFi.h>

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    M5Cardputer.Display.setTextSize(1);

    WiFi.mode(WIFI_STA);           // station 模式:我是客户端
    int n = WiFi.scanNetworks();   // 阻塞扫描,逐信道监听 beacon
    for (int i = 0; i < n && i < 8; i++) {
        M5Cardputer.Display.printf("%-14.14s ch%2d %d\n",
            WiFi.SSID(i).c_str(),      // 网络名
            WiFi.channel(i),           // 信道号
            WiFi.RSSI(i));             // 信号强度 dBm
    }
}

void loop() {}
```

**为什么**:`scanNetworks()` 会在每个信道上停留一小段时间收 beacon,所以要花 2 秒左右。注意观察:你家邻居们大概率挤在 1、6、11 三个信道上(这三个互不重叠)。

### 实验 3:连接并抓取 JSON

先在 `platformio.ini` 加依赖 `bblanchon/ArduinoJson`。

```cpp
#include "M5Cardputer.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    M5Cardputer.Display.setTextSize(1);

    WiFi.begin("你的SSID", "你的密码");
    while (WiFi.status() != WL_CONNECTED) delay(200); // 等 DHCP 拿到 IP
    M5Cardputer.Display.printf("IP: %s\n", WiFi.localIP().toString().c_str());
    M5Cardputer.Display.printf("heap: %u\n", ESP.getFreeHeap()); // 记住这个数

    HTTPClient http;
    // open-meteo 免费无需 key;纬度经度换成你的城市
    // 注意:只给 URL 不给证书,库会悄悄退回"不验证服务器"模式,见"深入一层"第 3 条
    http.begin("https://api.open-meteo.com/v1/forecast"
               "?latitude=37.87&longitude=-122.27&current_weather=true");
    int code = http.GET();          // TLS 握手发生在这里,吃 ~40KB 堆
    M5Cardputer.Display.printf("HTTP %d heap: %u\n", code, ESP.getFreeHeap());

    if (code == 200) {
        JsonDocument doc;           // ArduinoJson v7 自动管理容量
        deserializeJson(doc, http.getString());
        float t = doc["current_weather"]["temperature"];
        M5Cardputer.Display.printf("Temp: %.1f C\n", t);
    }
    http.end();                     // 释放连接,堆会回来一大截
}

void loop() {}
```

**为什么**:对比 TLS 握手前后的 `getFreeHeap()`,你会亲眼看到加密的内存代价。JSON 解析用 ArduinoJson 而不是手写字符串处理,因为它专为内存受限环境设计(零拷贝、可控分配)。

### 实验 4:反转角色,当服务器

```cpp
#include "M5Cardputer.h"
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>

WebServer server(80);

void setup() {
    auto cfg = M5.config();
    M5Cardputer.begin(cfg);
    WiFi.begin("你的SSID", "你的密码");
    while (WiFi.status() != WL_CONNECTED) delay(200);

    MDNS.begin("cardputer");   // 之后手机浏览器直接访问 http://cardputer.local
    server.on("/", []() {
        server.send(200, "text/html",
            "<h1>Hello from my pocket!</h1>");
    });
    server.begin();
    M5Cardputer.Display.setTextSize(2);
    M5Cardputer.Display.println("cardputer.local");
    // IP 也显示出来,给不支持 mDNS 的手机留条后路
    M5Cardputer.Display.println(WiFi.localIP().toString());
}

void loop() {
    server.handleClient();  // 每圈处理一次挂起的 HTTP 请求,不能省
}
```

**为什么**:手机和 Cardputer 连同一个 WiFi,浏览器输入 `http://cardputer.local`——mDNS 让局域网设备不用背 IP 地址互相找到对方。(iPhone 和电脑基本都认 `.local`,但不少 Android 浏览器不支持 mDNS——这时直接输屏幕上那串 IP。)注意 `handleClient()` 必须在 `loop()` 里持续调用:这个 WebServer 库是轮询式的,请求处理发生在你的应用核上,和第 4 课的"非阻塞主循环"是同一门功夫。

## 挑战任务

今晚你的口袋电脑要连干三票:先当雷达扫出全楼的 WiFi 死角,再变成一块永远在线的桌面天气屏,最后反客为主开一台服务器——让朋友们掏出手机,把弹幕发到你手心里的屏幕上。三个作品逐级解锁,共用验收线:**断网自动重连;界面有加载中和错误状态,不许白屏死等。**

### 作品一:WiFi 热力探测器

拿着 Cardputer 满屋走,屏幕实时显示按 RSSI 排序的网络列表,找出路由器信号死角。

- 里程碑 1:循环扫描 + 按 RSSI 排序显示(提示:`scanNetworks(true)` 是异步扫描,配合 `scanComplete()` 就不会卡住屏幕刷新)
- 里程碑 2:把 dBm 映射成颜色条(强=绿,弱=红),想想对数刻度该怎么映射才符合体感
- 里程碑 3:锁定某一个 SSID,超大字显示它的实时 RSSI,走动时数字跳动——这就是你的"信号盖革计数器"

### 作品二:桌面天气小站

开机自动连 WiFi、抓天气 API、画成仪表盘,每 10 分钟刷新。

- 里程碑 1:状态机先行——`CONNECTING / FETCHING / SHOWING / ERROR` 四态,每个状态有对应画面
- 里程碑 2:解析 JSON 画仪表盘,复用第 2 课的 sprite 避免闪烁
- 里程碑 3:用 `WiFi.onEvent()` 监听掉线事件触发重连,而不是在 loop 里傻等;重连要有退避(1s、2s、4s…),别把路由器当 DDoS 目标
- 里程碑 4:拔掉路由器电源再插回,小站要能自愈——这是验收线

### 作品三:口袋弹幕服务器(反转高潮)

Cardputer 开 Web 服务器,朋友手机浏览器打开 `cardputer.local`,输入文字点发送,弹幕从你设备屏幕上飘过。

- 里程碑 1:GET `/` 返回一个带输入框的 HTML 页面(HTML 字符串就写在固件里)
- 里程碑 2:表单 POST 到 `/send`,用 `server.arg("msg")` 取出文字,先串口打印验证
- 里程碑 3:弹幕滚动动画——收到的消息进一个队列,`loop()` 里每帧移动 x 坐标绘制;想想 `handleClient()` 和渲染怎么在同一个循环里和平共处(第 4 课的 frame pacing 直接搬来用)
- 里程碑 4(炫耀模式):支持多人同时发,屏幕上多条弹幕不同颜色不同轨道齐飞

## 深入一层

1. **亲手建一个 FreeRTOS 任务**:用 `xTaskCreatePinnedToCore()` 把弹幕渲染放到独立任务里,指定跑在 Core 1。两个任务共享消息队列时会发生什么?试试 FreeRTOS 的 `xQueueSend/xQueueReceive`——这是第 11 课的预告片。
2. **抓包看 beacon**:`esp_wifi_set_promiscuous(true)` 能让射频进入混杂模式,收到信道上所有 802.11 帧的回调。数一数你家信道 6 上每秒飞过多少帧,你会重新理解"WiFi 卡"三个字。
3. **HTTPS 的信任问题**:实验 3 里只给 URL 就连上了 HTTPS,是因为 Arduino-ESP32 的 HTTPClient 在没提供证书时会自动调用 `setInsecure()`——数据仍然加密,但设备不验证对方是谁,防不了中间人攻击。正确做法:建一个 `WiFiClientSecure`,用 `setCACert()` 把服务器的根证书固定进固件,再以 `http.begin(client, url)` 发请求。验证一下:把证书改错一个字符会发生什么?

## 检查点

1. 从按下回车到浏览器显示网页,依次经过哪些步骤?(提示:beacon/扫描 → 关联 → DHCP → DNS → TCP → TLS → HTTP)
2. `loop()` 里写 `delay(5000)`,WiFi 会掉线吗?为什么?这和第 7 课 IR 发码时用 `delayMicroseconds()` 抖动的问题,本质区别在哪?
3. RSSI 从 -60 变到 -70,信号功率变成了原来的几分之一?
4. 为什么 TLS 握手前后 `ESP.getFreeHeap()` 差了几十 KB?这对你同时开 sprite 双缓冲有什么影响?
5. mDNS 解决了什么问题?没有它,朋友的手机要怎么找到你的 Cardputer?

## 参考资料

- Cardputer 官方文档与 pinout:https://docs.m5stack.com/en/core/Cardputer
- ESP-IDF WiFi Driver 文档(Arduino 层的底座):https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-guides/wifi.html
- Arduino-ESP32 WiFi / HTTPClient / WebServer 库文档:https://docs.espressif.com/projects/arduino-esp32/en/latest/libraries.html
- FreeRTOS 官方入门(任务、队列、调度):https://www.freertos.org/Documentation/RTOS_book.html
- ArduinoJson 官方文档(v7):https://arduinojson.org/
- Open-Meteo 免费天气 API:https://open-meteo.com/en/docs
