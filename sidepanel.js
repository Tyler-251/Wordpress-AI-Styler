// Sync Styler — Side Panel UI

// Hard-coded model pricing (per 1M tokens)
const CLAUDE_MODELS = [
  { id: 'claude-haiku-4-5',  label: 'Haiku 4.5',  inputPer1M: 1.00, outputPer1M: 5.00  },
  { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5', inputPer1M: 3.00, outputPer1M: 15.00 },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', inputPer1M: 3.00, outputPer1M: 15.00 },
  { id: 'claude-opus-4-5',   label: 'Opus 4.5',   inputPer1M: 5.00, outputPer1M: 25.00 },
  { id: 'claude-opus-4-6',   label: 'Opus 4.6',   inputPer1M: 5.00, outputPer1M: 25.00 },
  { id: 'claude-opus-4-7',   label: 'Opus 4.7',   inputPer1M: 5.00, outputPer1M: 25.00 },
];

const DEEPSEEK_MODELS = [
  { id: 'deepseek-v4-flash', label: 'V4 Flash', inputPer1M: 0.14,  outputPer1M: 0.28 },
  { id: 'deepseek-v4-pro',   label: 'V4 Pro',   inputPer1M: 0.435, outputPer1M: 0.87 },
];



const state = {
  screenshotDataUrl: null,
  screenshotTime: null,
  designRefDataUrl: null,
  ctxDrawerOpen: false,
  originalCss: null,
  lastGeneratedCss: null,
  patchPreview: null,
  isFullRewrite: false,
  cssGenerationMode: 'full',  // 'full' | 'patch' — what mode was used for last generation
  viewingFull: false,
  generatePort: null,
  stopping: false,
  changelist: [],
  messageHistory: [],
  applied: false,
  lastInstructions: '',
  scopeMode: 'all',           // 'all' | '1' | '2' | '3' | '4' | '5'
  chatHistory: [],
  chatContextItems: new Set(), // active context bubbles: 'dom' | 'css' | 'screenshot' | 'designref'
  cssContextChars: null,
  siteTabId: null,
  siteTabTitle: null,
};

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // Assign the tab the panel was opened on as the site tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.id) {
      const url = tab.url || '';
      const isSystem = url.startsWith('chrome-extension://') || url.startsWith('chrome://') || url.startsWith('about:') || url.startsWith('edge://');
      if (!isSystem) {
        state.siteTabId    = tab.id;
        state.siteTabTitle = tab.title || 'Site Tab';
      }
    }
  } catch (_) {}

  await loadSettings();
  await loadDesignRef();
  setupContextDrawer();
  setupMainTabs();
  setupStatusBar();
  updateStatusBarMode('css'); // CSS is the default active tab
  setupSettings();
  setupSetupTab();
  setupWorkflowTab();
  setupScopeButtons();
  setupHelper();
  setupCssIde();
  loadCssIde();
  setupDocsTab();
  setupTabMismatch();
  listenForTabChanges();
}

// ─── Messaging ────────────────────────────────────────────────────────────────

function send(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, resp => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (resp && resp.error) return reject(new Error(resp.error));
      resolve(resp);
    });
  });
}

// ─── Main Tabs ────────────────────────────────────────────────────────────────

function setupMainTabs() {
  document.querySelectorAll('.main-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      document.querySelectorAll('.main-tab').forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('workflowPanel').classList.toggle('hidden', panel !== 'agent');
      document.getElementById('helperPanel').classList.toggle('hidden', panel !== 'helper');
      document.getElementById('cssIdePanel').classList.toggle('hidden', panel !== 'css');
      document.getElementById('docsPanel').classList.toggle('hidden', panel !== 'docs');
      document.getElementById('newChat').classList.toggle('hidden', panel !== 'helper');
      document.getElementById('ctxDrawer').classList.toggle('hidden', panel === 'css' || panel === 'docs');
      updateStatusBarMode(panel);
      if (panel === 'css') loadCssIde();
    });
  });

  document.getElementById('newChat').addEventListener('click', () => {
    state.chatHistory = [];
    state.chatContextItems.clear();
    document.getElementById('chatMessages').innerHTML = '';
    document.getElementById('chatInput').value = '';
    document.getElementById('chatInput').style.height = 'auto';
    renderChatContextBubbles();
    updateTokenCounter();
  });
}

// ─── Context Drawer ───────────────────────────────────────────────────────────

async function loadDesignRef() {
  try {
    const { dataUrl } = await send({ type: 'GET_DESIGN_REF' });
    state.designRefDataUrl = dataUrl || null;
  } catch (_) {}
}

function setupContextDrawer() {
  const toggle = document.getElementById('ctxDrawerToggle');
  const body   = document.getElementById('ctxDrawerBody');

  toggle.addEventListener('click', () => {
    state.ctxDrawerOpen = !state.ctxDrawerOpen;
    body.classList.toggle('hidden', !state.ctxDrawerOpen);
    document.getElementById('ctxDrawerChevron').style.transform =
      state.ctxDrawerOpen ? 'rotate(180deg)' : '';
    renderCtxDrawerSummary();
  });

  // Screenshot
  document.getElementById('takeScreenshot').addEventListener('click', handleTakeScreenshot);
  document.getElementById('clearScreenshot').addEventListener('click', () => {
    state.screenshotDataUrl = null;
    state.screenshotTime = null;
    document.getElementById('ctxScreenshotPreview').classList.add('hidden');
    state.chatContextItems.delete('screenshot');
    renderChatContextBubbles();
    renderCtxDrawerSummary();
  });

  // Design ref
  const input = document.getElementById('designRefInput');
  document.getElementById('designRefBrowse').addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files[0]) loadDesignRefFile(input.files[0]); input.value = ''; });

  // Drag and drop on the design ref row
  const row = document.getElementById('ctxDrawerDesignRefRow');
  row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('drag-over'); });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', e => {
    e.preventDefault();
    row.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) loadDesignRefFile(e.dataTransfer.files[0]);
  });

  document.getElementById('designRefClear').addEventListener('click', async () => {
    state.designRefDataUrl = null;
    document.getElementById('ctxDesignRefPreview').classList.add('hidden');
    document.getElementById('ctxDesignRefEmpty').classList.remove('hidden');
    state.chatContextItems.delete('designref');
    renderChatContextBubbles();
    renderCtxDrawerSummary();
    try { await send({ type: 'CLEAR_DESIGN_REF' }); } catch (_) {}
  });

  renderContextDrawer();
}

function loadDesignRefFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = async e => {
    state.designRefDataUrl = e.target.result;
    renderContextDrawer();
    renderCtxDrawerSummary();
    try { await send({ type: 'SAVE_DESIGN_REF', dataUrl: state.designRefDataUrl }); } catch (_) {}
  };
  reader.readAsDataURL(file);
}

function renderContextDrawer() {
  const hasScreenshot = !!state.screenshotDataUrl;
  const hasDesignRef  = !!state.designRefDataUrl;

  // Screenshot preview
  const ssPrev = document.getElementById('ctxScreenshotPreview');
  if (hasScreenshot) {
    document.getElementById('screenshotImg').src = state.screenshotDataUrl;
    document.getElementById('screenshotTime').textContent =
      state.screenshotTime ? state.screenshotTime.toLocaleTimeString() : '';
    ssPrev.classList.remove('hidden');
  } else {
    ssPrev.classList.add('hidden');
  }

  // Design ref preview
  const drEmpty = document.getElementById('ctxDesignRefEmpty');
  const drPrev  = document.getElementById('ctxDesignRefPreview');
  if (hasDesignRef) {
    document.getElementById('designRefThumb').src = state.designRefDataUrl;
    drPrev.classList.remove('hidden');
    drEmpty.classList.add('hidden');
  } else {
    drPrev.classList.add('hidden');
    drEmpty.classList.remove('hidden');
  }
}

function renderCtxDrawerSummary() {
  const parts = [];
  if (state.screenshotDataUrl) parts.push('Screenshot');
  if (state.designRefDataUrl)  parts.push('Design Ref');
  document.getElementById('ctxDrawerSummary').textContent = parts.join(' · ');
}

async function handleTakeScreenshot() {
  const btn = document.getElementById('takeScreenshot');
  setLoading(btn, true, 'Capturing…');
  try {
    const { dataUrl } = await send({ type: 'TAKE_SCREENSHOT' });
    state.screenshotDataUrl = dataUrl;
    state.screenshotTime = new Date();
    renderContextDrawer();
    renderCtxDrawerSummary();
    // Auto-open drawer to confirm capture
    if (!state.ctxDrawerOpen) {
      state.ctxDrawerOpen = true;
      document.getElementById('ctxDrawerBody').classList.remove('hidden');
      document.getElementById('ctxDrawerChevron').style.transform = 'rotate(180deg)';
    }
  } catch (e) {
    showError(e.message);
  } finally {
    setLoading(btn, false, 'Take Screenshot');
  }
}

// ─── Helper (Chat) ────────────────────────────────────────────────────────────

function setupHelper() {
  const input   = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSend');

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    updateTokenCounter();
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSend();
    }
  });

  sendBtn.addEventListener('click', handleChatSend);

  // Delegated copy button handler (inline onclick blocked by MV3 CSP)
  document.getElementById('chatMessages').addEventListener('click', e => {
    const btn = e.target.closest('.chat-code-copy');
    if (!btn) return;
    const code = btn.closest('.chat-code-wrap')?.querySelector('code')?.textContent ?? '';
    navigator.clipboard.writeText(code).then(() => {
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
    }).catch(() => {});
  });

  // Context "+" dropdown
  const addBtn   = document.getElementById('ctxAddBtn');
  const dropdown = document.getElementById('ctxDropdown');

  addBtn.addEventListener('click', e => {
    e.stopPropagation();
    refreshCtxDropdownOptions();
    dropdown.classList.toggle('hidden');
  });

  document.addEventListener('click', () => dropdown.classList.add('hidden'));

  document.querySelectorAll('.ctx-opt').forEach(opt => {
    opt.addEventListener('click', e => {
      e.stopPropagation();
      const ctx = opt.dataset.ctx;
      if (ctx === 'css' && !state.chatContextItems.has('css')) {
        // Prefetch char count
        state.cssContextChars = null;
        updateTokenCounter();
        send({ type: 'GET_CSS_CHARS' }).then(r => {
          state.cssContextChars = r.chars ?? 0;
          updateTokenCounter();
        }).catch(() => { state.cssContextChars = 0; });
      }
      state.chatContextItems.add(ctx);
      dropdown.classList.add('hidden');
      renderChatContextBubbles();
      updateTokenCounter();
    });
  });

  updateTokenCounter();
}

function refreshCtxDropdownOptions() {
  document.querySelectorAll('.ctx-opt').forEach(opt => {
    const ctx = opt.dataset.ctx;
    const alreadyAdded = state.chatContextItems.has(ctx);
    const unavailable =
      (ctx === 'screenshot' && !state.screenshotDataUrl) ||
      (ctx === 'designref'  && !state.designRefDataUrl);
    opt.disabled = alreadyAdded || unavailable;
    opt.style.opacity = (alreadyAdded || unavailable) ? '0.4' : '';
  });
}

function renderChatContextBubbles() {
  const container = document.getElementById('ctxBubbles');
  container.innerHTML = '';

  const labels = { dom: 'DOM', css: 'CSS', screenshot: 'Screenshot', designref: 'Design Ref' };

  for (const ctx of state.chatContextItems) {
    const bubble = document.createElement('span');
    bubble.className = 'ctx-bubble';
    bubble.innerHTML = `${labels[ctx] || ctx}<button class="ctx-bubble-remove" title="Remove">×</button>`;
    bubble.querySelector('.ctx-bubble-remove').addEventListener('click', () => {
      state.chatContextItems.delete(ctx);
      if (ctx === 'css') state.cssContextChars = null;
      renderChatContextBubbles();
      updateTokenCounter();
    });
    container.appendChild(bubble);
  }

  container.classList.toggle('hidden', state.chatContextItems.size === 0);
  updateTokenCounter();
}

function updateTokenCounter() {
  const el = document.getElementById('chatTokenCount');
  if (!el) return;

  let chars = 0;
  for (const m of state.chatHistory) {
    const c = m.content;
    chars += typeof c === 'string' ? c.length : JSON.stringify(c).length;
  }
  chars += document.getElementById('chatInput').value.length;

  const items = state.chatContextItems;
  if (items.has('dom'))        chars += 12000;
  if (items.has('screenshot')) chars += 50000;
  if (items.has('designref'))  chars += 50000;
  if (items.has('css')) {
    if (state.cssContextChars === null) { el.textContent = '~… tokens'; return; }
    chars += state.cssContextChars;
  }

  const tokens = Math.ceil(chars / 4);
  const display = tokens >= 1000 ? (tokens / 1000).toFixed(1) + 'k' : String(tokens);
  el.textContent = `~${display} tokens`;
}

function appendChatMemo(text) {
  const el = document.createElement('div');
  el.className = 'chat-memo';
  el.textContent = text;
  document.getElementById('chatMessages').appendChild(el);
  el.scrollIntoView({ block: 'end' });
  return el;
}

async function handleChatSend() {
  const input = document.getElementById('chatInput');
  const text  = input.value.trim();
  if (!text) return;

  const sendBtn = document.getElementById('chatSend');
  input.value = '';
  input.style.height = 'auto';
  sendBtn.disabled = true;

  // Snapshot the active context items, then clear them
  const activeCtx = new Set(state.chatContextItems);
  state.chatContextItems.clear();
  state.cssContextChars = null;
  renderChatContextBubbles();
  updateTokenCounter();

  appendChatMessage('user', text);
  const assistantEl = appendChatMessage('assistant', '');
  assistantEl.classList.add('streaming');
  assistantEl.innerHTML = '<span class="chat-thinking">Uploading…</span>';

  let buffer = '';
  let chatPhase = 'uploading'; // 'uploading' | 'thinking' | 'generating'
  const port = chrome.runtime.connect({ name: 'chat' });

  port.onMessage.addListener(msg => {
    if (msg.type === 'CHAT_CONTEXT_INJECTED') {
      const memo = appendChatMemo(`↳ context: ${msg.note}`);
      assistantEl.before(memo);
    } else if (msg.type === 'CHAT_DEBUG') {
      const note = document.createElement('div');
      note.className = 'debug-note';
      note.textContent = msg.text;
      assistantEl.before(note);
    } else if (msg.type === 'CHAT_CHUNK') {
      buffer += msg.text;
      if (chatPhase === 'uploading') chatPhase = 'thinking';

      const thinking = isThinking(buffer);
      const content  = extractThought(buffer);

      if (thinking) {
        assistantEl.innerHTML = `<span class="chat-thinking">Thinking… (${buffer.length} chars)</span>`;
      } else {
        if (chatPhase !== 'generating') chatPhase = 'generating';
        if (!content.trim()) {
          // Content extracting but not yet renderable — show Generating status
          assistantEl.innerHTML = `<span class="chat-thinking">Generating… (${buffer.length} chars)</span>`;
        } else {
          assistantEl.innerHTML = renderChatMarkdown(content);
        }
      }
      assistantEl.scrollIntoView({ block: 'end' });
    } else if (msg.type === 'CHAT_DONE') {
      assistantEl.classList.remove('streaming');
      state.chatHistory = msg.history;
      sendBtn.disabled = false;
      if (msg.inputTokens || msg.outputTokens) {
        const cost = calcCost(msg.inputTokens, msg.outputTokens);
        const usage = document.createElement('div');
        usage.className = 'chat-token-usage';
        usage.textContent = `↑ ${fmtTokens(msg.inputTokens)} · ↓ ${fmtTokens(msg.outputTokens)}${fmtCost(cost)}`;
        assistantEl.appendChild(usage);
      }
      updateTokenCounter();
    } else if (msg.type === 'CHAT_ERROR') {
      assistantEl.textContent = `Error: ${msg.error}`;
      assistantEl.classList.remove('streaming');
      assistantEl.style.color = 'var(--danger)';
      sendBtn.disabled = false;
    }
  });

  port.onDisconnect.addListener(() => {
    assistantEl.classList.remove('streaming');
    sendBtn.disabled = false;
  });

  port.postMessage({
    type: 'CHAT_MESSAGE',
    message: text,
    history: state.chatHistory,
    siteTabId: state.siteTabId ?? null,
    includeDom: activeCtx.has('dom'),
    includeExistingCss: activeCtx.has('css'),
    screenshotDataUrl: activeCtx.has('screenshot') ? state.screenshotDataUrl : null,
    designRefDataUrl:  activeCtx.has('designref')  ? state.designRefDataUrl  : null,
  });
}

function isThinking(raw) {
  return raw.lastIndexOf('<think>') > raw.lastIndexOf('</think>');
}

function extractThought(raw) {
  return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderChatMarkdown(text) {
  // 1. Pull out fenced code blocks so their contents are never processed
  const codeBlocks = [];
  text = text.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang || '', code: code.replace(/\n$/, '') });
    return `\x00CODE${idx}\x00`;
  });

  // 2. Walk lines and emit block-level HTML
  const lines = text.split('\n');
  const out   = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block placeholder
    const codeMatch = line.match(/^\x00CODE(\d+)\x00$/);
    if (codeMatch) {
      const { lang, code } = codeBlocks[parseInt(codeMatch[1], 10)];
      out.push(
        `<div class="chat-code-wrap">` +
        `<div class="chat-code-header">` +
        `<span class="chat-code-lang">${escapeHtml(lang)}</span>` +
        `<button class="chat-code-copy" title="Copy">Copy</button>` +
        `</div>` +
        `<pre class="chat-code-block"><code>${escapeHtml(code)}</code></pre>` +
        `</div>`
      );
      i++; continue;
    }

    // Horizontal rule
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr class="chat-hr">');
      i++; continue;
    }

    // ATX heading
    const headMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headMatch) {
      const lvl = headMatch[1].length;
      out.push(`<h${lvl} class="chat-h${lvl}">${inlineMarkdown(headMatch[2])}</h${lvl}>`);
      i++; continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const bqLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        bqLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote class="chat-blockquote">${renderChatMarkdown(bqLines.join('\n'))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^[-*+]\s/, ''))}</li>`);
        i++;
      }
      out.push(`<ul class="chat-ul">${items.join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol class="chat-ol">${items.join('')}</ol>`);
      continue;
    }

    // Blank line — paragraph break
    if (line.trim() === '') { i++; continue; }

    // Paragraph: collect contiguous non-special lines
    const paraLines = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === '')            break;
      if (/^\x00CODE\d+\x00$/.test(l)) break;
      if (/^(#{1,6})\s/.test(l))      break;
      if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(l)) break;
      if (/^>\s?/.test(l))            break;
      if (/^[-*+]\s/.test(l))         break;
      if (/^\d+\.\s/.test(l))         break;
      paraLines.push(inlineMarkdown(l));
      i++;
    }
    if (paraLines.length) out.push(`<p class="chat-p">${paraLines.join('<br>')}</p>`);
  }

  return out.join('');
}

function inlineMarkdown(text) {
  // Stash inline code first so its contents are untouched
  const codes = [];
  text = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(escapeHtml(c));
    return `\x01IC${codes.length - 1}\x01`;
  });

  // Escape remaining HTML
  text = escapeHtml(text);

  // Bold + italic
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/___(.+?)___/g,        '<strong><em>$1</em></strong>');
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.+?)__/g,     '<strong>$1</strong>');
  // Italic
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  text = text.replace(/_(.+?)_/g,   '<em>$1</em>');
  // Strikethrough
  text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    '<a class="chat-link" href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Restore inline code
  text = text.replace(/\x01IC(\d+)\x01/g,
    (_, idx) => `<code class="chat-inline-code">${codes[parseInt(idx, 10)]}</code>`);

  return text;
}

function appendChatMessage(role, text) {
  const el = document.createElement('div');
  el.className = role === 'user' ? 'chat-msg-user' : 'chat-msg-assistant';
  if (role === 'user') {
    el.textContent = text;
  } else {
    el.innerHTML = renderChatMarkdown(text);
  }
  document.getElementById('chatMessages').appendChild(el);
  el.scrollIntoView({ block: 'end' });
  return el;
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

function openSettingsPanel() {
  document.getElementById('settingsPanel').classList.remove('hidden');
  document.getElementById('backupsOverlay').classList.add('hidden');
  loadBackups();
}

function closeSettingsPanel() {
  document.getElementById('settingsPanel').classList.add('hidden');
}

async function doSaveSettings() {
  const backend = document.querySelector('#backendToggle .toggle-opt.active')?.dataset.value || 'claude';
  const cssMode = document.querySelector('#cssModeToggle .toggle-opt.active')?.dataset.value || 'full';
  const cfEnabled = document.getElementById('cfEnabled').checked;
  const settings = {
    aiBackend:        backend,
    claudeApiKey:     document.getElementById('claudeApiKey').value.trim(),
    claudeModel:      document.getElementById('claudeModel').value || 'claude-sonnet-4-6',
    deepseekApiKey:   document.getElementById('deepseekApiKey').value.trim(),
    deepseekModel:    document.getElementById('deepseekModel').value || 'deepseek-v4-flash',
    ollamaUrl:        document.getElementById('ollamaUrl').value.trim() || 'http://localhost:11434',
    ollamaModel:      document.getElementById('ollamaModel').value.trim() || 'llama3',
    ollamaVisionModel: document.getElementById('ollamaVisionModel').value.trim() || 'llava',
    cfEnabled,
    cfClientId:       cfEnabled ? document.getElementById('cfClientId').value.trim()   : '',
    cfClientSecret:   cfEnabled ? document.getElementById('cfClientSecret').value.trim() : '',
    autoPublish:      document.getElementById('autoPublish').checked,
    cssLineWrap:      document.getElementById('cssLineWrap').checked,
    maxRollbacks:     100,
    cssMode,
  };
  await send({ type: 'SAVE_SETTINGS', settings });
  updateStatusBar(settings);
}

function flashSaveBtn() {
  const btn = document.getElementById('saveSettings');
  const orig = btn.textContent;
  btn.textContent = 'Saved ✓';
  btn.style.color = 'var(--success)';
  setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1500);
}

function setupSettings() {
  document.getElementById('openSettings').addEventListener('click', openSettingsPanel);

  document.getElementById('closeSettings').addEventListener('click', closeSettingsPanel);

  document.getElementById('saveSettings').addEventListener('click', async () => {
    try { await doSaveSettings(); flashSaveBtn(); } catch (e) { showError(e.message); }
  });

  document.getElementById('saveCloseSettings').addEventListener('click', async () => {
    try { await doSaveSettings(); closeSettingsPanel(); } catch (e) { showError(e.message); }
  });

  document.getElementById('saveExitSettings').addEventListener('click', async () => {
    try { await doSaveSettings(); closeSettingsPanel(); } catch (e) { showError(e.message); }
  });

  document.getElementById('viewBackups').addEventListener('click', () => {
    document.getElementById('backupsOverlay').classList.remove('hidden');
  });

  document.getElementById('backBackups').addEventListener('click', () => {
    document.getElementById('backupsOverlay').classList.add('hidden');
  });

  document.getElementById('clearBackups').addEventListener('click', async () => {
    if (!confirm('Clear all backups? This cannot be undone.')) return;
    try {
      await send({ type: 'CLEAR_BACKUPS' });
      loadBackups();
    } catch (e) {
      showError(e.message);
    }
  });

  // ── Tools dropdown ──
  const toolsWrap = document.getElementById('toolsDropdownBtn').parentElement;
  const toolsMenu = document.getElementById('toolsMenu');

  document.getElementById('toolsDropdownBtn').addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = !toolsMenu.classList.contains('hidden');
    toolsMenu.classList.toggle('hidden', isOpen);
    toolsWrap.classList.toggle('open', !isOpen);
  });

  document.addEventListener('click', () => {
    toolsMenu.classList.add('hidden');
    toolsWrap.classList.remove('open');
  });

  // ── Insert SA EZ child theme ──
  document.getElementById('insertSaEzTheme').addEventListener('click', async () => {
    toolsMenu.classList.add('hidden');
    toolsWrap.classList.remove('open');
    if (!confirm('This will override the current Additional CSS with the SA EZ child theme. Continue?')) return;
    const settings = await send({ type: 'GET_SETTINGS' });
    try {
      await send({ type: 'WRITE_CSS', css: SA_EZ_CHILD_CSS, autoPublish: settings.autoPublish });
    } catch (e) {
      showError(e.message);
    }
  });

  // ── Ensure This Tab is Selected ──
  document.getElementById('ensureThisTab').addEventListener('click', async () => {
    toolsMenu.classList.add('hidden');
    toolsWrap.classList.remove('open');
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab) {
        state.siteTabId    = tab.id;
        state.siteTabTitle = tab.title || 'this tab';
        hideTabMismatch();
      }
    } catch (_) {}
  });
}

// ─── Status dot helpers ───────────────────────────────────────────────────────

function setStatusDot(dotEl, state) {
  dotEl.className = 'settings-status-dot';
  if (state === 'ok')      dotEl.classList.add('dot-ok');
  if (state === 'fail')    dotEl.classList.add('dot-fail');
  if (state === 'pending') dotEl.classList.add('dot-pending');
}

function setVerifyMsg(msgEl, text, state) {
  msgEl.textContent = text;
  msgEl.className = 'settings-verify-msg';
  if (state === 'ok')   msgEl.classList.add('msg-ok');
  if (state === 'fail') msgEl.classList.add('msg-fail');
  msgEl.classList.remove('hidden');
}

// ─── Backups ──────────────────────────────────────────────────────────────────

async function loadBackups() {
  try {
    const { backups } = await send({ type: 'GET_BACKUPS' });
    renderBackups(backups);
  } catch (_) {}
}

let lastRestoredTimestamp = null;

function renderBackups(backups) {
  const list  = document.getElementById('backupsList');
  const count = document.getElementById('backupsCount');
  count.textContent = `(${backups.length})`;

  if (!backups.length) {
    list.innerHTML = '<div class="backups-empty">No backups yet.</div>';
    return;
  }
  list.innerHTML = '';
  backups.forEach((entry, index) => {
    const date = new Date(entry.timestamp);
    const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      + ' — ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const label      = entry.label ? escapeHtml(entry.label) : '';
    const preview    = (entry.css || '').slice(0, 80).replace(/\s+/g, ' ').trim();
    const wasRestored = entry.timestamp === lastRestoredTimestamp;
    const el = document.createElement('div');
    el.className = 'backup-entry';
    el.innerHTML = `
      <div class="backup-entry-header">
        <span class="backup-timestamp">${formatted}</span>
        <button class="backup-restore" data-index="${index}">Restore</button>
      </div>
      ${label ? `<div class="backup-label">${label}</div>` : ''}
      ${wasRestored ? `<div class="backup-restored-note">✓ Just restored</div>` : ''}
      <div class="backup-preview">${escapeHtml(preview)}${entry.css && entry.css.length > 80 ? '…' : ''}</div>
    `;
    el.querySelector('.backup-restore').addEventListener('click', async () => {
      if (!confirm(`Restore this backup from ${formatted}?`)) return;
      try {
        await send({ type: 'RESTORE_BACKUP', index });
        lastRestoredTimestamp = entry.timestamp;
        await loadBackups();
        setTimeout(() => {
          if (lastRestoredTimestamp === entry.timestamp) {
            lastRestoredTimestamp = null;
            loadBackups();
          }
        }, 4000);
      } catch (e) {
        showError(e.message);
      }
    });
    list.appendChild(el);
  });
}

// ─── Setup Tab ────────────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const settings = await send({ type: 'GET_SETTINGS' });
    applySettingsToForm(settings);
    updateStatusBar(settings);
  } catch (_) {}
}

function applySettingsToForm(s) {
  document.getElementById('claudeApiKey').value      = s.claudeApiKey || '';
  const modelSelect = document.getElementById('claudeModel');
  modelSelect.value = s.claudeModel || 'claude-sonnet-4-6';
  if (!modelSelect.value) modelSelect.value = 'claude-sonnet-4-6';
  document.getElementById('deepseekApiKey').value    = s.deepseekApiKey || '';
  const dsModelSelect = document.getElementById('deepseekModel');
  dsModelSelect.value = s.deepseekModel || 'deepseek-v4-flash';
  if (!dsModelSelect.value) dsModelSelect.value = 'deepseek-v4-flash';
  document.getElementById('ollamaUrl').value         = s.ollamaUrl || 'http://localhost:11434';
  document.getElementById('ollamaModel').value       = s.ollamaModel || 'llama3';
  document.getElementById('ollamaVisionModel').value = s.ollamaVisionModel || 'llava';
  document.getElementById('cfClientId').value        = s.cfClientId || '';
  document.getElementById('cfClientSecret').value    = s.cfClientSecret || '';
  document.getElementById('autoPublish').checked     = !!s.autoPublish;
  const lineWrap = s.cssLineWrap !== false; // default true
  document.getElementById('cssLineWrap').checked = lineWrap;
  if (cssIdeEditor) cssIdeEditor.setOption('lineWrapping', lineWrap);
  // CF enabled: restore from saved value, or infer from non-empty credentials
  const cfEnabled = s.cfEnabled || !!(s.cfClientId || s.cfClientSecret);
  document.getElementById('cfEnabled').checked = cfEnabled;
  document.getElementById('cfFields').classList.toggle('hidden', !cfEnabled);
  setBackend(s.aiBackend || 'claude');
  setCssMode(s.cssMode || 'full');
}

function setCssMode(value) {
  document.querySelectorAll('#cssModeToggle .toggle-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
}

function setBackend(value) {
  document.querySelectorAll('#backendToggle .toggle-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
  document.getElementById('claudeConfig').classList.toggle('hidden', value !== 'claude');
  document.getElementById('deepseekConfig').classList.toggle('hidden', value !== 'deepseek');
  document.getElementById('ollamaConfig').classList.toggle('hidden', value !== 'ollama');
}

function setupSetupTab() {
  // Backend toggle
  document.querySelectorAll('#backendToggle .toggle-opt').forEach(btn => {
    btn.addEventListener('click', () => setBackend(btn.dataset.value));
  });

  // CSS mode toggle
  document.querySelectorAll('#cssModeToggle .toggle-opt').forEach(btn => {
    btn.addEventListener('click', () => setCssMode(btn.dataset.value));
  });

  // ── Claude: show/hide key ──
  document.getElementById('claudeKeyView').addEventListener('click', () => {
    const input = document.getElementById('claudeApiKey');
    const btn   = document.getElementById('claudeKeyView');
    const show  = input.type === 'password';
    input.type  = show ? 'text' : 'password';
    btn.classList.toggle('active', show);
  });

  // ── Claude: copy key ──
  document.getElementById('claudeKeyCopy').addEventListener('click', () => {
    const key = document.getElementById('claudeApiKey').value;
    if (!key) return;
    navigator.clipboard.writeText(key).catch(() => {});
    const btn = document.getElementById('claudeKeyCopy');
    btn.classList.add('active');
    setTimeout(() => btn.classList.remove('active'), 1200);
  });

  // ── Claude: verify API key ──
  document.getElementById('verifyClaudeKey').addEventListener('click', async () => {
    const key    = document.getElementById('claudeApiKey').value.trim();
    const dot    = document.getElementById('claudeStatusDot');
    const msgEl  = document.getElementById('claudeVerifyMsg');
    const btn    = document.getElementById('verifyClaudeKey');
    if (!key) { setStatusDot(dot, 'fail'); setVerifyMsg(msgEl, 'Enter an API key first', 'fail'); return; }
    setStatusDot(dot, 'pending');
    msgEl.classList.add('hidden');
    btn.disabled = true;
    try {
      const resp = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      });
      if (resp.ok) {
        setStatusDot(dot, 'ok');
        setVerifyMsg(msgEl, 'API key is valid', 'ok');
      } else {
        const body = await resp.json().catch(() => ({}));
        setStatusDot(dot, 'fail');
        setVerifyMsg(msgEl, body?.error?.message || `Error ${resp.status}`, 'fail');
      }
    } catch (e) {
      setStatusDot(dot, 'fail');
      setVerifyMsg(msgEl, e.message, 'fail');
    } finally {
      btn.disabled = false;
    }
  });

  // ── DeepSeek: show/hide key ──
  document.getElementById('deepseekKeyView').addEventListener('click', () => {
    const input = document.getElementById('deepseekApiKey');
    const btn   = document.getElementById('deepseekKeyView');
    const show  = input.type === 'password';
    input.type  = show ? 'text' : 'password';
    btn.classList.toggle('active', show);
  });

  // ── DeepSeek: copy key ──
  document.getElementById('deepseekKeyCopy').addEventListener('click', () => {
    const key = document.getElementById('deepseekApiKey').value;
    if (!key) return;
    navigator.clipboard.writeText(key).catch(() => {});
    const btn = document.getElementById('deepseekKeyCopy');
    btn.classList.add('active');
    setTimeout(() => btn.classList.remove('active'), 1200);
  });

  // ── DeepSeek: verify API key ──
  document.getElementById('verifyDeepseekKey').addEventListener('click', async () => {
    const key   = document.getElementById('deepseekApiKey').value.trim();
    const dot   = document.getElementById('deepseekStatusDot');
    const msgEl = document.getElementById('deepseekVerifyMsg');
    const btn   = document.getElementById('verifyDeepseekKey');
    if (!key) { setStatusDot(dot, 'fail'); setVerifyMsg(msgEl, 'Enter an API key first', 'fail'); return; }
    setStatusDot(dot, 'pending');
    msgEl.classList.add('hidden');
    btn.disabled = true;
    try {
      const resp = await fetch('https://api.deepseek.com/models', {
        headers: { 'Authorization': `Bearer ${key}` },
      });
      if (resp.ok) {
        setStatusDot(dot, 'ok');
        setVerifyMsg(msgEl, 'API key is valid', 'ok');
      } else {
        const body = await resp.json().catch(() => ({}));
        setStatusDot(dot, 'fail');
        setVerifyMsg(msgEl, body?.error?.message || `Error ${resp.status}`, 'fail');
      }
    } catch (e) {
      setStatusDot(dot, 'fail');
      setVerifyMsg(msgEl, e.message, 'fail');
    } finally {
      btn.disabled = false;
    }
  });

  // ── Ollama: test connection ──
  document.getElementById('testOllama').addEventListener('click', async () => {
    const btn   = document.getElementById('testOllama');
    const dot   = document.getElementById('ollamaStatusDot');
    const msgEl = document.getElementById('ollamaTestStatus');
    btn.disabled = true;
    setStatusDot(dot, 'pending');
    msgEl.classList.add('hidden');
    try {
      const cfEnabled = document.getElementById('cfEnabled').checked;
      const result = await send({
        type: 'TEST_OLLAMA',
        url:            document.getElementById('ollamaUrl').value.trim() || 'http://localhost:11434',
        cfClientId:     cfEnabled ? document.getElementById('cfClientId').value.trim()     : '',
        cfClientSecret: cfEnabled ? document.getElementById('cfClientSecret').value.trim() : '',
      });
      setStatusDot(dot, 'ok');
      setVerifyMsg(msgEl, result.message, 'ok');
    } catch (e) {
      setStatusDot(dot, 'fail');
      setVerifyMsg(msgEl, e.message, 'fail');
    } finally {
      btn.disabled = false;
    }
  });

  // ── CSS line wrap toggle ──
  document.getElementById('cssLineWrap').addEventListener('change', e => {
    if (cssIdeEditor) cssIdeEditor.setOption('lineWrapping', e.target.checked);
  });

  // ── CF toggle ──
  document.getElementById('cfEnabled').addEventListener('change', e => {
    document.getElementById('cfFields').classList.toggle('hidden', !e.target.checked);
  });

  // ── CF: verify credentials (reuses Ollama test with CF tokens) ──
  document.getElementById('verifyCf').addEventListener('click', async () => {
    const btn   = document.getElementById('verifyCf');
    const dot   = document.getElementById('cfStatusDot');
    const msgEl = document.getElementById('cfVerifyMsg');
    btn.disabled = true;
    setStatusDot(dot, 'pending');
    msgEl.classList.add('hidden');
    try {
      const result = await send({
        type:           'TEST_OLLAMA',
        url:            document.getElementById('ollamaUrl').value.trim() || 'http://localhost:11434',
        cfClientId:     document.getElementById('cfClientId').value.trim(),
        cfClientSecret: document.getElementById('cfClientSecret').value.trim(),
      });
      setStatusDot(dot, 'ok');
      setVerifyMsg(msgEl, result.message, 'ok');
    } catch (e) {
      setStatusDot(dot, 'fail');
      setVerifyMsg(msgEl, e.message, 'fail');
    } finally {
      btn.disabled = false;
    }
  });
}

// ─── Workflow Tab ─────────────────────────────────────────────────────────────

function setupWorkflowTab() {
  document.getElementById('generateCss').addEventListener('click', handleGenerate);
  document.getElementById('instructions').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(); }
  });
  document.getElementById('reconsolidate').addEventListener('click', handleReconsolidate);
  document.getElementById('applyChanges').addEventListener('click', handleApply);
  // Revision send — also submit on Enter (no shift)
  const revisionInput = document.getElementById('revisionInput');
  document.getElementById('revise').addEventListener('click', handleRevise);
  revisionInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRevise(); }
  });
  revisionInput.addEventListener('input', () => {
    revisionInput.style.height = 'auto';
    revisionInput.style.height = Math.min(revisionInput.scrollHeight, 120) + 'px';
  });

  // Stop main generation
  document.getElementById('stopGenerate').addEventListener('click', () => {
    if (state.generatePort) {
      state.stopping = true;
      state.generatePort.disconnect();
      state.generatePort = null;
      document.getElementById('stopGenerate').classList.add('hidden');
      document.getElementById('cssBlock').disabled = false;
      document.getElementById('cssBlock').placeholder = '';
      setLoading(document.getElementById('generateCss'), false, 'Generate CSS');
      setLoading(document.getElementById('reconsolidate'), false, 'Reconsolidate CSS');
    }
  });

  // Stop revision generation
  document.getElementById('revisionStop').addEventListener('click', () => {
    if (state.generatePort) {
      state.stopping = true;
      state.generatePort.disconnect();
      state.generatePort = null;
    }
    setRevisionLoading(false);
  });

  document.getElementById('cssBlock').addEventListener('input', autoResizeCssBlock);
  document.getElementById('toggleCssView').addEventListener('click', handleToggleCssView);
}

async function handleReconsolidate() {
  clearError();
  state.lastInstructions = 'Fully Reconsolidated';
  const btn = document.getElementById('reconsolidate');
  btn.disabled = true;
  btn.classList.add('loading');
  streamGenerate({
    instructions: '__reconsolidate__',
    baseCss: undefined,
    history: [],
    siteTabId: state.siteTabId,
    stepScope: null,
    onDone:  () => { btn.disabled = false; btn.classList.remove('loading'); },
    onError: () => { btn.disabled = false; btn.classList.remove('loading'); },
  });
}

async function handleGenerate() {
  const instructions = document.getElementById('instructions').value.trim();
  if (!instructions) { showError('Please enter instructions before generating.'); return; }
  state.lastInstructions = instructions;
  clearError();
  const btn = document.getElementById('generateCss');
  setLoading(btn, true, 'Generating…');
  streamGenerate({
    instructions,
    baseCss: undefined,
    history: [],
    siteTabId: state.siteTabId,
    stepScope: state.scopeMode === 'all' ? null : parseInt(state.scopeMode),
    onDone:  () => setLoading(btn, false, 'Generate CSS'),
    onError: () => setLoading(btn, false, 'Generate CSS'),
  });
}

async function handleApply() {
  clearError();
  const btn = document.getElementById('applyChanges');

  if (state.applied) {
    // Undo → restore and go back to Apply Changes
    try {
      setLoading(btn, true, 'Restoring…');
      await send({ type: 'RESTORE_BACKUP', index: 0 });
      state.applied = false;
      setApplyButton('apply');
      await loadBackups();
    } catch (e) {
      showError(e.message);
    } finally {
      setLoading(btn, false, 'Apply Changes');
    }
    return;
  }

  try {
    setLoading(btn, true, 'Applying…');
    await send({ type: 'SAVE_BACKUP', css: state.originalCss || '', label: state.lastInstructions ? `Before: ${state.lastInstructions.slice(0, 80)}` : 'Manual apply' });
    const settings = await send({ type: 'GET_SETTINGS' });
    await send({ type: 'WRITE_CSS', css: cssToApply(), autoPublish: settings.autoPublish });
    state.applied = true;
    setApplyButton('undo');
    await loadBackups();
  } catch (e) {
    showError(e.message);
  } finally {
    setLoading(btn, false, state.applied ? '← Undo' : 'Apply Changes');
  }
}

async function handleRevise() {
  const revisionText = document.getElementById('revisionInput').value.trim();
  if (!revisionText) return;
  state.lastInstructions = `Revision: ${revisionText}`;
  clearError();

  let instructions = revisionText;
  if (state.changelist.length) {
    instructions = `Previous changes:\n${state.changelist.map(c => `- ${c}`).join('\n')}\n\nRevision: ${revisionText}`;
  }

  setRevisionLoading(true);
  streamGenerate({
    instructions,
    baseCss: state.lastGeneratedCss,
    history: state.messageHistory,
    siteTabId: state.siteTabId,
    stepScope: state.scopeMode === 'all' ? null : parseInt(state.scopeMode),
    onDone: () => {
      setRevisionLoading(false);
      document.getElementById('revisionInput').value = '';
      document.getElementById('revisionInput').style.height = 'auto';
    },
    onError: () => setRevisionLoading(false),
  });
}

function handleToggleCssView() {
  const cssBlock  = document.getElementById('cssBlock');
  const toggleBtn = document.getElementById('toggleCssView');
  const label     = document.getElementById('cssSectionLabel');

  state.viewingFull = !state.viewingFull;

  if (state.viewingFull) {
    cssBlock.value = state.lastGeneratedCss || '';
    label.textContent = 'Full CSS';
    toggleBtn.textContent = 'Show changes only';
  } else {
    cssBlock.value = state.patchPreview || '';
    label.textContent = 'Changes';
    toggleBtn.textContent = 'Show full CSS';
  }
  cssBlock.scrollTop = 0;
  autoResizeCssBlock();
}

// ─── CSS Apply Logic ──────────────────────────────────────────────────────────

function cssToApply() {
  const cssBlock = document.getElementById('cssBlock');

  // When viewing the full CSS directly, use textarea value as-is (user may have edited it)
  if (state.viewingFull || state.isFullRewrite) {
    return cssBlock.value;
  }

  // Full-mode generation: the AI returned the complete file.
  // The textarea shows only the diff for review — use the full generated CSS.
  if (state.cssGenerationMode === 'full') {
    return state.lastGeneratedCss || '';
  }

  // Patch-mode generation: merge the (possibly edited) patch into the original.
  return mergePatchClient(state.originalCss || '', cssBlock.value);
}

function mergePatchClient(existingCss, patchCss) {
  if (!patchCss || !patchCss.trim()) return existingCss;
  if (!existingCss || !existingCss.trim()) return patchCss;
  function splitBlocks(css) {
    const blocks = [];
    let depth = 0, start = 0;
    for (let i = 0; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) { blocks.push(css.slice(start, i + 1).trim()); start = i + 1; }
      }
    }
    const tail = css.slice(start).trim();
    if (tail) blocks.push(tail);
    return blocks.filter(Boolean);
  }
  function selectorOf(b) { const i = b.indexOf('{'); return i === -1 ? null : b.slice(0, i).trim(); }
  const existingBlocks = splitBlocks(existingCss);
  const patchBlocks    = splitBlocks(patchCss);
  const patchMap = new Map();
  for (const b of patchBlocks) { const s = selectorOf(b); if (s) patchMap.set(s, b); }
  const merged = existingBlocks.map(b => {
    const s = selectorOf(b);
    if (s && patchMap.has(s)) { const r = patchMap.get(s); patchMap.delete(s); return r; }
    return b;
  });
  for (const b of patchMap.values()) merged.push(b);
  return merged.join('\n\n');
}

function autoResizeCssBlock() {
  const el = document.getElementById('cssBlock');
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 320) + 'px';
}

// ─── Streaming helper ─────────────────────────────────────────────────────────

function streamGenerate({ instructions, baseCss, history, siteTabId, stepScope, onDone, onError }) {
  const cssBlock = document.getElementById('cssBlock');

  showGeneratedCss('');
  cssBlock.value = '';
  cssBlock.disabled = true;
  cssBlock.placeholder = 'Uploading…';
  resetApplyButton();
  setAgentActionsLocked(true);
  document.getElementById('stopGenerate').classList.remove('hidden');
  document.getElementById('toggleCssView').classList.add('hidden');
  document.getElementById('ctxStats').classList.add('hidden');
  document.getElementById('cssDebugNote').classList.add('hidden');

  state.stopping = false;
  let charCount    = 0;
  let agentBuffer  = '';
  let agentPhase   = 'uploading'; // 'uploading' | 'thinking' | 'generating'

  const port = chrome.runtime.connect({ name: 'generate' });
  state.generatePort = port;

  port.onMessage.addListener(msg => {
    if (msg.type === 'CSS_DEBUG') {
      const note = document.getElementById('cssDebugNote');
      note.textContent = msg.text;
      note.classList.remove('hidden');

    } else if (msg.type === 'CSS_RETRY') {
      charCount   = 0;
      agentBuffer = '';
      agentPhase  = 'uploading';
      cssBlock.placeholder = 'Uploading…';

    } else if (msg.type === 'CSS_CHUNK') {
      charCount    += msg.text.length;
      agentBuffer  += msg.text;

      // Phase: uploading → thinking on first chunk, thinking → generating once <css> tag seen
      if (agentPhase === 'uploading') agentPhase = 'thinking';
      if (agentPhase === 'thinking' && agentBuffer.includes('<css>')) agentPhase = 'generating';

      cssBlock.placeholder = agentPhase === 'generating'
        ? `Generating… (${charCount} chars)`
        : `Thinking… (${charCount} chars)`;

    } else if (msg.type === 'CSS_DONE') {
      state.lastGeneratedCss    = msg.css;
      state.originalCss         = msg.originalCss;
      state.patchPreview        = msg.patchPreview || msg.css;
      state.isFullRewrite       = !!msg.isFullRewrite;
      state.cssGenerationMode   = msg.cssMode || 'full';
      state.viewingFull         = state.isFullRewrite;
      state.changelist          = msg.changelist || [];
      state.messageHistory      = msg.history || [];

      resetApplyButton();

      const label     = document.getElementById('cssSectionLabel');
      const toggleBtn = document.getElementById('toggleCssView');

      if (state.isFullRewrite) {
        label.textContent = 'Generated CSS';
        toggleBtn.classList.add('hidden');
        cssBlock.value = msg.css;
      } else {
        label.textContent = state.cssGenerationMode === 'patch' ? 'Patch' : 'Changes';
        toggleBtn.textContent = 'Show full CSS';
        toggleBtn.classList.remove('hidden');
        cssBlock.value = state.patchPreview;
      }

      cssBlock.disabled = false;
      cssBlock.placeholder = '';
      cssBlock.scrollTop = 0;
      autoResizeCssBlock();

      const diffStat = document.getElementById('diffStat');
      if (msg.lineDiff && (msg.lineDiff.added || msg.lineDiff.removed)) {
        const { added, removed } = msg.lineDiff;
        diffStat.innerHTML =
          (added   ? `<span class="diff-added">+${added}</span>`   : '') +
          (removed ? `<span class="diff-removed">−${removed}</span>` : '');
        diffStat.classList.remove('hidden');
      } else {
        diffStat.classList.add('hidden');
      }

      if (msg.inputTokens || msg.outputTokens) {
        const cost = calcCost(msg.inputTokens, msg.outputTokens);
        const summary = document.getElementById('ctxStatsSummary');
        if (summary) {
          const costStr = fmtCost(cost);
          summary.textContent += ` · ↑${fmtTokens(msg.inputTokens)} ↓${fmtTokens(msg.outputTokens)}`;
          if (costStr) {
            const costSpan = document.createElement('span');
            costSpan.className = 'ctx-stats-cost';
            costSpan.textContent = costStr;
            summary.appendChild(costSpan);
          }
        }
        document.getElementById('ctxStats').classList.remove('hidden');
      }

      endStream();
      onDone();

    } else if (msg.type === 'CSS_STATS') {
      renderCtxStats(msg.stats);

    } else if (msg.type === 'CSS_ERROR') {
      cssBlock.disabled = false;
      endStream();
      showError(msg.error);
      onError();
    }
  });

  port.onDisconnect.addListener(() => {
    if (state.stopping) return;
    endStream();
    cssBlock.disabled = false;
    cssBlock.placeholder = '';
    if (chrome.runtime.lastError) {
      showError('Connection lost: ' + chrome.runtime.lastError.message);
    }
    onError();
  });

  function endStream() {
    state.generatePort = null;
    document.getElementById('stopGenerate').classList.add('hidden');
    setAgentActionsLocked(false);
  }

  port.postMessage({
    type: 'GENERATE_CSS',
    instructions,
    screenshotDataUrl: state.screenshotDataUrl,
    designRefDataUrl: state.designRefDataUrl,
    history: history || [],
    siteTabId: siteTabId ?? null,
    stepScope: stepScope ?? null,
  });
}

function renderCtxStats(stats) {
  const el      = document.getElementById('ctxStats');
  const summary = document.getElementById('ctxStatsSummary');
  const copyBtn = document.getElementById('ctxStatsCopy');
  if (!el || !stats?.summary) return;

  summary.textContent = stats.summary;
  el.classList.remove('hidden');

  copyBtn.onclick = () => {
    navigator.clipboard.writeText(stats.log).then(() => {
      copyBtn.querySelector('.ctx-stats-arrow').textContent = '✓';
      copyBtn.querySelector('.ctx-stats-label').textContent = ' Copied';
      setTimeout(() => {
        copyBtn.querySelector('.ctx-stats-arrow').textContent = '›';
        copyBtn.querySelector('.ctx-stats-label').textContent = ' Copy Log';
      }, 1500);
    }).catch(() => {});
  };
}

function showGeneratedCss(css) {
  document.getElementById('cssBlock').value = css;
  document.getElementById('generatedSection').classList.remove('hidden');
  document.getElementById('generatedDivider').style.display = '';
  document.getElementById('agentRevisionBar').classList.remove('hidden');
  document.getElementById('generatedSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function setAgentActionsLocked(locked) {
  const applyBtn      = document.getElementById('applyChanges');
  const reviseBtn     = document.getElementById('revise');
  const revisionInput = document.getElementById('revisionInput');
  const revisionBar   = document.getElementById('agentRevisionBar');

  if (applyBtn)      applyBtn.disabled      = locked;
  if (reviseBtn)     reviseBtn.disabled      = locked;
  if (revisionInput) revisionInput.disabled  = locked;
  if (revisionBar)   revisionBar.classList.toggle('agent-actions-locked', locked);
}

function setRevisionLoading(loading) {
  const btn     = document.getElementById('revise');
  const arrow   = btn.querySelector('.revision-arrow');
  const spinner = btn.querySelector('.revision-spinner');
  const stop    = document.getElementById('revisionStop');
  const input   = document.getElementById('revisionInput');

  btn.disabled   = loading;
  input.disabled = loading;
  arrow.classList.toggle('hidden', loading);
  spinner.classList.toggle('hidden', !loading);
  stop.classList.toggle('hidden', !loading);
}

// ─── Apply Button State ───────────────────────────────────────────────────────

function setApplyButton(mode) {
  const btn = document.getElementById('applyChanges');
  btn.classList.remove('btn-primary', 'btn-secondary', 'btn-undo');
  if (mode === 'undo') {
    btn.textContent = '← Undo';
    btn.classList.add('btn-undo');
  } else {
    btn.textContent = 'Apply Changes';
    btn.classList.add('btn-primary');
  }
}

function resetApplyButton() {
  state.applied = false;
  setApplyButton('apply');
}

// ─── Scope Buttons ────────────────────────────────────────────────────────────

function setupScopeButtons() {
  document.querySelectorAll('#scopeToggle .scope-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.scopeMode = btn.dataset.scope;
      document.querySelectorAll('#scopeToggle .scope-btn').forEach(b => {
        const active = b === btn;
        b.classList.toggle('active', active);
        if (b.dataset.scope !== 'all') {
          b.textContent = active ? `Step ${b.dataset.scope}` : b.dataset.scope;
        }
      });
    });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTokens(n) {
  if (!n) return '0';
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
}

function calcCost(inputTokens, outputTokens) {
  const backend = document.querySelector('#backendToggle .toggle-opt.active')?.dataset.value;
  if (backend === 'claude') {
    const modelId = document.getElementById('claudeModel')?.value;
    const model = CLAUDE_MODELS.find(m => m.id === modelId);
    if (!model) return null;
    return (inputTokens * model.inputPer1M + outputTokens * model.outputPer1M) / 1_000_000;
  }
  if (backend === 'deepseek') {
    const modelId = document.getElementById('deepseekModel')?.value;
    const model = DEEPSEEK_MODELS.find(m => m.id === modelId);
    if (!model) return null;
    return (inputTokens * model.inputPer1M + outputTokens * model.outputPer1M) / 1_000_000;
  }
  return null;
}

function fmtCost(cost) {
  if (cost === null) return '';
  if (cost < 0.0001) return ' ~<$0.0001';
  return ` ~$${cost.toFixed(4)}`;
}

function setLoading(btn, loading, text) {
  btn.textContent = text;
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
}

function showError(msg) {
  const box = document.getElementById('errorBox');
  box.textContent = msg;
  box.classList.remove('hidden');
}

function clearError() {
  document.getElementById('errorBox').classList.add('hidden');
}

// ─── CSS IDE ──────────────────────────────────────────────────────────────────

let cssIdeEditor = null;       // CodeMirror instance
let cssIdeColorMarks = [];     // active bookmark widgets for color swatches
let cssIdeColorTimer = null;   // debounce timer

function setupCssIde() {
  const textarea = document.getElementById('cssIdeTextarea');

  cssIdeEditor = CodeMirror.fromTextArea(textarea, {
    mode: 'css',
    theme: 'sync-dark',
    lineNumbers: true,
    lineWrapping: true,
    indentWithTabs: false,
    indentUnit: 2,
    tabSize: 2,
    smartIndent: true,
    matchBrackets: true,
    autofocus: false,
    extraKeys: { Tab: cm => cm.execCommand('indentMore'), 'Shift-Tab': cm => cm.execCommand('indentLess') },
  });

  // Refresh editor size when it becomes visible
  const observer = new MutationObserver(() => {
    if (!document.getElementById('cssIdePanel').classList.contains('hidden')) {
      cssIdeEditor.refresh();
    }
  });
  observer.observe(document.getElementById('cssIdePanel'), { attributes: true, attributeFilter: ['class'] });

  // Update meta (line/col/char) on cursor move
  cssIdeEditor.on('cursorActivity', updateCssIdeMeta);

  // Color swatches on change (debounced)
  cssIdeEditor.on('changes', () => {
    clearTimeout(cssIdeColorTimer);
    cssIdeColorTimer = setTimeout(renderColorSwatches, 300);
  });

  document.getElementById('cssIdeRefresh').addEventListener('click', loadCssIde);
  document.getElementById('cssIdePublish').addEventListener('click', () => deployOrPublishCss(true));
  document.getElementById('cssIdeReloadPage').addEventListener('click', () => {
    if (state.siteTabId) chrome.tabs.reload(state.siteTabId);
  });

  // Auto-write to Customizer field on every edit (debounced)
  let cssIdeAutoWriteTimer = null;
  cssIdeEditor.on('changes', (cm, changes) => {
    // Ignore changes that came from setValue (initial load / reload)
    if (changes.every(c => c.origin === 'setValue')) return;
    clearTimeout(cssIdeAutoWriteTimer);
    setCssIdeStatus('');
    cssIdeAutoWriteTimer = setTimeout(async () => {
      try {
        await send({ type: 'WRITE_CSS', css: cssIdeEditor.getValue(), autoPublish: false });
        setCssIdeStatus('Synced ✓');
        setTimeout(() => setCssIdeStatus(''), 2000);
      } catch (_) {
        // Silently ignore — Customizer tab may not be open
      }
    }, 800);
  });

  // Search
  document.getElementById('cssIdeSearchBtn').addEventListener('click', openCssSearch);
  document.getElementById('cssIdeSearchPrev').addEventListener('click', prevCssMatch);
  document.getElementById('cssIdeSearchNext').addEventListener('click', nextCssMatch);
  document.getElementById('cssIdeSearchClose').addEventListener('click', closeCssSearch);
  document.getElementById('cssIdeSearchAiToggle').addEventListener('click', toggleCssSearchAiMode);

  const searchInput = document.getElementById('cssIdeSearchInput');
  searchInput.addEventListener('input', () => { if (!cssSearchAiMode) runCssSearch(); });
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (cssSearchAiMode) runSmartSearch();
      else e.shiftKey ? prevCssMatch() : nextCssMatch();
    }
    if (e.key === 'Escape') { e.preventDefault(); closeCssSearch(); }
  });

  cssIdeEditor.addKeyMap({
    'Ctrl-F': () => { openCssSearch(); return true; },
    'Cmd-F':  () => { openCssSearch(); return true; },
    'Ctrl-I': () => { openInlineChat(); return true; },
    'Cmd-I':  () => { openInlineChat(); return true; },
  });
}

// ── CSS IDE Search ────────────────────────────────────────────────────────────

let cssIdeSearchMatches = [];
let cssIdeSearchIndex   = -1;
let cssIdeSearchMarks   = [];
let cssSearchAiMode     = false;
let cssSmartSearchPort  = null;

function openCssSearch() {
  document.getElementById('cssIdeSearch').classList.remove('hidden');
  const input = document.getElementById('cssIdeSearchInput');
  input.focus();
  input.select();
  runCssSearch();
}

function closeCssSearch() {
  document.getElementById('cssIdeSearch').classList.add('hidden');
  clearCssSearchMarks();
  document.getElementById('cssIdeSearchCount').textContent = '';
  cssIdeEditor.focus();
}

function clearCssSearchMarks() {
  cssIdeSearchMarks.forEach(m => m.clear());
  cssIdeSearchMarks   = [];
  cssIdeSearchMatches = [];
  cssIdeSearchIndex   = -1;
}

function runCssSearch() {
  clearCssSearchMarks();
  const query   = document.getElementById('cssIdeSearchInput').value;
  const countEl = document.getElementById('cssIdeSearchCount');
  if (!query) { countEl.textContent = ''; return; }

  const cursor = cssIdeEditor.getSearchCursor(query, CodeMirror.Pos(0, 0), { caseFold: true });
  while (cursor.findNext()) {
    const from = cursor.from();
    const to   = cursor.to();
    cssIdeSearchMatches.push({ from, to });
    cssIdeSearchMarks.push(cssIdeEditor.markText(from, to, { className: 'cm-search-match' }));
  }

  if (!cssIdeSearchMatches.length) {
    countEl.textContent = 'No matches';
    countEl.classList.add('css-ide-search-count-none');
    return;
  }
  countEl.classList.remove('css-ide-search-count-none');
  cssIdeSearchIndex = 0;
  jumpToMatch();
}

function nextCssMatch() {
  if (!cssIdeSearchMatches.length) return;
  cssIdeSearchIndex = (cssIdeSearchIndex + 1) % cssIdeSearchMatches.length;
  jumpToMatch();
}

function prevCssMatch() {
  if (!cssIdeSearchMatches.length) return;
  cssIdeSearchIndex = (cssIdeSearchIndex - 1 + cssIdeSearchMatches.length) % cssIdeSearchMatches.length;
  jumpToMatch();
}

function jumpToMatch() {
  const match = cssIdeSearchMatches[cssIdeSearchIndex];
  cssIdeEditor.setSelection(match.from, match.to);
  cssIdeEditor.scrollIntoView({ from: match.from, to: match.to }, 80);
  document.getElementById('cssIdeSearchCount').textContent =
    `${cssIdeSearchIndex + 1} / ${cssIdeSearchMatches.length}`;
}

function toggleCssSearchAiMode() {
  cssSearchAiMode = !cssSearchAiMode;
  const btn   = document.getElementById('cssIdeSearchAiToggle');
  const input = document.getElementById('cssIdeSearchInput');
  const navs  = document.querySelectorAll('.css-ide-search-nav');

  btn.classList.toggle('css-ide-search-ai-active', cssSearchAiMode);
  input.placeholder = cssSearchAiMode ? 'Describe what you\'re looking for…' : 'Find in CSS…';
  navs.forEach(n => n.classList.toggle('hidden', cssSearchAiMode));

  // Clear any existing text-search state when switching modes
  clearCssSearchMarks();
  document.getElementById('cssIdeSearchCount').textContent = '';
  document.getElementById('cssIdeSearchCount').classList.remove('css-ide-search-count-none');
  input.value = '';
  input.focus();
}

function runSmartSearch() {
  const query   = document.getElementById('cssIdeSearchInput').value.trim();
  const countEl = document.getElementById('cssIdeSearchCount');
  if (!query) return;

  // Abort any in-flight smart search
  if (cssSmartSearchPort) { try { cssSmartSearchPort.disconnect(); } catch (_) {} cssSmartSearchPort = null; }
  clearCssSearchMarks();

  countEl.textContent = '✦ Searching…';
  countEl.classList.remove('css-ide-search-count-none');
  document.getElementById('cssIdeSearchInput').disabled = true;

  const fullCss = cssIdeEditor.getValue();
  const port    = chrome.runtime.connect({ name: 'css-smart-search' });
  cssSmartSearchPort = port;

  port.onMessage.addListener(msg => {
    if (msg.type === 'SMART_DONE') {
      cssSmartSearchPort = null;
      document.getElementById('cssIdeSearchInput').disabled = false;
      highlightSmartResult(msg.result, countEl);

    } else if (msg.type === 'SMART_ERROR') {
      cssSmartSearchPort = null;
      document.getElementById('cssIdeSearchInput').disabled = false;
      countEl.textContent = msg.error;
      countEl.classList.add('css-ide-search-count-none');
    }
  });

  port.onDisconnect.addListener(() => {
    cssSmartSearchPort = null;
    document.getElementById('cssIdeSearchInput').disabled = false;
  });

  port.postMessage({ type: 'SMART_SEARCH', css: fullCss, query });
}

function highlightSmartResult(resultCss, countEl) {
  // Strip any accidental fences the AI may have added
  const cleaned = resultCss
    .replace(/^```[\w]*\r?\n?/m, '').replace(/\r?\n?```\s*$/m, '').trim();

  // Use the first non-empty, non-comment line as the search anchor
  const anchor = cleaned.split('\n')
    .map(l => l.trim())
    .find(l => l && !l.startsWith('/*') && !l.startsWith('//'));

  if (!anchor) {
    countEl.textContent = 'Not found';
    countEl.classList.add('css-ide-search-count-none');
    return;
  }

  const cursor = cssIdeEditor.getSearchCursor(anchor, CodeMirror.Pos(0, 0), { caseFold: true });
  if (!cursor.findNext()) {
    countEl.textContent = 'Not found';
    countEl.classList.add('css-ide-search-count-none');
    return;
  }

  const from = cursor.from();

  // Walk forward from anchor to find the end of the full block (matching braces)
  const to = findBlockEnd(from);

  cssIdeSearchMarks.push(cssIdeEditor.markText(from, to, { className: 'cm-search-match' }));
  cssIdeEditor.setSelection(from, to);
  cssIdeEditor.scrollIntoView({ from, to }, 80);
  countEl.textContent = '✦ Found';
  countEl.classList.remove('css-ide-search-count-none');
}

function findBlockEnd(from) {
  const doc   = cssIdeEditor.getDoc();
  const total = doc.lineCount();
  let depth = 0;
  let started = false;

  for (let ln = from.line; ln < total; ln++) {
    const text     = doc.getLine(ln);
    const startCh  = ln === from.line ? from.ch : 0;
    for (let ch = startCh; ch < text.length; ch++) {
      if (text[ch] === '{') { depth++; started = true; }
      else if (text[ch] === '}') {
        depth--;
        if (started && depth <= 0) return { line: ln, ch: ch + 1 };
      }
    }
  }
  // Fallback: end of anchor line
  return { line: from.line, ch: doc.getLine(from.line).length };
}

async function loadCssIde() {
  setCssIdeStatus('Loading…');
  try {
    const resp = await send({ type: 'GET_CSS' });
    cssIdeEditor.setValue(resp.css || '');
    cssIdeEditor.clearHistory();
    cssIdeEditor.refresh();
    renderColorSwatches();
    updateCssIdeMeta();
    setCssIdeStatus('');
  } catch (e) {
    setCssIdeStatus(e.message, true);
  }
}

async function deployOrPublishCss(publish) {
  const btn = document.getElementById('cssIdePublish');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Publishing…';
  setCssIdeStatus('');
  try {
    await send({ type: 'WRITE_CSS', css: cssIdeEditor.getValue(), autoPublish: publish });
    setCssIdeStatus('Published ✓');
    setTimeout(() => setCssIdeStatus(''), 3000);
  } catch (e) {
    setCssIdeStatus(e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

function updateCssIdeMeta() {
  const cursor = cssIdeEditor.getCursor();
  const chars  = cssIdeEditor.getValue().length;
  const lines  = cssIdeEditor.lineCount();
  document.getElementById('cssIdeMeta').textContent =
    `Ln ${cursor.line + 1}, Col ${cursor.ch + 1}  ·  ${lines} lines  ·  ${chars} chars`;
}

function setCssIdeStatus(msg, isError) {
  const el = document.getElementById('cssIdeStatus');
  el.textContent = msg;
  el.classList.toggle('css-ide-status-error', !!isError);
}

// ── Color swatches ────────────────────────────────────────────────────────────

const CSS_NAMED_COLORS = new Set([
  'aliceblue','antiquewhite','aqua','aquamarine','azure','beige','bisque','black','blanchedalmond',
  'blue','blueviolet','brown','burlywood','cadetblue','chartreuse','chocolate','coral',
  'cornflowerblue','cornsilk','crimson','cyan','darkblue','darkcyan','darkgoldenrod','darkgray',
  'darkgreen','darkgrey','darkkhaki','darkmagenta','darkolivegreen','darkorange','darkorchid',
  'darkred','darksalmon','darkseagreen','darkslateblue','darkslategray','darkslategrey',
  'darkturquoise','darkviolet','deeppink','deepskyblue','dimgray','dimgrey','dodgerblue',
  'firebrick','floralwhite','forestgreen','fuchsia','gainsboro','ghostwhite','gold','goldenrod',
  'gray','green','greenyellow','grey','honeydew','hotpink','indianred','indigo','ivory','khaki',
  'lavender','lavenderblush','lawngreen','lemonchiffon','lightblue','lightcoral','lightcyan',
  'lightgoldenrodyellow','lightgray','lightgreen','lightgrey','lightpink','lightsalmon',
  'lightseagreen','lightskyblue','lightslategray','lightslategrey','lightsteelblue','lightyellow',
  'lime','limegreen','linen','magenta','maroon','mediumaquamarine','mediumblue','mediumorchid',
  'mediumpurple','mediumseagreen','mediumslateblue','mediumspringgreen','mediumturquoise',
  'mediumvioletred','midnightblue','mintcream','mistyrose','moccasin','navajowhite','navy',
  'oldlace','olive','olivedrab','orange','orangered','orchid','palegoldenrod','palegreen',
  'paleturquoise','palevioletred','papayawhip','peachpuff','peru','pink','plum','powderblue',
  'purple','rebeccapurple','red','rosybrown','royalblue','saddlebrown','salmon','sandybrown',
  'seagreen','seashell','sienna','silver','skyblue','slateblue','slategray','slategrey','snow',
  'springgreen','steelblue','tan','teal','thistle','tomato','turquoise','violet','wheat',
  'white','whitesmoke','yellow','yellowgreen',
]);

function parseColorValue(token) {
  const t = token.trim().toLowerCase();
  if (/^#([0-9a-f]{3,8})$/.test(t)) return t;
  if (/^rgba?\s*\(/.test(t) || /^hsla?\s*\(/.test(t)) return t;
  if (CSS_NAMED_COLORS.has(t)) return t;
  return null;
}

function renderColorSwatches() {
  if (!cssIdeEditor) return;

  // Clear previous widgets
  cssIdeColorMarks.forEach(m => m.clear());
  cssIdeColorMarks = [];

  const totalLines = cssIdeEditor.lineCount();
  for (let ln = 0; ln < totalLines; ln++) {
    const tokens = cssIdeEditor.getLineTokens(ln);
    for (const tok of tokens) {
      const color = parseColorValue(tok.string);
      if (!color) continue;

      const swatch = document.createElement('span');
      swatch.className = 'cm-color-swatch';
      swatch.style.background = color;

      const mark = cssIdeEditor.setBookmark(
        { line: ln, ch: tok.start },
        { widget: swatch, insertLeft: true }
      );
      mark._isSwatch = true;
      cssIdeColorMarks.push(mark);
    }
  }
}

// ─── Docs Tab ─────────────────────────────────────────────────────────────────

const PINNED_DOCS = [
  { title: 'Latest Sync Express',        url: 'https://drive.google.com/drive/folders/1ZGzkhgQgPqYgynC6oTkxw1_N9nA3ocQ1' },
  { title: 'Sync Express Child Theme',   url: 'https://drive.google.com/drive/folders/15W7CkTwmeHxOIT0GYY-mJ3Nv5oLpsKgL' },
  { title: "IT SOP's",                   url: 'https://drive.google.com/drive/folders/1c-z3qmA0c38oq6BKkIl1jj8X_OXaPCAi' },
  { title: "Sync SOP's",                 url: 'https://drive.google.com/drive/folders/1i74JyMOQvqZijVV6mZB841eTvKoqlOx4' },
  { title: "Sync Express SOP's",         url: 'https://drive.google.com/drive/folders/1NkoUUbfRe-aziOZReX76MILxgzdgP3Qt' },
  { title: 'Sync Express Install Guide', url: 'https://docs.google.com/document/d/15eK_hCvxPA2u3BVfjmUAvAEQ4IqUMd9oCOnuR6XV2aM/edit?tab=t.0#heading=h.pdm5fi2akt2b' },
  { title: 'Sync Acquire User Manual',   url: 'https://docs.google.com/document/d/1G2WL8e6Y3cuXia_UeKoks4U8qCQQ4SFcVdnirZm5WSg/edit?tab=t.w9lk7i3ra967#heading=h.690z1psrtwyh' },
];

let userDocs      = [];  // loaded from storage
let docsEditingId = null; // id of doc currently being edited

function docTypeIcon(url) {
  if (url.includes('drive.google.com/drive/folders')) {
    // Folder icon
    return `<svg class="docs-type-icon" viewBox="0 0 16 16" fill="none" width="14" height="14">
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3.086a1.5 1.5 0 0 1 1.06.44l.915.914A1.5 1.5 0 0 0 9.62 4.9H12.5A1.5 1.5 0 0 1 14 6.4V12a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12V4.5Z" stroke="currentColor" stroke-width="1.3"/>
    </svg>`;
  }
  // Doc icon (default)
  return `<svg class="docs-type-icon" viewBox="0 0 16 16" fill="none" width="14" height="14">
    <rect x="3" y="1.5" width="10" height="13" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
    <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`;
}

function setupDocsTab() {
  renderPinnedDocs();
  loadUserDocs();

  document.getElementById('docsAddBtn').addEventListener('click', openDocsAddForm);
  document.getElementById('docsFormCancel').addEventListener('click', closeDocsForm);
  document.getElementById('docsFormSave').addEventListener('click', saveDocsForm);

  document.getElementById('docsFormTitle').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('docsFormUrl').focus();
    if (e.key === 'Escape') closeDocsForm();
  });
  document.getElementById('docsFormUrl').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveDocsForm();
    if (e.key === 'Escape') closeDocsForm();
  });
}

function renderPinnedDocs() {
  const list = document.getElementById('docsPinnedList');
  if (!PINNED_DOCS.length) {
    list.innerHTML = '<div class="docs-empty">No pinned resources yet.</div>';
    return;
  }
  list.innerHTML = PINNED_DOCS.map(doc => `
    <a class="docs-item docs-item-pinned" href="${escapeHtml(doc.url)}" target="_blank" rel="noopener noreferrer">
      ${docTypeIcon(doc.url)}
      <span class="docs-item-title">${escapeHtml(doc.title)}</span>
      <svg class="docs-item-arrow" viewBox="0 0 10 10" fill="none" width="10" height="10">
        <path d="M2 8l6-6M4 2h4v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </a>
  `).join('');
}

async function loadUserDocs() {
  try {
    const resp = await send({ type: 'GET_DOCS' });
    userDocs = resp.docs || [];
  } catch (_) { userDocs = []; }
  renderUserDocs();
}

async function saveUserDocs() {
  try { await send({ type: 'SAVE_DOCS', docs: userDocs }); } catch (_) {}
}

function renderUserDocs() {
  const list = document.getElementById('docsUserList');
  if (!userDocs.length) {
    list.innerHTML = '<div class="docs-empty">No docs saved yet.</div>';
    return;
  }
  list.innerHTML = '';
  userDocs.forEach(doc => {
    const el = document.createElement('div');
    el.className = 'docs-item';
    el.dataset.id = doc.id;
    el.innerHTML = `
      <a class="docs-item-link" href="${escapeHtml(doc.url)}" target="_blank" rel="noopener noreferrer">
        ${docTypeIcon(doc.url)}
        <span class="docs-item-title">${escapeHtml(doc.title)}</span>
        <svg class="docs-item-arrow" viewBox="0 0 10 10" fill="none" width="10" height="10">
          <path d="M2 8l6-6M4 2h4v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </a>
      <div class="docs-item-actions">
        <button class="docs-edit-btn" data-id="${doc.id}" title="Edit">Edit</button>
        <button class="docs-delete-btn" data-id="${doc.id}" title="Delete">Delete</button>
      </div>
    `;
    el.querySelector('.docs-edit-btn').addEventListener('click', () => openDocsEditForm(doc.id));
    el.querySelector('.docs-delete-btn').addEventListener('click', () => deleteDoc(doc.id));
    list.appendChild(el);
  });
}

function openDocsAddForm() {
  docsEditingId = null;
  document.getElementById('docsFormTitle').value = '';
  document.getElementById('docsFormUrl').value = '';
  document.getElementById('docsFormSave').textContent = 'Save';
  document.getElementById('docsAddForm').classList.remove('hidden');
  document.getElementById('docsAddBtn').classList.add('hidden');
  document.getElementById('docsFormTitle').focus();
}

function openDocsEditForm(id) {
  const doc = userDocs.find(d => d.id === id);
  if (!doc) return;
  docsEditingId = id;
  document.getElementById('docsFormTitle').value = doc.title;
  document.getElementById('docsFormUrl').value = doc.url;
  document.getElementById('docsFormSave').textContent = 'Update';
  document.getElementById('docsAddForm').classList.remove('hidden');
  document.getElementById('docsAddBtn').classList.add('hidden');
  document.getElementById('docsFormTitle').focus();
}

function closeDocsForm() {
  docsEditingId = null;
  document.getElementById('docsAddForm').classList.add('hidden');
  document.getElementById('docsAddBtn').classList.remove('hidden');
}

async function saveDocsForm() {
  const title = document.getElementById('docsFormTitle').value.trim();
  const url   = document.getElementById('docsFormUrl').value.trim();
  if (!title || !url) return;

  if (docsEditingId) {
    const doc = userDocs.find(d => d.id === docsEditingId);
    if (doc) { doc.title = title; doc.url = url; }
  } else {
    userDocs.push({ id: Date.now().toString(), title, url });
  }

  await saveUserDocs();
  closeDocsForm();
  renderUserDocs();
}

async function deleteDoc(id) {
  userDocs = userDocs.filter(d => d.id !== id);
  await saveUserDocs();
  renderUserDocs();
}

// ─── Status Bar ──────────────────────────────────────────────────────────────

const SB_PROVIDER_ICONS = {
  claude:   'icons/models/claude.png',
  deepseek: 'icons/models/deepseek.png',
  ollama:   'icons/models/ollama.png',
};
const SB_PROVIDER_LABELS = { claude: 'Claude', deepseek: 'DeepSeek', ollama: 'Ollama' };

function setupStatusBar() {
  // Provider
  document.getElementById('sbProviderBtn').addEventListener('click', e => {
    e.stopPropagation();
    toggleSbPopover('sbProviderPopover');
  });
  document.querySelectorAll('#sbProviderPopover .sb-popover-item').forEach(item => {
    item.addEventListener('click', async () => {
      closeSbPopovers();
      await saveStatusBarSetting('aiBackend', item.dataset.value);
    });
  });

  // Model (dynamic items — delegated)
  document.getElementById('sbModelBtn').addEventListener('click', e => {
    e.stopPropagation();
    toggleSbPopover('sbModelPopover');
  });
  document.getElementById('sbModelPopover').addEventListener('click', async e => {
    const item = e.target.closest('.sb-popover-item');
    if (!item) return;
    const backend = document.querySelector('#backendToggle .toggle-opt.active')?.dataset.value || 'claude';
    const key = backend === 'deepseek' ? 'deepseekModel' : 'claudeModel';
    closeSbPopovers();
    await saveStatusBarSetting(key, item.dataset.value);
  });

  // Mode
  document.getElementById('sbModeBtn').addEventListener('click', e => {
    e.stopPropagation();
    toggleSbPopover('sbModePopover');
  });
  document.querySelectorAll('#sbModePopover .sb-popover-item').forEach(item => {
    item.addEventListener('click', async () => {
      closeSbPopovers();
      await saveStatusBarSetting('cssMode', item.dataset.value);
    });
  });

  // Global dismiss
  document.addEventListener('click', closeSbPopovers);
}

function toggleSbPopover(id) {
  const el = document.getElementById(id);
  const wasHidden = el.classList.contains('hidden');
  closeSbPopovers();
  if (wasHidden) el.classList.remove('hidden');
}

function closeSbPopovers() {
  document.querySelectorAll('.statusbar-popover').forEach(p => p.classList.add('hidden'));
}

function updateStatusBar(settings) {
  const backend  = settings.aiBackend  || 'claude';
  const cssMode  = settings.cssMode    || 'full';

  // ── Provider ──
  const iconEl = document.getElementById('sbProviderIcon');
  iconEl.src = SB_PROVIDER_ICONS[backend] || '';
  iconEl.style.display = '';
  document.getElementById('sbProviderLabel').textContent = SB_PROVIDER_LABELS[backend] || backend;
  document.querySelectorAll('#sbProviderPopover .sb-popover-item').forEach(item => {
    const active = item.dataset.value === backend;
    item.classList.toggle('selected', active);
    item.querySelector('.sb-check').classList.toggle('hidden', !active);
  });

  // ── Model ──
  const modelWrap = document.getElementById('sbModelWrap');
  if (backend === 'ollama') {
    modelWrap.classList.add('hidden');
  } else {
    modelWrap.classList.remove('hidden');
    const models = backend === 'deepseek' ? DEEPSEEK_MODELS : CLAUDE_MODELS;
    const currentId = backend === 'deepseek'
      ? (settings.deepseekModel || 'deepseek-v4-flash')
      : (settings.claudeModel   || 'claude-sonnet-4-6');
    const active = models.find(m => m.id === currentId) || models[0];
    document.getElementById('sbModelLabel').textContent = active ? active.label : currentId;

    document.getElementById('sbModelPopover').innerHTML = models.map(m => `
      <button class="sb-popover-item${m.id === currentId ? ' selected' : ''}" data-value="${m.id}">
        <span>${escapeHtml(m.label)}</span>
        <svg class="sb-check${m.id === currentId ? '' : ' hidden'}" viewBox="0 0 12 12" fill="none">
          <path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    `).join('');
  }

  // ── Mode ──
  document.getElementById('sbModeLabel').textContent = cssMode === 'patch' ? 'Patch Mode' : 'Full Rewrite';
  document.querySelectorAll('#sbModePopover .sb-popover-item').forEach(item => {
    const active = item.dataset.value === cssMode;
    item.classList.toggle('selected', active);
    item.querySelector('.sb-check').classList.toggle('hidden', !active);
  });
}

const SB_IS_MAC = navigator.platform.startsWith('Mac') || navigator.userAgent.includes('Mac OS');

function updateStatusBarMode(panel) {
  document.getElementById('sbModeWrap').classList.toggle('hidden', panel !== 'agent');
  document.getElementById('statusBar').classList.toggle('hidden', panel === 'docs');

  const hint = document.getElementById('sbShortcutHint');
  hint.classList.toggle('hidden', panel !== 'css');
  if (panel === 'css') {
    document.getElementById('sbShortcutKey').textContent = SB_IS_MAC ? '⌘i' : 'Ctrl+i';
  }
}

async function saveStatusBarSetting(key, value) {
  try {
    const settings = await send({ type: 'GET_SETTINGS' });
    settings[key] = value;
    await send({ type: 'SAVE_SETTINGS', settings });
    applySettingsToForm(settings);
    updateStatusBar(settings);
  } catch (e) {
    console.error('[StatusBar]', e);
  }
}

// ─── CSS Inline Chat ──────────────────────────────────────────────────────────

let cssInlineChat = null; // { lineWidget, port, from, to, el }

function openInlineChat() {
  const sel = cssIdeEditor.getSelection();
  if (!sel.trim()) return; // nothing selected

  // Close any existing inline chat first
  closeInlineChat();

  const from = cssIdeEditor.getCursor('from');
  const to   = cssIdeEditor.getCursor('to');

  const el = document.createElement('div');
  el.className = 'css-inline-chat';
  renderInlineChatInput(el);

  const lineWidget = cssIdeEditor.addLineWidget(to.line, el, {
    above: false,
    handleMouseEvents: true,
    noHScroll: true,
  });

  cssInlineChat = { lineWidget, port: null, from, to, el, selectedCss: sel };

  // Focus the input after the widget is inserted
  requestAnimationFrame(() => {
    const input = el.querySelector('.css-inline-chat-input');
    if (input) input.focus();
  });
}

function closeInlineChat() {
  if (!cssInlineChat) return;
  if (cssInlineChat.port) { try { cssInlineChat.port.disconnect(); } catch (_) {} }
  cssInlineChat.lineWidget.clear();
  cssInlineChat = null;
  cssIdeEditor.focus();
}

function renderInlineChatInput(el) {
  el.innerHTML = `
    <div class="css-inline-chat-row">
      <span class="css-inline-chat-icon">✦</span>
      <input class="css-inline-chat-input" type="text" placeholder="Rewrite instruction…" spellcheck="false" autocomplete="off">
      <button class="css-inline-chat-send" title="Send (Enter)">
        <svg viewBox="0 0 14 14" fill="none" width="11" height="11">
          <path d="M2 7h10M7 2l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button class="css-inline-chat-dismiss" title="Dismiss (Esc)">
        <svg viewBox="0 0 10 10" fill="none" width="10" height="10">
          <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  `;

  const input = el.querySelector('.css-inline-chat-input');
  el.querySelector('.css-inline-chat-send').addEventListener('click', () => submitInlineChat(input.value));
  el.querySelector('.css-inline-chat-dismiss').addEventListener('click', closeInlineChat);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); submitInlineChat(input.value); }
    if (e.key === 'Escape') { e.preventDefault(); closeInlineChat(); }
  });
}

function submitInlineChat(instruction) {
  if (!instruction.trim() || !cssInlineChat) return;

  const { el, selectedCss } = cssInlineChat;
  let buffer = '';

  // Swap to streaming phase — no raw preview, just a spinner
  el.innerHTML = `
    <div class="css-inline-chat-row css-inline-chat-streaming-row">
      <span class="css-inline-chat-icon css-inline-chat-icon-spin">✦</span>
      <span class="css-inline-chat-label">Uploading…</span>
      <button class="css-inline-chat-dismiss" title="Stop">
        <svg viewBox="0 0 10 10" fill="none" width="10" height="10">
          <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  `;
  el.querySelector('.css-inline-chat-dismiss').addEventListener('click', closeInlineChat);
  cssInlineChat.lineWidget.changed();

  // Track which phase we're in: uploading → thinking → generating
  // "generating" kicks in once we see a CSS brace in the stream buffer
  let inlinePhase = 'uploading';

  const port = chrome.runtime.connect({ name: 'css-inline-rewrite' });
  cssInlineChat.port = port;

  port.onMessage.addListener(msg => {
    if (msg.type === 'INLINE_CHUNK') {
      buffer += msg.text;

      // Advance phase: uploading → thinking on first chunk, thinking → generating on first '{'
      if (inlinePhase === 'uploading') {
        inlinePhase = 'thinking';
      }
      if (inlinePhase === 'thinking' && buffer.includes('{')) {
        inlinePhase = 'generating';
      }

      const label = el.querySelector('.css-inline-chat-label');
      if (label) {
        label.textContent = inlinePhase === 'generating'
          ? `Generating… (${buffer.length} chars)`
          : `Thinking… (${buffer.length} chars)`;
      }

    } else if (msg.type === 'INLINE_DONE') {
      const finalCss = cleanInlineCss(msg.css || buffer);
      cssInlineChat.port = null;
      renderInlineChatResult(el, finalCss);

    } else if (msg.type === 'INLINE_ERROR') {
      const label = el.querySelector('.css-inline-chat-label');
      const icon  = el.querySelector('.css-inline-chat-icon');
      if (label) { label.textContent = msg.error; label.style.color = 'var(--danger)'; }
      if (icon)  icon.classList.remove('css-inline-chat-icon-spin');
      cssInlineChat.port = null;
      cssInlineChat.lineWidget.changed();
    }
  });

  port.onDisconnect.addListener(() => {
    if (cssInlineChat) cssInlineChat.port = null;
  });

  port.postMessage({ type: 'INLINE_REWRITE', selectedCss, instruction });
}

function renderInlineChatResult(el, finalCss) {
  const originalCss = cssInlineChat.selectedCss || '';
  const diff        = computeLineDiff(originalCss.trim(), finalCss.trim());
  const hasChanges  = diff.some(d => d.type !== 'same');

  const diffHtml = diff.map(({ type, line }) => {
    const prefix = type === 'add' ? '+' : type === 'remove' ? '−' : ' ';
    const cls    = type === 'add' ? 'css-diff-add' : type === 'remove' ? 'css-diff-remove' : 'css-diff-same';
    return `<div class="css-diff-line ${cls}"><span class="css-diff-prefix">${prefix}</span><span class="css-diff-text">${escapeHtml(line)}</span></div>`;
  }).join('');

  el.innerHTML = `
    <div class="css-inline-chat-row css-inline-chat-done-row">
      <span class="css-inline-chat-icon">✦</span>
      <span class="css-inline-chat-label css-inline-chat-label-done">${hasChanges ? 'Review changes' : 'No changes'}</span>
      <button class="css-inline-chat-apply btn-primary btn-sm">Apply</button>
      <button class="css-inline-chat-dismiss btn-secondary btn-sm">Discard</button>
    </div>
    <div class="css-inline-diff">${diffHtml || '<div class="css-diff-empty">No output returned.</div>'}</div>
  `;
  el.querySelector('.css-inline-chat-apply').addEventListener('click', () => applyInlineRewrite(finalCss));
  el.querySelector('.css-inline-chat-dismiss').addEventListener('click', closeInlineChat);
  cssInlineChat.lineWidget.changed();
}

function applyInlineRewrite(newCss) {
  if (!cssInlineChat) return;
  const { from, to } = cssInlineChat;
  closeInlineChat();
  cssIdeEditor.replaceRange(newCss, from, to);
  cssIdeEditor.focus();
}

function cleanInlineCss(text) {
  return text
    .replace(/<css>\s*/gi, '')
    .replace(/\s*<\/css>/gi, '')
    .replace(/^```[\w]*\r?\n?/m, '')
    .replace(/\r?\n?```\s*$/m, '')
    .trim();
}

// LCS-based line diff — returns array of { type: 'same'|'add'|'remove', line: string }
function computeLineDiff(oldText, newText) {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const m = a.length;
  const n = b.length;

  // Guard against O(m×n) blowup on giant blocks
  if (m * n > 20000) {
    return [
      ...a.map(line => ({ type: 'remove', line })),
      ...b.map(line => ({ type: 'add',    line })),
    ];
  }

  // dp[i][j] = LCS length of a[i..] vs b[j..]
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Walk table to emit diff entries (removes grouped before adds at each hunk)
  const result = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      result.push({ type: 'same', line: a[i] });
      i++; j++;
    } else if (i < m && (j >= n || dp[i + 1][j] >= dp[i][j + 1])) {
      result.push({ type: 'remove', line: a[i] });
      i++;
    } else {
      result.push({ type: 'add', line: b[j] });
      j++;
    }
  }
  return result;
}

// ─── Tab Mismatch ─────────────────────────────────────────────────────────────

function setupTabMismatch() {
  document.getElementById('tabMismatchSwitch').addEventListener('click', async () => {
    if (!state.siteTabId) return;
    try { await chrome.tabs.update(state.siteTabId, { active: true }); } catch (_) {}
  });

  document.getElementById('tabMismatchReset').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab) {
        state.siteTabId = tab.id;
        state.siteTabTitle = tab.title || 'this tab';
        hideTabMismatch();
      }
    } catch (_) {}
  });
}

function showTabMismatch(currentTabTitle) {
  const desc = document.getElementById('tabMismatchDesc');
  desc.textContent = state.siteTabTitle
    ? `You're on "${currentTabTitle || 'another tab'}". Switch back to "${state.siteTabTitle}" to continue.`
    : 'Switch back to your site tab to continue.';
  document.getElementById('tabMismatchOverlay').classList.remove('hidden');
}

function hideTabMismatch() {
  document.getElementById('tabMismatchOverlay').classList.add('hidden');
}

function listenForTabChanges() {
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type !== 'TAB_ACTIVATED') return;
    if (!state.siteTabId) return;
    if (msg.tabId === state.siteTabId) {
      hideTabMismatch();
    } else {
      showTabMismatch(msg.tabTitle);
    }
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
