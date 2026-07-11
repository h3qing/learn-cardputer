---
title: 解剖神器:总线地图与不可砖之证
subtitle: 认识你的 Cardputer,刷机、刷坏、再满血复活
order: 1
slug: anatomy-and-unbrickable
difficulty: 1
est_hours: 3
hardware:
  - ESP32-S3 架构:双核 Xtensa 240MHz、8MB flash、WiFi/BLE 同芯片
  - StampS3 计算模块与键盘底板的两层结构
  - 总线鸟瞰:SPI / I2S / I2C / UART / GPIO 各自解决什么问题
  - ROM bootloader 与下载模式(G0 键),为什么设备不可能刷成砖
  - flash 分区表:bootloader / app / NVS 的布局
  - USB-CDC 串口与 esptool:刷机就是串口写 flash
  - 读官方 pinout 与原理图的方法(docs.m5stack.com)
project: 刷入 M5Launcher 变身掌上应用商店,再故意刷坏一次并用 bootloader 模式救活,dump 整块 flash 围观自己写进去的字节。
summary: 不写一行代码,先画出整机总线地图:ESP32-S3 是唯一大脑,其余全是挂在 SPI、I2S、GPIO 总线上的外设。刷入 M5Launcher 理解刷机本质,亲手刷坏再救活,从此对试错免疫。
---

## 本课目标

- [ ] 说清楚 Cardputer 里"哪块是电脑、哪些是外设",画出一张总线地图
- [ ] 理解 SPI / I2S / I2C / UART / GPIO 五种总线各自解决什么问题(概念层面,细节留给后面各课)
- [ ] 用 esptool 从命令行读出芯片信息、备份并 dump 整块 flash
- [ ] 刷入 M5Launcher,并能向朋友演示"从设备上直接下载安装游戏"
- [ ] 亲手把设备刷"坏"一次,再用 G0 键 + ROM bootloader 救活——用肌肉记忆证明它不可能变砖

## 硬件原理

### 一台电脑,拆开只有两层

把 Cardputer 后盖朝上,它其实是两块板子的三明治:

1. **StampS3 计算模块**——那块带天线的小方块,才是真正的"电脑"。上面是一颗 **ESP32-S3** 芯片:双核 Xtensa 处理器,每核 240MHz,8MB flash,WiFi 和 BLE 的射频电路直接做在同一颗芯片里。你的 MacBook 里 CPU、内存、硬盘、网卡是四个东西;在这里,它们挤在一颗指甲盖大的 SoC(System on Chip)里。
2. **键盘底板**——其余一切:56 键键盘、1.14 寸 240×135 LCD(ST7789V2 驱动)、PDM 麦克风(SPM1423)、扬声器功放(NS4168)、红外 LED、microSD 卡槽、电池、Grove 扩展口。

关键认知:**底板上没有第二个大脑**。屏幕不会自己显示,喇叭不会自己响,它们全是"哑设备",每一个都靠导线接到 ESP32-S3 的 GPIO 引脚上,听它指挥。

### 总线:芯片和外设约好的"说话方式"

芯片引脚就是一根根能输出高低电平的导线。但"拉高、拉低"太原始了,于是工程师约定了几套通信协议——这就是**总线(bus)**。Cardputer 上你会遇到五种:

| 总线 | 解决什么问题 | 本机谁在用 | 哪课深挖 |
|------|------------|-----------|---------|
| **SPI** | 快!大量数据单向猛灌 | 屏幕、SD 卡 | 第 2、10 课 |
| **I2S** | 音频流,节拍必须稳 | 扬声器、麦克风 | 第 5、6 课 |
| **GPIO** | 最原始的开/关一根线 | 键盘矩阵、红外 LED | 第 3、7 课 |
| **I2C** | 两根线挂一串低速设备 | Grove 口外接传感器 | 第 10 课 |
| **UART** | 点对点串口,和电脑聊天 | USB 调试口(本机由 ESP32-S3 内置 USB 外设模拟串口,即 USB-CDC) | 本课就用 |

用一张 ASCII 图把它钉在脑子里——这就是你的世界地图:

```
                    ┌─────────────────────────┐
                    │       ESP32-S3          │
                    │  双核 Xtensa @240MHz    │
                    │  8MB flash · WiFi · BLE │
                    └──┬───┬───┬───┬───┬──────┘
              SPI ─────┘   │   │   │   └───── UART/USB-CDC
               │          I2S GPIO I2C          │
      ┌────────┴───┐       │   │   └─Grove口   电脑(esptool)
      │            │       │   ├── 键盘矩阵(74HC138)
   LCD 屏幕     microSD    │   └── 红外 LED
  (ST7789V2)              ├── 扬声器功放(NS4168)
                           └── PDM 麦克风(SPM1423)
```

(具体哪个外设接哪号 GPIO,别背也别猜——查官方 pinout 表,方法见"动手实验"第 4 步。)

### 刷机的真相:往 flash 里抄字节

那 8MB flash 就是这台电脑的"硬盘"。它不是一整块随便放,而是按**分区表**划好的:开头是 bootloader(引导程序),接着是分区表本身,然后是 app 分区(你的程序)、NVS 分区(存 WiFi 密码之类的键值数据)等。ESP32-S3 上电后:先跑芯片内部 ROM 里固化的一小段代码 → 它去 flash 找 bootloader → bootloader 找 app 分区 → 跳进去执行。你的程序就这样活了。

**"刷机"没有任何魔法:就是通过串口,把一个 .bin 文件的字节写进 flash 的指定偏移地址。** 就这么朴素。

### 为什么它不可能变砖

重点来了。那段最初执行的 **ROM bootloader** 是在芯片出厂时**光刻进硅片**的,任何软件都改不了它。按住 **G0 键**(机身上标注 G0 的那颗按键,接在 GPIO0 上;具体位置以官方文档的按键示意图为准)再上电或复位,芯片会检测到 GPIO0 为低电平,于是不去 flash 找程序,而是进入**下载模式**:在你的电脑上出现一个 USB 串口,等着接收新固件。

推论:**无论你把 flash 里的内容糟蹋成什么样——刷错固件、刷一半拔线、写满乱码——ROM 还在,下载模式永远能进,永远能重刷。** 这台设备在软件层面上是物理不可砖的。本课压轴戏就是让你亲手验证这一点,验证过一次,以后写代码就再也没有心理包袱了。

## 动手实验

### 第 1 步:玩透出厂 demo(15 分钟)

开机,把自带固件的每个功能都点一遍:键盘测试、麦克风可视化、扬声器。玩的时候在心里对照总线地图翻译:"麦克风波形 = I2S 收 PDM 数据 + SPI 刷屏"、"按键回显 = GPIO 扫矩阵"。**你看到的一切,课程结束时你都能亲手重写。**

### 第 2 步:让电脑看见它

用 USB-C 线(要数据线,不是纯充电线)连上 Mac:

```bash
ls /dev/cu.usbmodem*
```

应该出现一个设备,比如 `/dev/cu.usbmodem1101`。这是 **USB-CDC** 虚拟串口——ESP32-S3 不需要外置 USB 转串口芯片,USB 控制器就在 SoC 里。为什么先做这步?后面所有操作都走这条串口,先确认路是通的。

### 第 3 步:用 esptool 跟 ROM bootloader 对话

```bash
pip install esptool   # 若提示 externally-managed-environment,改用 pipx install esptool

# 读芯片和 flash 信息(esptool 会自动让芯片短暂进入下载模式;
# 若失败,按住 G0 键重新插入 USB 手动进下载模式再试)
# 注:esptool v5 起命令改用连字符(flash-id、read-flash),
# 下划线旧写法目前仍兼容,只会打印一条弃用提示
esptool.py --port /dev/cu.usbmodem1101 flash_id
```

输出里找这些字眼:`Chip is ESP32-S3`、flash 大小、MAC 地址。恭喜,你刚跟固化在硅片里的 ROM 程序完成了第一次握手。再看看分区表长什么样:

```bash
# 读出 flash 偏移 0x8000 处的 3KB —— 分区表就放在这里
esptool.py --port /dev/cu.usbmodem1101 read_flash 0x8000 0xc00 ptable.bin
xxd ptable.bin | head -20
```

能看到 `nvs`、`app` 之类的 ASCII 字符串混在字节里——分区表是真实存在的字节,不是抽象概念。

### 第 4 步:备份出厂固件(安全网)

```bash
# dump 整块 8MB flash,大约需要几分钟
esptool.py --port /dev/cu.usbmodem1101 read_flash 0x0 0x800000 stock_firmware.bin
```

为什么?这是完整的出厂镜像,任何时候 `write_flash 0x0 stock_firmware.bin` 就能一键回到出厂状态。有了这张"存档",接下来怎么折腾都不怕。顺手围观一下:`xxd stock_firmware.bin | less`,开头那些字节就是 bootloader 本尊。

### 第 5 步:刷入 M5Launcher

去 m5stack.com 下载 **M5Burner**,在 Cardputer 分类里找到 **M5Launcher**,点 Burn。(它底层调用的就是你刚用过的 esptool——GUI 只是壳。)

刷完重启,Cardputer 变成了口袋应用商店:连上 WiFi 就能浏览社区固件目录,下载游戏、工具直接运行,也能从 SD 卡加载 `.bin`。装一两个社区游戏,这是你今天可以拿给朋友看的第一个成果。

### 第 6 步:读官方文档的方法(受用整个课程)

打开 <https://docs.m5stack.com/en/core/Cardputer>,找到 **PinMap / 引脚映射表**。练习:查出 LCD 的 SPI 引脚号、麦克风的 I2S 引脚号,标注到你的总线地图上。养成习惯:**引脚号永远查表,不背、不猜、不信论坛帖子。** 原理图(Schematic)PDF 也在同一页,现在看不懂没关系,第 3 课会教你顺着线路找 74HC138。

## 挑战任务

**压轴魔术:当着朋友的面,亲手"杀死"一台刚买的电脑,再把它从棺材里拉出来。** 这可能是你人生第一次故意刷坏一台设备——不写一行代码,但每一步都真刀真枪。

**需求:** 故意让 Cardputer 变成"开机黑屏的死机状态",然后只靠 G0 键和 esptool 恢复,全程录像发给朋友(或现场表演)。

**里程碑:**

1. **刷坏**——想一个让它开不了机的办法。提示:app 分区里如果是乱码,bootloader 就找不到可执行程序。`dd if=/dev/urandom of=garbage.bin bs=1k count=64` 能造一个纯垃圾文件;想想该把它写到哪个偏移地址(第 3 步读出的分区表里有答案;直接从 0x0 覆盖 bootloader 区域也行——更刺激,而且照样救得回来)。
2. **确认真的"坏"了**——重启,黑屏,毫无反应。体会一下这种以前会心跳加速的时刻。
3. **救活**——按住 G0 键插入 USB(或按住 G0 按一下 RST),验证 `/dev/cu.usbmodem*` 又出现了。想想为什么屏幕全黑、"系统"全毁,串口却还在。
4. **恢复**——用第 4 步的存档 `write_flash 0x0 stock_firmware.bin`(或重刷 M5Launcher)。开机,满血复活。
5. **验收标准**:能向朋友口头解释救活的每一步原理,尤其是"ROM 在哪里、为什么删不掉"。

**附加任务:总线地图海报。** 把本课的 ASCII 图升级成一张手绘或电子海报:中央 ESP32-S3,五种总线放射出去,每个外设标上芯片型号和(查表得来的)GPIO 号。这是你的世界地图——之后每通一关,涂亮一条分支。第 11 课结课时,它应该全亮。

## 深入一层

1. **围观自己刷的字节。** 刷完 M5Launcher 后 dump flash 开头 64KB:`read_flash 0x0 0x10000 head.bin`,再 `xxd head.bin | head`。第一个字节应该是 `0xE9`——ESP32 固件镜像的 magic byte。查一下 espressif 文档里 image header 的格式,看看你能不能读出入口地址。
2. **分区表解剖。** 对照 Espressif "Partition Tables" 文档里的二进制格式说明(参考资料有链接),把第 3 步 dump 的 `ptable.bin` 逐字段解析——手工数字节,或写个几十行的小脚本:每个分区的类型、子类型、偏移、大小。回答:M5Launcher 的 app 分区从哪里开始?
3. **思考题:什么情况下 ESP32 真的会变砖?** 提示:答案不在软件层。搜搜 eFuse——芯片里有一次性可编程的熔丝位(比如永久禁用下载模式的安全选项)。理解"软件不可砖、eFuse 慎碰"这条边界。

## 检查点

学完本课,合上电脑回答:

1. Cardputer 里哪个部件是"电脑"?屏幕、麦克风、键盘分别通过什么总线/方式接到它?
2. "刷机"用一句话说本质是什么?.bin 文件、串口、flash 偏移地址各扮演什么角色?
3. 按住 G0 键上电时,芯片内部发生了什么?为什么这保证了设备刷不成砖?
4. flash 分区表里 bootloader、app、NVS 各存什么?上电后的启动链条是怎样的?
5. 想知道某个外设接在哪号 GPIO,正确的做法是什么?(答"背下来"扣分)

## 参考资料

- Cardputer 官方文档(pinout、原理图):<https://docs.m5stack.com/en/core/Cardputer>
- esptool 官方文档:<https://docs.espressif.com/projects/esptool/en/latest/esp32s3/>
- ESP32-S3 启动流程与分区表(Espressif 官方):<https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-guides/startup.html> 与同站 "Partition Tables" 章节
- M5Burner 下载:<https://docs.m5stack.com/en/download>
- M5Launcher 项目:<https://github.com/bmorcelli/M5Stick-Launcher>
- ESP32-S3 技术规格书(datasheet):<https://www.espressif.com/en/products/socs/esp32-s3>
