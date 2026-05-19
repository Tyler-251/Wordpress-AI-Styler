// Injected into WordPress Customizer pages (customize.php)

function getCodeMirror() {
  const cmEl = document.querySelector('.CodeMirror');
  return cmEl ? cmEl.CodeMirror : null;
}

function readCss() {
  const cm = getCodeMirror();
  if (cm) return cm.getValue();
  const ta = document.querySelector('#custom_css_c1') || document.querySelector('textarea[id^="custom_css"]');
  return ta ? ta.value : '';
}

function writeCss(css, autoPublish) {
  const cm = getCodeMirror();
  if (cm) {
    cm.setValue(css);
    cm.save();
  } else {
    const ta = document.querySelector('#custom_css_c1') || document.querySelector('textarea[id^="custom_css"]');
    if (ta) {
      ta.value = css;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  if (autoPublish) {
    const saveBtn = document.querySelector('#save');
    if (saveBtn) saveBtn.click();
  }
  return true;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'READ_CSS') {
    sendResponse({ css: readCss() });
  } else if (msg.type === 'WRITE_CSS') {
    const ok = writeCss(msg.css, msg.autoPublish);
    sendResponse({ success: ok });
  }
  return false;
});
