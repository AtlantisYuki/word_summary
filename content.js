const UI_DEFAULTS = {
  selectionShortcut: "alt+s",
  pageShortcut: "ctrl+alt+s",
  summaryHighlightColor: "#fff3a3",
  selectionPendingBgColor: "#fff3a3",
  selectionPendingBorderColor: "#f59e0b",
  selectionPendingBorderWidth: 1,
  selectionPendingBorderStyle: "solid",
  selectionLoadingText: "总结中",
  enableSelectionSummary: true,
  enableImageSummary: true,
  enablePageSummary: true
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
let pendingStyleConfig = {
  bgColor: UI_DEFAULTS.selectionPendingBgColor,
  borderColor: UI_DEFAULTS.selectionPendingBorderColor,
  borderWidth: UI_DEFAULTS.selectionPendingBorderWidth,
  borderStyle: UI_DEFAULTS.selectionPendingBorderStyle
};
let selectionLoadingText = UI_DEFAULTS.selectionLoadingText;
let featureConfig = {
  enableSelectionSummary: UI_DEFAULTS.enableSelectionSummary,
  enableImageSummary: UI_DEFAULTS.enableImageSummary,
  enablePageSummary: UI_DEFAULTS.enablePageSummary
};
let isSummarizing = false;
let lastSelectionRange = null;
let lastSelectionText = "";

const selectionSummaryStore = new Map();
let activeSelectionArtifact = null;
let activeImageArtifact = null;
let lastKnownPageUrl = location.href;
let selectionCardHideTimer = null;
const supportsCustomHighlights =
  typeof window !== "undefined" &&
  typeof window.Highlight !== "undefined" &&
  typeof CSS !== "undefined" &&
  CSS.highlights;

let pendingSelectionHighlight = null;
let finalSelectionHighlight = null;

function ensureSelectionHighlights() {
  if (!supportsCustomHighlights) {
    return false;
  }
  if (!pendingSelectionHighlight) {
    pendingSelectionHighlight = new Highlight();
    CSS.highlights.set("sl-selection-pending", pendingSelectionHighlight);
  }
  if (!finalSelectionHighlight) {
    finalSelectionHighlight = new Highlight();
    CSS.highlights.set("sl-selection-final", finalSelectionHighlight);
  }
  return true;
}

function addRangeToHighlight(highlight, range) {
  try {
    highlight.add(range);
    return true;
  } catch (_error) {
    return false;
  }
}

function removeRangeFromHighlight(highlight, range) {
  try {
    highlight.delete(range);
  } catch (_error) {
  }
}

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

function normalizeBorderStyle(value) {
  const style = String(value || "").trim().toLowerCase();
  const allowed = ["solid", "dashed", "dotted", "double"];
  return allowed.includes(style) ? style : UI_DEFAULTS.selectionPendingBorderStyle;
}

function normalizeBorderWidth(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return UI_DEFAULTS.selectionPendingBorderWidth;
  }
  const width = Math.max(0, Math.min(6, Math.floor(parsed)));
  return width;
}

function ensureUiStyles() {
  if (document.getElementById("__sl-summary-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "__sl-summary-style";
  style.textContent = [
    ":root{--sl-summary-highlight-color:#fff3a3;--sl-selection-pending-bg:#fff3a3;--sl-selection-pending-border:#f59e0b;--sl-selection-pending-border-width:1px;--sl-selection-pending-border-style:solid;}",
    ".__sl-summary-highlight{background:var(--sl-summary-highlight-color);padding:0 .08em;border-radius:3px;}",
    ".__sl-summary-pending{box-shadow:inset 0 0 0 1px #f59e0b;}",
    ".__sl-summary-loading{display:inline-flex;align-items:center;margin-left:6px;padding:1px 7px;border:1px dashed #1366d6;background:#eef5ff;color:#1f4f96;border-radius:12px;font-size:11px;line-height:1.4;vertical-align:middle;}",
    "::highlight(sl-selection-pending){background:var(--sl-selection-pending-bg);text-decoration-line:underline;text-decoration-style:var(--sl-selection-pending-border-style);text-decoration-color:var(--sl-selection-pending-border);text-decoration-thickness:var(--sl-selection-pending-border-width);}",
    "::highlight(sl-selection-final){background:var(--sl-summary-highlight-color);}",
    "img.__sl-summary-image-highlight{outline:3px solid var(--sl-summary-highlight-color);outline-offset:2px;border-radius:6px;}",
    ".__sl-summary-bubble{display:inline-flex;align-items:center;justify-content:center;margin-left:6px;padding:1px 6px;border:1px solid #1366d6;background:#e9f2ff;color:#1366d6;border-radius:12px;font-size:11px;line-height:1.4;cursor:pointer;vertical-align:middle;}",
    "#__sl-floating-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483646;}",
    "#__sl-floating-layer .__sl-summary-bubble{position:fixed;margin:0;pointer-events:auto;}",
    "#__sl-selection-card{position:fixed;z-index:2147483647;width:min(340px,calc(100vw - 24px));background:#fff;border:1px solid #cfd6df;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.16);padding:10px;}",
    "#__sl-selection-card .head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}",
    "#__sl-selection-card .title{font-size:13px;font-weight:600;color:#1f2d3d;}",
    "#__sl-selection-card .actions{display:flex;gap:6px;}",
    "#__sl-selection-card .copy{border:none;background:#e9f2ff;color:#1366d6;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:12px;}",
    "#__sl-selection-card .close{border:none;background:#1366d6;color:#fff;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:12px;}",
    "#__sl-selection-card .content{white-space:pre-wrap;line-height:1.6;font-size:13px;color:#233245;max-height:45vh;overflow:auto;}",
    "#__sl-page-summary-dock{position:fixed;right:12px;top:50%;transform:translateY(-50%);z-index:2147483646;display:none;}",
    "#__sl-page-summary-dock .dock-bubble{display:inline-flex;align-items:center;justify-content:center;padding:3px 8px;border:1px solid #1366d6;background:#e9f2ff;color:#1366d6;border-radius:14px;font-size:12px;line-height:1.4;cursor:default;}",
    "#__sl-page-summary-dock .dock-panel{display:none;flex-direction:column;width:min(380px,88vw);max-height:72vh;background:#fff;border:1px solid #ccd4de;border-radius:10px;box-shadow:0 8px 26px rgba(0,0,0,.18);overflow:hidden;}",
    "#__sl-page-summary-dock.expanded .dock-bubble{display:none;}",
    "#__sl-page-summary-dock.expanded .dock-panel{display:flex;}",
    "#__sl-page-summary-dock .panel-head{display:flex;justify-content:space-between;align-items:center;padding:10px 10px 8px;border-bottom:1px solid #e0e5ec;}",
    "#__sl-page-summary-dock .panel-title{font-size:13px;font-weight:600;color:#1f2d3d;}",
    "#__sl-page-summary-dock .panel-body{padding:10px;white-space:pre-wrap;line-height:1.65;font-size:13px;color:#243342;overflow:auto;}",
    "#__sl-transient-msg{position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:8px 12px;border-radius:8px;background:#1f2d3d;color:#fff;font-size:12px;box-shadow:0 8px 20px rgba(0,0,0,.2);}"
  ].join("");
  document.documentElement.appendChild(style);
}

function updateHighlightColor(color) {
  highlightColor = normalizeColor(color);
  document.documentElement.style.setProperty("--sl-summary-highlight-color", highlightColor);
}

function updateSelectionStyleVariables() {
  document.documentElement.style.setProperty("--sl-selection-pending-bg", pendingStyleConfig.bgColor);
  document.documentElement.style.setProperty("--sl-selection-pending-border", pendingStyleConfig.borderColor);
  document.documentElement.style.setProperty("--sl-selection-pending-border-width", `${pendingStyleConfig.borderWidth}px`);
  document.documentElement.style.setProperty("--sl-selection-pending-border-style", pendingStyleConfig.borderStyle);
}

function getLoadingText() {
  const configured = (selectionLoadingText || "").trim();
  if (configured) {
    return configured;
  }
  return UI_DEFAULTS.selectionLoadingText;
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
    clearSelectionCardHideTimer();
    hideSelectionCard();
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
  card.dataset.summaryId = summaryId;
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

function createSummaryBubble(summaryId, options = {}) {
  const bubble = document.createElement("button");
  bubble.type = "button";
  bubble.className = "__sl-summary-bubble";
  bubble.textContent = options.text || "省流";
  bubble.dataset.summaryId = summaryId;
  bubble.dataset.summaryType = options.summaryType || "generic";
  if (options.clickable !== false) {
    bubble.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSelectionCard(summaryId, bubble);
    });
  }
  return bubble;
}

function clearSelectionCardHideTimer() {
  if (!selectionCardHideTimer) {
    return;
  }
  clearTimeout(selectionCardHideTimer);
  selectionCardHideTimer = null;
}

function scheduleHideSelectionCard() {
  clearSelectionCardHideTimer();
  selectionCardHideTimer = setTimeout(() => {
    hideSelectionCard();
  }, 160);
}

function bindSelectionCardHover(summaryId, bubble) {
  const card = ensureSelectionCard();
  let overBubble = false;
  let overCard = false;

  const sync = () => {
    if (overBubble || overCard) {
      clearSelectionCardHideTimer();
      openSelectionCard(summaryId, bubble);
      return;
    }
    scheduleHideSelectionCard();
  };

  const onBubbleEnter = () => {
    overBubble = true;
    sync();
  };
  const onBubbleLeave = () => {
    overBubble = false;
    sync();
  };
  const onCardEnter = () => {
    if (card.dataset.summaryId !== summaryId) {
      return;
    }
    overCard = true;
    sync();
  };
  const onCardLeave = () => {
    if (card.dataset.summaryId !== summaryId) {
      return;
    }
    overCard = false;
    sync();
  };

  bubble.addEventListener("mouseenter", onBubbleEnter);
  bubble.addEventListener("mouseleave", onBubbleLeave);
  card.addEventListener("mouseenter", onCardEnter);
  card.addEventListener("mouseleave", onCardLeave);

  return () => {
    if (card.dataset.summaryId === summaryId) {
      clearSelectionCardHideTimer();
      hideSelectionCard();
    }
    bubble.removeEventListener("mouseenter", onBubbleEnter);
    bubble.removeEventListener("mouseleave", onBubbleLeave);
    card.removeEventListener("mouseenter", onCardEnter);
    card.removeEventListener("mouseleave", onCardLeave);
  };
}

function hideSelectionCard() {
  const card = document.getElementById("__sl-selection-card");
  if (card) {
    card.dataset.summaryId = "";
    card.style.display = "none";
  }
}

function clearPreviousSelectionArtifacts() {
  if (!activeSelectionArtifact) {
    hideSelectionCard();
    return;
  }

  activeSelectionArtifact.cleanupHover?.();
  activeSelectionArtifact.bubble?.remove();

  if (activeSelectionArtifact.useCustomHighlight) {
    try {
      pendingSelectionHighlight?.clear?.();
      finalSelectionHighlight?.clear?.();
    } catch (_error) {
    }
    activeSelectionArtifact.anchorNode?.remove();
  } else if (activeSelectionArtifact.highlightNode?.parentNode) {
    unwrapNode(activeSelectionArtifact.highlightNode);
  }

  selectionSummaryStore.delete(activeSelectionArtifact.summaryId);
  activeSelectionArtifact = null;
  hideSelectionCard();
}

function ensureFloatingLayer() {
  ensureUiStyles();
  let layer = document.getElementById("__sl-floating-layer");
  if (layer) {
    return layer;
  }
  layer = document.createElement("div");
  layer.id = "__sl-floating-layer";
  document.documentElement.appendChild(layer);
  return layer;
}

function positionImageBubble(imageEl, bubble) {
  if (!imageEl?.isConnected || !bubble?.isConnected) {
    return;
  }
  const rect = imageEl.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > viewportHeight) {
    bubble.style.display = "none";
    return;
  }

  bubble.style.display = "inline-flex";
  bubble.style.left = "-9999px";
  bubble.style.top = "-9999px";
  const bubbleRect = bubble.getBoundingClientRect();
  const gap = 8;
  const bubbleWidth = bubbleRect.width || 40;
  const bubbleHeight = bubbleRect.height || 22;

  let left = rect.right - bubbleWidth;
  let top = rect.bottom + gap;
  if (top + bubbleHeight > viewportHeight - 8) {
    top = rect.top - bubbleHeight - gap;
  }

  left = Math.max(8, Math.min(left, viewportWidth - bubbleWidth - 8));
  top = Math.max(8, Math.min(top, viewportHeight - bubbleHeight - 8));
  bubble.style.left = `${Math.round(left)}px`;
  bubble.style.top = `${Math.round(top)}px`;
}

function bindImageBubblePosition(imageEl, bubble) {
  const update = () => {
    positionImageBubble(imageEl, bubble);
  };

  window.addEventListener("scroll", update, true);
  window.addEventListener("resize", update, true);
  update();

  return () => {
    window.removeEventListener("scroll", update, true);
    window.removeEventListener("resize", update, true);
  };
}

function clearActiveImageArtifact() {
  if (!activeImageArtifact) {
    return;
  }
  activeImageArtifact.cleanupPosition?.();
  activeImageArtifact.cleanupHover?.();
  activeImageArtifact.imageEl?.classList?.remove("__sl-summary-image-highlight");
  activeImageArtifact.bubble?.remove();
  selectionSummaryStore.delete(activeImageArtifact.summaryId);
  activeImageArtifact = null;
}

function ensurePageSummaryPanel() {
  ensureUiStyles();
  let dock = document.getElementById("__sl-page-summary-dock");
  if (!dock) {
    dock = document.createElement("section");
    dock.id = "__sl-page-summary-dock";
    dock.style.display = "none";
    dock.innerHTML = [
      "<div class='dock-bubble'>省流</div>",
      "<div class='dock-panel'>",
      "<div class='panel-head'>",
      "<span class='panel-title'>全文省流总结</span>",
      "</div>",
      "<div class='panel-body'></div>",
      "</div>"
    ].join("");
    document.documentElement.appendChild(dock);

    dock.addEventListener("mouseenter", () => {
      dock.classList.add("expanded");
    });
    dock.addEventListener("mouseleave", () => {
      dock.classList.remove("expanded");
    });
  }

  return dock;
}

function destroyPageSummaryPanel() {
  const dock = document.getElementById("__sl-page-summary-dock");
  if (dock) {
    dock.remove();
  }
}

function renderPageSummaryPanel(state, summary, errorMessage) {
  const dock = ensurePageSummaryPanel();
  const body = dock.querySelector(".panel-body");
  const bubble = dock.querySelector(".dock-bubble");

  dock.style.display = "block";
  dock.classList.remove("expanded");

  if (state === "loading") {
    bubble.textContent = getLoadingText();
    body.textContent = `${getLoadingText()}，请稍候...`;
    body.style.color = "#243342";
    return;
  }
  bubble.textContent = "省流";
  if (state === "error") {
    body.textContent = `总结失败：${errorMessage || "未知错误"}`;
    body.style.color = "#b8403b";
    return;
  }

  body.textContent = summary || "未返回摘要内容。";
  body.style.color = "#243342";
}

function handlePageLocationChanged() {
  const currentUrl = location.href;
  if (currentUrl === lastKnownPageUrl) {
    return;
  }
  lastKnownPageUrl = currentUrl;
  destroyPageSummaryPanel();
  clearActiveImageArtifact();
  clearPreviousSelectionArtifacts();
}

function installPageNavigationCleanup() {
  if (window.__slSummaryNavHooked__) {
    return;
  }
  window.__slSummaryNavHooked__ = true;

  const patchHistoryMethod = (methodName) => {
    const original = history[methodName];
    if (typeof original !== "function") {
      return;
    }
    history[methodName] = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);
      handlePageLocationChanged();
      return result;
    };
  };

  patchHistoryMethod("pushState");
  patchHistoryMethod("replaceState");
  window.addEventListener("popstate", handlePageLocationChanged, true);
  window.addEventListener("hashchange", handlePageLocationChanged, true);
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

  clearPreviousSelectionArtifacts();
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

    const bubble = createSummaryBubble(summaryId, { summaryType: "selection" });
    highlightNode.insertAdjacentElement("afterend", bubble);
    activeSelectionArtifact = {
      summaryId,
      useCustomHighlight: false,
      highlightNode,
      bubble,
      cleanupHover: bindSelectionCardHover(summaryId, bubble)
    };

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
    showTransientMessage("摘要已生成，悬停“省流”查看。", "normal");
    return { ok: true };
  } catch (_error) {
    return { ok: false, error: "选区渲染失败，请重新选择文本。" };
  }
}

function getSelectionRangeForTask() {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const currentRange = selection.getRangeAt(0);
    if (!currentRange.collapsed) {
      return currentRange.cloneRange();
    }
  }

  if (lastSelectionRange) {
    try {
      const text = normalizeText(lastSelectionRange.toString());
      if (text) {
        return lastSelectionRange.cloneRange();
      }
    } catch (_error) {
    }
  }

  return null;
}

function applyPendingSelectionStyle(node) {
  node.style.background = pendingStyleConfig.bgColor;
  if (pendingStyleConfig.borderWidth > 0) {
    node.style.border = `${pendingStyleConfig.borderWidth}px ${pendingStyleConfig.borderStyle} ${pendingStyleConfig.borderColor}`;
  } else {
    node.style.border = "none";
  }
  node.style.borderRadius = "3px";
}

function createSelectionLoadingNode() {
  const loading = document.createElement("span");
  loading.className = "__sl-summary-loading";
  loading.textContent = getLoadingText();
  return loading;
}

function createSelectionAnchorNode(summaryId) {
  const anchor = document.createElement("span");
  anchor.className = "__sl-summary-anchor";
  anchor.dataset.summaryId = summaryId;
  anchor.style.cssText = "display:inline-block;width:0;height:0;line-height:0;";
  return anchor;
}

function unwrapNode(node) {
  const parent = node?.parentNode;
  if (!parent) {
    return;
  }
  while (node.firstChild) {
    parent.insertBefore(node.firstChild, node);
  }
  node.remove();
}

function beginSelectionSummaryTask() {
  ensureUiStyles();
  const range = getSelectionRangeForTask();
  if (!range) {
    return { ok: false, error: "未找到选区，任务已终止。" };
  }

  const sourceText = normalizeText(range.toString()).slice(0, 8000);
  if (!sourceText) {
    return { ok: false, error: "选区为空，任务已终止。" };
  }

  const summaryId = `summary_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const loadingNode = createSelectionLoadingNode();

  if (ensureSelectionHighlights()) {
    const pendingRange = range.cloneRange();
    const added = addRangeToHighlight(pendingSelectionHighlight, pendingRange);
    if (!added) {
      return { ok: false, error: "选区样式应用失败，任务已终止。" };
    }

    try {
      const endRange = range.cloneRange();
      endRange.collapse(false);
      const anchorNode = createSelectionAnchorNode(summaryId);
      endRange.insertNode(anchorNode);
      anchorNode.insertAdjacentElement("afterend", loadingNode);

      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
      }
      lastSelectionRange = null;
      lastSelectionText = "";

      return {
        ok: true,
        task: {
          summaryId,
          sourceText,
          loadingNode,
          anchorNode,
          pendingRange,
          useCustomHighlight: true
        }
      };
    } catch (_error) {
      removeRangeFromHighlight(pendingSelectionHighlight, pendingRange);
      return { ok: false, error: "选区样式应用失败，任务已终止。" };
    }
  }

  const highlightNode = document.createElement("span");
  highlightNode.className = "__sl-summary-highlight __sl-summary-pending";
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
      return { ok: false, error: "选区样式应用失败，任务已终止。" };
    }

    applyPendingSelectionStyle(highlightNode);
    highlightNode.insertAdjacentElement("afterend", loadingNode);

    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }
    lastSelectionRange = null;
    lastSelectionText = "";

    return {
      ok: true,
      task: {
        summaryId,
        sourceText,
        highlightNode,
        loadingNode,
        useCustomHighlight: false
      }
    };
  } catch (_error) {
    return { ok: false, error: "选区样式应用失败，任务已终止。" };
  }
}

function finishSelectionSummaryTask(task, summary) {
  task.loadingNode?.remove();

  if (task.useCustomHighlight) {
    if (!task.anchorNode?.parentNode) {
      removeRangeFromHighlight(pendingSelectionHighlight, task.pendingRange);
      return { ok: false, error: "选区已变化，无法渲染结果。" };
    }
    removeRangeFromHighlight(pendingSelectionHighlight, task.pendingRange);
    addRangeToHighlight(finalSelectionHighlight, task.pendingRange);

    const bubble = createSummaryBubble(task.summaryId, { summaryType: "selection" });
    task.anchorNode.insertAdjacentElement("afterend", bubble);

    activeSelectionArtifact = {
      summaryId: task.summaryId,
      useCustomHighlight: true,
      anchorNode: task.anchorNode,
      pendingRange: task.pendingRange,
      bubble,
      cleanupHover: bindSelectionCardHover(task.summaryId, bubble)
    };
  } else {
    if (!task?.highlightNode?.parentNode) {
      return { ok: false, error: "选区已变化，无法渲染结果。" };
    }
    task.highlightNode.classList.remove("__sl-summary-pending");
    task.highlightNode.style.border = "none";
    const bubble = createSummaryBubble(task.summaryId, { summaryType: "selection" });
    task.highlightNode.insertAdjacentElement("afterend", bubble);

    activeSelectionArtifact = {
      summaryId: task.summaryId,
      useCustomHighlight: false,
      highlightNode: task.highlightNode,
      bubble,
      cleanupHover: bindSelectionCardHover(task.summaryId, bubble)
    };
  }

  selectionSummaryStore.set(task.summaryId, {
    title: "选中摘要",
    summary
  });
  return { ok: true };
}

function failSelectionSummaryTask(task) {
  if (!task) {
    return;
  }
  task.loadingNode?.remove();
  if (task.useCustomHighlight) {
    removeRangeFromHighlight(pendingSelectionHighlight, task.pendingRange);
    task.anchorNode?.remove();
    return;
  }
  if (task.highlightNode?.parentNode) {
    unwrapNode(task.highlightNode);
  }
}

async function startSelectionSummaryWorkflow(triggerType) {
  if (featureConfig.enableSelectionSummary === false) {
    return { ok: false, error: "选区总结已关闭。" };
  }
  if (isSummarizing) {
    return { ok: false, error: "已有任务执行中，请稍候。" };
  }

  clearPreviousSelectionArtifacts();
  const start = beginSelectionSummaryTask();
  if (!start.ok) {
    return start;
  }

  isSummarizing = true;
  try {
    const summary = await sendSummaryRequest(start.task.sourceText, "selection");
    const result = finishSelectionSummaryTask(start.task, summary);
    if (!result.ok) {
      failSelectionSummaryTask(start.task);
      return result;
    }
    showTransientMessage("摘要已生成，悬停“省流”查看。", "normal");
    return { ok: true, triggerType: triggerType || "unknown" };
  } catch (error) {
    failSelectionSummaryTask(start.task);
    return { ok: false, error: `总结失败：${error?.message || String(error)}` };
  } finally {
    isSummarizing = false;
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

function showImageSummaryLoading(imageUrl) {
  if (featureConfig.enableImageSummary === false) {
    return { ok: false, error: "图片总结已关闭。" };
  }
  ensureUiStyles();
  const imageEl = findImageElement(imageUrl);
  if (!imageEl) {
    return { ok: false, error: "未定位到对应图片，无法显示总结状态。" };
  }

  clearActiveImageArtifact();
  imageEl.classList.add("__sl-summary-image-highlight");

  const bubble = createSummaryBubble("", {
    summaryType: "image",
    text: getLoadingText(),
    clickable: false
  });
  const layer = ensureFloatingLayer();
  layer.appendChild(bubble);
  const cleanupPosition = bindImageBubblePosition(imageEl, bubble);

  activeImageArtifact = {
    summaryId: "",
    imageEl,
    bubble,
    cleanupPosition,
    cleanupHover: null
  };
  return { ok: true };
}

function applyImageSummary(summary, imageUrl) {
  if (featureConfig.enableImageSummary === false) {
    return { ok: false, error: "图片总结已关闭。" };
  }
  ensureUiStyles();
  const imageEl = findImageElement(imageUrl);
  if (!imageEl) {
    return { ok: false, error: "已生成摘要，但未定位到对应图片。" };
  }

  clearActiveImageArtifact();
  const summaryId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  imageEl.classList.add("__sl-summary-image-highlight");

  const bubble = createSummaryBubble(summaryId, {
    summaryType: "image"
  });
  const layer = ensureFloatingLayer();
  layer.appendChild(bubble);
  const cleanupPosition = bindImageBubblePosition(imageEl, bubble);
  const cleanupHover = bindSelectionCardHover(summaryId, bubble);

  activeImageArtifact = {
    summaryId,
    imageEl,
    bubble,
    cleanupPosition,
    cleanupHover
  };

  selectionSummaryStore.set(summaryId, {
    title: "图片摘要",
    summary
  });
  showTransientMessage("已添加图片摘要气泡，悬停“省流”查看。", "normal");
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
  if (mode === "selection") {
    if (featureConfig.enableSelectionSummary === false) {
      showTransientMessage("选区总结已关闭。", "error");
      return;
    }
    const result = await startSelectionSummaryWorkflow("shortcut");
    if (!result.ok) {
      showTransientMessage(result.error || "总结失败。", "error");
    }
    return;
  }

  if (isSummarizing) {
    showTransientMessage("正在总结，请稍候...", "normal");
    return;
  }
  if (mode === "page" && featureConfig.enablePageSummary === false) {
    showTransientMessage("全文总结已关闭。", "error");
    return;
  }

  const sourceText = getPageText();
  if (!sourceText) {
    showTransientMessage("未提取到网页正文。", "error");
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
    pendingStyleConfig = {
      bgColor: normalizeColor(settings.selectionPendingBgColor),
      borderColor: normalizeColor(settings.selectionPendingBorderColor),
      borderWidth: normalizeBorderWidth(settings.selectionPendingBorderWidth),
      borderStyle: normalizeBorderStyle(settings.selectionPendingBorderStyle)
    };
    selectionLoadingText = (settings.selectionLoadingText || UI_DEFAULTS.selectionLoadingText).trim() || UI_DEFAULTS.selectionLoadingText;
    featureConfig = {
      enableSelectionSummary: settings.enableSelectionSummary !== false,
      enableImageSummary: settings.enableImageSummary !== false,
      enablePageSummary: settings.enablePageSummary !== false
    };
    updateSelectionStyleVariables();
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

  if (message?.type === "START_SELECTION_SUMMARY") {
    startSelectionSummaryWorkflow(message.triggerType || "message")
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error?.message || String(error) });
      });
    return true;
  }

  if (message?.type === "APPLY_IMAGE_SUMMARY") {
    const result = applyImageSummary(message.summary || "", message.imageUrl || "");
    sendResponse(result);
    return true;
  }

  if (message?.type === "SHOW_IMAGE_SUMMARY_LOADING") {
    const result = showImageSummaryLoading(message.imageUrl || "");
    sendResponse(result);
    return true;
  }

  if (message?.type === "CLEAR_IMAGE_SUMMARY_LOADING") {
    clearActiveImageArtifact();
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "SHOW_PAGE_SUMMARY_PANEL") {
    if (featureConfig.enablePageSummary === false) {
      sendResponse({ ok: false, error: "全文总结已关闭。" });
      return true;
    }
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
  if (
    changes.summaryHighlightColor ||
    changes.selectionPendingBgColor ||
    changes.selectionPendingBorderColor ||
    changes.selectionPendingBorderWidth ||
    changes.selectionPendingBorderStyle ||
    changes.selectionLoadingText ||
    changes.enableSelectionSummary ||
    changes.enableImageSummary ||
    changes.enablePageSummary
  ) {
    loadUiSettings();
  }
});

document.addEventListener("selectionchange", captureSelectionSnapshot, true);
document.addEventListener("mouseup", captureSelectionSnapshot, true);
document.addEventListener("contextmenu", captureSelectionSnapshot, true);
document.addEventListener("keydown", handleShortcutKeydown, true);

installPageNavigationCleanup();
ensureUiStyles();
updateHighlightColor(highlightColor);
updateSelectionStyleVariables();
loadUiSettings();
