# Sync Styler

AI-powered Chrome extension for styling WordPress sites with natural language. Describe a change, review the generated CSS, and publish — all from a side panel without leaving the browser.

Supports **Claude**, **DeepSeek**, **OpenAI**, and **Ollama** (local).

---

## Installation

### 1. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked** → select the `Sync Styler` folder
4. Pin the extension to your toolbar for easy access

---

## Setup

### 1. Open the side panel

Click the **Sync Styler icon** in your Chrome toolbar. The side panel opens on the right side of the browser.

### 2. Open Config

Click the **⚙ Config** button in the top-right corner of the panel.

### 3. Choose your AI backend

Select one of the four backends from the **AI Backend** toggle:

#### Claude (recommended)
1. Click **Get API Key ↗** — this opens [platform.claude.com](https://platform.claude.com)
2. Sign in, navigate to **API Keys**, and create a new key
3. Paste the key into the **API Key** field
4. Click **Verify API Key** to confirm it works
5. Choose a model — **Sonnet 4.6** is recommended for the best balance of quality and cost

#### OpenAI
1. Click **Get API Key ↗** — this opens [platform.openai.com](https://platform.openai.com)
2. Go to **API Keys** and create a new secret key
3. Paste it into the **API Key** field and click **Verify API Key**
4. Choose a model — **GPT-4.1 Mini** is recommended

#### DeepSeek
1. Click **Get API Key ↗** — this opens [platform.deepseek.com](https://platform.deepseek.com)
2. Create an API key and paste it in
3. Click **Verify API Key** — **V4 Flash** is the recommended model

#### Ollama (local / self-hosted)
1. Install [Ollama](https://ollama.com) and start it with CORS enabled:
   ```
   OLLAMA_ORIGINS=* ollama serve
   ```
2. Enter your server URL (default: `http://localhost:11434`)
3. Set a **Text Model** (e.g. `llama3`) and optionally a **Vision Model** (e.g. `llava`) for screenshot support
4. Click **Test** to confirm the connection

### 4. Save

Click **Save & Close**. You're ready to go.

---

## Usage

Sync Styler works alongside the **WordPress Customizer**. The Customizer's Additional CSS field is where the extension reads and writes styles.

### Step 1 — Open the WordPress Customizer

In your WordPress admin, go to:

```
yoursite.com/wp-admin/customize.php
```

Leave this tab open. The extension reads and writes CSS directly to the Customizer's Additional CSS editor.

### Step 2 — Open the side panel on your site

Navigate to your live site in another tab (or the Customizer preview itself). Click the **Sync Styler icon** to open the panel. The extension will attach to whichever tab is active when you open it.

> **Tip:** If you switch tabs and the extension loses track of which tab is your site, go to **⚙ Config → Tools → Ensure This Tab is Selected**.

### Step 3 — Generate CSS

Go to the **Agent** tab:

1. Type your styling instructions in the text field — e.g. *"Make the hero section background dark navy and increase the headline font size to 56px"*
2. Optionally take a **screenshot** or drag in a **design reference image** using the Context drawer
3. Click **Generate CSS**
4. The AI will stream back the CSS. Once done, click **Apply Changes** to write it to the Customizer

### Step 4 — Review and publish

After applying, the CSS is live in your Customizer preview. When you're happy:

- Click **Publish** in the Sync Styler toolbar (or the Customizer's own Publish button)
- Use **Request a Revision** to iterate — the AI retains the full conversation context

### Step 5 — Inline edits (CSS tab)

Switch to the **CSS** tab for a full editor view of your Additional CSS. You can:

- Select any block of CSS and press **Ctrl+i** (or **⌘i** on Mac) to trigger an inline AI rewrite
- Review the diff (+/− lines) before applying
- Use **Find** to search by selector or keyword, with optional AI-powered smart search

---

## Tabs

| Tab | What it does |
|-----|-------------|
| **CSS** | Full CSS editor with inline AI editing, find, and publish |
| **Chat** | Ask anything — the AI can answer questions about the page or CSS with optional DOM/screenshot context |
| **Agent** | Generate or revise full CSS rewrites with instructions |
| **Docs** | Quick-access links to CSS references and your saved docs |

---

## Status Bar

The thin bar at the bottom of the panel shows:

- **AI provider** — click to switch between Claude, OpenAI, DeepSeek, and Ollama
- **Model** — click to switch models within the current provider (hidden for Ollama)
- **Mode** — on the Agent tab, switch between **Full Rewrite** (returns the entire CSS file) and **Patch Mode** (returns only changed rules — faster and cheaper)
- **Ctrl+i / ⌘i** — reminder of the inline edit shortcut, shown on the CSS tab

---

## Backups

Every time you click **Apply Changes**, the previous CSS is saved automatically. Open **⚙ Config → View Backups** to browse and restore any previous version. Restoring also saves the current CSS first, so nothing is ever permanently lost.

---

## File Structure

```
Sync Styler/
├── manifest.json             Chrome extension manifest (MV3)
├── background.js             Service worker — AI streaming, screenshots, storage
├── content-customizer.js     Reads/writes CodeMirror in the WordPress Customizer
├── content-site.js           DOM snapshot on live site pages
├── sidepanel.html            Side panel markup
├── sidepanel.js              UI logic
├── sidepanel.css             Styles
├── tools-presets.js          Built-in CSS presets (Express Starter CSS, etc.)
└── icons/                   Extension and model icons
```
