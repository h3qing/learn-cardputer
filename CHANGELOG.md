# Changelog

All notable changes to this project will be documented in this file.
Format: [MAJOR.MINOR.PATCH.MICRO] - YYYY-MM-DD

## [0.1.0.0] - 2026-07-11

### Added
- 11 节中文硬件课程(`content/lessons/`):从 Cardputer 解剖与救砖,经 SPI 显示、GPIO 键盘矩阵、I2S/PDM 音频、红外 RMT、WiFi/FreeRTOS、BLE HID、SD/I2C,到最终综合项目;每课含原理、动手实验与不给答案的挑战任务
- Next.js 16 静态课程网站:首页课程总线路线图、课程页 Markdown 渲染与代码高亮、localStorage 学习进度
- 双主题设计系统(羊皮纸/墨黑,system/light/dark 切换),对齐 heqing-blog DESIGN.md 的 Editorial register;纯 CSS 手绘 Cardputer 开机动画
- 内容完整性单元测试(vitest):frontmatter 校验、课序连续性、必备小节检查
- 项目文档:README(部署指南)、GUIDE.md(课程雏形)、firmware/ 目录约定、审校遗留事项(content/REVIEW-NOTES.md)
