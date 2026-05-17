<div align="right">
  中文 | <a href="#english">English</a>
</div>

<h1 align="center">🎭 MMD Web 渲染器</h1>

<p align="center">
  基于 Three.js 的浏览器端 MMD 模型实时渲染工具<br>
  无需安装软件，打开网页即可加载模型、动作与音乐
</p>

<p align="center">
  <a href=""><img src="https://img.shields.io/badge/在线演示-Live%20Demo-e94560?style=flat-square&logo=github" alt="Live Demo"></a>
  <img src="https://img.shields.io/badge/Three.js-r160-000000?style=flat-square&logo=three.js&logoColor=white" alt="Three.js">
  <img src="https://img.shields.io/badge/Vite-5.x-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite">
</p>

---

## ✨ 功能

- **浏览器直接渲染** — 无需本地安装 MMD，打开网页即可播放
- **拖拽上传** — 支持拖拽或点击选择模型文件夹、动作、音频等文件
- **多格式支持** — PMX 模型、VMD 动作/表情/镜头、WAV/MP3 音频
- **多模型自动检测** — 文件夹内存在多个 PMX 时自动列出供选择
- **渲染预设系统** — 内置 MMD 风格渲染，支持自定义并保存多种预设
- **实时参数调节** — 光照、背景、墙壁、Bloom 辉光、色调等均可边播边调
- **配置自动保存** — 所有调节自动存入浏览器本地，下次打开自动恢复
- **播放控制** — 播放/暂停、进度条拖拽、音频同步、FPS 显示

## 🚀 快速开始

### 本地开发

```bash
# 克隆仓库
git clone <仓库地址>
cd <项目文件夹>

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

浏览器自动打开 `http://localhost:3120`，即可开始使用。

### 构建

```bash
npm run build
```

构建产物输出至 `dist/` 目录，可直接部署到任何静态托管服务。

## 📖 使用说明

### 文件准备

| 类型 | 格式 | 是否必填 | 说明 |
|------|------|---------|------|
| 模型 | `.pmx` + 贴图文件夹 | ✅ 必填 | 上传包含 PMX 及贴图的完整文件夹 |
| 动作 | `.vmd` | ✅ 必填 | 骨骼动作数据 |
| 音乐 | `.wav` / `.mp3` | ❌ 可选 | 与动作同步播放 |
| 表情 | `.vmd` | ❌ 可选 | 面部表情动作 |
| 镜头 | `.vmd` | ❌ 可选 | 相机运镜数据 |

> **提示**：Firefox 不支持拖拽文件夹，请点击选择。

### 操作方式

| 操作 | 说明 |
|------|------|
| 左键拖拽 | 旋转视角 |
| 右键拖拽 | 平移视角 |
| 滚轮 | 缩放远近 |
| 空格键 | 播放 / 暂停 |

---

<h1 id="english">🎭 MMD Web Renderer</h1>

<p>
  A browser-based real-time MMD model renderer powered by Three.js.<br>
  No software installation required — just open the page, load your model, and play.
</p>

## Features

- **Browser Rendering** — Run MMD directly in the browser without native software
- **Drag & Drop Upload** — Support drag-and-drop or click-to-select for model folders, motions, audio, etc.
- **Multi-format Support** — PMX models, VMD motions/expressions/camera, WAV/MP3 audio
- **Auto PMX Detection** — Automatically lists multiple PMX files in a folder for selection
- **Render Presets** — Built-in MMD-style rendering with customizable and savable presets
- **Real-time Parameters** — Adjust lighting, background, wall, bloom, color grading while playing
- **Auto-save Config** — All settings are saved to localStorage and restored on next visit
- **Playback Controls** — Play/Pause, timeline scrubbing, audio sync, FPS display

## Quick Start

```bash
git clone <repo-url>
cd <project-folder>
npm install
npm run dev
```

Open `http://localhost:3120` in your browser.

## Usage

| Type | Format | Required | Note |
|------|--------|----------|------|
| Model | `.pmx` + texture folder | ✅ | Upload the complete folder containing PMX and textures |
| Motion | `.vmd` | ✅ | Bone motion data |
| Audio | `.wav` / `.mp3` | ❌ | Sync with motion |
| Expression | `.vmd` | ❌ | Facial expression motion |
| Camera | `.vmd` | ❌ | Camera motion data |

> **Tip**: Firefox does not support folder drag-and-drop; please use click-to-select.

## Controls

| Input | Action |
|-------|--------|
| Left click + drag | Rotate view |
| Right click + drag | Pan view |
| Scroll wheel | Zoom in/out |
| Spacebar | Play / Pause |

