const DEFAULT_PROVIDER = {
  id: "provider_default",
  name: "默认供应商",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  textModel: "gpt-4o-mini",
  visionModel: "gpt-4o-mini",
  timeoutMs: 30000,
  maxRetries: 1,
  textPriority: 1,
  visionPriority: 1,
  enabled: true
};

const DEFAULT_SETTINGS = {
  providers: [DEFAULT_PROVIDER],
  debugLogEnabled: true,
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
  enablePageSummary: true,
  selectionPreferredProviderId: "",
  imagePreferredProviderId: "",
  pagePreferredProviderId: "",
  preferredProviderId: ""
};

const providerListEl = document.getElementById("providerList");
const addProviderBtn = document.getElementById("addProvider");
const selectionShortcutInput = document.getElementById("selectionShortcut");
const pageShortcutInput = document.getElementById("pageShortcut");
const summaryHighlightColorInput = document.getElementById("summaryHighlightColor");
const selectionPendingBgColorInput = document.getElementById("selectionPendingBgColor");
const selectionPendingBorderColorInput = document.getElementById("selectionPendingBorderColor");
const selectionPendingBorderWidthInput = document.getElementById("selectionPendingBorderWidth");
const selectionPendingBorderStyleInput = document.getElementById("selectionPendingBorderStyle");
const selectionLoadingTextInput = document.getElementById("selectionLoadingText");
const debugLogEnabledInput = document.getElementById("debugLogEnabled");
const refreshLogsBtn = document.getElementById("refreshLogs");
const clearLogsBtn = document.getElementById("clearLogs");
const debugLogBox = document.getElementById("debugLogBox");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");

const MODIFIERS = ["ctrl", "alt", "shift", "meta"];
const MODIFIER_ALIAS = {
  control: "ctrl",
  command: "meta",
  cmd: "meta",
  option: "alt"
};

let providerState = [];

function formatDebugLogs(logs) {
  if (!Array.isArray(logs) || logs.length === 0) {
    return "";
  }
  return logs
    .map((log) => {
      const ts = log?.ts || "";
      const level = log?.level || "info";
      const event = log?.event || "unknown";
      let detailText = "";
      try {
        detailText = JSON.stringify(log?.detail || {});
      } catch (_error) {
        detailText = String(log?.detail || "");
      }
      return `[${ts}] [${level}] ${event} ${detailText}`;
    })
    .join("\n");
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "请求失败。"));
        return;
      }
      resolve(response);
    });
  });
}

async function refreshDebugLogs() {
  try {
    const response = await sendRuntimeMessage({ type: "GET_DEBUG_LOGS" });
    const text = formatDebugLogs(response.logs || []);
    debugLogBox.value = text || "暂无日志";
  } catch (error) {
    debugLogBox.value = `读取日志失败：${error.message || String(error)}`;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function normalizeProvider(provider, index) {
  const safeId = provider?.id == null ? `provider_${index + 1}` : String(provider.id);
  const safeName = provider?.name == null ? `供应商${index + 1}` : String(provider.name);
  const safeBaseUrl = provider?.baseUrl == null ? "" : String(provider.baseUrl);
  const safeApiKey = provider?.apiKey == null ? "" : String(provider.apiKey);
  const safeTextModel = provider?.textModel == null ? "" : String(provider.textModel);
  const safeVisionModel = provider?.visionModel == null ? "" : String(provider.visionModel);

  return {
    id: safeId.trim(),
    name: safeName.trim(),
    baseUrl: safeBaseUrl.trim(),
    apiKey: safeApiKey.trim(),
    textModel: safeTextModel.trim(),
    visionModel: safeVisionModel.trim(),
    timeoutMs: Number.isFinite(Number(provider?.timeoutMs)) ? Math.floor(Number(provider.timeoutMs)) : 30000,
    maxRetries: Number.isFinite(Number(provider?.maxRetries)) ? Math.floor(Number(provider.maxRetries)) : 1,
    textPriority: Number.isFinite(Number(provider?.textPriority)) ? Math.floor(Number(provider.textPriority)) : index + 1,
    visionPriority: Number.isFinite(Number(provider?.visionPriority)) ? Math.floor(Number(provider.visionPriority)) : index + 1,
    enabled: provider?.enabled !== false
  };
}

function createProviderCard(provider, index) {
  const card = document.createElement("div");
  card.className = "provider-item";
  card.dataset.id = provider.id;
  card.innerHTML = `
    <div class="provider-head">
      <div class="provider-title">供应商 #${index + 1}</div>
      <button type="button" class="ghost remove-provider">删除</button>
    </div>
    <div class="grid">
      <div class="field">
        <label>显示名称</label>
        <input data-key="name" value="${escapeHtml(provider.name)}" placeholder="例如：OpenAI 主通道" />
      </div>
      <div class="field">
        <label>Base URL</label>
        <input data-key="baseUrl" value="${escapeHtml(provider.baseUrl)}" placeholder="例如：https://api.openai.com" />
      </div>
      <div class="field">
        <label>API Key</label>
        <input data-key="apiKey" type="password" value="${escapeHtml(provider.apiKey)}" placeholder="sk-..." />
      </div>
      <div class="field">
        <label>启用状态</label>
        <input data-key="enabled" type="checkbox" ${provider.enabled ? "checked" : ""} />
      </div>
      <div class="field">
        <label>文字模型（textModel）</label>
        <input data-key="textModel" value="${escapeHtml(provider.textModel)}" placeholder="例如：gpt-4o-mini" />
      </div>
      <div class="field">
        <label>视觉模型（visionModel）</label>
        <input data-key="visionModel" value="${escapeHtml(provider.visionModel)}" placeholder="例如：gpt-4o-mini" />
      </div>
      <div class="field">
        <label>反应时长 ms（timeoutMs）</label>
        <input data-key="timeoutMs" value="${escapeHtml(provider.timeoutMs)}" />
      </div>
      <div class="field">
        <label>失败重试次数（maxRetries）</label>
        <input data-key="maxRetries" value="${escapeHtml(provider.maxRetries)}" />
      </div>
      <div class="field">
        <label>文字优先级（textPriority）</label>
        <input data-key="textPriority" value="${escapeHtml(provider.textPriority)}" />
      </div>
      <div class="field">
        <label>视觉优先级（visionPriority）</label>
        <input data-key="visionPriority" value="${escapeHtml(provider.visionPriority)}" />
      </div>
    </div>
  `;
  return card;
}

function renderProviders() {
  providerListEl.innerHTML = "";
  providerState.forEach((provider, index) => {
    const card = createProviderCard(provider, index);
    const removeBtn = card.querySelector(".remove-provider");
    removeBtn.addEventListener("click", () => {
      providerState.splice(index, 1);
      renderProviders();
    });
    providerListEl.appendChild(card);
  });
}

function collectProviderCards() {
  const cards = Array.from(providerListEl.querySelectorAll(".provider-item"));
  return cards.map((card, index) => {
    const getValue = (key) => (card.querySelector(`[data-key="${key}"]`)?.value || "").trim();
    const enabledInput = card.querySelector('[data-key="enabled"]');

    const provider = normalizeProvider(
      {
        id: card.dataset.id || `provider_${index + 1}`,
        name: getValue("name"),
        baseUrl: getValue("baseUrl"),
        apiKey: getValue("apiKey"),
        textModel: getValue("textModel"),
        visionModel: getValue("visionModel"),
        timeoutMs: getValue("timeoutMs"),
        maxRetries: getValue("maxRetries"),
        textPriority: getValue("textPriority"),
        visionPriority: getValue("visionPriority"),
        enabled: Boolean(enabledInput?.checked)
      },
      index
    );

    return provider;
  });
}

function validateProviders(providers) {
  if (!providers.length) {
    return "至少需要一个供应商。";
  }

  for (const provider of providers) {
    if (!provider.name) {
      return "供应商名称不能为空。";
    }
    if (!provider.baseUrl) {
      return `供应商「${provider.name}」缺少 Base URL。`;
    }
    if (!provider.textModel && !provider.visionModel) {
      return `供应商「${provider.name}」至少要配置一个模型。`;
    }
    if (provider.timeoutMs < 1000 || provider.timeoutMs > 120000) {
      return `供应商「${provider.name}」反应时长建议在 1000-120000 ms。`;
    }
    if (provider.maxRetries < 0 || provider.maxRetries > 6) {
      return `供应商「${provider.name}」失败重试次数建议在 0-6。`;
    }
    if (provider.textPriority <= 0 || provider.visionPriority <= 0) {
      return `供应商「${provider.name}」优先级必须为正整数。`;
    }
  }

  const enabledCount = providers.filter((provider) => provider.enabled).length;
  if (!enabledCount) {
    return "至少启用一个供应商。";
  }
  return "";
}

function buildLegacyProvider(rawSettings) {
  return normalizeProvider(
    {
      ...DEFAULT_PROVIDER,
      id: "provider_legacy",
      name: "兼容默认供应商",
      baseUrl: rawSettings.baseUrl || DEFAULT_PROVIDER.baseUrl,
      apiKey: rawSettings.apiKey || "",
      textModel: rawSettings.modelName || DEFAULT_PROVIDER.textModel,
      visionModel: rawSettings.modelName || DEFAULT_PROVIDER.visionModel
    },
    0
  );
}

function loadSettings() {
  chrome.storage.sync.get(null, (rawSettings) => {
    const providers = Array.isArray(rawSettings.providers) && rawSettings.providers.length
      ? rawSettings.providers.map((provider, index) => normalizeProvider(provider, index))
      : [buildLegacyProvider(rawSettings || {})];

    providerState = providers;
    renderProviders();

    selectionShortcutInput.value = rawSettings.selectionShortcut || DEFAULT_SETTINGS.selectionShortcut;
    pageShortcutInput.value = rawSettings.pageShortcut || DEFAULT_SETTINGS.pageShortcut;
    summaryHighlightColorInput.value = rawSettings.summaryHighlightColor || DEFAULT_SETTINGS.summaryHighlightColor;
    selectionPendingBgColorInput.value = rawSettings.selectionPendingBgColor || DEFAULT_SETTINGS.selectionPendingBgColor;
    selectionPendingBorderColorInput.value = rawSettings.selectionPendingBorderColor || DEFAULT_SETTINGS.selectionPendingBorderColor;
    selectionPendingBorderWidthInput.value = Number.isFinite(Number(rawSettings.selectionPendingBorderWidth))
      ? Math.floor(Number(rawSettings.selectionPendingBorderWidth))
      : DEFAULT_SETTINGS.selectionPendingBorderWidth;
    selectionPendingBorderStyleInput.value = rawSettings.selectionPendingBorderStyle || DEFAULT_SETTINGS.selectionPendingBorderStyle;
    selectionLoadingTextInput.value = rawSettings.selectionLoadingText || DEFAULT_SETTINGS.selectionLoadingText;
    debugLogEnabledInput.checked = rawSettings.debugLogEnabled !== false;
    void refreshDebugLogs();
  });
}

function saveSettings() {
  const providers = collectProviderCards();
  const providersError = validateProviders(providers);
  if (providersError) {
    statusEl.textContent = providersError;
    return;
  }

  const selectionShortcut = normalizeShortcut(selectionShortcutInput.value || "");
  const pageShortcut = normalizeShortcut(pageShortcutInput.value || "");
  const summaryHighlightColor = (summaryHighlightColorInput.value || "").trim().toLowerCase();
  const selectionPendingBgColor = (selectionPendingBgColorInput.value || "").trim().toLowerCase();
  const selectionPendingBorderColor = (selectionPendingBorderColorInput.value || "").trim().toLowerCase();
  const selectionPendingBorderWidth = Math.floor(Number(selectionPendingBorderWidthInput.value || "1"));
  const selectionPendingBorderStyle = (selectionPendingBorderStyleInput.value || "").trim().toLowerCase();
  const selectionLoadingText = (selectionLoadingTextInput.value || "").trim();
  const debugLogEnabled = Boolean(debugLogEnabledInput.checked);

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
  if (!/^#[0-9a-f]{6}$/i.test(selectionPendingBgColor)) {
    statusEl.textContent = "任务前背景色格式无效。";
    return;
  }
  if (!/^#[0-9a-f]{6}$/i.test(selectionPendingBorderColor)) {
    statusEl.textContent = "任务前框线颜色格式无效。";
    return;
  }
  if (!Number.isFinite(selectionPendingBorderWidth) || selectionPendingBorderWidth < 0 || selectionPendingBorderWidth > 6) {
    statusEl.textContent = "任务前框线宽度需在 0-6。";
    return;
  }
  if (!["solid", "dashed", "dotted", "double"].includes(selectionPendingBorderStyle)) {
    statusEl.textContent = "任务前框线样式仅支持 solid/dashed/dotted/double。";
    return;
  }
  if (!selectionLoadingText) {
    statusEl.textContent = "请输入总结加载文案。";
    return;
  }

  chrome.storage.sync.set(
    {
      providers,
      debugLogEnabled,
      selectionShortcut,
      pageShortcut,
      summaryHighlightColor,
      selectionPendingBgColor,
      selectionPendingBorderColor,
      selectionPendingBorderWidth,
      selectionPendingBorderStyle,
      selectionLoadingText
    },
    () => {
      selectionShortcutInput.value = selectionShortcut;
      pageShortcutInput.value = pageShortcut;
      summaryHighlightColorInput.value = summaryHighlightColor;
      selectionPendingBgColorInput.value = selectionPendingBgColor;
      selectionPendingBorderColorInput.value = selectionPendingBorderColor;
      selectionPendingBorderWidthInput.value = String(selectionPendingBorderWidth);
      selectionPendingBorderStyleInput.value = selectionPendingBorderStyle;
      selectionLoadingTextInput.value = selectionLoadingText;
      providerState = providers;
      renderProviders();
      statusEl.textContent = "已保存。";
      void refreshDebugLogs();
      setTimeout(() => {
        statusEl.textContent = "";
      }, 1800);
    }
  );
}

addProviderBtn.addEventListener("click", () => {
  const nextIndex = providerState.length + 1;
  providerState.push(
    normalizeProvider(
      {
        ...DEFAULT_PROVIDER,
        id: `provider_${Date.now()}_${nextIndex}`,
        name: `供应商${nextIndex}`,
        textPriority: nextIndex,
        visionPriority: nextIndex
      },
      nextIndex - 1
    )
  );
  renderProviders();
});

saveBtn.addEventListener("click", saveSettings);
refreshLogsBtn.addEventListener("click", () => {
  void refreshDebugLogs();
});
clearLogsBtn.addEventListener("click", async () => {
  try {
    await sendRuntimeMessage({ type: "CLEAR_DEBUG_LOGS" });
    debugLogBox.value = "暂无日志";
    statusEl.textContent = "调试日志已清空。";
    setTimeout(() => {
      statusEl.textContent = "";
    }, 1200);
  } catch (error) {
    statusEl.textContent = `清空失败：${error.message || String(error)}`;
  }
});
loadSettings();
