# WP Styler

AI-powered Chrome extension for styling WordPress sites with natural language. Describe a change, review the generated CSS diff, and publish — all from a side panel without leaving the browser.

Supports **Claude**, **DeepSeek**, **OpenAI**, and **Ollama** (local).

---

## Installation

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked** → select the `WP Styler` folder
4. Pin the extension to your toolbar for easy access

---

## Setup

Click the **WP Styler icon** in your Chrome toolbar to open the side panel, then click **⚙ Config**.

### AI Backend

Choose from four backends:

#### Claude
1. Click **Get API Key ↗** → [platform.claude.com](https://platform.claude.com)
2. Create a key, paste it in, click **Verify API Key**
3. **Sonnet 4.6** is recommended

#### OpenAI
1. Click **Get API Key ↗** → [platform.openai.com](https://platform.openai.com)
2. Create a secret key, paste it in, click **Verify API Key**
3. **GPT-4.1 Mini** is recommended

#### DeepSeek (Least Expensive)
1. Click **Get API Key ↗** → [platform.deepseek.com](https://platform.deepseek.com)
2. Paste key in, click **Verify API Key** — **V4 Flash** recommended

#### Ollama (local / self-hosted)
1. Install [Ollama](https://ollama.com) and start with CORS enabled:
   ```
   OLLAMA_ORIGINS=* ollama serve
   ```
2. Enter your server URL (default: `http://localhost:11434`)
3. Set a **Text Model** (e.g. `llama3`) and optionally a **Vision Model** (e.g. `llava`) for screenshot/design ref support
4. Click **Test** to confirm the connection

Click **Save & Close** when done.

---

## Usage

WP Styler works alongside the **WordPress Customizer**. It reads and writes CSS directly to the Customizer's Additional CSS field.

### 1 — Open the WordPress Customizer

```
yoursite.com/wp-admin/customize.php
```

Leave this tab open. The extension targets the Customizer's Additional CSS editor.

### 2 — Open the side panel on your site

Navigate to your live site and click the **WP Styler icon**. The extension attaches to whichever tab is active.

> **Tip:** If the extension loses track of your site tab, go to **⚙ Config → Tools → Ensure This Tab is Selected**.

---

## Features

### CSS Editor

A full CodeMirror editor with syntax highlighting, line wrap toggle, inline find, and color swatches. Use **Fetch** to pull the latest CSS from the site, and **Publish** to push changes live.

**Inline AI editing** (`Ctrl+I` on any line) opens a chat widget directly in the editor — describe a change and a diff is shown inline before applying.

### AI Chat Panel

The **✦ AI** panel lives at the bottom of the CSS editor. Toggle it open to chat with the AI about the page or request CSS changes.

**Make Changes mode** (toggle in the footer) switches the AI into a CSS-editing mode — it reads your current stylesheet and generates a diff for review. When off, the AI answers questions freely without touching CSS.

**Chat sessions** — use the `+` button in the AI bar header to create new chat sessions or switch between existing ones. The `+` button is hidden when the panel is collapsed.

#### Context

Click `+` in the chat input row to attach context to your next message:

| Context | What it sends |
|---------|--------------|
| **All Page CSS** | Your full stylesheet + live DOM snapshot |
| **CSS** | Stylesheet only |
| **DOM** | Live DOM snapshot (includes classes, IDs, `data-*` and custom attributes) |
| **Take Screenshot** | Screenshot of the current page (shown as a thumbnail) |
| **Design Ref** | A reference image uploaded in Config (shown as a thumbnail) |

Screenshots and design ref images appear as visual thumbnails in the input area instead of text bubbles.

### Diff Review

When the AI generates CSS changes, they appear as an inline diff in the editor:

- **Accept / Reject** each hunk individually, or use **Accept All / Reject All**
- A backup is **automatically saved** when review completes
- Navigate between hunks with **Scroll to next**

### Backups

Backups are saved automatically whenever:
- You click **Apply Changes** in the workflow panel
- A diff review session completes (accept or reject)

**Manual backups** — click the `+` button next to **History** in the top bar to save a snapshot at any time. Manual backups are **starred** (★) and never auto-trimmed — they persist until you click **Clear All**.

Open the backup list via **History** in the top bar. Starred backups appear at the top with a gold indicator. Restoring a backup saves the current CSS first, so nothing is permanently lost.

---

## File Structure

```
WP Styler/
├── manifest.json             Chrome extension manifest (MV3)
├── background.js             Service worker — AI streaming, screenshots, storage
├── content-customizer.js     Reads/writes CodeMirror in the WordPress Customizer
├── content-site.js           DOM snapshot on live site pages
├── sidepanel.html            Side panel markup
├── sidepanel.js              UI logic
├── sidepanel.css             Styles
├── tools-presets.js          Built-in CSS presets
└── icons/                    Extension and model icons
```
