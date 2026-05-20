// Sync Styler — Side Panel UI

const state = {
  screenshotDataUrl: null,
  screenshotTime: null,
  designRefDataUrl: null,
  designRefCollapsed: false,
  originalCss: null,
  lastGeneratedCss: null,
  patchPreview: null,
  isFullRewrite: false,
  viewingFull: false,
  generatePort: null,
  stopping: false,
  changelist: [],
  messageHistory: [],
  applied: false,
  scopeMode: 'all',     // 'all' | '1' | '2' | '3' | '4' | '5'
  chatHistory: [],
  siteTabId: null,      // tab this panel is locked to
  siteTabTitle: null,
  cssContextChars: null, // cached char count of current WP CSS, null = unknown
};

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  await loadSettings();
  await loadDesignRef();
  setupDesignRefStrip();
  setupMainTabs();
  setupSettings();
  setupSetupTab();
  setupWorkflowTab();
  setupScopeButtons();
  setupHelper();
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
      document.getElementById('newChat').classList.toggle('hidden', panel !== 'helper');
    });
  });

  document.getElementById('newChat').addEventListener('click', () => {
    state.chatHistory = [];
    document.getElementById('chatMessages').innerHTML = '';
    document.getElementById('chatInput').value = '';
    document.getElementById('chatInput').style.height = 'auto';
    updateTokenCounter();
  });
}

// ─── Helper (Chat) ────────────────────────────────────────────────────────────

function setupHelper() {
  const input = document.getElementById('chatInput');
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

  document.getElementById('chatIncludeDom').addEventListener('change', updateTokenCounter);
  document.getElementById('chatIncludeCss').addEventListener('change', async e => {
    if (e.target.checked) {
      state.cssContextChars = null;
      updateTokenCounter();
      try {
        const resp = await send({ type: 'GET_CSS_CHARS' });
        state.cssContextChars = resp.chars ?? 0;
      } catch (_) {
        state.cssContextChars = 0;
      }
    } else {
      state.cssContextChars = null;
    }
    updateTokenCounter();
  });

  sendBtn.addEventListener('click', handleChatSend);
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

  // Add context injection estimates when toggles are on
  if (document.getElementById('chatIncludeDom').checked) {
    chars += 12000; // ~200 nodes × 60 chars each
  }
  if (document.getElementById('chatIncludeCss').checked) {
    // Use fetched size if available, otherwise show a pending marker
    if (state.cssContextChars === null) {
      el.textContent = '~… tokens';
      return;
    }
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
  const text = input.value.trim();
  if (!text) return;

  const sendBtn = document.getElementById('chatSend');
  input.value = '';
  input.style.height = 'auto';
  sendBtn.disabled = true;

  const domToggle = document.getElementById('chatIncludeDom');
  const cssToggle = document.getElementById('chatIncludeCss');
  const includeDom = domToggle.checked;
  const includeExistingCss = cssToggle.checked;
  domToggle.checked = false;
  cssToggle.checked = false;
  updateTokenCounter();

  appendChatMessage('user', text);

  const assistantEl = appendChatMessage('assistant', '');
  assistantEl.classList.add('streaming');

  let buffer = '';

  const port = chrome.runtime.connect({ name: 'chat' });

  port.onMessage.addListener(msg => {
    if (msg.type === 'CHAT_CONTEXT_INJECTED') {
      const memo = appendChatMemo(`↳ context injected: ${msg.note}`);
      assistantEl.before(memo);

    } else if (msg.type === 'CHAT_DEBUG') {
      const note = document.createElement('div');
      note.className = 'debug-note';
      note.textContent = msg.text;
      assistantEl.before(note);

    } else if (msg.type === 'CHAT_CHUNK') {
      buffer += msg.text;
      const thinking = isThinking(buffer);
      const content = extractThought(buffer);
      if (thinking) {
        assistantEl.innerHTML = '<span class="chat-thinking">Thinking…</span>';
      } else {
        assistantEl.innerHTML = renderChatMarkdown(content);
      }
      assistantEl.scrollIntoView({ block: 'end' });
    } else if (msg.type === 'CHAT_DONE') {
      assistantEl.classList.remove('streaming');
      state.chatHistory = msg.history;
      sendBtn.disabled = false;
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
    includeDom,
    includeExistingCss,
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
  const segments = text.split(/(```(?:\w*\n?)?[\s\S]*?```)/g);
  return segments.map(seg => {
    const match = seg.match(/^```(?:\w+)?\n?([\s\S]*?)```$/);
    if (match) {
      return `<pre class="chat-code-block"><code>${escapeHtml(match[1])}</code></pre>`;
    }
    return `<span class="chat-text">${escapeHtml(seg)}</span>`;
  }).join('');
}

function appendChatMessage(role, text) {
  const el = document.createElement('div');
  el.className = role === 'user' ? 'chat-msg-user' : 'chat-msg-assistant';
  if (role === 'user') {
    el.textContent = text;
  } else {
    el.innerHTML = renderChatMarkdown(text);
  }
  const container = document.getElementById('chatMessages');
  container.appendChild(el);
  el.scrollIntoView({ block: 'end' });
  return el;
}

// ─── Settings Panel ───────────────────────────────────────────────────────────

function setupSettings() {
  document.getElementById('openSettings').addEventListener('click', () => {
    document.getElementById('settingsPanel').classList.remove('hidden');
    loadBackups();
  });
  document.getElementById('closeSettings').addEventListener('click', () => {
    document.getElementById('settingsPanel').classList.add('hidden');
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
}

// ─── Backups ──────────────────────────────────────────────────────────────────

// ─── Design Reference Strip ───────────────────────────────────────────────────

async function loadDesignRef() {
  try {
    const { dataUrl } = await send({ type: 'GET_DESIGN_REF' });
    state.designRefDataUrl = dataUrl;
  } catch (e) { /* no ref saved */ }
}

function setupDesignRefStrip() {
  const strip = document.getElementById('designRefStrip');
  const empty = document.getElementById('designRefEmpty');
  const filled = document.getElementById('designRefFilled');
  const bar = document.getElementById('designRefBar');
  const input = document.getElementById('designRefInput');
  const thumb = document.getElementById('designRefThumb');
  const thumbMini = document.getElementById('designRefThumbMini');
  const name = document.getElementById('designRefName');

  function renderStrip() {
    const has = !!state.designRefDataUrl;
    const collapsed = state.designRefCollapsed;
    empty.classList.toggle('hidden', has);
    filled.classList.toggle('hidden', !has || collapsed);
    bar.classList.toggle('hidden', !has || !collapsed);
    if (has) {
      thumb.src = state.designRefDataUrl;
      thumbMini.src = state.designRefDataUrl;
    }
  }

  function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async e => {
      state.designRefDataUrl = e.target.result;
      state.designRefCollapsed = false;
      renderStrip();
      try { await send({ type: 'SAVE_DESIGN_REF', dataUrl: state.designRefDataUrl }); } catch (e) {}
    };
    reader.readAsDataURL(file);
  }

  async function clearRef() {
    state.designRefDataUrl = null;
    state.designRefCollapsed = false;
    renderStrip();
    try { await send({ type: 'CLEAR_DESIGN_REF' }); } catch (e) {}
  }

  // Drag and drop on empty state
  strip.addEventListener('dragover', e => { e.preventDefault(); empty.style.background = 'var(--bg-surface-hover)'; });
  strip.addEventListener('dragleave', () => { empty.style.background = ''; });
  strip.addEventListener('drop', e => {
    e.preventDefault();
    empty.style.background = '';
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  // Click empty area to browse
  empty.addEventListener('click', () => input.click());
  document.getElementById('designRefBrowse').addEventListener('click', e => { e.stopPropagation(); input.click(); });
  input.addEventListener('change', () => { if (input.files[0]) loadFile(input.files[0]); input.value = ''; });

  // Collapse / expand
  document.getElementById('designRefCollapse').addEventListener('click', () => {
    state.designRefCollapsed = true; renderStrip();
  });
  document.getElementById('designRefExpand').addEventListener('click', () => {
    state.designRefCollapsed = false; renderStrip();
  });

  // Clear
  document.getElementById('designRefClear').addEventListener('click', clearRef);
  document.getElementById('designRefClearBar').addEventListener('click', clearRef);

  renderStrip();
}

// ─── Setup Tab ────────────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const settings = await send({ type: 'GET_SETTINGS' });
    applySettingsToForm(settings);
  } catch (e) {}
}

function applySettingsToForm(s) {
  document.getElementById('claudeApiKey').value = s.claudeApiKey || '';
  document.getElementById('claudeModel').value = s.claudeModel || 'claude-sonnet-4-6';
  document.getElementById('ollamaUrl').value = s.ollamaUrl || 'http://localhost:11434';
  document.getElementById('ollamaModel').value = s.ollamaModel || 'llama3';
  document.getElementById('ollamaVisionModel').value = s.ollamaVisionModel || 'llava';
  document.getElementById('cfClientId').value = s.cfClientId || '';
  document.getElementById('cfClientSecret').value = s.cfClientSecret || '';
  document.getElementById('autoPublish').checked = !!s.autoPublish;
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
  document.getElementById('ollamaConfig').classList.toggle('hidden', value !== 'ollama');
}

function setupSetupTab() {
  document.querySelectorAll('#backendToggle .toggle-opt').forEach(btn => {
    btn.addEventListener('click', () => setBackend(btn.dataset.value));
  });

  document.getElementById('testOllama').addEventListener('click', async () => {
    const btn = document.getElementById('testOllama');
    const status = document.getElementById('ollamaTestStatus');
    btn.disabled = true;
    btn.textContent = 'Testing…';
    status.className = 'ollama-test-status';
    status.textContent = '';
    try {
      const result = await send({
        type: 'TEST_OLLAMA',
        url: document.getElementById('ollamaUrl').value.trim() || 'http://localhost:11434',
        cfClientId: document.getElementById('cfClientId').value.trim(),
        cfClientSecret: document.getElementById('cfClientSecret').value.trim(),
      });
      status.textContent = `✓ ${result.message}`;
      status.classList.add('test-ok');
    } catch (e) {
      status.textContent = `✗ ${e.message}`;
      status.classList.add('test-fail');
    } finally {
      status.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Test Connection';
    }
  });

  document.querySelectorAll('#cssModeToggle .toggle-opt').forEach(btn => {
    btn.addEventListener('click', () => setCssMode(btn.dataset.value));
  });

  document.getElementById('saveSettings').addEventListener('click', async () => {
    const backend = document.querySelector('#backendToggle .toggle-opt.active')?.dataset.value || 'claude';
    const cssMode = document.querySelector('#cssModeToggle .toggle-opt.active')?.dataset.value || 'full';
    const settings = {
      aiBackend: backend,
      claudeApiKey: document.getElementById('claudeApiKey').value.trim(),
      claudeModel: document.getElementById('claudeModel').value.trim() || 'claude-sonnet-4-6',
      ollamaUrl: document.getElementById('ollamaUrl').value.trim() || 'http://localhost:11434',
      ollamaModel: document.getElementById('ollamaModel').value.trim() || 'llama3',
      ollamaVisionModel: document.getElementById('ollamaVisionModel').value.trim() || 'llava',
      cfClientId: document.getElementById('cfClientId').value.trim(),
      cfClientSecret: document.getElementById('cfClientSecret').value.trim(),
      autoPublish: document.getElementById('autoPublish').checked,
      maxRollbacks: 20,
      cssMode,
    };
    try {
      await send({ type: 'SAVE_SETTINGS', settings });
      const confirm = document.getElementById('saveConfirm');
      confirm.classList.remove('hidden');
      setTimeout(() => confirm.classList.add('hidden'), 2000);
    } catch (e) {
      showError(e.message);
    }
  });
}

// ─── Workflow Tab ─────────────────────────────────────────────────────────────

function setupWorkflowTab() {
  document.getElementById('takeScreenshot').addEventListener('click', handleTakeScreenshot);
  document.getElementById('generateCss').addEventListener('click', handleGenerate);
  document.getElementById('reconsolidate').addEventListener('click', handleReconsolidate);
  document.getElementById('applyChanges').addEventListener('click', handleApply);
  document.getElementById('revise').addEventListener('click', handleRevise);
  document.getElementById('cssBlock').addEventListener('input', autoResizeCssBlock);
  document.getElementById('toggleCssView').addEventListener('click', handleToggleCssView);
  document.getElementById('stopGenerate').addEventListener('click', () => {
    if (state.generatePort) {
      state.stopping = true;
      state.generatePort.disconnect();
      state.generatePort = null;
      // port.onDisconnect doesn't fire on the initiating side, so clean up manually
      document.getElementById('stopGenerate').classList.add('hidden');
      document.getElementById('cssBlock').disabled = false;
      document.getElementById('cssBlock').placeholder = '';
      setLoading(document.getElementById('generateCss'), false, 'Generate CSS');
      setLoading(document.getElementById('reconsolidate'), false, 'Reconsolidate CSS');
    }
  });
}

async function handleTakeScreenshot() {
  const btn = document.getElementById('takeScreenshot');
  setLoading(btn, true, 'Capturing…');
  clearError();
  try {
    const { dataUrl, tabId, tabTitle } = await send({ type: 'TAKE_SCREENSHOT' });
    state.screenshotDataUrl = dataUrl;
    state.screenshotTime = new Date();
    state.siteTabId = tabId;
    state.siteTabTitle = tabTitle || 'Site Tab';

    const img = document.getElementById('screenshotImg');
    img.src = dataUrl;
    document.getElementById('screenshotTime').textContent =
      `Captured at ${state.screenshotTime.toLocaleTimeString()} — will be sent with next request`;
    document.getElementById('screenshotEmpty').classList.add('hidden');
    document.getElementById('screenshotFilled').classList.remove('hidden');
    hideTabMismatch();
  } catch (e) {
    showError(e.message);
  } finally {
    setLoading(btn, false, 'Take Screenshot');
  }
}

async function handleReconsolidate() {
  clearError();
  const btn = document.getElementById('reconsolidate');
  setLoading(btn, true, 'Reconsolidating…');

  streamGenerate({
    instructions: '__reconsolidate__',
    baseCss: undefined,
    history: [],
    siteTabId: state.siteTabId,
    stepScope: null,
    onDone: () => setLoading(btn, false, 'Reconsolidate CSS'),
    onError: () => setLoading(btn, false, 'Reconsolidate CSS'),
  });
}

async function handleGenerate() {
  const instructions = document.getElementById('instructions').value.trim();
  if (!instructions) {
    showError('Please enter instructions before generating.');
    return;
  }
  clearError();
  const btn = document.getElementById('generateCss');
  setLoading(btn, true, 'Generating…');

  streamGenerate({
    instructions,
    baseCss: undefined,
    history: [],
    siteTabId: state.siteTabId,
    stepScope: state.scopeMode === 'all' ? null : parseInt(state.scopeMode),
    onDone: () => setLoading(btn, false, 'Generate CSS'),
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

  // Apply
  try {
    setLoading(btn, true, 'Applying…');
    await send({ type: 'SAVE_BACKUP', css: state.originalCss || '' });
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
  if (!revisionText) {
    showError('Please enter revision instructions.');
    return;
  }
  clearError();

  let instructions = revisionText;
  if (state.changelist.length) {
    instructions = `Previous changes:\n${state.changelist.map(c => `- ${c}`).join('\n')}\n\nRevision: ${revisionText}`;
  }

  const btn = document.getElementById('revise');
  setLoading(btn, true, 'Revising…');

  streamGenerate({
    instructions,
    baseCss: state.lastGeneratedCss,
    history: state.messageHistory,
    siteTabId: state.siteTabId,
    stepScope: state.scopeMode === 'all' ? null : parseInt(state.scopeMode),
    onDone: () => {
      setLoading(btn, false, 'Revise');
      document.getElementById('revisionInput').value = '';
    },
    onError: () => setLoading(btn, false, 'Revise'),
  });
}

function handleToggleCssView() {
  const cssBlock = document.getElementById('cssBlock');
  const toggleBtn = document.getElementById('toggleCssView');
  const label = document.getElementById('cssSectionLabel');

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

// ─── Streaming helper ─────────────────────────────────────────────────────────

function streamGenerate({ instructions, baseCss, history, siteTabId, stepScope, onDone, onError }) {
  const cssBlock = document.getElementById('cssBlock');

  showGeneratedCss('');
  cssBlock.value = '';
  cssBlock.disabled = true;
  cssBlock.placeholder = 'Generating…';
  resetApplyButton();
  document.getElementById('stopGenerate').classList.remove('hidden');
  document.getElementById('toggleCssView').classList.add('hidden');

  state.stopping = false;
  let charCount = 0;

  const port = chrome.runtime.connect({ name: 'generate' });
  state.generatePort = port;

  port.onMessage.addListener(msg => {
    if (msg.type === 'CSS_DEBUG') {
      const note = document.getElementById('cssDebugNote');
      note.textContent = msg.text;
      note.classList.remove('hidden');

    } else if (msg.type === 'CSS_RETRY') {
      charCount = 0;
      cssBlock.placeholder = 'Retrying…';

    } else if (msg.type === 'CSS_CHUNK') {
      charCount += msg.text.length;
      cssBlock.placeholder = `Generating… (${charCount} chars)`;

    } else if (msg.type === 'CSS_DONE') {
      state.lastGeneratedCss = msg.css;
      state.originalCss = msg.originalCss;
      state.patchPreview = msg.patchPreview || msg.css;
      state.isFullRewrite = !!msg.isFullRewrite;
      state.viewingFull = state.isFullRewrite;
      state.changelist = msg.changelist || [];
      state.messageHistory = msg.history || [];

      resetApplyButton();

      const label = document.getElementById('cssSectionLabel');
      const toggleBtn = document.getElementById('toggleCssView');

      if (state.isFullRewrite) {
        label.textContent = 'Generated CSS';
        toggleBtn.classList.add('hidden');
        cssBlock.value = msg.css;
      } else {
        label.textContent = 'Changes';
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

      endStream();
      onDone();

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
  }

  port.postMessage({
    type: 'GENERATE_CSS',
    instructions,
    baseCss: baseCss ?? null,
    screenshotDataUrl: state.screenshotDataUrl,
    designRefDataUrl: state.designRefDataUrl,
    history: history || [],
    siteTabId: siteTabId ?? null,
    stepScope: stepScope ?? null,
  });
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
  const patchBlocks = splitBlocks(patchCss);
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

function cssToApply() {
  const cssBlock = document.getElementById('cssBlock');
  let css;
  if (state.viewingFull || state.isFullRewrite) {
    css = cssBlock.value;
  } else {
    css = mergePatchClient(state.originalCss || '', cssBlock.value);
  }
  return css;
}

function autoResizeCssBlock() {
  const el = document.getElementById('cssBlock');
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 320) + 'px';
}

// Strip the <css> wrapper tags from the live stream display
function extractDisplayCss(raw) {
  const open = raw.indexOf('<css>');
  if (open === -1) return raw; // tag not yet received — show raw (usually empty or preamble)
  const contentStart = open + 5;
  const close = raw.indexOf('</css>', contentStart);
  const content = close === -1 ? raw.slice(contentStart) : raw.slice(contentStart, close);
  return content.replace(/^\n/, ''); // trim leading newline after <css>
}

function showGeneratedCss(css) {
  document.getElementById('cssBlock').value = css;
  document.getElementById('generatedSection').classList.remove('hidden');
  document.getElementById('generatedDivider').style.display = '';
  document.getElementById('generatedSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

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

// ─── Backups Tab ──────────────────────────────────────────────────────────────


async function loadBackups() {
  try {
    const { backups } = await send({ type: 'GET_BACKUPS' });
    renderBackups(backups);
  } catch (e) {}
}

function renderBackups(backups) {
  const list = document.getElementById('backupsList');
  const count = document.getElementById('backupsCount');
  count.textContent = `Backups (${backups.length})`;

  if (!backups.length) {
    list.innerHTML = '<div class="backups-empty">No backups yet.</div>';
    return;
  }

  list.innerHTML = '';
  backups.forEach((entry, index) => {
    const date = new Date(entry.timestamp);
    const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      + ' — ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const preview = (entry.css || '').slice(0, 80).replace(/\s+/g, ' ').trim();

    const el = document.createElement('div');
    el.className = 'backup-entry';
    el.innerHTML = `
      <div class="backup-entry-header">
        <span class="backup-timestamp">${formatted}</span>
        <button class="backup-restore" data-index="${index}">Restore</button>
      </div>
      <div class="backup-preview">${preview}${entry.css && entry.css.length > 80 ? '…' : ''}</div>
    `;
    el.querySelector('.backup-restore').addEventListener('click', async () => {
      if (!confirm(`Restore this backup from ${formatted}?`)) return;
      try {
        await send({ type: 'RESTORE_BACKUP', index });
        await loadBackups();
      } catch (e) {
        showError(e.message);
      }
    });
    list.appendChild(el);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Tab Mismatch ─────────────────────────────────────────────────────────────

function setupTabMismatch() {
  document.getElementById('tabMismatchSwitch').addEventListener('click', async () => {
    if (!state.siteTabId) return;
    try {
      await chrome.tabs.update(state.siteTabId, { active: true });
    } catch (_) {}
  });

  document.getElementById('tabMismatchReset').addEventListener('click', async () => {
    // Re-associate with whatever tab is currently active
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
    if (!state.siteTabId) return; // not yet locked to a tab
    if (msg.tabId === state.siteTabId) {
      hideTabMismatch();
    } else {
      showTabMismatch(msg.tabTitle);
    }
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
