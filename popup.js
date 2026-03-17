const selectionBtn = document.getElementById("summary-selection");
const pageBtn = document.getElementById("summary-page");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const openOptionsEl = document.getElementById("open-options");

function setLoading(isLoading, text) {
  selectionBtn.disabled = isLoading;
  pageBtn.disabled = isLoading;
  statusEl.textContent = text || "";
}

function setResult(text) {
  resultEl.value = text || "";
}

function sendToContent(tabId, type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response && response.ok === false) {
        reject(new Error(response.error || "无法从当前页面读取内容。"));
        return;
      }
      resolve(response);
    });
  });
}

function sendToBackground(text, mode) {
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

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length || !tabs[0].id) {
    throw new Error("未找到当前激活标签页。");
  }
  return tabs[0].id;
}

async function runSummary(contentType) {
  try {
    setLoading(true, "正在读取页面内容...");
    setResult("");

    const tabId = await getActiveTabId();
    const messageType = contentType === "selection" ? "GET_SELECTION_TEXT" : "GET_PAGE_TEXT";
    const textResponse = await sendToContent(tabId, messageType);
    const text = textResponse?.text || "";

    if (!text) {
      throw new Error(contentType === "selection" ? "未检测到选中文本，请先选中后再试。" : "未提取到网页正文。");
    }

    setLoading(true, "正在总结，请稍候...");
    const summary = await sendToBackground(text, contentType);
    setResult(summary);
    if (contentType === "selection") {
      await sendToContent(tabId, "APPLY_SELECTION_SUMMARY", {
        summary,
        sourceText: text
      });
    } else {
      await sendToContent(tabId, "SHOW_PAGE_SUMMARY_PANEL", {
        state: "done",
        summary
      });
    }
    setLoading(false, "完成。");
  } catch (error) {
    setLoading(false, `失败：${error.message || String(error)}`);
  }
}

selectionBtn.addEventListener("click", () => runSummary("selection"));
pageBtn.addEventListener("click", () => runSummary("page"));
openOptionsEl.addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});
