const UI_DEFAULTS = {
  selectionShortcut: "alt+s",
  pageShortcut: "ctrl+alt+s",
  summaryHighlightColor: "#fff3a3"
};

const MODIFIERS = ["ctrl", "alt", "shift", "meta"];
const MODIFIER_ALIAS = {
  control: "ctrl",
  command: "meta",
  cmd: "meta",
  option: "alt"
};

let shortcutConfig = {
  selectionShortcut: UI_DEFAULTS.selectionShortcut,
  pageShortcut: UI_DEFAULTS.pageShortcut
};
let highlightColor = UI_DEFAULTS.summaryHighlightColor;
let isSummarizing = false;
let lastSelectionRange = null;
let lastSelectionText = "";

const selectionSummaryStore = new Map();

function normalizeText(text) {
  return (text || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeShortcut(input) {
  const raw = (input || "").toLowerCase().replace(/\s+/g, "");
  if (!raw) {
    return "";
  }

  const parts = raw.split("+").filter(Boolean).map((part) => MODIFIER_ALIAS[part] || part);
  if (!parts.length) {
    return "";
  }

  let key = "";
  const modifiers = [];
  for (const part of parts) {
    if (MODIFIERS.includes(part)) {
      if (!modifiers.includes(part)) {
        modifiers.push(part);
      }
      continue;
    }
    if (key) {
      return "";
    }
    key = part;
  }

  if (!key) {
    return "";
  }

  const orderedModifiers = MODIFIERS.filter((modifier) => modifiers.includes(modifier));
  return orderedModifiers.length ? `${orderedModifiers.join("+")}+${key}` : key;
}

function eventToShortcut(event) {
  const keyValue = (event.key || "").toLowerCase();
  const key = MODIFIERS.includes(keyValue) ? "" : keyValue === " " ? "space" : keyValue;
  if (!key) {
    return "";
  }

  const modifiers = [];
  if (event.ctrlKey) {
    modifiers.push("ctrl");
  }
  if (event.altKey) {
    modifiers.push("alt");
  }
  if (event.shiftKey) {
    modifiers.push("shift");
  }
  if (event.metaKey) {
    modifiers.push("meta");
  }

  const orderedModifiers = MODIFIERS.filter((modifier) => modifiers.includes(modifier));
  return orderedModifiers.length ? `${orderedModifiers.join("+")}+${key}` : key;
}

function normalizeColor(input) {
  const color = (input || "").trim().toLowerCase();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : UI_DEFAULTS.summaryHighlightColor;
}

function ensureUiStyles() {
  if (document.getElementById("__sl-summary-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "__sl-summary-style";
  style.textContent = [
    ":root{--sl-summary-highlight-color:#fff3a3;}",
    ".__sl-summary-highlight{background:var(--sl-summary-highlight-color);padding:0 .08em;border-radius:3px;}",
    "img.__sl-summary-image-highlight{outline:3px solid var(--sl-summary-highlight-color);outline-offset:2px;border-radius:6px;}",
    ".__sl-summary-bubble{display:inline-flex;align-items:center;justify-content:center;margin-left:6px;padding:1px 6px;border:1px solid #1366d6;background:#e9f2ff;color:#1366d6;border-radius:12px;font-size:11px;line-height:1.4;cursor:pointer;vertical-align:middle;}",
    "#__sl-selection-card{position:fixed;z-index:2147483647;width:min(340px,calc(100vw - 24px));background:#fff;border:1px solid #cfd6df;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:10px;}",
    "#__sl-selection-card .head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}",
    "#__sl-selection-card .title{font-size:13px;font-weight:600;color:#1f2d3d;}",
    "#__sl-selection-card .actions{display:flex;gap:6px;}",
    "#__sl-selection-card .copy{border:none;background:#e9f2ff;color:#1366d6;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:12px;}",
    "#__sl-selection-card .close{border:none;background:#1366d6;color:#fff;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:12px;}",
    "#__sl-selection-card .content{white-space:pre-wrap;line-height:1.6;font-size:13px;color:#233245;max-height:45vh;overflow:auto;}",
    "#__sl-page-summary-panel{position:fixed;right:0;top:72px;width:min(380px,88vw);max-height:72vh;background:#fff;border:1px solid #ccd4de;border-right:none;border-radius:10px 0 0 10px;box-shadow:0 8px 26px rgba(0,0,0,.18);z-index:2147483646;display:flex;flex-direction:column;transition:transform .2s ease;}",
    "#__sl-page-summary-panel.collapsed{transform:translateX(calc(100% - 38px));}",
    "#__sl-page-summary-panel .panel-head{display:flex;justify-content:space-between;align-items:center;padding:10px 10px 8px;border-bottom:1px solid #e0e5ec;}",
    "#__sl-page-summary-panel .panel-title{font-size:13px;font-weight:600;color:#1f2d3d;}",
    "#__sl-page-summary-panel .panel-actions{display:flex;gap:6px;}",
    "#__sl-page-summary-panel button{border:none;background:#1366d6;color:#fff;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;}",
    "#__sl-page-summary-panel .panel-body{padding:10px;white-space:pre-wrap;line-height:1.65;font-size:13px;color:#243342;overflow:auto;}",
    "#__sl-transient-msg{position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:8px 12px;border-radius:8px;background:#1f2d3d;color:#fff;font-size:12px;box-shadow:0 8px 20px rgba(0,0,0,.2);}"
  ].join("");
  document.documentElement.appendChild(style);
}

function updateHighlightColor(color) {
  highlightColor = normalizeColor(color);
  document.documentElement.style.setProperty("--sl-summary-highlight-color", highlightColor);
}

function showTransientMessage(text, level) {
  ensureUiStyles();
  let node = document.getElementById("__sl-transient-msg");
  if (!node) {
    node = document.createElement("div");
    node.id = "__sl-transient-msg";
    document.documentElement.appendChild(node);
  }

  node.textContent = text;
  node.style.background = level === "error" ? "#b8403b" : "#1f2d3d";
  node.style.display = "block";

  clearTimeout(showTransientMessage.timerId);
  showTransientMessage.timerId = setTimeout(() => {
    node.style.display = "none";
  }, 1800);
}
showTransientMessage.timerId = null;

async function copyText(text) {
  const content = String(text || "").trim();
  if (!content) {
    return false;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(content);
      return true;
    }
  } catch (_error) {
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = content;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch (_error) {
    return false;
  }
}

function ensureSelectionCard() {
  ensureUiStyles();
  let card = document.getElementById("__sl-selection-card");
  if (card) {
    return card;
  }

  card = document.createElement("div");
  card.id = "__sl-selection-card";
  card.style.display = "none";
  card.innerHTML = [
    "<div class='head'>",
    "<span class='title'>选中摘要</span>",
    "<div class='actions'>",
    "<button type='button' class='copy'>复制</button>",
    "<button type='button' class='close'>关闭</button>",
    "</div>",
    "</div>",
    "<div class='content'></div>"
  ].join("");
  document.documentElement.appendChild(card);

  card.querySelector(".copy").addEventListener("click", async () => {
    const content = card.querySelector(".content")?.textContent || "";
    const ok = await copyText(content);
    showTransientMessage(ok ? "已复制摘要。" : "复制失败，请手动复制。", ok ? "normal" : "error");
  });
  card.querySelector(".close").addEventListener("click", () => {
    card.style.display = "none";
  });
  return card;
}

function openSelectionCard(summaryId, anchorEl) {
  const payload = selectionSummaryStore.get(summaryId);
  if (!payload?.summary) {
    showTransientMessage("摘要已失效，请重新生成。", "error");
    return;
  }

  const card = ensureSelectionCard();
  card.querySelector(".title").textContent = payload.title || "摘要";
  card.querySelector(".content").textContent = payload.summary;
  card.style.display = "block";

  const rect = anchorEl.getBoundingClientRect();
  const cardWidth = Math.min(340, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - cardWidth - 12));
  let top = rect.bottom + 10;
  if (top + 220 > window.innerHeight) {
    top = Math.max(12, rect.top - 230);
  }

  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

function createSummaryBubble(summaryId) {
  const bubble = document.createElement("button");
  bubble.type = "button";
  bubble.className = "__sl-summary-bubble";
  bubble.textContent = "省流";
  bubble.dataset.summaryId = summaryId;
  bubble.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openSelectionCard(summaryId, bubble);
  });
  return bubble;
}

function ensurePageSummaryPanel() {
  ensureUiStyles();
  let panel = document.getElementById("__sl-page-summary-panel");
  if (panel) {
    return panel;
  }

  panel = document.createElement("section");
  panel.id = "__sl-page-summary-panel";
  panel.style.display = "none";
  panel.innerHTML = [
    "<div class='panel-head'>",
    "<span class='panel-title'>全文省流总结</span>",
    "<div class='panel-actions'>",
    "<button type='button' data-action='toggle'>收起</button>",
    "<button type='button' data-action='close'>关闭</button>",
    "</div>",
    "</div>",
    "<div class='panel-body'></div>"
  ].join("");
  document.documentElement.appendChild(panel);

  const toggleBtn = panel.querySelector("[data-action='toggle']");
  const closeBtn = panel.querySelector("[data-action='close']");

  toggleBtn.addEventListener("click", () => {
    const collapsed = panel.classList.toggle("collapsed");
    toggleBtn.textContent = collapsed ? "展开" : "收起";
  });
  closeBtn.addEventListener("click", () => {
    panel.style.display = "none";
  });

  return panel;
}

function renderPageSummaryPanel(state, summary, errorMessage) {
  const panel = ensurePageSummaryPanel();
  const body = panel.querySelector(".panel-body");
  const toggleBtn = panel.querySelector("[data-action='toggle']");

  panel.style.display = "flex";
  panel.classList.remove("collapsed");
  toggleBtn.textContent = "收起";

  if (state === "loading") {
    body.textContent = "正在总结全文，请稍候...";
    body.style.color = "#243342";
    return;
  }
  if (state === "error") {
    body.textContent = `总结失败：${errorMessage || "未知错误"}`;
    body.style.color = "#b8403b";
    return;
  }

  body.textContent = summary || "未返回摘要内容。";
  body.style.color = "#243342";
}

function isEditableTarget(target) {
  if (!target) {
    return false;
  }

  const tagName = target.tagName?.toLowerCase() || "";
  if (target.isContentEditable) {
    return true;
  }
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function getActiveElementSelectedText() {
  const active = document.activeElement;
  if (!active) {
    return "";
  }

  const tagName = active.tagName?.toLowerCase();
  const isTextInput = tagName === "textarea" || (tagName === "input" && /^(text|search|url|tel|password)$/i.test(active.type));
  if (!isTextInput) {
    return "";
  }

  const start = active.selectionStart;
  const end = active.selectionEnd;
  if (typeof start !== "number" || typeof end !== "number" || end <= start) {
    return "";
  }
  return active.value.slice(start, end);
}

function textProbablyMatches(a, b) {
  if (!b) {
    return true;
  }
  if (!a) {
    return false;
  }
  return a === b || a.includes(b) || b.includes(a);
}

function rememberSelection(range) {
  if (!range || range.collapsed) {
    return;
  }
  const text = normalizeText(range.toString());
  if (!text) {
    return;
  }

  try {
    lastSelectionRange = range.cloneRange();
    lastSelectionText = text.slice(0, 8000);
  } catch (_error) {
  }
}

function captureSelectionSnapshot() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }
  rememberSelection(selection.getRangeAt(0));
}

function getSelectionText() {
  const selection = normalizeText(window.getSelection()?.toString() || "");
  const fallbackInput = normalizeText(getActiveElementSelectedText());
  const merged = selection || fallbackInput || lastSelectionText;
  return merged.slice(0, 8000);
}

function getSelectionRangeForHighlight(sourceText) {
  const normalizedSource = normalizeText(sourceText || "").slice(0, 8000);

  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const currentRange = selection.getRangeAt(0);
    if (!currentRange.collapsed) {
      const currentText = normalizeText(currentRange.toString()).slice(0, 8000);
      if (textProbablyMatches(currentText, normalizedSource)) {
        return currentRange.cloneRange();
      }
    }
  }

  if (lastSelectionRange) {
    try {
      const backupText = normalizeText(lastSelectionRange.toString()).slice(0, 8000);
      if (textProbablyMatches(backupText, normalizedSource)) {
        return lastSelectionRange.cloneRange();
      }
    } catch (_error) {
    }
  }

  return null;
}

function applySelectionSummary(summary, sourceText) {
  ensureUiStyles();
  const range = getSelectionRangeForHighlight(sourceText);
  if (!range) {
    return { ok: false, error: "已生成摘要，但未找到可高亮的选区。" };
  }

  const summaryId = `summary_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const highlightNode = document.createElement("span");
  highlightNode.className = "__sl-summary-highlight";
  highlightNode.dataset.summaryId = summaryId;

  try {
    try {
      range.surroundContents(highlightNode);
    } catch (_error) {
      const fragment = range.extractContents();
      highlightNode.appendChild(fragment);
      range.insertNode(highlightNode);
    }

    if (!highlightNode.parentNode) {
      return { ok: false, error: "选区渲染失败，请重新选择文本。"};
    }

    const bubble = createSummaryBubble(summaryId);
    highlightNode.insertAdjacentElement("afterend", bubble);

    selectionSummaryStore.set(summaryId, {
      title: "选中摘要",
      summary
    });
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }
    lastSelectionRange = null;
    lastSelectionText = "";
    showTransientMessage("已添加摘要气泡，点击“省流”查看。", "normal");
    return { ok: true };
  } catch (_error) {
    return { ok: false, error: "选区渲染失败，请重新选择文本。" };
  }
}

function normalizeUrl(value) {
  try {
    return new URL(value, location.href).href;
  } catch (_error) {
    return (value || "").trim();
  }
}

function findImageElement(imageUrl) {
  const targetUrl = normalizeUrl(imageUrl);
  if (!targetUrl) {
    return null;
  }

  const images = document.querySelectorAll("img");
  for (const img of images) {
    const current = normalizeUrl(img.currentSrc || img.src || "");
    if (current && current === targetUrl) {
      return img;
    }
  }

  for (const img of images) {
    const current = normalizeUrl(img.currentSrc || img.src || "");
    if (current && (current.includes(targetUrl) || targetUrl.includes(current))) {
      return img;
    }
  }

  return null;
}

function applyImageSummary(summary, imageUrl) {
  ensureUiStyles();
  const imageEl = findImageElement(imageUrl);
  if (!imageEl) {
    return { ok: false, error: "已生成摘要，但未定位到对应图片。" };
  }

  const summaryId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  imageEl.classList.add("__sl-summary-image-highlight");

  const existingBubble = imageEl.nextElementSibling;
  if (existingBubble && existingBubble.classList?.contains("__sl-summary-bubble")) {
    existingBubble.remove();
  }
  const bubble = createSummaryBubble(summaryId);
  imageEl.insertAdjacentElement("afterend", bubble);

  selectionSummaryStore.set(summaryId, {
    title: "图片摘要",
    summary
  });
  showTransientMessage("已添加图片摘要气泡，点击“省流”查看。", "normal");
  return { ok: true };
}

function getPageText() {
  const candidates = [];
  const nodes = document.querySelectorAll("article, main, [role='main']");

  for (const node of nodes) {
    const text = normalizeText(node.innerText || "");
    if (text) {
      candidates.push(text);
    }
  }

  const bodyText = normalizeText(document.body?.innerText || "");
  if (bodyText) {
    candidates.push(bodyText);
  }

  candidates.sort((a, b) => b.length - a.length);
  return (candidates[0] || "").slice(0, 15000);
}

function sendSummaryRequest(text, mode) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "SUMMARIZE_TEXT",
        text,
        mode
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || "总结失败。"));
          return;
        }
        resolve(response.summary || "");
      }
    );
  });
}

async function runSummaryByShortcut(mode) {
  if (isSummarizing) {
    showTransientMessage("正在总结，请稍候...", "normal");
    return;
  }

  const sourceText = mode === "selection" ? getSelectionText() : getPageText();
  if (!sourceText) {
    showTransientMessage(mode === "selection" ? "未检测到选中文本，请先选中后再试。" : "未提取到网页正文。", "error");
    return;
  }

  isSummarizing = true;
  if (mode === "page") {
    renderPageSummaryPanel("loading");
  } else {
    showTransientMessage("正在总结，请稍候...", "normal");
  }

  try {
    const summary = await sendSummaryRequest(sourceText, mode);
    if (mode === "selection") {
      const result = applySelectionSummary(summary, sourceText);
      if (!result.ok) {
        showTransientMessage(result.error, "error");
      }
    } else {
      renderPageSummaryPanel("done", summary);
    }
  } catch (error) {
    if (mode === "page") {
      renderPageSummaryPanel("error", "", error?.message || String(error));
    } else {
      showTransientMessage(`总结失败：${error?.message || String(error)}`, "error");
    }
  } finally {
    isSummarizing = false;
  }
}

function handleShortcutKeydown(event) {
  if (event.repeat || isEditableTarget(event.target)) {
    return;
  }

  const current = eventToShortcut(event);
  if (!current) {
    return;
  }

  if (current === shortcutConfig.selectionShortcut) {
    event.preventDefault();
    void runSummaryByShortcut("selection");
    return;
  }
  if (current === shortcutConfig.pageShortcut) {
    event.preventDefault();
    void runSummaryByShortcut("page");
  }
}

function loadUiSettings() {
  chrome.storage.sync.get(UI_DEFAULTS, (settings) => {
    const selectionShortcut = normalizeShortcut(settings.selectionShortcut);
    const pageShortcut = normalizeShortcut(settings.pageShortcut);
    shortcutConfig = {
      selectionShortcut: selectionShortcut || UI_DEFAULTS.selectionShortcut,
      pageShortcut: pageShortcut || UI_DEFAULTS.pageShortcut
    };
    updateHighlightColor(settings.summaryHighlightColor);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_SELECTION_TEXT") {
    sendResponse({ ok: true, text: getSelectionText() });
    return true;
  }

  if (message?.type === "GET_PAGE_TEXT") {
    sendResponse({ ok: true, text: getPageText() });
    return true;
  }

  if (message?.type === "APPLY_SELECTION_SUMMARY") {
    const result = applySelectionSummary(message.summary || "", message.sourceText || "");
    sendResponse(result);
    return true;
  }

  if (message?.type === "APPLY_IMAGE_SUMMARY") {
    const result = applyImageSummary(message.summary || "", message.imageUrl || "");
    sendResponse(result);
    return true;
  }

  if (message?.type === "SHOW_PAGE_SUMMARY_PANEL") {
    renderPageSummaryPanel(message.state || "done", message.summary || "", message.error || "");
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "SHOW_TRANSIENT_MESSAGE") {
    showTransientMessage(message.text || "", message.level || "normal");
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") {
    return;
  }

  if (changes.selectionShortcut || changes.pageShortcut) {
    loadUiSettings();
  }
  if (changes.summaryHighlightColor) {
    updateHighlightColor(changes.summaryHighlightColor.newValue);
  }
});

document.addEventListener("selectionchange", captureSelectionSnapshot, true);
document.addEventListener("mouseup", captureSelectionSnapshot, true);
document.addEventListener("contextmenu", captureSelectionSnapshot, true);
document.addEventListener("keydown", handleShortcutKeydown, true);

ensureUiStyles();
updateHighlightColor(highlightColor);
loadUiSettings();
