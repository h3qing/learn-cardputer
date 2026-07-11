# Cardputer 硬件冒险 · Cardputer Hardware Adventure

> 用一台 M5Stack Cardputer,从零学会硬件。一份边学边做的开源课程。
> An open-source, learn-by-building hardware course around the M5Stack Cardputer.

🌐 **网站 / Site:** [cardputer.heqinghuang.com](https://cardputer.heqinghuang.com)

## 这是什么

我买了一台 [M5Stack Cardputer](https://docs.m5stack.com/en/core/Cardputer)(ESP32-S3 掌上电脑),想借它系统地学习硬件。与其闷头学,不如把整个学习过程设计成课程开源出来:

- **`content/lessons/`** — 课程正文(Markdown)。每课深挖一个硬件子系统(SPI 显示、键盘矩阵、I2S 音频、红外、WiFi、BLE……),配原理讲解、动手实验和一个挑战作品。
- **`firmware/`** — 我自己写的每课固件代码(PlatformIO / C++)。课程只给思路和提示,代码是我作为"第一个学生"交的作业。
- **网站本身** — Next.js 静态站,也是这个项目的一部分。

## 本地运行

```bash
npm install
npm run dev    # http://localhost:3000
npm test       # 内容解析的单元测试
```

## 部署

推送到 GitHub 后在 [Vercel](https://vercel.com) 导入本仓库,零配置即可部署;在 Vercel 项目设置中绑定域名 `cardputer.heqinghuang.com`。

## 跟着学

你需要:一台 Cardputer(约 $30)、USB-C 数据线、装有 [PlatformIO](https://platformio.org) 的电脑。从第 1 课开始,别跳级 :)

发现课程里的错误(尤其是硬件细节)欢迎提 issue / PR。

## License

MIT © Heqing Huang
