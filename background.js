// Sync Styler — Background Service Worker

const SYSTEM_PROMPTS = {
  claude: {
    full: `You are a CSS expert helping style a WordPress marketing site for a product called Sync (a web-based meeting tool).
You will receive the current Additional CSS, a DOM structure summary, and optionally a screenshot and/or design reference image.

Return the COMPLETE rewritten CSS file with your changes applied — additions, edits, and deletions included.
Wrap your response in <css> tags:
<css>
/* complete rewritten CSS here */
</css>

Rules:
- Include every rule from the original file unless it should be removed.
- Make the requested changes precisely — add, edit, or delete as needed.
- Do not output anything outside the <css></css> tags.
- No explanations, no markdown, no code fences.`,

    patch: `You are a CSS expert helping style a WordPress marketing site for a product called Sync (a web-based meeting tool).
You will receive the current Additional CSS, a DOM structure summary, and optionally a screenshot and/or design reference image.

Return ONLY the CSS rules that need to be added or changed — not the entire file.
Wrap your response in <css> tags:
<css>
/* only the new or modified rules */
</css>

Rules:
- Include a rule in full if any part of it changes.
- Do not include rules that are unchanged.
- Do not output anything outside the <css></css> tags.
- No explanations, no markdown, no code fences.`,
  },

  ollama: {
    full: `/no_think
You are a CSS expert. Return the COMPLETE rewritten CSS file with the requested changes applied.
Include every rule from the original unless it should be removed. Make precise additions, edits, and deletions.
Wrap the full file in <css> tags:
<css>
/* complete rewritten CSS here */
</css>
No explanations. No markdown. Nothing outside the <css></css> tags.`,

    patch: `/no_think
You are a CSS expert. Return ONLY the CSS rules that need to be added or changed to fulfil the user's request.
Do NOT return the entire CSS file. Return only new or modified rules, wrapped in <css> tags:
<css>
/* only the changed or new rules here */
</css>
No explanations. No markdown. Nothing outside the <css></css> tags.`,
  },
};

// ─── Init ─────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    chrome.runtime.sendMessage({ type: 'TAB_ACTIVATED', tabId, tabTitle: tab.title || '' }).catch(() => {});
  } catch (_) {}
});

// ─── One-shot messages (settings, backups, write, screenshot) ─────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch(err => {
    console.error('[SyncStyler]', err);
    sendResponse({ error: err.message });
  });
  return true;
});

async function handleMessage(msg) {
  switch (msg.type) {
    case 'TAKE_SCREENSHOT':   return takeScreenshot();
    case 'WRITE_CSS':         return writeCss(msg.css, msg.autoPublish);
    case 'GET_BACKUPS':       return getBackups();
    case 'SAVE_BACKUP':       return saveBackup(msg.css);
    case 'RESTORE_BACKUP':    return restoreBackup(msg.index);
    case 'CLEAR_BACKUPS':     return clearBackups();
    case 'GET_SETTINGS':      return getSettings();
    case 'SAVE_SETTINGS':     return saveSettings(msg.settings);
    case 'GET_DESIGN_REF':    return getDesignRef();
    case 'SAVE_DESIGN_REF':   return saveDesignRef(msg.dataUrl);
    case 'CLEAR_DESIGN_REF':  return clearDesignRef();
    case 'TEST_OLLAMA': {
      const headers = { 'Content-Type': 'application/json' };
      if (msg.cfClientId && msg.cfClientSecret) {
        headers['CF-Access-Client-Id'] = msg.cfClientId;
        headers['CF-Access-Client-Secret'] = msg.cfClientSecret;
      }
      let testResp;
      try {
        testResp = await fetch(msg.url, { headers });
      } catch (e) {
        throw new Error(`Could not reach ${msg.url} — ${e.message}`);
      }
      if (!testResp.ok) throw new Error(`Server returned ${testResp.status}`);
      const text = await testResp.text();
      return { message: text.trim() || 'Connected' };
    }
    case 'GET_CSS_CHARS': {
      const custTab = await findCustomizerTab();
      if (!custTab) return { chars: 0 };
      const css = await readCssFromTab(custTab.id);
      return { chars: css ? css.length : 0 };
    }
    default: throw new Error('Unknown message type: ' + msg.type);
  }
}

// ─── Streaming port (Generate / Revise) ───────────────────────────────────────
// Side panel opens a port named 'generate', posts one GENERATE_CSS message,
// and receives CSS_CHUNK / CSS_DONE / CSS_ERROR messages back.

chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'generate') {
    const controller = new AbortController();
    port.onDisconnect.addListener(() => controller.abort());
    port.onMessage.addListener(async msg => {
      if (msg.type !== 'GENERATE_CSS') return;
      try {
        await generateCssStreaming(msg, port, controller.signal);
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('[SyncStyler stream]', err);
        try { port.postMessage({ type: 'CSS_ERROR', error: err.message }); } catch (_) {}
      }
    });
  }

  if (port.name === 'chat') {
    port.onMessage.addListener(async msg => {
      if (msg.type !== 'CHAT_MESSAGE') return;
      try {
        await streamChatMessage(msg, port);
      } catch (err) {
        try { port.postMessage({ type: 'CHAT_ERROR', error: err.message }); } catch (_) {}
      }
    });
  }
});

async function generateCssStreaming(msg, port, signal) {
  const { instructions, baseCss, screenshotDataUrl, designRefDataUrl, history, stepScope, siteTabId } = msg;
  const settings = await getSettings();

  // Read current CSS
  let currentCss = baseCss ?? null;
  if (currentCss === null) {
    const custTab = await findCustomizerTab();
    if (!custTab) throw new Error('WordPress Customizer tab not found.\nOpen /wp-admin/customize.php in a tab first.');
    currentCss = await readCssFromTab(custTab.id);
  }

  // DOM snapshot from the exact tab the screenshot came from
  let domSnapshot = null;
  let domDebug = 'DOM: no siteTabId — take a screenshot first';
  if (siteTabId) {
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: siteTabId },
        world: 'ISOLATED',
        func: (stepScopeNum) => {
          function snap(root, maxDepth, maxNodes) {
            const nodes = [];
            function walk(el, depth) {
              if (!el || nodes.length >= maxNodes || depth > maxDepth) return;
              if (el.nodeType !== Node.ELEMENT_NODE) return;
              nodes.push({ tag: el.tagName.toLowerCase(), id: el.id || '', classes: Array.from(el.classList).slice(0, 6), depth });
              for (const child of el.children) walk(child, depth + 1);
            }
            walk(root, 0);
            return nodes;
          }
          let root = document.body;
          if (stepScopeNum) {
            root = document.querySelector(`.tab.step${stepScopeNum}`)
              || document.querySelector(`#step${stepScopeNum}`)
              || document.body;
          }
          return snap(root, 6, 200);
        },
        args: [stepScope || null],
      });
      domSnapshot = r.result;
      domDebug = domSnapshot
        ? `DOM: ${domSnapshot.length} nodes from tab ${siteTabId}`
        : `DOM: executeScript returned null for tab ${siteTabId}`;
    } catch (e) {
      domDebug = `DOM: executeScript failed — ${e.message}`;
    }
  }
  port.postMessage({ type: 'CSS_DEBUG', text: domDebug });

  const isReconsolidate = instructions === '__reconsolidate__';
  const backend = settings.aiBackend === 'ollama' ? 'ollama' : 'claude';
  const cssMode = isReconsolidate ? 'full' : (settings.cssMode || 'full');
  const systemPrompt = SYSTEM_PROMPTS[backend][cssMode];

  // Build user message content
  const { userContent } = buildUserContent({
    currentCss, domSnapshot, screenshotDataUrl, designRefDataUrl, instructions, settings, isReconsolidate,
  });

  const messages = [...(history || []), { role: 'user', content: userContent }];

  // Stream
  let fullText = '';
  if (backend === 'ollama') {
    fullText = await streamOllama(settings, messages, port, { systemPrompt, signal });
  } else {
    fullText = await streamClaude(settings, messages, port, { systemPrompt, signal });
  }

  // If the model didn't wrap its output in <css> tags, nudge it and retry once
  if (!fullText.includes('<css>')) {
    const retryMessages = [
      ...messages,
      { role: 'assistant', content: fullText },
      { role: 'user', content: 'Your response did not include a <css> block. Please reformat your CSS wrapped in <css> tags exactly like this:\n<css>\n/* complete CSS here */\n</css>' },
    ];
    port.postMessage({ type: 'CSS_RETRY' });
    if (backend === 'ollama') {
      fullText = await streamOllama(settings, retryMessages, port, { systemPrompt, signal });
    } else {
      fullText = await streamClaude(settings, retryMessages, port, { systemPrompt, signal });
    }
  }

  const parsed = parseAiResponse(fullText);
  const finalCss = cssMode === 'patch' ? mergeCssPatch(currentCss, parsed.css) : parsed.css;

  const changelist = computeChangelist(currentCss, finalCss);
  const lineDiff = computeLineDiff(currentCss, finalCss);
  const updatedHistory = [...messages, { role: 'assistant', content: fullText }];

  const isFullRewrite = !currentCss || !currentCss.trim();
  const patchPreview = cssMode === 'patch'
    ? parsed.css
    : isFullRewrite
      ? finalCss
      : extractPatchPreview(currentCss, finalCss);

  port.postMessage({
    type: 'CSS_DONE',
    css: finalCss,
    originalCss: currentCss,
    patchPreview,
    isFullRewrite,
    changelist,
    lineDiff,
    history: updatedHistory,
  });
}

// ─── Message builders ─────────────────────────────────────────────────────────

function buildUserContent({ currentCss, domSnapshot, screenshotDataUrl, designRefDataUrl, instructions, settings, isReconsolidate }) {
  const userContent = [];

  if (isReconsolidate) {
    const text =
      `Current Additional CSS (may have duplicate or conflicting rules from successive edits — rules added later may override earlier ones):\n${currentCss || '(empty)'}\n\n` +
      `Rewrite this as a single clean, consolidated CSS file. Merge duplicate selectors, resolve conflicts by keeping the most recent intent, and remove redundancy. ` +
      `Return the COMPLETE rewritten file — not just changed rules — wrapped in <css> tags.`;
    userContent.push({ type: 'text', text });
    return { userContent };
  }

  if (designRefDataUrl) {
    const [meta, b64] = designRefDataUrl.split(',');
    const mediaType = (meta.match(/data:([^;]+)/) || [])[1] || 'image/png';
    userContent.push({ type: 'text', text: 'Design reference — align the CSS with this visual target:' });
    userContent.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } });
  }

  if (screenshotDataUrl) {
    const [, b64] = screenshotDataUrl.split(',');
    userContent.push({ type: 'text', text: 'Current page screenshot:' });
    userContent.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } });
  }

  let text = `Current Additional CSS:\n${currentCss || '(empty)'}\n\n`;
  if (domSnapshot) text += `DOM structure:\n${JSON.stringify(domSnapshot)}\n\n`;
  text += `Instructions: ${instructions}`;
  userContent.push({ type: 'text', text });

  return { userContent };
}

// ─── Chat Streaming ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT_CHAT = `You are a CSS assistant embedded in a WordPress styling tool. Answer directly and briefly — no lists of suggestions, no asking the user to paste HTML, no emojis. When page context or CSS is provided in the conversation, use it. When writing CSS, use code blocks.`;

async function streamChatMessage(msg, port) {
  const { message, history, siteTabId, includeDom = false, includeExistingCss = false } = msg;
  const settings = await getSettings();

  // ── Inject context once into this message ────────────────────────────────────
  const contextParts = [];
  const noteParts = [];

  if (includeDom) {
    let domTabId = null;
    let domNote = '';
    try {
      if (!siteTabId) {
        domNote = 'no site tab locked';
      } else {
        const tab = await chrome.tabs.get(siteTabId);
        if (!tab.url.includes('wp-admin')) {
          domTabId = siteTabId;
        } else {
          const origin = new URL(tab.url).origin;
          const all = await chrome.tabs.query({});
          const candidate = all.find(t =>
            t.url && t.url.startsWith(origin) && !t.url.includes('wp-admin')
          );
          if (candidate) domTabId = candidate.id;
          else domNote = 'no matching site tab';
        }
      }
    } catch (_) {
      domNote = 'could not access tab';
    }

    if (domTabId) {
      try {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId: domTabId },
          world: 'ISOLATED',
          func: () => {
            const nodes = [];
            function walk(el, depth) {
              if (!el || nodes.length >= 200 || depth > 6) return;
              if (el.nodeType !== Node.ELEMENT_NODE) return;
              nodes.push({ tag: el.tagName.toLowerCase(), id: el.id || '', classes: Array.from(el.classList).slice(0, 6), depth });
              for (const child of el.children) walk(child, depth + 1);
            }
            walk(document.body, 0);
            return nodes;
          },
        });
        if (r?.result) {
          contextParts.push(`Current page DOM:\n${JSON.stringify(r.result)}`);
          noteParts.push(`DOM (${r.result.length} nodes)`);
        }
      } catch (_) {
        noteParts.push('DOM (failed)');
      }
    } else {
      noteParts.push(`DOM (unavailable — ${domNote})`);
    }
  }

  if (includeExistingCss) {
    try {
      const custTab = await findCustomizerTab();
      if (custTab) {
        const css = await readCssFromTab(custTab.id);
        contextParts.push(`Existing Additional CSS:\n${css || '(empty)'}`);
        noteParts.push(`CSS (${css ? css.length + ' chars' : 'empty'})`);
      } else {
        noteParts.push('CSS (Customizer tab not found)');
      }
    } catch (e) {
      noteParts.push(`CSS (failed — ${e.message})`);
    }
  }

  if (noteParts.length) {
    port.postMessage({ type: 'CHAT_CONTEXT_INJECTED', note: noteParts.join(' + ') });
  }

  const fullMessage = contextParts.length
    ? contextParts.join('\n\n') + '\n\n---\n\n' + message
    : message;

  const messages = [...(history || []), { role: 'user', content: fullMessage }];

  let fullText = '';
  if (settings.aiBackend === 'ollama') {
    fullText = await streamOllama(settings, messages, port, { systemPrompt: SYSTEM_PROMPT_CHAT, chunkType: 'CHAT_CHUNK' });
  } else {
    fullText = await streamClaude(settings, messages, port, { systemPrompt: SYSTEM_PROMPT_CHAT, chunkType: 'CHAT_CHUNK' });
  }

  const updatedHistory = [...messages, { role: 'assistant', content: fullText }];
  port.postMessage({ type: 'CHAT_DONE', history: updatedHistory });
}

// ─── Claude Streaming ─────────────────────────────────────────────────────────

async function streamClaude(settings, messages, port, { systemPrompt = SYSTEM_PROMPT_CLAUDE, chunkType = 'CSS_CHUNK', signal } = {}) {
  if (!settings.claudeApiKey) throw new Error('Claude API key not set. Go to the Setup tab.');

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.claudeApiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: settings.claudeModel || 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: systemPrompt,
      messages,
      stream: true,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Claude API error ${resp.status}: ${errText}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop(); // keep incomplete line in buffer

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const event = JSON.parse(data);
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const chunk = event.delta.text;
          fullText += chunk;
          port.postMessage({ type: chunkType, text: chunk });
        }
      } catch (_) {}
    }
  }

  return fullText;
}

// ─── Ollama Streaming ─────────────────────────────────────────────────────────

async function streamOllama(settings, messages, port, { systemPrompt = SYSTEM_PROMPT_OLLAMA, chunkType = 'CSS_CHUNK', signal } = {}) {
  const baseUrl = settings.ollamaUrl || 'http://localhost:11434';
  const hasImages = messages.some(m =>
    Array.isArray(m.content) && m.content.some(b => b.type === 'image')
  );
  const model = hasImages && settings.ollamaVisionModel
    ? settings.ollamaVisionModel
    : (settings.ollamaModel || 'llama3');

  // Flatten content for Ollama (text only, images as separate field)
  // Inject Ollama-specific system prompt (patch mode) as first message
  const ollamaMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => {
      if (!Array.isArray(m.content)) return m;
      const text = m.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      const images = m.content.filter(b => b.type === 'image').map(b => b.source?.data).filter(Boolean);
      return images.length ? { role: m.role, content: text, images } : { role: m.role, content: text };
    }),
  ];

  const ollamaHeaders = { 'Content-Type': 'application/json' };
  if (settings.cfClientId && settings.cfClientSecret) {
    ollamaHeaders['CF-Access-Client-Id'] = settings.cfClientId;
    ollamaHeaders['CF-Access-Client-Secret'] = settings.cfClientSecret;
  }

  let resp;
  try {
    resp = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      signal,
      headers: ollamaHeaders,
      body: JSON.stringify({ model, messages: ollamaMessages, stream: true, options: { num_ctx: 32768 } }),
    });
  } catch (e) {
    throw new Error(
      `Could not reach Ollama at ${baseUrl}.\n\n` +
      `This is usually a CORS issue. Restart Ollama with:\n\n` +
      `  OLLAMA_ORIGINS=* ollama serve\n\n` +
      `On Windows, set the environment variable OLLAMA_ORIGINS=* in System Settings, then restart Ollama.`
    );
  }

  if (!resp.ok) {
    const errText = await resp.text();
    if (resp.status === 403) {
      throw new Error(
        `Ollama returned 403 Forbidden — this is a CORS/origins issue.\n\n` +
        `Restart Ollama with:\n\n` +
        `  OLLAMA_ORIGINS=* ollama serve\n\n` +
        `On Windows, set OLLAMA_ORIGINS=* in System Settings → Environment Variables, then restart Ollama.`
      );
    }
    throw new Error(`Ollama error ${resp.status}: ${errText}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        const chunk = event.message?.content || '';
        if (chunk) {
          fullText += chunk;
          port.postMessage({ type: chunkType, text: chunk });
        }
      } catch (_) {}
    }
  }

  return fullText;
}

// ─── Response Parser ──────────────────────────────────────────────────────────

function parseAiResponse(text) {
  // Prefer a <css> tag that starts on its own line — avoids grabbing inline
  // mentions like "wrapped in <css> tags as requested"
  const ownLineMatch = text.match(/(?:^|\n)<css>\s*\n([\s\S]*?)\n?\s*<\/css>/im);
  if (ownLineMatch) return { css: ownLineMatch[1].trim() };

  // Fallback: any <css>...</css> pair, but strip leading non-CSS prose
  const tagMatch = text.match(/<css>([\s\S]*?)<\/css>/i);
  if (tagMatch) {
    const inner = tagMatch[1].trim();
    const cssStart = inner.search(/\/\*|[a-zA-Z#.:[*][\w\s-]*\s*\{/);
    return { css: cssStart > 0 ? inner.slice(cssStart).trim() : inner };
  }

  // Fallback: JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.css) return { css: parsed.css };
    } catch (_) {}
  }

  // Last resort: find first CSS-looking line
  const cssStart = text.search(/\/\*|[a-zA-Z#.:[*][\w\s-]*\s*\{/);
  if (cssStart >= 0) return { css: text.slice(cssStart).trim() };

  return { css: text.trim() };
}

// ─── Screenshot ───────────────────────────────────────────────────────────────

async function takeScreenshot() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error('No active tab found.');
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  return { dataUrl, tabId: tab.id, tabTitle: tab.title || '' };
}

// ─── Read / Write CSS (MAIN world) ───────────────────────────────────────────

async function readCssFromTab(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      if (window.wp && window.wp.customize) {
        let css = '';
        window.wp.customize.each(setting => {
          if (setting.id.startsWith('custom_css[')) css = setting.get() || '';
        });
        if (css) return css;
      }
      const cmEl = document.querySelector('.CodeMirror');
      if (cmEl && cmEl.CodeMirror) return cmEl.CodeMirror.getValue();
      const ta = document.querySelector('#custom_css_c1')
        || document.querySelector('textarea[id^="custom_css"]');
      return ta ? ta.value : '';
    },
  });
  return result.result || '';
}

async function writeCssToTab(tabId, css, autoPublish) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (newCss, publish) => {
      let applied = false;

      if (window.wp && window.wp.customize) {
        window.wp.customize.each(setting => {
          if (setting.id.startsWith('custom_css[')) { setting.set(newCss); applied = true; }
        });
      }

      const cmEl = document.querySelector('.CodeMirror');
      if (cmEl && cmEl.CodeMirror) { cmEl.CodeMirror.setValue(newCss); applied = true; }

      if (!applied) {
        const ta = document.querySelector('#custom_css_c1')
          || document.querySelector('textarea[id^="custom_css"]');
        if (ta) {
          ta.value = newCss;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
          applied = true;
        }
      }

      if (publish) {
        const btn = document.querySelector('#save');
        if (btn && !btn.disabled) btn.click();
      }

      return applied;
    },
    args: [css, autoPublish],
  });
  if (!result.result) throw new Error('Could not find the Additional CSS field in the Customizer.');
  return { success: true };
}

async function writeCss(css, autoPublish) {
  const custTab = await findCustomizerTab();
  if (!custTab) throw new Error('WordPress Customizer tab not found.\nOpen /wp-admin/customize.php in a tab.');
  return writeCssToTab(custTab.id, css, autoPublish);
}

// ─── Tab Finders ──────────────────────────────────────────────────────────────

async function findCustomizerTab() {
  const tabs = await chrome.tabs.query({});
  return tabs.find(t => t.url && t.url.includes('customize.php')) || null;
}


// ─── CSS Patch Merge ─────────────────────────────────────────────────────────

function mergeCssPatch(existingCss, patchCss) {
  if (!patchCss || !patchCss.trim()) return existingCss;
  if (!existingCss || !existingCss.trim()) return patchCss;

  function splitBlocks(css) {
    const blocks = [];
    let depth = 0, start = 0;
    for (let i = 0; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) {
          blocks.push(css.slice(start, i + 1).trim());
          start = i + 1;
        }
      }
    }
    const tail = css.slice(start).trim();
    if (tail) blocks.push(tail);
    return blocks.filter(Boolean);
  }

  function selectorOf(block) {
    const i = block.indexOf('{');
    return i === -1 ? null : block.slice(0, i).trim();
  }

  const existingBlocks = splitBlocks(existingCss);
  const patchBlocks = splitBlocks(patchCss);
  const patchMap = new Map();
  for (const block of patchBlocks) {
    const sel = selectorOf(block);
    if (sel) patchMap.set(sel, block);
  }

  const merged = existingBlocks.map(block => {
    const sel = selectorOf(block);
    if (sel && patchMap.has(sel)) {
      const replacement = patchMap.get(sel);
      patchMap.delete(sel);
      return replacement;
    }
    return block;
  });

  for (const block of patchMap.values()) merged.push(block);
  return merged.join('\n\n');
}

// ─── Line Diff ────────────────────────────────────────────────────────────────

function computeLineDiff(oldCss, newCss) {
  const oldLines = new Set((oldCss || '').split('\n').map(l => l.trim()).filter(Boolean));
  const newLines = new Set((newCss || '').split('\n').map(l => l.trim()).filter(Boolean));
  let added = 0, removed = 0;
  for (const l of newLines) if (!oldLines.has(l)) added++;
  for (const l of oldLines) if (!newLines.has(l)) removed++;
  return { added, removed };
}

// ─── CSS Changelist ───────────────────────────────────────────────────────────

function computeChangelist(oldCss, newCss) {
  function parseRules(css) {
    const rules = {};
    const re = /([^{@][^{]*)\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(css)) !== null) {
      const selector = m[1].trim();
      const props = {};
      m[2].split(';').forEach(decl => {
        const colon = decl.indexOf(':');
        if (colon < 0) return;
        const prop = decl.slice(0, colon).trim();
        const val = decl.slice(colon + 1).trim();
        if (prop) props[prop] = val;
      });
      if (Object.keys(props).length) rules[selector] = props;
    }
    return rules;
  }

  const oldRules = parseRules(oldCss || '');
  const newRules = parseRules(newCss || '');
  const changes = [];

  for (const [sel, props] of Object.entries(newRules)) {
    const oldProps = oldRules[sel] || {};
    const changed = Object.entries(props).filter(([p, v]) => oldProps[p] !== v).map(([p]) => p);
    if (changed.length) changes.push(`${oldRules[sel] ? 'Modified' : 'Added'}: ${sel} { ${changed.join(', ')} }`);
  }
  for (const sel of Object.keys(oldRules)) {
    if (!newRules[sel]) changes.push(`Removed: ${sel}`);
  }
  return changes;
}

// ─── Patch Preview ───────────────────────────────────────────────────────────

function extractPatchPreview(oldCss, newCss) {
  function splitBlocks(css) {
    const blocks = [];
    let depth = 0, start = 0;
    for (let i = 0; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) {
          blocks.push(css.slice(start, i + 1).trim());
          start = i + 1;
        }
      }
    }
    const tail = css.slice(start).trim();
    if (tail) blocks.push(tail);
    return blocks.filter(Boolean);
  }
  function selectorOf(block) {
    const i = block.indexOf('{');
    return i === -1 ? null : block.slice(0, i).trim();
  }

  const oldBlocks = splitBlocks(oldCss || '');
  const newBlocks = splitBlocks(newCss || '');
  const oldMap = new Map();
  for (const b of oldBlocks) {
    const sel = selectorOf(b);
    if (sel) oldMap.set(sel, b);
  }

  const changed = [];
  const newSelectors = new Set();
  for (const b of newBlocks) {
    const sel = selectorOf(b);
    if (!sel) continue;
    newSelectors.add(sel);
    const old = oldMap.get(sel);
    if (!old || old !== b) changed.push(b);
  }

  const removed = [];
  for (const [sel] of oldMap) {
    if (!newSelectors.has(sel)) removed.push(sel);
  }

  let preview = changed.join('\n\n');
  if (removed.length) {
    preview += (preview ? '\n\n' : '') + `/* Removed: ${removed.join(', ')} */`;
  }
  return preview.trim() || '/* No changes */';
}

// ─── Backups ──────────────────────────────────────────────────────────────────

async function getBackups() {
  const r = await chrome.storage.local.get('ss_backups');
  return { backups: r.ss_backups || [] };
}

async function saveBackup(css) {
  const { backups } = await getBackups();
  const settings = await getSettings();
  const updated = [{ timestamp: new Date().toISOString(), css }, ...backups].slice(0, settings.maxRollbacks || 20);
  await chrome.storage.local.set({ ss_backups: updated });
  return { backups: updated };
}

async function restoreBackup(index) {
  const { backups } = await getBackups();
  const entry = backups[index];
  if (!entry) throw new Error('Backup not found at index ' + index);
  const settings = await getSettings();
  const custTab = await findCustomizerTab();
  if (custTab) {
    try { await saveBackup(await readCssFromTab(custTab.id)); } catch (_) {}
  }
  return writeCss(entry.css, settings.autoPublish);
}

async function clearBackups() {
  await chrome.storage.local.set({ ss_backups: [] });
  return { success: true };
}

// ─── Settings ─────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  aiBackend: 'claude',
  claudeApiKey: '',
  claudeModel: 'claude-sonnet-4-6',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3',
  ollamaVisionModel: 'llava',
  cfClientId: '',
  cfClientSecret: '',
  autoPublish: false,
  maxRollbacks: 20,
  cssMode: 'full',
};

async function getSettings() {
  const r = await chrome.storage.sync.get('ss_settings');
  return { ...DEFAULT_SETTINGS, ...(r.ss_settings || {}) };
}

async function saveSettings(settings) {
  await chrome.storage.sync.set({ ss_settings: settings });
  return { success: true };
}

// ─── Design Reference ─────────────────────────────────────────────────────────

async function getDesignRef() {
  const r = await chrome.storage.local.get('ss_design_ref');
  return { dataUrl: r.ss_design_ref || null };
}

async function saveDesignRef(dataUrl) {
  await chrome.storage.local.set({ ss_design_ref: dataUrl });
  return { success: true };
}

async function clearDesignRef() {
  await chrome.storage.local.remove('ss_design_ref');
  return { success: true };
}
