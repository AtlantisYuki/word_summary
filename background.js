const DEFAULT_SETTINGS = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  modelName: "gpt-4o-mini",
  selectionShortcut: "alt+s",
  pageShortcut: "ctrl+alt+s",
  summaryHighlightColor: "#fff3a3"
};

const MENU_IDS = {
  selection: "sl-summary-selection",
  page: "sl-summary-page"
};

function normalizeBaseUrl(baseUrl) {
  return (baseUrl || "").trim().replace(/\/+$/, "");
}

function buildPrompt(mode, rawText) {
  const text = (rawText || "").trim();
  if (mode === "selection") {
    return [
      "请将以下选中文本总结成简短省流版本：",
      "- 输出中文",
      "- 3到5条要点",
      "- 总长度不超过120字",
      "- 只保留关键信息，不要客套",
      "",
      text
    ].join("\n");
  }

  return [
    "请将以下网页内容总结成简短省流版本：",
    "- 输出中文",
    "- 5条以内要点",
    "- 总长度不超过180字",
    "- 先给一句总览，再列关键点",
    "",
    text
  ].join("\n");
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
      resolve(settings);
    });
  });
}

async function summarizeWithProvider({ text, mode }) {
  const settings = await getSettings();
  const apiKey = (settings.apiKey || "").trim();
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  const modelName = (settings.modelName || "").trim();

  if (!baseUrl) {
    throw new Error("请先在插件设置中填写 Base URL。");
  }
  if (!modelName) {
    throw new Error("请先在插件设置中填写模型名称。");
  }

  const endpoint = `${baseUrl}/chat/completions`;
  const prompt = buildPrompt(mode, text);
  const headers = {
    "Content-Type": "application/json"
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: modelName,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "你是一个精炼的中文总结助手。"
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error("接口返回了非 JSON 响应，请检查 Base URL 是否正确。");
  }

  if (!response.ok) {
    const message = data?.error?.message || `请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }

  const result = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || "";
  if (!result) {
    throw new Error("接口返回成功但未包含可用摘要内容。");
  }
  return result.trim();
}

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_IDS.selection,
      title: "省流助手：总结选中文本",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: MENU_IDS.page,
      title: "省流助手：总结当前网页",
      contexts: ["page"]
    });
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function getPageTextFromTab(tabId) {
  const response = await sendMessageToTab(tabId, { type: "GET_PAGE_TEXT" });
  if (!response?.ok) {
    throw new Error("未提取到网页正文。");
  }
  return (response.text || "").trim();
}

async function getSelectionTextFromTab(tabId) {
  const response = await sendMessageToTab(tabId, { type: "GET_SELECTION_TEXT" });
  if (!response?.ok) {
    throw new Error("未检测到选中文本。");
  }
  return (response.text || "").trim();
}

async function notifySelectionSummary(tabId, summary, sourceText) {
  await sendMessageToTab(tabId, {
    type: "APPLY_SELECTION_SUMMARY",
    summary,
    sourceText
  });
}

async function notifyPageSummary(tabId, payload) {
  await sendMessageToTab(tabId, {
    type: "SHOW_PAGE_SUMMARY_PANEL",
    ...payload
  });
}

async function notifyTransientMessage(tabId, text, level) {
  await sendMessageToTab(tabId, {
    type: "SHOW_TRANSIENT_MESSAGE",
    text,
    level
  });
}

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  setupContextMenus();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SUMMARIZE_TEXT") {
    return false;
  }

  summarizeWithProvider({
    text: message.text,
    mode: message.mode
  })
    .then((summary) => {
      sendResponse({ ok: true, summary });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: error.message || String(error) });
    });

  return true;
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) {
    return;
  }

  const tabId = tab.id;
  const run = async () => {
    if (info.menuItemId === MENU_IDS.selection) {
      const inputText = (info.selectionText || "").trim() || (await getSelectionTextFromTab(tabId));
      if (!inputText) {
        await notifyTransientMessage(tabId, "未检测到选中文本，请先选中后再试。", "error");
        return;
      }
      const summary = await summarizeWithProvider({ text: inputText, mode: "selection" });
      await notifySelectionSummary(tabId, summary, inputText);
      return;
    }

    if (info.menuItemId === MENU_IDS.page) {
      await notifyPageSummary(tabId, { state: "loading" });
      const pageText = await getPageTextFromTab(tabId);
      if (!pageText) {
        throw new Error("未提取到网页正文。");
      }
      const summary = await summarizeWithProvider({ text: pageText, mode: "page" });
      await notifyPageSummary(tabId, { state: "done", summary });
    }
  };

  run().catch(async (error) => {
    const message = error?.message || String(error);
    try {
      if (info.menuItemId === MENU_IDS.page) {
        await notifyPageSummary(tabId, { state: "error", error: message });
      } else {
        await notifyTransientMessage(tabId, `总结失败：${message}`, "error");
      }
    } catch (_notifyError) {
    }
  });
});
