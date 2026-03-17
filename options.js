const DEFAULT_SETTINGS = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  modelName: "gpt-4o-mini",
  selectionShortcut: "alt+s",
  pageShortcut: "ctrl+alt+s",
  summaryHighlightColor: "#fff3a3"
};

const baseUrlInput = document.getElementById("baseUrl");
const modelNameInput = document.getElementById("modelName");
const apiKeyInput = document.getElementById("apiKey");
const selectionShortcutInput = document.getElementById("selectionShortcut");
const pageShortcutInput = document.getElementById("pageShortcut");
const summaryHighlightColorInput = document.getElementById("summaryHighlightColor");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");

const MODIFIERS = ["ctrl", "alt", "shift", "meta"];
const MODIFIER_ALIAS = {
  control: "ctrl",
  command: "meta",
  cmd: "meta",
  option: "alt"
};

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

function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    baseUrlInput.value = settings.baseUrl || "";
    modelNameInput.value = settings.modelName || "";
    apiKeyInput.value = settings.apiKey || "";
    selectionShortcutInput.value = settings.selectionShortcut || DEFAULT_SETTINGS.selectionShortcut;
    pageShortcutInput.value = settings.pageShortcut || DEFAULT_SETTINGS.pageShortcut;
    summaryHighlightColorInput.value = settings.summaryHighlightColor || DEFAULT_SETTINGS.summaryHighlightColor;
  });
}

function saveSettings() {
  const baseUrl = (baseUrlInput.value || "").trim();
  const modelName = (modelNameInput.value || "").trim();
  const apiKey = (apiKeyInput.value || "").trim();
  const selectionShortcut = normalizeShortcut(selectionShortcutInput.value || "");
  const pageShortcut = normalizeShortcut(pageShortcutInput.value || "");
  const summaryHighlightColor = (summaryHighlightColorInput.value || "").trim().toLowerCase();

  if (!baseUrl) {
    statusEl.textContent = "请填写 Base URL。";
    return;
  }
  if (!modelName) {
    statusEl.textContent = "请填写模型名称。";
    return;
  }
  if (!selectionShortcut) {
    statusEl.textContent = "选中文本快捷键格式无效。";
    return;
  }
  if (!pageShortcut) {
    statusEl.textContent = "整页快捷键格式无效。";
    return;
  }
  if (selectionShortcut === pageShortcut) {
    statusEl.textContent = "两个快捷键不能相同。";
    return;
  }
  if (!/^#[0-9a-f]{6}$/i.test(summaryHighlightColor)) {
    statusEl.textContent = "高亮颜色格式无效。";
    return;
  }

  chrome.storage.sync.set({ baseUrl, modelName, apiKey, selectionShortcut, pageShortcut, summaryHighlightColor }, () => {
    selectionShortcutInput.value = selectionShortcut;
    pageShortcutInput.value = pageShortcut;
    summaryHighlightColorInput.value = summaryHighlightColor;
    statusEl.textContent = "已保存。";
    setTimeout(() => {
      statusEl.textContent = "";
    }, 1800);
  });
}

saveBtn.addEventListener("click", saveSettings);
loadSettings();
