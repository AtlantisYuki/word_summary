const DEFAULT_PROVIDER = {
  id: "provider_default",
  name: "默认供应商",
  baseUrl: "https://api.openai.com/v1",
  enabled: true
};

const DEFAULT_SETTINGS = {
  providers: [DEFAULT_PROVIDER],
  enableSelectionSummary: true,
  enableImageSummary: true,
  enablePageSummary: true,
  selectionPreferredProviderId: "",
  imagePreferredProviderId: "",
  pagePreferredProviderId: "",
  preferredProviderId: ""
};

const MODE_CONFIG = [
  {
    key: "selection",
    label: "选区总结",
    enableKey: "enableSelectionSummary",
    preferredKey: "selectionPreferredProviderId",
    toggleEl: document.getElementById("toggle-selection"),
    selectEl: document.getElementById("provider-selection"),
    wrapEl: document.getElementById("provider-wrap-selection")
  },
  {
    key: "image",
    label: "图片总结",
    enableKey: "enableImageSummary",
    preferredKey: "imagePreferredProviderId",
    toggleEl: document.getElementById("toggle-image"),
    selectEl: document.getElementById("provider-image"),
    wrapEl: document.getElementById("provider-wrap-image")
  },
  {
    key: "page",
    label: "全文总结",
    enableKey: "enablePageSummary",
    preferredKey: "pagePreferredProviderId",
    toggleEl: document.getElementById("toggle-page"),
    selectEl: document.getElementById("provider-page"),
    wrapEl: document.getElementById("provider-wrap-page")
  }
];

const openOptionsBtn = document.getElementById("open-options");
const openMoreBtn = document.getElementById("open-more");
const statusEl = document.getElementById("status");
const versionTextEl = document.getElementById("version-text");

function setStatus(text) {
  statusEl.textContent = text || "";
}

function normalizeProviders(providers) {
  if (!Array.isArray(providers)) {
    return [];
  }
  return providers
    .map((provider, index) => {
      const id = String(provider?.id || `provider_${index + 1}`).trim();
      const name = String(provider?.name || id || `供应商${index + 1}`).trim();
      const baseUrl = String(provider?.baseUrl || "").trim();
      return {
        id,
        name,
        baseUrl,
        enabled: provider?.enabled !== false
      };
    })
    .filter((provider) => provider.id && provider.enabled && provider.baseUrl);
}

function renderProviders(selectEl, providers, selectedId) {
  selectEl.innerHTML = "";
  const autoOption = document.createElement("option");
  autoOption.value = "";
  autoOption.textContent = "自动（按优先级）";
  selectEl.appendChild(autoOption);

  for (const provider of providers) {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = provider.name;
    selectEl.appendChild(option);
  }

  const resolved = String(selectedId || "");
  if (resolved && providers.some((provider) => provider.id === resolved)) {
    selectEl.value = resolved;
  } else {
    selectEl.value = "";
  }
}

function updateProviderVisibility() {
  for (const mode of MODE_CONFIG) {
    const enabled = mode.toggleEl.checked;
    mode.wrapEl.classList.toggle("is-disabled", !enabled);
    mode.selectEl.disabled = !enabled;
  }
}

function savePartialSettings(patch, successText) {
  chrome.storage.sync.set(patch, () => {
    if (chrome.runtime.lastError) {
      setStatus(`保存失败：${chrome.runtime.lastError.message}`);
      return;
    }
    setStatus(successText || "已保存。");
  });
}

function bindModeEvents() {
  for (const mode of MODE_CONFIG) {
    mode.toggleEl.addEventListener("change", () => {
      const enabled = mode.toggleEl.checked;
      updateProviderVisibility();
      savePartialSettings(
        { [mode.enableKey]: enabled },
        `${mode.label}已${enabled ? "开启" : "关闭"}。`
      );
    });

    mode.selectEl.addEventListener("change", () => {
      const selectedId = String(mode.selectEl.value || "");
      savePartialSettings(
        { [mode.preferredKey]: selectedId },
        selectedId ? `${mode.label}已切换供应商。` : `${mode.label}已切换为自动。`
      );
    });
  }
}

function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    const providers = normalizeProviders(settings.providers);
    for (const mode of MODE_CONFIG) {
      mode.toggleEl.checked = settings[mode.enableKey] !== false;
      const selected = settings[mode.preferredKey] || settings.preferredProviderId || "";
      renderProviders(mode.selectEl, providers, selected);
    }
    updateProviderVisibility();
    setStatus("");
  });
}

openOptionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

openMoreBtn.addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("more.html")
  });
});

bindModeEvents();
versionTextEl.textContent = `v${chrome.runtime.getManifest().version}`;
loadSettings();
