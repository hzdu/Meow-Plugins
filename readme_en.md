[简体中文](./README.md) | English

# Meow 🐱

> This little guy doesn't just slack off — now it helps you run your daily life. Aside from not shedding fur, it's a master of calendars, bookkeeping, alarms, web doodling, and more.

A feature-rich Chrome extension (Manifest V3) integrating calendar & to-dos, financial bookkeeping, habit tracking, web doodling, a toolbox, and nearly **30 functional modules** — your all-in-one browser assistant.

---

## 📦 Feature Overview

### 📅 Schedule & Productivity
| Feature | Description |
|---------|-------------|
| **Calendar + To-Do** | Month view, daily to-do CRUD, filter by completed/incomplete |
| **Habit Check-in** | Daily habit tracking, completion percentage statistics |
| **Quit-Smoking Plan** | Daily smoking goal setting, progress bar, interval suggestions, sleep duration correlation |
| **Countdown Days** | Countdown to important dates, flip-style display |
| **Alarm Reminders** | Supports one-time/repeating alarms, Westminster chime ringtones |

### 💰 Financial Management
| Feature | Description |
|---------|-------------|
| **Ledger** | Daily income/expense records, monthly income/expense/balance summary, set beginning-of-month balance |
| **Account Relationship Graph** | Visualized financial relationship analysis |
| **Financial Planning** | Planned spending (essential/non-essential + planned income), recurring monthly tasks, completion status tracking |
| **Fixed Assets** | Manage real estate, storefronts, vehicles and other assets, rental income records |

### 🖌️ Web Tools
| Feature | Description |
|---------|-------------|
| **Web Annotation/Doodle** | Brush, text, mosaic, eraser, sticky notes, screenshot save, highlighter, toggle with shortcut `Alt+W` |
| **Read Later** | Save web pages to read-later list (shortcut `Alt+S`), supports search |
| **Stash Board** | Global clipboard history, mixed text & images, supports `Ctrl+V` to paste images |

### 🧰 Toolbox
| Feature | Description |
|---------|-------------|
| IP Address Lookup | Domestic + international dual-source |
| Real-time Oil Price / Exchange Rate | Real-time data aggregation |
| Base64 Encode/Decode | Supports text and images |
| Unit Conversion | Length, weight, bytes |
| Number Tools | Abbreviation restore, thousands separator, amount in words |
| URL / Unicode Encode/Decode | Quick conversion |
| Header Formatter / Pip to Requirements / UUID Generator | Developer utilities |

### 🧰 Server Management
| Centralized Server Info Management / Centralized Server Info Management | Ops tools |

### 🤖 AI Related
| Feature | Description |
|---------|-------------|
| **AI Prompt Management** | Categorized prompt management, supports search and filter |
| **AI Provider** | Manage AI service provider configs (OpenAI / Anthropic format), supports Base URL, API Key, Model management, import/export |
| **AI Collection** | AI sites embedded in the sidebar (Tongyi Qianwen, ChatGPT, etc.), supports custom additions |

### 🔐 Security & Data
| Feature | Description |
|---------|-------------|
| **2FA Verification Codes** | Two-step verification code management, 30-second countdown animation, secret import/export backup |
| **WebDAV Cloud Backup** | Manual/auto backup of all data to WebDAV, supports cloud restore |
| **Data Management** | Full backup export/restore, financial data export to CSV, data cleanup |

### 📊 Information Aggregation
| Feature | Description |
|---------|-------------|
| **Hot Rankings** | Aggregated hot lists from Toutiao, Douyin, Zhihu, Xiaohongshu, Baidu — five major platforms, draggable tab sorting |
| **Weather** | Real-time weather information |
| **World Clock** | Multi-city world clock (Beijing, Washington, Moscow, London, Sydney, etc.), time zone comparison |
| **Image Gallery** | Image collection management, drag / `Ctrl+V` paste to save, lightbox preview, Base64 copy |
| **Batch Scheduling** | Automatically open a group of URLs at a specified time, auto-close after 30 seconds, execution log |

---

## 🚀 Installation

### Load from Source (Developer Mode)

1. Open Chrome browser and go to `chrome://extensions`
2. Enable **Developer mode** in the top-right corner
3. Click **Load unpacked**
4. Select this project's root directory `Meow/`

No dependencies to install, zero build process — load and use immediately.

---

## ⌨️ Shortcuts

| Shortcut | Function |
|----------|----------|
| `Alt+Q` | Open/close the main popup panel |
| `Alt+W` | Toggle web annotation mode |
| `Alt+C` | Open the sidebar toolset |
| `Alt+R` | Open the large calendar view |
| `Alt+S` | Save the current page to Read Later |
| `Esc` | Close panel / exit annotation mode |
| `Ctrl+Z` | Undo in annotation mode |
| `Alt+F1` | Toggle brush tool in annotation mode |

> All shortcuts can be customized in `chrome://extensions/shortcuts`.

---

## 🧩 Tech Stack

| Category | Technology |
|----------|------------|
| **Runtime** | Chrome Extension Manifest V3 |
| **Language** | Vanilla JavaScript (ES6+), no UI framework |
| **Storage** | `chrome.storage.sync` (synced data) + `chrome.storage.local` (large capacity) |
| **Audio** | Web Audio API (Offscreen Document for ringtone playback) |
| **Icons** | Material Icons (Google Fonts CDN) |
| **Third-party Libraries** | flatpickr (date picker), lunar.min.js (lunar calendar) |

> Pure native development — no bundler, no build step, no runtime dependencies.

---

## 📂 Directory Structure

```
Meow/
├── manifest.json              # Extension config
├── popup.html                 # Main popup panel
├── sidepanel.html             # Sidebar
├── offscreen.html             # Offscreen document (audio playback)
│
├── css/                       # Style files
│   ├── popup.css
│   ├── sidepanel.css
│   ├── annotation.css
│   └── ...
│
├── js/
│   ├── background.js          # Service Worker (core scheduling)
│   ├── annotation.js          # Web annotation/doodle
│   ├── panel.js               # Injected panel control
│   ├── i18n.js                # Internationalization
│   ├── offscreen.js           # Audio playback
│   └── modules/               # Feature modules
│       ├── popup-core.js      # Popup core
│       ├── popup-calendar.js  # Calendar & to-do
│       ├── popup-finance.js   # Financial bookkeeping
│       ├── popup-habits.js    # Habit check-in
│       ├── popup-alarms.js    # Alarms & countdown
│       ├── popup-smoking.js   # Quit-smoking plan
│       ├── sp-core.js         # Sidebar core
│       ├── sp-prompts.js      # AI prompt management
│       ├── sp-tools.js        # Toolbox
│       ├── sp-hot.js          # Hot rankings
│       └── ...
│
├── images/
│   └── icon.png               # Extension icon
│
├── scripts/                   # Development helper scripts
└── 备份/                      # Historical version archive
```

---

## 🌐 Internationalization

Supports three languages, auto-switching based on browser language:

- **简体中文** (zh-CN)
- **繁體中文** (zh-TW)
- **English** (en)

---

## 💾 Data Security

- **Storage Method**: All data is stored locally in `chrome.storage`, with no upload to any third-party server
- **WebDAV Backup**: Supports configuring a self-hosted WebDAV server for cloud backup (manual/auto)
- **Full Export**: Supports one-click export of all data as a JSON file
- **Financial Export**: Supports exporting bookkeeping data as CSV

---

> **Meow** — From slacking off to running your daily life, an all-in-one browser assistant. Meow~ 🐱
