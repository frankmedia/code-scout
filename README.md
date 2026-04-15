<div align="center">
  <img src="app-icon.png" alt="Code Scout" width="128" height="128">
  
  # Code Scout
  
  ### AI-Powered Code Analysis for Local Models
  
  **A beautiful desktop app for exploring codebases with your own AI models**
  
  [![Latest Release](https://img.shields.io/github/v/release/frankmedia/code-scout?color=blue&label=Download)](https://github.com/frankmedia/code-scout/releases/latest)
  [![Platform](https://img.shields.io/badge/platform-macOS%20|%20Windows%20|%20Linux-lightgrey)]()
  
  [Download](#-download) • [Features](#-features) • [Requirements](#-requirements) • [Documentation](docs/)
  
</div>

---

## ✨ Features

- 🤖 **Local AI Models** - Works with Ollama, LM Studio, or any OpenAI-compatible API
- 🔒 **Privacy First** - Your code stays on your machine
- 🎨 **Beautiful Interface** - Modern, intuitive UI built with cutting-edge tech
- 🚀 **Lightning Fast** - Tauri-powered native performance
- 📊 **Code Intelligence** - Deep analysis and insights powered by AI
- ☁️ **Cloud Sync** - Optional account sync across devices via [llmscout.co/code-scout](https://llmscout.co/code-scout)
- 🔐 **Code Signed** - Fully signed and notarized builds (no security warnings)

## 📥 Download

### Latest Release: v0.1.0

<table>
<tr>
<td align="center" width="33%">

### 🍎 macOS

**Apple Silicon**

[Download DMG](https://github.com/frankmedia/code-scout/releases/download/v0.1.0/Code.Scout_0.1.0_aarch64.dmg)

*macOS 13+ (Ventura or later)*

</td>
<td align="center" width="33%">

### 🪟 Windows

**Pre-release Available**

[Setup EXE](https://github.com/frankmedia/code-scout/releases/download/v0.0.0-windows-ci-24460243303/Code.Scout_0.1.0_x64-setup.exe) • [MSI](https://github.com/frankmedia/code-scout/releases/download/v0.0.0-windows-ci-24460243303/Code.Scout_0.1.0_x64_en-US.msi)

*Windows 10+ (x64) - Unsigned*

</td>
<td align="center" width="33%">

### 🐧 Linux

**Pre-release Available**

[AppImage](https://github.com/frankmedia/code-scout/releases/download/v0.0.0-windows-ci-24460243303/Code.Scout_0.1.0_amd64.AppImage) • [DEB](https://github.com/frankmedia/code-scout/releases/download/v0.0.0-windows-ci-24460243303/Code.Scout_0.1.0_amd64.deb) • [RPM](https://github.com/frankmedia/code-scout/releases/download/v0.0.0-windows-ci-24460243303/Code.Scout-0.1.0-1.x86_64.rpm)

*x64 - Unsigned*

</td>
</tr>
</table>

[→ View All Releases](https://github.com/frankmedia/code-scout/releases)

## 🚀 Quick Start

### macOS Installation

1. **Download** the DMG file from the link above
2. **Open** the DMG and drag Code Scout to Applications
3. **Launch** Code Scout from your Applications folder
4. **No security warnings** - Fully signed and notarized by Apple

### Windows Installation

1. **Download** the Setup EXE or MSI from the link above
2. **Run** the installer
3. **SmartScreen warning**: Click "More info" → "Run anyway" (builds are unsigned)
4. **Launch** Code Scout from your Start menu

### Linux Installation

**AppImage:**
```bash
chmod +x Code.Scout_0.1.0_amd64.AppImage
./Code.Scout_0.1.0_amd64.AppImage
```

**DEB (Ubuntu/Debian):**
```bash
sudo dpkg -i Code.Scout_0.1.0_amd64.deb
```

**RPM (Fedora/RHEL):**
```bash
sudo rpm -i Code.Scout-0.1.0-1.x86_64.rpm
```

### First Run

1. Install a local AI model (we recommend [Ollama](https://ollama.ai))
2. Launch Code Scout
3. Optional: Create a free account at [llmscout.co/code-scout](https://llmscout.co/code-scout) to sync settings
4. Start exploring your codebase!

## 📋 Requirements

- **macOS**: 13.0+ (Ventura or later) - Apple Silicon
- **AI Model Provider**: One of the following:
  - [Ollama](https://ollama.ai) *(recommended)*
  - [LM Studio](https://lmstudio.ai)
  - Any OpenAI-compatible API endpoint
- **Memory**: 8GB RAM minimum (16GB recommended)

## 🔧 Configuration

Code Scout works with any OpenAI-compatible API. Configure your model provider in settings:

```
Default endpoint: http://localhost:11434/v1 (Ollama)
```

Compatible with:
- Ollama (local)
- LM Studio (local)
- LocalAI
- Any custom OpenAI-compatible endpoint

## 📚 What's New

### v0.1.0 (Latest)
- ✅ Register and sign in via hosted API
- ✅ Accounts created at [llmscout.co/code-scout](https://llmscout.co/code-scout) work across devices
- ✅ Signed and notarized macOS build (no Gatekeeper warnings)
- ✅ No local database required

[View Full Changelog](https://github.com/frankmedia/code-scout/releases)

## 🤝 Support & Community

- 🐛 [Report Issues](https://github.com/frankmedia/code-scout/issues)
- 💬 [Discussions](https://github.com/frankmedia/code-scout/discussions)
- 📖 [Documentation](docs/)
- 🌐 [LLM Scout](https://llmscout.co/code-scout)

## 🔐 Privacy & Security

- **Your code stays local** - Analysis happens on your machine
- **No telemetry** - We don't track your usage
- **Optional cloud features** - Account sync is opt-in only
- **Signed & notarized** - Official Apple Developer Program builds

## ⚖️ License

**Free for Non-Commercial Use**

Code Scout is free to use for personal and non-commercial purposes.

For commercial use, please [get in touch](https://llmscout.co/code-scout) to discuss licensing options.

Copyright © 2026 Frank Media. All rights reserved.

---

<div align="center">
  
**Built with ❤️ for developers who value privacy**

[Download Now](https://github.com/frankmedia/code-scout/releases/latest) • [Visit LLM Scout](https://llmscout.co/code-scout)

</div>
