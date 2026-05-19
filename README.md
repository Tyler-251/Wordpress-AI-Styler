# Sync Styler

AI-powered Chrome extension for iterating on WordPress Additional CSS with Claude or Ollama.

## Setup

### 1. Generate icons (one-time)
```
node generate-icons.js
```

### 2. Load the extension in Chrome
1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select this folder
4. Pin the extension to your toolbar

### 3. Configure
1. Click the Sync Styler icon — the side panel opens on the right
2. Go to the **Setup** tab
3. Enter your Claude API key (or configure Ollama URL and models)
4. Enter your WordPress site URL (used to find the right tab for DOM inspection)
5. Click **Save Settings**

### 4. Install on WordPress (optional — for auto-publish)
The extension writes directly to the CodeMirror editor in the Customizer. No WordPress plugin needed. The **Auto-publish** toggle in Setup will automatically click the Publish button after each Apply.

---

## Usage

1. Open your WordPress site in one tab and the Customizer (`/wp-admin/customize.php`) in another
2. Open the Sync Styler side panel
3. **Drop a design reference** in the strip at the top (optional — a mockup or brand guide image the AI uses as a style target)
4. Switch to the **Workflow** tab
5. Navigate to whatever tab you want to capture → click **Take Screenshot**
6. Type your styling instructions → click **Generate CSS**
7. Review the CSS → click **Apply Changes**
8. Click **← Undo** to revert, or use the **Backups** tab to restore any previous version
9. For follow-up tweaks, use **Request a Revision** — the AI retains the previous context and changelist

---

## AI Backends

### Claude (default)
- Requires an [Anthropic API key](https://console.anthropic.com)
- Supports vision — screenshots and design references are sent as images
- Default model: `claude-sonnet-4-6`

### Ollama (local)
- Requires [Ollama](https://ollama.com) running locally
- Set separate **Text model** and **Vision model** in Setup
- Vision is used automatically when a screenshot or design reference is attached (if the vision model is set)
- Falls back to text-only if no vision model is configured

---

## File Structure

```
Sync Styler/
├── manifest.json           Chrome extension manifest (MV3)
├── background.js           Service worker — AI calls, screenshots, backup storage
├── content-customizer.js   Reads/writes CodeMirror in WordPress Customizer
├── content-site.js         DOM snapshot on live site pages
├── sidepanel.html          Side panel shell
├── sidepanel.js            UI logic
├── sidepanel.css           Styles
├── generate-icons.js       One-time icon generator (no deps)
└── icons/                  Generated PNG icons
```

---

## Backups

Every time you click **Apply Changes**, the previous CSS is saved automatically. Backups are stored in `chrome.storage.local` (up to 20 entries). You can browse and restore any of them from the **Backups** tab. Restoring a backup also saves the current CSS first, so nothing is ever permanently lost.
