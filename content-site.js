// Injected into all pages — returns a compact DOM snapshot and detects form step

function domSnapshot(root) {
  const nodes = [];
  function walk(el, depth) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
    const id      = el.id || '';
    const classes = Array.from(el.classList).slice(0, 8);
    // Only include elements that are targetable with CSS (have an id or classes)
    if (id || classes.length) {
      nodes.push({ tag: el.tagName.toLowerCase(), id, classes, depth });
    }
    for (const child of el.children) walk(child, depth + 1);
  }
  walk(root, 0);
  return nodes;
}

function detectStep() {
  // Primary: .tab.stepN with inline style="display: block" — the site toggles steps this way
  for (let i = 1; i <= 10; i++) {
    const el = document.querySelector(`.tab.step${i}`);
    if (el && el.style.display === 'block') return i;
  }

  // Fallback: progress list data-mynumber on active item
  const activeListItem = document.querySelector('.progress-list li.active');
  if (activeListItem) {
    const num = parseInt(activeListItem.dataset.mynumber, 10);
    if (!isNaN(num) && num > 0) return num;
  }

  // Last resort: computed style on #stepN
  for (let i = 1; i <= 10; i++) {
    const el = document.querySelector(`#step${i}`);
    if (el) {
      const s = window.getComputedStyle(el);
      if (s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0') return i;
    }
  }

  return null;
}

function rootForStep(stepNum) {
  if (!stepNum) return document.body;
  // Prefer .tab.stepN (outer wrapper) over #stepN which may be an inner child div
  return document.querySelector(`.tab.step${stepNum}`)
    || document.querySelector(`#step${stepNum}`)
    || document.body;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'READ_DOM') {
    const step = detectStep();
    const root = msg.stepScope ? rootForStep(msg.stepScope) : document.body;
    const snapshot = domSnapshot(root);
    sendResponse({ dom: snapshot, step });
  } else if (msg.type === 'DETECT_STEP') {
    sendResponse({ step: detectStep() });
  } else if (msg.type === 'DETECT_STEP_DEBUG') {
    const debug = {};

    // 1. Progress list active li
    const activeListItem = document.querySelector('.progress-list li.active');
    if (activeListItem) {
      debug.progressListActiveLi = {
        outerHTML: activeListItem.outerHTML.slice(0, 300),
        dataMynumber: activeListItem.dataset.mynumber,
        classes: activeListItem.className,
      };
      const num = parseInt(activeListItem.dataset.mynumber, 10);
      debug.progressListParsedNum = num;
      debug.progressListResult = (!isNaN(num) && num > 0) ? num : 'skipped (non-positive)';
    } else {
      debug.progressListActiveLi = 'NOT FOUND — no .progress-list li.active in DOM';
      debug.progressListResult = null;
    }

    // 2. All .tab.stepN found
    const tabSteps = [];
    for (let i = 1; i <= 10; i++) {
      const el = document.querySelector(`.tab.step${i}`);
      if (el) {
        tabSteps.push({
          step: i,
          inlineDisplay: el.style.display,
          computedDisplay: window.getComputedStyle(el).display,
          classes: el.className,
          id: el.id,
        });
      }
    }
    debug.tabStepElements = tabSteps.length ? tabSteps : 'NONE FOUND';

    const activeTabStep = tabSteps.find(t => t.inlineDisplay === 'block');
    debug.tabStepInlineBlockResult = activeTabStep ? activeTabStep.step : 'NONE with inline display:block';

    // 3. All #stepN found
    const idSteps = [];
    for (let i = 1; i <= 10; i++) {
      const el = document.querySelector(`#step${i}`);
      if (el) {
        idSteps.push({
          step: i,
          inlineDisplay: el.style.display,
          computedDisplay: window.getComputedStyle(el).display,
          classes: el.className,
        });
      }
    }
    debug.idStepElements = idSteps.length ? idSteps : 'NONE FOUND';

    // 4. Final result
    debug.finalDetectedStep = detectStep();

    sendResponse({ debug });
  }
  return false;
});
