# 审校遗留事项

多 agent 审校(2026-07)全部通过后仍需**实机/上线前人工验证**的点,做完可删对应条目。

## 需要实机验证(第一次做对应课时顺手确认)

- [ ] **全部示例代码未经真实编译**:审校只做了对照官方库源码的静态 API 核查(本机无 PlatformIO 工程)。每课第一次动手时 `pio run` 编译一遍示例,发现问题回填课文。
- [ ] **L1**:esptool v5+ 命令改为连字符形式(`read-flash`);实操若遇弃用警告,统一升级课文命令写法。
- [ ] **L3**:鬼键实验在 74HC138 推挽驱动下可能表现为按键丢失而非"第四个键",实测后回填结论;顺带确认 M5Cardputer 库是否内置消抖。
- [ ] **L7**:IR LED 的具体物理位置(课文写"顶部")拿实机对照官方产品图确认;IR 引脚号课文故意留空逼你查 pinout——网站上需标注"此代码不能直接编译"。
- [ ] **L8**:HTTPS 无证书回落行为依赖 arduino-esp32 2.x,若用 3.x 需实测;open-meteo `current_weather=true` 为旧参数,失效则改 `current=temperature_2m`。
- [ ] **L9**:`t-vk/ESP32 BLE Keyboard` 在 PlatformIO registry 收录不稳定,报错就用课文里的 GitHub 地址兜底。
- [ ] **L10**:全课程仅有的两处硬编码引脚(SD: SCK40/MISO39/MOSI14/CS12;Grove: SDA2/SCL1)上板前对照 docs.m5stack.com 核验。

## 上线前

- [ ] 人工点一遍外链(M5Launcher 仓库、M5Burner 下载页、usb.org HID 表、Espressif coexist 文档),考虑给站点加死链检查。

## 番外候选(终审建议,非缺陷)

- 电源/电池:电量读取、充电管理、deep/light sleep——可作第 11 课扩展或附录,写之前先查官方文档确认电量检测引脚。
- ESP32-S3 原生 USB OTG 有线 HID,与第 9 课 BLE HID 形成有线/无线对照。
