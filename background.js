// WP Styler — Background Service Worker

const SYSTEM_PROMPTS = {
  openai: {
    full: `You are a CSS expert helping style a WordPress site.
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

    patch: `You are a CSS expert helping style a WordPress site.
You will receive the current Additional CSS, a DOM structure summary, and optionally a screenshot and/or design reference image.

Return ONLY the selector blocks that need to be added or changed — not the entire file.
Wrap your response in <css> tags:
<css>
/* only the new or modified selector blocks */
</css>

Rules:
- A "block" means the ENTIRE selector + every declaration inside it, from the opening { to the closing } — all lines, including unchanged properties.
- NEVER output a partial block. If only background-color changes inside .foo { ... }, output the complete .foo { ... } block with all its properties rewritten.
- Do not output blocks that are completely unchanged.
- Do not output anything outside the <css></css> tags.
- No explanations, no markdown, no code fences.`,
  },

  claude: {
    full: `You are a CSS expert helping style a WordPress site.
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

    patch: `You are a CSS expert helping style a WordPress site.
You will receive the current Additional CSS, a DOM structure summary, and optionally a screenshot and/or design reference image.

Return ONLY the selector blocks that need to be added or changed — not the entire file.
Wrap your response in <css> tags:
<css>
/* only the new or modified selector blocks */
</css>

Rules:
- A "block" means the ENTIRE selector + every declaration inside it, from the opening { to the closing } — all lines, including unchanged properties.
- NEVER output a partial block. If only background-color changes inside .foo { ... }, output the complete .foo { ... } block with all its properties rewritten.
- Do not output blocks that are completely unchanged.
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
You are a CSS expert. Return ONLY the selector blocks that need to be added or changed to fulfil the user's request.
Do NOT return the entire CSS file. Wrap your response in <css> tags:
<css>
/* only the changed or new selector blocks here */
</css>
A "block" means the ENTIRE selector + all its declarations from { to } — never a partial block or single property in isolation.
If any property inside a block changes, output the complete block with every declaration rewritten.
No explanations. No markdown. Nothing outside the <css></css> tags.`,
  },

  deepseek: {
    full: `You are a CSS expert helping style a WordPress site.
You will receive the current Additional CSS and a DOM structure summary.

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

    patch: `You are a CSS expert helping style a WordPress site.
You will receive the current Additional CSS and a DOM structure summary.

Return ONLY the selector blocks that need to be added or changed — not the entire file.
Wrap your response in <css> tags:
<css>
/* only the new or modified selector blocks */
</css>

Rules:
- A "block" means the ENTIRE selector + every declaration inside it, from the opening { to the closing } — all lines, including unchanged properties.
- NEVER output a partial block. If only background-color changes inside .foo { ... }, output the complete .foo { ... } block with all its properties rewritten.
- Do not output blocks that are completely unchanged.
- Do not output anything outside the <css></css> tags.
- No explanations, no markdown, no code fences.`,
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
    console.error('[WPStyler]', err);
    sendResponse({ error: err.message });
  });
  return true;
});

async function handleMessage(msg) {
  switch (msg.type) {
    case 'TAKE_SCREENSHOT':   return takeScreenshot();
    case 'WRITE_CSS':         return writeCss(msg.css, msg.autoPublish);
    case 'GET_BACKUPS':       return getBackups();
    case 'SAVE_BACKUP':       return saveBackup(msg.css, msg.label, msg.starred);
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
    case 'COLLAPSE_CUSTOMIZER_SIDEBAR': {
      const custTab = await findCustomizerTab();
      if (!custTab) return { success: false };
      await chrome.scripting.executeScript({
        target: { tabId: custTab.id },
        world: 'MAIN',
        func: () => {
          const btn = document.querySelector('button.collapse-sidebar');
          if (btn && btn.getAttribute('aria-expanded') === 'true') btn.click();
        },
      });
      return { success: true };
    }
    case 'GET_CSS_CHARS': {
      const custTab = await findCustomizerTab();
      if (!custTab) return { chars: 0 };
      const css = await readCssFromTab(custTab.id);
      return { chars: css ? css.length : 0 };
    }
    case 'GET_DOM_CHARS': {
      if (!msg.siteTabId) return { chars: 12000 };
      try {
        const frame = await resolveContentFrame(msg.siteTabId);
        const dom = await getDomSnapshot(frame.tabId, null, frame.frameId);
        return { chars: dom ? JSON.stringify(dom).length : 0 };
      } catch (_) {
        return { chars: 12000 };
      }
    }
    case 'GET_CSS': {
      const custTab = await findCustomizerTab();
      if (!custTab) throw new Error('WordPress Customizer tab not found.\nOpen /wp-admin/customize.php in a tab.');
      const css = await readCssFromTab(custTab.id);
      return { css: css || '' };
    }
    case 'GET_DOCS': {
      const data = await chrome.storage.local.get('userDocs');
      return { docs: data.userDocs || [] };
    }
    case 'SAVE_DOCS': {
      await chrome.storage.local.set({ userDocs: msg.docs });
      return { success: true };
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

  if (port.name === 'css-smart-search') {
    const controller = new AbortController();
    port.onDisconnect.addListener(() => controller.abort());
    port.onMessage.addListener(async msg => {
      if (msg.type !== 'SMART_SEARCH') return;
      try {
        await streamSmartSearch(msg, port, controller.signal);
      } catch (err) {
        if (err.name === 'AbortError') return;
        try { port.postMessage({ type: 'SMART_ERROR', error: err.message }); } catch (_) {}
      }
    });
  }

  if (port.name === 'css-inline-rewrite') {
    const controller = new AbortController();
    port.onDisconnect.addListener(() => controller.abort());
    port.onMessage.addListener(async msg => {
      if (msg.type !== 'INLINE_REWRITE') return;
      try {
        await streamInlineRewrite(msg, port, controller.signal);
      } catch (err) {
        if (err.name === 'AbortError') return;
        try { port.postMessage({ type: 'INLINE_ERROR', error: err.message }); } catch (_) {}
      }
    });
  }
});

async function generateCssStreaming(msg, port, signal) {
  const { instructions, screenshotDataUrl, designRefDataUrl, history, stepScope, siteTabId, skipDom = false } = msg;
  const settings = await getSettings();

  // Always read the live CSS from the Customizer — never use a cached value.
  // This guarantees the agent sees whatever is actually in the Additional CSS
  // field right now, even if it was manually edited or applied since last run.
  const custTab = await findCustomizerTab();
  if (!custTab) throw new Error('WordPress Customizer tab not found.\nOpen /wp-admin/customize.php in a tab first.');
  const currentCss = await readCssFromTab(custTab.id);

  const isReconsolidate = instructions === '__reconsolidate__';
  const isRevision      = history && history.length > 0;
  const backend  = settings.aiBackend === 'ollama' ? 'ollama'
    : settings.aiBackend === 'deepseek' ? 'deepseek'
    : settings.aiBackend === 'openai'   ? 'openai'
    : 'claude';
  const cssMode  = isReconsolidate ? 'full' : (settings.cssMode || 'full');
  const systemPrompt = SYSTEM_PROMPTS[backend][cssMode];

  // DOM snapshot — skip on revisions or when DOM was already sent earlier in this session
  let domSnapshot = null;
  let domDebug = isRevision
    ? 'DOM: skipped (revision — using existing conversation context)'
    : skipDom
      ? 'DOM: skipped (already injected earlier in this session)'
      : null;
  if (!isRevision && !skipDom) {
    if (siteTabId) {
      try {
        const frame = await resolveContentFrame(siteTabId);
        domSnapshot = await getDomSnapshot(frame.tabId, stepScope, frame.frameId);
        const src = frame.frameId !== null ? 'customizer iframe' : frame.tabId !== siteTabId ? 'front-end tab' : 'customizer';
        domDebug = domSnapshot
          ? `DOM: ${domSnapshot.length} nodes (${src})`
          : `DOM: content script returned empty (${src})`;
      } catch (e) {
        domDebug = `DOM: ${e.message}`;
      }
    } else {
      domDebug = 'DOM: no siteTabId';
    }
  }
  port.postMessage({ type: 'CSS_DEBUG', text: domDebug });

  // Vision digest — Ollama pre-processes images with the vision model.
  // Skipped on revisions: the digest text is already in the conversation history.
  let screenshotDigest = null;
  let designRefDigest  = null;
  if (backend === 'ollama' && !isRevision) {
    const digestHint = isReconsolidate ? 'consolidate and clean up CSS' : instructions;
    if (screenshotDataUrl) {
      port.postMessage({ type: 'CSS_DEBUG', text: `Vision: analyzing screenshot with ${settings.ollamaVisionModel || 'llava'}…` });
      try {
        screenshotDigest = await digestImageWithOllama(settings, screenshotDataUrl, digestHint, port, signal);
        port.postMessage({ type: 'CSS_DEBUG', text: `Vision: screenshot digest complete (${screenshotDigest.length} chars)` });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        port.postMessage({ type: 'CSS_DEBUG', text: `Vision: screenshot failed — ${e.message}` });
      }
    }
    if (designRefDataUrl) {
      port.postMessage({ type: 'CSS_DEBUG', text: `Vision: analyzing design ref with ${settings.ollamaVisionModel || 'llava'}…` });
      try {
        designRefDigest = await digestImageWithOllama(settings, designRefDataUrl, digestHint, port, signal);
        port.postMessage({ type: 'CSS_DEBUG', text: `Vision: design ref digest complete (${designRefDigest.length} chars)` });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        port.postMessage({ type: 'CSS_DEBUG', text: `Vision: design ref failed — ${e.message}` });
      }
    }
  }

  // Context stats
  port.postMessage({
    type: 'CSS_STATS',
    stats: isRevision
      ? { summary: 'Revision — reusing existing conversation context', log: `REVISION\n\nInstructions: ${instructions}` }
      : buildContextLog({
          instructions: isReconsolidate ? '(reconsolidate)' : instructions,
          domSnapshot, currentCss,
          screenshotDataUrl, screenshotDigest,
          designRefDataUrl, designRefDigest,
          backend,
        }),
  });

  // Build user message — revisions send only the instruction, no re-injected context
  const { userContent } = buildUserContent({
    currentCss: isRevision ? null : currentCss,
    domSnapshot: isRevision ? null : domSnapshot,
    screenshotDataUrl: isRevision ? null : screenshotDataUrl,
    screenshotDigest:  isRevision ? null : screenshotDigest,
    designRefDataUrl:  isRevision ? null : designRefDataUrl,
    designRefDigest:   isRevision ? null : designRefDigest,
    instructions, settings, isReconsolidate,
  });

  const messages = [...(history || []), { role: 'user', content: userContent }];

  // Stream
  let result = backend === 'ollama'
    ? await streamOllama(settings, messages, port, { systemPrompt, signal })
    : backend === 'deepseek'
      ? await streamDeepSeek(settings, messages, port, { systemPrompt, signal })
      : backend === 'openai'
        ? await streamOpenAI(settings, messages, port, { systemPrompt, signal })
        : await streamClaude(settings, messages, port, { systemPrompt, signal });
  let fullText = result.text;
  let inputTokens = result.inputTokens, outputTokens = result.outputTokens;

  // If the model didn't wrap its output in <css> tags, nudge it and retry once
  if (!fullText.includes('<css>')) {
    const retryMessages = [
      ...messages,
      { role: 'assistant', content: fullText },
      { role: 'user', content: 'Your response did not include a <css> block. Please reformat your CSS wrapped in <css> tags exactly like this:\n<css>\n/* complete CSS here */\n</css>' },
    ];
    port.postMessage({ type: 'CSS_RETRY' });
    const retryResult = backend === 'ollama'
      ? await streamOllama(settings, retryMessages, port, { systemPrompt, signal })
      : backend === 'deepseek'
        ? await streamDeepSeek(settings, retryMessages, port, { systemPrompt, signal })
        : backend === 'openai'
          ? await streamOpenAI(settings, retryMessages, port, { systemPrompt, signal })
          : await streamClaude(settings, retryMessages, port, { systemPrompt, signal });
    fullText = retryResult.text;
    inputTokens  += retryResult.inputTokens;
    outputTokens += retryResult.outputTokens;
  }

  const parsed = parseAiResponse(fullText);
  const finalCss = cssMode === 'patch' ? mergeCssPatch(currentCss, parsed.css) : parsed.css;

  const changelist = computeChangelist(currentCss, finalCss);
  const lineDiff = computeLineDiff(currentCss, finalCss);
  const updatedHistory = [...messages, { role: 'assistant', content: fullText }];

  const isEmptyStart = !currentCss || !currentCss.trim();
  const patchPreview = cssMode === 'patch'
    ? parsed.css
    : isEmptyStart
      ? finalCss
      : extractPatchPreview(currentCss, finalCss);

  port.postMessage({
    type: 'CSS_DONE',
    css: finalCss,
    originalCss: currentCss,
    patchPreview,
    isFullRewrite: isEmptyStart,
    cssMode,
    changelist,
    lineDiff,
    history: updatedHistory,
    inputTokens,
    outputTokens,
  });
}

// ─── Message builders ─────────────────────────────────────────────────────────

function buildUserContent({ currentCss, domSnapshot, screenshotDataUrl, screenshotDigest, designRefDataUrl, designRefDigest, instructions, settings, isReconsolidate }) {
  const userContent = [];

  // Revision — all context is null, just send the instruction and let the
  // model use the existing conversation history for everything else
  if (!isReconsolidate && !currentCss && !domSnapshot && !screenshotDataUrl && !designRefDataUrl) {
    userContent.push({ type: 'text', text: `Revision: ${instructions}` });
    return { userContent };
  }

  if (isReconsolidate) {
    const text =
      `Current Additional CSS (may have duplicate or conflicting rules from successive edits — rules added later may override earlier ones):\n${currentCss || '(empty)'}\n\n` +
      `Rewrite this as a single clean, consolidated CSS file. Merge duplicate selectors, resolve conflicts by keeping the most recent intent, and remove redundancy. ` +
      `Return the COMPLETE rewritten file — not just changed rules — wrapped in <css> tags.`;
    userContent.push({ type: 'text', text });
    return { userContent };
  }

  if (designRefDataUrl) {
    if (designRefDigest) {
      // Ollama: image was pre-processed by vision model — use text description
      userContent.push({ type: 'text', text: `Design reference analysis (from vision model):\n${designRefDigest}` });
    } else {
      // Claude: pass image natively
      const [meta, b64] = designRefDataUrl.split(',');
      const mediaType = (meta.match(/data:([^;]+)/) || [])[1] || 'image/png';
      userContent.push({ type: 'text', text: 'Design reference — align the CSS with this visual target:' });
      userContent.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } });
    }
  }

  if (screenshotDataUrl) {
    if (screenshotDigest) {
      // Ollama: image was pre-processed by vision model — use text description
      userContent.push({ type: 'text', text: `Page screenshot analysis (from vision model):\n${screenshotDigest}` });
    } else {
      // Claude: pass image natively
      const [, b64] = screenshotDataUrl.split(',');
      userContent.push({ type: 'text', text: 'Current page screenshot:' });
      userContent.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } });
    }
  }

  const { cssMode: mode } = settings;
  let text = `Current Additional CSS:\n${currentCss || '(empty)'}\n\n`;
  if (domSnapshot) text += `DOM structure:\n${JSON.stringify(domSnapshot)}\n\n`;
  text += `Instructions: ${instructions}`;
  if (mode === 'patch') {
    text += '\n\nIMPORTANT: Return ONLY the CSS rules that need to be added or changed. Do NOT return the entire stylesheet — only the new or modified rules, wrapped in <css> tags.';
  }
  userContent.push({ type: 'text', text });

  return { userContent };
}

// ─── Chat Streaming ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT_CHAT = `You are a CSS assistant embedded in a WordPress styling tool. Answer directly and briefly — no lists of suggestions, no asking the user to paste HTML, no emojis. When page context or CSS is provided in the conversation, use it. When writing CSS, use code blocks.`;

const SYSTEM_PROMPT_INLINE_REWRITE = `You are a CSS expert. The user will give you a CSS snippet and an instruction to modify it.
Return ONLY the rewritten CSS — no explanation, no markdown fences, no <css> tags, nothing else.
Preserve the original indentation style. Change only what the instruction asks for.`;

const SYSTEM_PROMPT_SMART_SEARCH = `You are a CSS expert. The user will give you their entire CSS file and a plain-language search query.
Find the single CSS block or rule that best matches the query.
Return ONLY that block copied exactly as it appears in the file — no explanation, no markdown, no extra text.`;

async function streamChatMessage(msg, port) {
  const { message, history, siteTabId, includeDom = false, includeExistingCss = false, screenshotDataUrl, designRefDataUrl } = msg;
  const settings = await getSettings();

  // ── Inject context once into this message ────────────────────────────────────
  const contextParts = [];
  const noteParts = [];

  if (includeDom) {
    if (!siteTabId) {
      noteParts.push('DOM (unavailable — no site tab assigned)');
    } else {
      try {
        const frame = await resolveContentFrame(siteTabId);
        const dom = await getDomSnapshot(frame.tabId, null, frame.frameId);
        if (dom?.length) {
          contextParts.push(`Current page DOM:\n${JSON.stringify(dom)}`);
          noteParts.push(`DOM (${dom.length} nodes)`);
        } else {
          noteParts.push('DOM (empty)');
        }
      } catch (e) {
        noteParts.push(`DOM (failed — ${e.message})`);
      }
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

  if (screenshotDataUrl) noteParts.push('Screenshot');
  if (designRefDataUrl) noteParts.push('Design Ref');

  if (noteParts.length) {
    port.postMessage({ type: 'CHAT_CONTEXT_INJECTED', note: noteParts.join(' + ') });
  }

  // Build user content — multimodal if images are attached
  let userContent;
  const hasImages = screenshotDataUrl || designRefDataUrl;
  if (hasImages) {
    const parts = [];
    if (contextParts.length) {
      parts.push({ type: 'text', text: contextParts.join('\n\n') + '\n\n---\n\n' });
    }
    if (designRefDataUrl) {
      const mediaType = (designRefDataUrl.match(/data:([^;]+)/) || [])[1] || 'image/png';
      parts.push({ type: 'text', text: 'Design reference:' });
      parts.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: designRefDataUrl.split(',')[1] } });
    }
    if (screenshotDataUrl) {
      parts.push({ type: 'text', text: 'Page screenshot:' });
      parts.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshotDataUrl.split(',')[1] } });
    }
    parts.push({ type: 'text', text: message });
    userContent = parts;
  } else {
    userContent = contextParts.length
      ? contextParts.join('\n\n') + '\n\n---\n\n' + message
      : message;
  }

  const messages = [...(history || []), { role: 'user', content: userContent }];

  const chatResult = settings.aiBackend === 'ollama'
    ? await streamOllama(settings, messages, port, { systemPrompt: SYSTEM_PROMPT_CHAT, chunkType: 'CHAT_CHUNK' })
    : settings.aiBackend === 'deepseek'
      ? await streamDeepSeek(settings, messages, port, { systemPrompt: SYSTEM_PROMPT_CHAT, chunkType: 'CHAT_CHUNK' })
      : settings.aiBackend === 'openai'
        ? await streamOpenAI(settings, messages, port, { systemPrompt: SYSTEM_PROMPT_CHAT, chunkType: 'CHAT_CHUNK' })
        : await streamClaude(settings, messages, port, { systemPrompt: SYSTEM_PROMPT_CHAT, chunkType: 'CHAT_CHUNK' });

  const updatedHistory = [...messages, { role: 'assistant', content: chatResult.text }];
  port.postMessage({
    type: 'CHAT_DONE',
    history: updatedHistory,
    inputTokens: chatResult.inputTokens,
    outputTokens: chatResult.outputTokens,
  });
}

// ─── Smart Search ────────────────────────────────────────────────────────────

async function streamSmartSearch(msg, port, signal) {
  const { css, query } = msg;
  const settings = await getSettings();
  const backend = settings.aiBackend === 'ollama' ? 'ollama'
    : settings.aiBackend === 'deepseek' ? 'deepseek'
    : settings.aiBackend === 'openai'   ? 'openai'
    : 'claude';

  const messages = [{ role: 'user', content: `CSS file:\n${css}\n\nFind: ${query}` }];
  const opts = { systemPrompt: SYSTEM_PROMPT_SMART_SEARCH, chunkType: 'SMART_CHUNK', signal };

  const result = backend === 'ollama'
    ? await streamOllama(settings, messages, port, opts)
    : backend === 'deepseek'
      ? await streamDeepSeek(settings, messages, port, opts)
      : backend === 'openai'
        ? await streamOpenAI(settings, messages, port, opts)
        : await streamClaude(settings, messages, port, opts);

  port.postMessage({ type: 'SMART_DONE', result: result.text.trim() });
}

// ─── Inline CSS Rewrite ───────────────────────────────────────────────────────

async function streamInlineRewrite(msg, port, signal) {
  const { selectedCss, instruction } = msg;
  const settings = await getSettings();
  const backend = settings.aiBackend === 'ollama' ? 'ollama'
    : settings.aiBackend === 'deepseek' ? 'deepseek'
    : settings.aiBackend === 'openai'   ? 'openai'
    : 'claude';

  const userMessage = `CSS to rewrite:\n${selectedCss}\n\nInstruction: ${instruction}`;
  const messages = [{ role: 'user', content: userMessage }];
  const opts = { systemPrompt: SYSTEM_PROMPT_INLINE_REWRITE, chunkType: 'INLINE_CHUNK', signal };

  const result = backend === 'ollama'
    ? await streamOllama(settings, messages, port, opts)
    : backend === 'deepseek'
      ? await streamDeepSeek(settings, messages, port, opts)
      : backend === 'openai'
        ? await streamOpenAI(settings, messages, port, opts)
        : await streamClaude(settings, messages, port, opts);

  port.postMessage({ type: 'INLINE_DONE', css: result.text.trim() });
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
  let inputTokens = 0, outputTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const event = JSON.parse(data);
        if (event.type === 'message_start') {
          inputTokens = event.message?.usage?.input_tokens || 0;
        } else if (event.type === 'message_delta') {
          outputTokens = event.usage?.output_tokens || 0;
          if (event.delta?.stop_reason === 'max_tokens') {
            port.postMessage({ type: chunkType === 'CSS_CHUNK' ? 'CSS_DEBUG' : 'CHAT_DEBUG',
              text: '⚠️ Response was cut off — hit max_tokens limit. Try a shorter instruction or switch to Patch mode.' });
          }
        } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const chunk = event.delta.text;
          fullText += chunk;
          port.postMessage({ type: chunkType, text: chunk });
        }
      } catch (_) {}
    }
  }

  return { text: fullText, inputTokens, outputTokens };
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
      body: JSON.stringify({ model, messages: ollamaMessages, stream: true, options: { num_ctx: settings.ollamaCtxLen || 32768 } }),
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
  let inputTokens = 0, outputTokens = 0;

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
        // Final message contains actual token counts
        if (event.done) {
          inputTokens  = event.prompt_eval_count || 0;
          outputTokens = event.eval_count || 0;
        }
      } catch (_) {}
    }
  }

  return { text: fullText, inputTokens, outputTokens };
}

// ─── DeepSeek Streaming ───────────────────────────────────────────────────────
// OpenAI-compatible SSE endpoint. DeepSeek is text-only — image blocks are
// stripped from messages before sending. Token counts come from the final
// chunk when stream_options.include_usage = true.

async function streamDeepSeek(settings, messages, port, { systemPrompt, chunkType = 'CSS_CHUNK', signal } = {}) {
  if (!settings.deepseekApiKey) throw new Error('DeepSeek API key not set. Go to the Setup tab.');

  // Strip image content blocks — DeepSeek V4 is text-only
  const textMessages = messages.map(m => {
    if (!Array.isArray(m.content)) return m;
    const text = m.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    return { role: m.role, content: text };
  });

  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.deepseekApiKey}`,
    },
    body: JSON.stringify({
      model: settings.deepseekModel || 'deepseek-v4-flash',
      max_tokens: 16000,
      messages: [
        { role: 'system', content: systemPrompt },
        ...textMessages,
      ],
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`DeepSeek API error ${resp.status}: ${errText}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buf = '';
  let inputTokens = 0, outputTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const event = JSON.parse(data);
        // Final chunk carries usage when stream_options.include_usage = true
        if (event.usage) {
          inputTokens  = event.usage.prompt_tokens    || 0;
          outputTokens = event.usage.completion_tokens || 0;
        }
        const delta = event.choices?.[0]?.delta;
        if (delta?.content) {
          fullText += delta.content;
          port.postMessage({ type: chunkType, text: delta.content });
        }
        if (event.choices?.[0]?.finish_reason === 'length') {
          port.postMessage({
            type: chunkType === 'CSS_CHUNK' ? 'CSS_DEBUG' : 'CHAT_DEBUG',
            text: '⚠️ Response was cut off — hit max_tokens limit. Try a shorter instruction or switch to Patch mode.',
          });
        }
      } catch (_) {}
    }
  }

  return { text: fullText, inputTokens, outputTokens };
}

// ─── OpenAI Streaming ─────────────────────────────────────────────────────────
// OpenAI Chat Completions SSE. Supports vision via image_url blocks (GPT-4o /
// GPT-4.1 family). Anthropic-style image blocks are converted on the fly.

async function streamOpenAI(settings, messages, port, { systemPrompt, chunkType = 'CSS_CHUNK', signal } = {}) {
  if (!settings.openaiApiKey) throw new Error('OpenAI API key not set. Go to the Config tab.');

  // Convert Anthropic-style content arrays to OpenAI format
  const openaiMessages = messages.map(m => {
    if (!Array.isArray(m.content)) return m;
    const content = m.content.map(block => {
      if (block.type === 'text') return { type: 'text', text: block.text };
      if (block.type === 'image') {
        const { media_type, data } = block.source;
        return { type: 'image_url', image_url: { url: `data:${media_type};base64,${data}` } };
      }
      return null;
    }).filter(Boolean);
    return { role: m.role, content };
  });

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: settings.openaiModel || 'gpt-4.1-mini',
      max_tokens: 16000,
      messages: [
        { role: 'system', content: systemPrompt },
        ...openaiMessages,
      ],
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI API error ${resp.status}: ${errText}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buf = '';
  let inputTokens = 0, outputTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const event = JSON.parse(data);
        if (event.usage) {
          inputTokens  = event.usage.prompt_tokens     || 0;
          outputTokens = event.usage.completion_tokens || 0;
        }
        const delta = event.choices?.[0]?.delta;
        if (delta?.content) {
          fullText += delta.content;
          port.postMessage({ type: chunkType, text: delta.content });
        }
        if (event.choices?.[0]?.finish_reason === 'length') {
          port.postMessage({
            type: chunkType === 'CSS_CHUNK' ? 'CSS_DEBUG' : 'CHAT_DEBUG',
            text: '⚠️ Response was cut off — hit max_tokens limit. Try a shorter instruction or switch to Patch mode.',
          });
        }
      } catch (_) {}
    }
  }

  return { text: fullText, inputTokens, outputTokens };
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
  const url = tab.url || '';
  if (url.startsWith('chrome-extension://') || url.startsWith('chrome://') || url.startsWith('about:') || url.startsWith('edge://')) {
    throw new Error('Cannot screenshot an extension or browser page — switch to your site tab first.');
  }
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
          // Multiple custom_css[theme] settings may exist after theme switches —
          // only overwrite with a non-empty value so a stale empty setting
          // (from an old inactive theme) doesn't wipe out the real CSS.
          if (setting.id.startsWith('custom_css[')) {
            const val = setting.get();
            if (val) css = val;
          }
        });
        if (css) return css;
      }
      // Prefer the CodeMirror scoped to the Additional CSS panel; fall back to
      // the first one on the page (avoids grabbing a Divi builder CM instance).
      const cmContainer = document.querySelector('#customize-control-custom_css .CodeMirror')
        || document.querySelector('.customize-control-code_editor .CodeMirror')
        || document.querySelector('.CodeMirror');
      if (cmContainer && cmContainer.CodeMirror) return cmContainer.CodeMirror.getValue();
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

      if (!applied) {
        // Only fall back to CodeMirror if wp.customize didn't handle it —
        // Divi pages can have multiple CodeMirror instances and the first one
        // found may not be the Additional CSS editor.
        const cmEl = document.querySelector('.CodeMirror');
        if (cmEl && cmEl.CodeMirror) { cmEl.CodeMirror.setValue(newCss); applied = true; }
      }

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

// ─── Ollama Vision Digest ─────────────────────────────────────────────────────
// Sends an image to the Ollama vision model with a CSS-focused prompt and
// returns a plain-text description. This pre-processes images before the main
// text model runs, since Ollama uses separate models for vision vs. text.

async function digestImageWithOllama(settings, imageDataUrl, instruction, port, signal) {
  const baseUrl = settings.ollamaUrl || 'http://localhost:11434';
  const model   = settings.ollamaVisionModel || 'llava';

  const prompt =
    `You are a CSS expert analyzing a web page image to assist with styling.\n` +
    `Describe every visually observable CSS-relevant property:\n` +
    `- Layout: element widths, heights, positions, alignment, flexbox/grid hints\n` +
    `- Colors: backgrounds, text, borders, overlays (use hex/rgb where estimable)\n` +
    `- Typography: font sizes, weights, line heights\n` +
    `- Spacing: padding, margins, gaps between components\n` +
    `- Effects: shadows, gradients, opacity, blur, border-radius, glass/frosted effects\n` +
    `- Component names: class names, element types, and relationships if visible\n\n` +
    `Developer goal: "${instruction}"\n` +
    `Focus especially on details relevant to achieving that goal.\n` +
    `Be specific and technical — your output is fed directly to a CSS-writing LLM.`;

  const headers = { 'Content-Type': 'application/json' };
  if (settings.cfClientId && settings.cfClientSecret) {
    headers['CF-Access-Client-Id']     = settings.cfClientId;
    headers['CF-Access-Client-Secret'] = settings.cfClientSecret;
  }

  let resp;
  try {
    resp = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST', signal, headers,
      body: JSON.stringify({ model, prompt, images: [imageDataUrl.split(',')[1]], stream: true }),
    });
  } catch (e) {
    throw new Error(`Vision model unreachable: ${e.message}`);
  }
  if (!resp.ok) throw new Error(`Vision model returned ${resp.status}`);

  const reader  = resp.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '', buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.response) {
          fullText += ev.response;
          port.postMessage({ type: 'CSS_DEBUG', text: `Vision (${model}): ${fullText.length} chars…` });
        }
      } catch (_) {}
    }
  }
  return fullText;
}

// ─── Context Log Builder ──────────────────────────────────────────────────────

function buildContextLog({ instructions, domSnapshot, currentCss, screenshotDataUrl, screenshotDigest, designRefDataUrl, designRefDigest, backend }) {
  const summaryParts = [];
  const lines = [
    '=== SYNC STYLER CONTEXT LOG ===',
    `Generated: ${new Date().toLocaleString()}`,
    `Backend: ${backend}`,
    '',
    'INSTRUCTIONS:',
    instructions || '(none)',
    '',
  ];

  if (domSnapshot && domSnapshot.length) {
    summaryParts.push(`DOM ${domSnapshot.length} nodes`);
    lines.push(`DOM SNAPSHOT (${domSnapshot.length} nodes):`, JSON.stringify(domSnapshot, null, 2), '');
  }

  if (currentCss && currentCss.trim()) {
    summaryParts.push(`CSS ${currentCss.length} chars`);
    lines.push(`EXISTING CSS (${currentCss.length} chars):`, currentCss, '');
  }

  if (screenshotDataUrl) {
    if (screenshotDigest) {
      summaryParts.push('Screenshot (vision digested)');
      lines.push('SCREENSHOT — VISION DIGEST:', screenshotDigest, '');
    } else {
      summaryParts.push('Screenshot (native multimodal)');
      lines.push('SCREENSHOT: [image passed directly — Claude multimodal]', '');
    }
  }

  if (designRefDataUrl) {
    if (designRefDigest) {
      summaryParts.push('Design Ref (vision digested)');
      lines.push('DESIGN REF — VISION DIGEST:', designRefDigest, '');
    } else {
      summaryParts.push('Design Ref (native multimodal)');
      lines.push('DESIGN REF: [image passed directly — Claude multimodal]', '');
    }
  }

  return {
    summary: summaryParts.length ? 'Passing → ' + summaryParts.join(' · ') : 'No context attached',
    log: lines.join('\n'),
  };
}

// ─── Content Frame Resolver ───────────────────────────────────────────────────
// Returns { tabId, frameId } pointing to the best front-end DOM source:
//   1. A separate front-end tab on the same origin (if open)
//   2. The Customizer's preview iframe (always present when Customizer is open)
//   3. The siteTabId itself as a last resort

async function resolveContentFrame(siteTabId) {
  if (!siteTabId) return null;
  try {
    const tab = await chrome.tabs.get(siteTabId);
    if (!tab.url || !tab.url.includes('wp-admin')) {
      return { tabId: siteTabId, frameId: null }; // already a front-end tab
    }

    const origin = new URL(tab.url).origin;

    // 1. Look for a standalone front-end tab
    const all = await chrome.tabs.query({});
    const frontTab = all.find(t =>
      t.url &&
      t.url.startsWith(origin) &&
      !t.url.includes('wp-admin') &&
      !t.url.startsWith('chrome')
    );
    if (frontTab) return { tabId: frontTab.id, frameId: null };

    // 2. Use the Customizer preview iframe (the iframe that renders the live site)
    const frames = await chrome.webNavigation.getAllFrames({ tabId: siteTabId });
    const previewFrame = frames?.find(f =>
      f.url &&
      f.url.startsWith(origin) &&
      !f.url.includes('wp-admin')
    );
    if (previewFrame) return { tabId: siteTabId, frameId: previewFrame.frameId };

  } catch (_) {}

  // 3. Fall back to the Customizer tab top-level
  return { tabId: siteTabId, frameId: null };
}

// ─── DOM Snapshot (with auto-inject fallback) ─────────────────────────────────

async function getDomSnapshot(tabId, stepScope, frameId = null) {
  const msgOpts = frameId !== null ? { frameId } : {};
  const injectTarget = frameId !== null ? { tabId, frameIds: [frameId] } : { tabId };
  const msg = { type: 'READ_DOM', stepScope: stepScope || null };

  // First attempt — content script may already be injected
  try {
    const resp = await chrome.tabs.sendMessage(tabId, msg, msgOpts);
    return resp?.dom || null;
  } catch (_) {
    // Content script not loaded yet — inject it, then retry once
  }

  try {
    await chrome.scripting.executeScript({ target: injectTarget, files: ['content-site.js'] });
  } catch (injectErr) {
    throw new Error(`Could not inject content script: ${injectErr.message}`);
  }

  // Brief delay to let the script initialize
  await new Promise(r => setTimeout(r, 100));

  try {
    const resp = await chrome.tabs.sendMessage(tabId, msg, msgOpts);
    return resp?.dom || null;
  } catch (retryErr) {
    throw new Error(`Content script unreachable after injection: ${retryErr.message}`);
  }
}


// ─── CSS Patch Merge ─────────────────────────────────────────────────────────

function mergeCssPatch(existingCss, patchCss) {
  if (!patchCss || !patchCss.trim()) return existingCss;
  if (!existingCss || !existingCss.trim()) return patchCss;

  // Parse CSS into blocks, tracking the exact start/end character positions
  // inside the source string so we can do surgical in-place replacement.
  function parseBlocks(css) {
    const blocks = [];
    let depth = 0;
    let contentStart = -1; // position of first non-whitespace char in current block

    for (let i = 0; i < css.length; i++) {
      if (depth === 0 && contentStart === -1 && /\S/.test(css[i])) {
        contentStart = i;
      }
      if (css[i] === '{') {
        depth++;
      } else if (css[i] === '}') {
        depth--;
        if (depth === 0 && contentStart !== -1) {
          const text = css.slice(contentStart, i + 1);
          const braceIdx = text.indexOf('{');
          const selector = braceIdx === -1 ? null : text.slice(0, braceIdx).trim().replace(/\s+/g, ' ');
          if (selector) {
            blocks.push({ selector, text, start: contentStart, end: i + 1 });
          }
          contentStart = -1;
        }
      }
    }
    return blocks;
  }

  // Build selector → block-text map from the patch
  const patchBlocks = parseBlocks(patchCss);
  const patchMap = new Map();
  for (const { selector, text } of patchBlocks) {
    patchMap.set(selector, text);
  }

  // Collect in-place replacements for blocks that exist in both
  const existingBlocks = parseBlocks(existingCss);
  const replacements = [];
  for (const { selector, start, end } of existingBlocks) {
    if (patchMap.has(selector)) {
      replacements.push({ start, end, newText: patchMap.get(selector) });
      patchMap.delete(selector);
    }
  }

  // Apply replacements from end → start to keep earlier offsets valid
  replacements.sort((a, b) => b.start - a.start);
  let result = existingCss;
  for (const { start, end, newText } of replacements) {
    result = result.slice(0, start) + newText + result.slice(end);
  }

  // Append genuinely new rules that had no matching selector in the original
  if (patchMap.size > 0) {
    result = result.trimEnd() + '\n\n' + [...patchMap.values()].join('\n\n') + '\n';
  }

  return result;
}

// ─── Line Diff ────────────────────────────────────────────────────────────────

function computeLineDiff(oldCss, newCss) {
  const oldLines = (oldCss || '').split('\n').map(l => l.trim()).filter(Boolean);
  const newLines = (newCss || '').split('\n').map(l => l.trim()).filter(Boolean);
  const m = oldLines.length, n = newLines.length;

  // LCS-based sequential diff (same basis as git diff).
  // Space-optimized: only two rows of the DP table kept in memory at once.
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] = oldLines[i - 1] === newLines[j - 1]
        ? prev[j - 1] + 1
        : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  const lcs = prev[n];
  return { added: n - lcs, removed: m - lcs };
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

async function saveBackup(css, label, starred = false) {
  const { backups } = await getBackups();
  // Skip identical CSS only for auto-backups (not manual starred ones)
  if (!starred && backups.length && backups[0].css === css) return { backups };
  const entry = { timestamp: new Date().toISOString(), css, label: label || '' };
  if (starred) entry.starred = true;
  const all = [entry, ...backups];
  // Starred backups are never trimmed; auto-backups capped at 100
  const starredEntries = all.filter(b => b.starred);
  const autoEntries    = all.filter(b => !b.starred).slice(0, 100);
  const updated = [...starredEntries, ...autoEntries]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
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
    try { await saveBackup(await readCssFromTab(custTab.id), `Before restoring: ${entry.label || new Date(entry.timestamp).toLocaleTimeString()}`); } catch (_) {}
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
  deepseekApiKey: '',
  deepseekModel: 'deepseek-v4-flash',
  openaiApiKey: '',
  openaiModel: 'gpt-4.1-mini',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3',
  ollamaVisionModel: 'llava',
  cfClientId: '',
  cfClientSecret: '',
  autoPublish: false,
  cssLineWrap: true,
  maxRollbacks: 100,
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
