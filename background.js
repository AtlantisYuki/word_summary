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
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  modelName: "gpt-4o-mini",
  providers: [DEFAULT_PROVIDER],
  debugLogEnabled: true,
  selectionShortcut: "alt+s",
  pageShortcut: "ctrl+alt+s",
  summaryHighlightColor: "#fff3a3"
};

const MENU_IDS = {
  selection: "sl-summary-selection",
  page: "sl-summary-page",
  image: "sl-summary-image"
};

const MODE_TEXT = "text";
const MODE_VISION = "vision";
const DEBUG_LOG_KEY = "debugLogs";
const DEBUG_LOG_MAX = 300;

let debugLogEnabledCache = true;

function normalizeBaseUrl(baseUrl) {
  return (baseUrl || "").trim().replace(/\/+$/, "");
}

function buildChatCompletionsEndpoint(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    return "";
  }
  if (normalized.endsWith("/v1/chat/completions") || normalized.endsWith("/chat/completions")) {
    return normalized;
  }
  if (normalized.endsWith("/v1")) {
    return `${normalized}/chat/completions`;
  }
  return `${normalized}/v1/chat/completions`;
}

function toPositiveInt(value, defaultValue) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }
  const rounded = Math.floor(parsed);
  if (rounded <= 0) {
    return defaultValue;
  }
  return rounded;
}

function toNonNegativeInt(value, defaultValue) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }
  const rounded = Math.floor(parsed);
  if (rounded < 0) {
    return defaultValue;
  }
  return rounded;
}

function toDebugMessage(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.message || String(value);
  }
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function safeDetail(detail) {
  const output = {};
  for (const [key, value] of Object.entries(detail || {})) {
    if (typeof value === "string" && value.length > 500) {
      output[key] = `${value.slice(0, 500)}...`;
    } else {
      output[key] = value;
    }
  }
  return output;
}

async function getDebugLogs() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [DEBUG_LOG_KEY]: [] }, (result) => {
      const logs = Array.isArray(result[DEBUG_LOG_KEY]) ? result[DEBUG_LOG_KEY] : [];
      resolve(logs);
    });
  });
}

async function appendDebugLog(level, event, detail = {}, force = false) {
  if (!force && !debugLogEnabledCache) {
    return;
  }

  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    detail: safeDetail(detail)
  };

  try {
    const logs = await getDebugLogs();
    logs.push(entry);
    if (logs.length > DEBUG_LOG_MAX) {
      logs.splice(0, logs.length - DEBUG_LOG_MAX);
    }
    await new Promise((resolve) => {
      chrome.storage.local.set({ [DEBUG_LOG_KEY]: logs }, resolve);
    });
  } catch (_error) {
  }

  if (level === "error") {
    console.error("[省流调试]", event, detail);
  } else {
    console.log("[省流调试]", event, detail);
  }
}

async function clearDebugLogs() {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [DEBUG_LOG_KEY]: [] }, resolve);
  });
}

function extractContentText(content) {
  if (!content) {
    return "";
  }
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const texts = content
      .map((item) => {
        if (!item) {
          return "";
        }
        if (typeof item === "string") {
          return item;
        }
        if (typeof item.text === "string") {
          return item.text;
        }
        if (typeof item.content === "string") {
          return item.content;
        }
        return "";
      })
      .filter(Boolean);
    return texts.join("\n").trim();
  }
  return "";
}

function tryParseJson(value) {
  if (typeof value !== "string") {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function parseSseChunks(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) {
    return null;
  }
  const lines = rawText.split(/\r?\n/);
  const payloads = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const body = trimmed.slice(5).trim();
    if (!body || body === "[DONE]") {
      continue;
    }
    const parsed = tryParseJson(body);
    if (parsed) {
      payloads.push(parsed);
    }
  }
  if (!payloads.length) {
    return null;
  }
  return payloads;
}

function extractTextFromSsePayloads(payloads) {
  let output = "";
  for (const payload of payloads) {
    const choice = payload?.choices?.[0];
    const delta = choice?.delta?.content;
    if (typeof delta === "string") {
      output += delta;
      continue;
    }
    if (Array.isArray(delta)) {
      for (const item of delta) {
        if (item?.type === "text" && typeof item.text === "string") {
          output += item.text;
        }
      }
      continue;
    }
    const messageText = extractContentText(choice?.message?.content);
    if (messageText) {
      output += messageText;
    }
  }
  return output.trim();
}

function buildProviderError(message, status = 0) {
  const error = new Error(message);
  error.status = status;
  error.nonRetriable = status >= 400 && status < 500 && status !== 408 && status !== 429;
  return error;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function extractVisionSegments(messages) {
  const texts = [];
  const images = [];

  for (const message of messages || []) {
    const content = message?.content;
    if (typeof content === "string") {
      if (content.trim()) {
        texts.push(content.trim());
      }
      continue;
    }
    if (!Array.isArray(content)) {
      continue;
    }
    for (const item of content) {
      if (!item) {
        continue;
      }
      if (item.type === "text" && typeof item.text === "string" && item.text.trim()) {
        texts.push(item.text.trim());
      }
      if (item.type === "image_url") {
        const url = typeof item.image_url === "string" ? item.image_url : item?.image_url?.url;
        if (url) {
          images.push(url);
        }
      }
    }
  }

  return { texts, images };
}

function withVisionFormat(messages, style, dataUrlMap = new Map()) {
  const useDataUrl = style.endsWith("_datauri");
  const baseStyle = useDataUrl ? style.replace(/_datauri$/, "") : style;
  const mapUrl = (url) => {
    if (!useDataUrl) {
      return url;
    }
    return dataUrlMap.get(url) || url;
  };

  if (baseStyle === "openai_object") {
    const cloned = deepClone(messages);
    for (const message of cloned) {
      if (!Array.isArray(message?.content)) {
        continue;
      }
      for (const item of message.content) {
        if (item?.type !== "image_url") {
          continue;
        }
        if (typeof item.image_url === "string") {
          item.image_url = { url: mapUrl(item.image_url) };
          continue;
        }
        if (item?.image_url && typeof item.image_url === "object") {
          item.image_url.url = mapUrl(item.image_url.url || "");
        }
      }
    }
    return cloned;
  }

  if (baseStyle === "openai_string") {
    const cloned = deepClone(messages);
    for (const message of cloned) {
      if (!Array.isArray(message?.content)) {
        continue;
      }
      for (const item of message.content) {
        if (item?.type === "image_url" && item?.image_url && typeof item.image_url === "object") {
          item.image_url = mapUrl(item.image_url.url || "");
          continue;
        }
        if (item?.type === "image_url" && typeof item.image_url === "string") {
          item.image_url = mapUrl(item.image_url);
        }
      }
    }
    return cloned;
  }

  if (baseStyle === "top_level_images") {
    const { texts, images } = extractVisionSegments(messages);
    return {
      messages: [
        {
          role: "user",
          content: texts.join("\n\n") || "请根据图片做省流总结。"
        }
      ],
      images: images.map((url) => mapUrl(url))
    };
  }

  if (baseStyle === "top_level_image_objects") {
    const { texts, images } = extractVisionSegments(messages);
    return {
      messages: [
        {
          role: "user",
          content: texts.join("\n\n") || "请根据图片做省流总结。"
        }
      ],
      images: images.map((url) => ({ url: mapUrl(url) }))
    };
  }

  return deepClone(messages);
}

function getVisionStyles(hasDataUrl) {
  const base = ["openai_object", "openai_string", "top_level_images", "top_level_image_objects"];
  if (!hasDataUrl) {
    return base;
  }
  return [...base, "openai_object_datauri", "openai_string_datauri", "top_level_images_datauri", "top_level_image_objects_datauri"];
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function fetchImageAsDataUrl(imageUrl) {
  const response = await fetchWithTimeout(
    imageUrl,
    {
      method: "GET"
    },
    20000
  );
  if (!response.ok) {
    throw new Error(`图片下载失败（HTTP ${response.status}）`);
  }

  const contentType = response.headers.get("content-type") || "image/png";
  const buffer = await response.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  return `data:${contentType};base64,${base64}`;
}

async function prepareVisionDataUrlMap(messages, traceId) {
  const map = new Map();
  const { images } = extractVisionSegments(messages);
  const uniqueUrls = [...new Set(images.filter(Boolean))];
  if (!uniqueUrls.length) {
    return map;
  }

  for (const imageUrl of uniqueUrls) {
    if (typeof imageUrl === "string" && imageUrl.startsWith("data:")) {
      map.set(imageUrl, imageUrl);
      continue;
    }
    try {
      const dataUrl = await fetchImageAsDataUrl(imageUrl);
      map.set(imageUrl, dataUrl);
      await appendDebugLog("info", "vision_image_datauri_ready", {
        traceId,
        imageUrl,
        dataLength: dataUrl.length
      });
    } catch (error) {
      await appendDebugLog("error", "vision_image_datauri_failed", {
        traceId,
        imageUrl,
        error: toDebugMessage(error)
      });
    }
  }

  return map;
}

function normalizeProvider(provider, index) {
  const safeId = provider?.id == null ? `provider_${index + 1}` : String(provider.id);
  const safeName = provider?.name == null ? safeId : String(provider.name);
  const safeBaseUrl = provider?.baseUrl == null ? "" : String(provider.baseUrl);
  const safeApiKey = provider?.apiKey == null ? "" : String(provider.apiKey);
  const safeTextModel = provider?.textModel == null ? "" : String(provider.textModel);
  const safeVisionModel = provider?.visionModel == null ? "" : String(provider.visionModel);

  const id = safeId.trim();
  const name = (safeName || id || `供应商${index + 1}`).trim();

  return {
    id,
    name,
    baseUrl: normalizeBaseUrl(safeBaseUrl),
    apiKey: safeApiKey.trim(),
    textModel: safeTextModel.trim(),
    visionModel: safeVisionModel.trim(),
    timeoutMs: toPositiveInt(provider?.timeoutMs, 30000),
    maxRetries: toNonNegativeInt(provider?.maxRetries, 1),
    textPriority: toPositiveInt(provider?.textPriority, index + 1),
    visionPriority: toPositiveInt(provider?.visionPriority, index + 1),
    enabled: provider?.enabled !== false
  };
}

function buildLegacyProvider(rawSettings) {
  return normalizeProvider(
    {
      ...DEFAULT_PROVIDER,
      id: "provider_legacy",
      name: "兼容默认供应商",
      baseUrl: rawSettings.baseUrl || DEFAULT_SETTINGS.baseUrl,
      apiKey: rawSettings.apiKey || "",
      textModel: rawSettings.modelName || DEFAULT_SETTINGS.modelName,
      visionModel: rawSettings.modelName || DEFAULT_SETTINGS.modelName
    },
    0
  );
}

function normalizeProviders(rawSettings) {
  if (Array.isArray(rawSettings.providers) && rawSettings.providers.length > 0) {
    return rawSettings.providers
      .map((provider, index) => normalizeProvider(provider, index))
      .filter((provider) => provider.baseUrl && provider.enabled);
  }

  return [buildLegacyProvider(rawSettings)];
}

function pickProvidersByMode(providers, mode) {
  const modeKey = mode === MODE_VISION ? "visionModel" : "textModel";
  const priorityKey = mode === MODE_VISION ? "visionPriority" : "textPriority";
  return providers
    .filter((provider) => provider.enabled && provider.baseUrl && provider[modeKey])
    .sort((a, b) => a[priorityKey] - b[priorityKey]);
}

function buildTextPrompt(mode, rawText) {
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

function buildImageSummaryUserContent(imageUrl) {
  return [
    {
      type: "text",
      text: [
        "请对这张图片做省流总结：",
        "- 输出中文",
        "- 3到5条要点",
        "- 总长度不超过120字",
        "- 如果图片文字可读，提取关键信息"
      ].join("\n")
    },
    {
      type: "image_url",
      image_url: {
        url: imageUrl
      }
    }
  ];
}

function buildCustomSummaryRequest(input) {
  const text = (input?.text || "").trim();
  const images = Array.isArray(input?.images) ? input.images.filter(Boolean) : [];
  const hasText = Boolean(text);
  const hasImages = images.length > 0;

  if (!hasText && !hasImages) {
    throw new Error("请至少输入文字或添加一张图片。");
  }

  if (!hasImages) {
    return {
      mode: MODE_TEXT,
      messages: [
        {
          role: "user",
          content: [
            "请将以下用户输入内容总结成简短省流版本：",
            "- 输出中文",
            "- 3到6条要点",
            "- 总长度不超过180字",
            "",
            text
          ].join("\n")
        }
      ]
    };
  }

  const content = [
    {
      type: "text",
      text: [
        "请基于用户输入的文字与图片做省流总结：",
        "- 输出中文",
        "- 3到6条要点",
        "- 总长度不超过180字",
        "- 文字与图片信息需要融合分析",
        hasText ? `\n用户文字：\n${text}` : "\n用户仅提供图片，请直接总结。"
      ].join("\n")
    }
  ];

  for (const image of images) {
    content.push({
      type: "image_url",
      image_url: {
        url: image
      }
    });
  }

  return {
    mode: MODE_VISION,
    messages: [
      {
        role: "user",
        content
      }
    ]
  };
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(null, (rawSettings) => {
      const merged = {
        ...DEFAULT_SETTINGS,
        ...rawSettings
      };
      merged.providers = normalizeProviders(rawSettings || {});
      merged.debugLogEnabled = rawSettings?.debugLogEnabled !== false;
      debugLogEnabledCache = merged.debugLogEnabled;
      resolve(merged);
    });
  });
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`请求超时（${timeoutMs}ms）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function callProviderOnce(provider, mode, messages, trace = {}) {
  const modelName = mode === MODE_VISION ? provider.visionModel : provider.textModel;
  if (!modelName) {
    throw new Error("模型未配置。");
  }

  const visionStyle = trace.visionStyle || "openai_object";

  const endpoint = buildChatCompletionsEndpoint(provider.baseUrl);
  const headers = {
    "Content-Type": "application/json"
  };
  if (provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }

  await appendDebugLog("info", "provider_request_start", {
    traceId: trace.traceId || "",
    mode,
    provider: provider.name,
    providerId: provider.id,
    model: modelName,
    timeoutMs: provider.timeoutMs,
    attempt: trace.attempt || 1,
    visionStyle: mode === MODE_VISION ? visionStyle : ""
  });

  const requestPayload = {
    model: modelName,
    temperature: 0.2
  };

  if (mode === MODE_VISION) {
    const converted = withVisionFormat(messages, visionStyle, trace.visionDataUrlMap || new Map());
    if (visionStyle === "top_level_images") {
      requestPayload.messages = [
        {
          role: "system",
          content: "你是一个精炼的中文总结助手。"
        },
        ...(converted.messages || [])
      ];
      requestPayload.images = converted.images || [];
    } else {
      requestPayload.messages = [
        {
          role: "system",
          content: "你是一个精炼的中文总结助手。"
        },
        ...converted
      ];
    }
  } else {
    requestPayload.messages = [
      {
        role: "system",
        content: "你是一个精炼的中文总结助手。"
      },
      ...messages
    ];
  }

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers,
      body: JSON.stringify(requestPayload)
    },
    provider.timeoutMs
  );

  await appendDebugLog("info", "provider_response", {
    traceId: trace.traceId || "",
    mode,
    provider: provider.name,
    providerId: provider.id,
    model: modelName,
    status: response.status,
    ok: response.ok,
    attempt: trace.attempt || 1,
    visionStyle: mode === MODE_VISION ? visionStyle : "",
    contentType: response.headers.get("content-type") || ""
  });

  const rawText = await response.text();
  const parsedJson = tryParseJson(rawText);

  if (!response.ok) {
    const message =
      parsedJson?.error?.message ||
      parsedJson?.message ||
      (rawText || "").trim().slice(0, 300) ||
      `请求失败（HTTP ${response.status}）`;
    throw buildProviderError(message, response.status);
  }

  if (parsedJson) {
    const content = parsedJson?.choices?.[0]?.message?.content || parsedJson?.choices?.[0]?.text;
    const result = extractContentText(content);
    if (result) {
      return result;
    }
  }

  const ssePayloads = parseSseChunks(rawText);
  if (ssePayloads) {
    const sseText = extractTextFromSsePayloads(ssePayloads);
    if (sseText) {
      await appendDebugLog("info", "provider_response_stream_parsed", {
        traceId: trace.traceId || "",
        mode,
        provider: provider.name,
        providerId: provider.id,
        attempt: trace.attempt || 1,
        visionStyle: mode === MODE_VISION ? visionStyle : "",
        chunkCount: ssePayloads.length
      });
      return sseText;
    }
  }

  const fallbackText = (rawText || "").trim();
  if (fallbackText) {
    await appendDebugLog("info", "provider_response_text_fallback", {
      traceId: trace.traceId || "",
      mode,
      provider: provider.name,
      providerId: provider.id,
      attempt: trace.attempt || 1,
      visionStyle: mode === MODE_VISION ? visionStyle : "",
      textLength: fallbackText.length
    });
    return fallbackText;
  }

  throw buildProviderError("接口返回成功但未包含可用摘要内容。", response.status);
}

async function callProviderWithFallback(mode, messages) {
  const settings = await getSettings();
  const candidates = pickProvidersByMode(settings.providers, mode);
  const traceId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const visionDataUrlMap = mode === MODE_VISION ? await prepareVisionDataUrlMap(messages, traceId) : new Map();

  await appendDebugLog("info", "task_start", {
    traceId,
    mode,
    providerCount: candidates.length,
    dataUrlCount: visionDataUrlMap.size
  });

  if (!candidates.length) {
    await appendDebugLog("error", "task_no_provider", {
      traceId,
      mode
    });
    if (mode === MODE_VISION) {
      throw new Error("未配置可用的视觉总结供应商，请在设置页填写 visionModel。");
    }
    throw new Error("未配置可用的文字总结供应商，请在设置页填写 textModel。");
  }

  const errors = [];
  for (const provider of candidates) {
    const attempts = provider.maxRetries + 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const styles = mode === MODE_VISION ? getVisionStyles(visionDataUrlMap.size > 0) : ["text_default"];
      const styleErrors = [];
      let allStyleNonRetriable = true;

      for (const style of styles) {
        try {
          const result = await callProviderOnce(provider, mode, messages, {
            traceId,
            attempt,
            visionStyle: style,
            visionDataUrlMap
          });
          await appendDebugLog("info", "task_success", {
            traceId,
            mode,
            provider: provider.name,
            providerId: provider.id,
            attempt,
            visionStyle: mode === MODE_VISION ? style : ""
          });
          return result;
        } catch (error) {
          const errorMessage = error?.message || String(error);
          styleErrors.push(`${style}: ${errorMessage}`);
          if (!error?.nonRetriable) {
            allStyleNonRetriable = false;
          }
          await appendDebugLog("error", "provider_attempt_failed", {
            traceId,
            mode,
            provider: provider.name,
            providerId: provider.id,
            attempt,
            visionStyle: mode === MODE_VISION ? style : "",
            error: errorMessage
          });
        }
      }

      errors.push(`${provider.name} 第${attempt}次失败：${styleErrors.join(" | ")}`);
      if (allStyleNonRetriable) {
        await appendDebugLog("info", "provider_retry_skipped_non_retriable", {
          traceId,
          mode,
          provider: provider.name,
          providerId: provider.id,
          attempt
        });
        break;
      }
    }
  }

  await appendDebugLog("error", "task_failed_all", {
    traceId,
    mode,
    errors: errors.slice(0, 10)
  });
  throw new Error(`所有供应商调用失败：${errors.slice(0, 6).join("；")}`);
}

async function summarizeWithProvider({ text, mode }) {
  const prompt = buildTextPrompt(mode, text);
  return callProviderWithFallback(MODE_TEXT, [
    {
      role: "user",
      content: prompt
    }
  ]);
}

async function summarizeImageWithProvider(imageUrl) {
  if (!imageUrl) {
    throw new Error("未检测到图片地址。");
  }
  return callProviderWithFallback(MODE_VISION, [
    {
      role: "user",
      content: buildImageSummaryUserContent(imageUrl)
    }
  ]);
}

async function summarizeCustomWithProvider(input) {
  const request = buildCustomSummaryRequest(input);
  return callProviderWithFallback(request.mode, request.messages);
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
    chrome.contextMenus.create({
      id: MENU_IDS.image,
      title: "省流助手：识图总结",
      contexts: ["image"]
    });
  });
}

function isContextInvalidatedError(error) {
  const text = (error?.message || String(error) || "").toLowerCase();
  return (
    text.includes("extension context invalidated") ||
    text.includes("receiving end does not exist") ||
    text.includes("could not establish connection")
  );
}

function sendMessageToTabOnce(tabId, message) {
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

async function injectContentScriptToTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ["content.js"]
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      }
    );
  });
}

async function sendMessageToTab(tabId, message, retried = false) {
  try {
    return await sendMessageToTabOnce(tabId, message);
  } catch (error) {
    if (!retried && isContextInvalidatedError(error)) {
      await appendDebugLog("info", "tab_context_recover_start", {
        tabId,
        messageType: message?.type || "",
        error: toDebugMessage(error)
      });
      try {
        await injectContentScriptToTab(tabId);
      } catch (injectError) {
        await appendDebugLog("error", "tab_context_recover_failed", {
          tabId,
          messageType: message?.type || "",
          error: toDebugMessage(injectError)
        });
        throw new Error("页面上下文已失效且无法自动恢复，请刷新当前网页后重试。");
      }
      await appendDebugLog("info", "tab_context_recover_retry", {
        tabId,
        messageType: message?.type || ""
      });
      return sendMessageToTab(tabId, message, true);
    }
    throw error;
  }
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
  const response = await sendMessageToTab(tabId, {
    type: "APPLY_SELECTION_SUMMARY",
    summary,
    sourceText
  });
  if (response?.ok === false) {
    throw new Error(response.error || "页面渲染选中摘要失败。");
  }
}

async function notifyImageSummary(tabId, summary, imageUrl) {
  const response = await sendMessageToTab(tabId, {
    type: "APPLY_IMAGE_SUMMARY",
    summary,
    imageUrl
  });
  if (response?.ok === false) {
    throw new Error(response.error || "页面渲染图片摘要失败。");
  }
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
  void appendDebugLog("info", "extension_installed_or_updated", {}, true);
});

chrome.runtime.onStartup.addListener(() => {
  setupContextMenus();
  void appendDebugLog("info", "extension_startup", {}, true);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") {
    return;
  }
  if (changes.debugLogEnabled) {
    debugLogEnabledCache = changes.debugLogEnabled.newValue !== false;
    void appendDebugLog(
      "info",
      "debug_switch_changed",
      { enabled: debugLogEnabledCache },
      true
    );
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SUMMARIZE_TEXT") {
    void appendDebugLog("info", "message_summarize_text", {
      mode: message.mode || "",
      textLength: typeof message.text === "string" ? message.text.length : 0
    });
    summarizeWithProvider({
      text: message.text,
      mode: message.mode
    })
      .then((summary) => {
        void appendDebugLog("info", "message_summarize_text_success", {
          mode: message.mode || "",
          summaryLength: summary.length
        });
        sendResponse({ ok: true, summary });
      })
      .catch((error) => {
        void appendDebugLog("error", "message_summarize_text_failed", {
          mode: message.mode || "",
          error: toDebugMessage(error)
        });
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    return true;
  }

  if (message?.type === "SUMMARIZE_CUSTOM_INPUT") {
    void appendDebugLog("info", "message_summarize_custom", {
      textLength: typeof message?.input?.text === "string" ? message.input.text.length : 0,
      imageCount: Array.isArray(message?.input?.images) ? message.input.images.length : 0
    });
    summarizeCustomWithProvider(message.input)
      .then((summary) => {
        void appendDebugLog("info", "message_summarize_custom_success", {
          summaryLength: summary.length
        });
        sendResponse({ ok: true, summary });
      })
      .catch((error) => {
        void appendDebugLog("error", "message_summarize_custom_failed", {
          error: toDebugMessage(error)
        });
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    return true;
  }

  if (message?.type === "GET_DEBUG_LOGS") {
    getDebugLogs()
      .then((logs) => {
        sendResponse({ ok: true, logs });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: toDebugMessage(error) });
      });
    return true;
  }

  if (message?.type === "CLEAR_DEBUG_LOGS") {
    clearDebugLogs()
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: toDebugMessage(error) });
      });
    return true;
  }

  return false;
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) {
    return;
  }

  const tabId = tab.id;
  const run = async () => {
    if (info.menuItemId === MENU_IDS.selection) {
      await appendDebugLog("info", "menu_selection_clicked", {
        tabId
      });
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
      await appendDebugLog("info", "menu_page_clicked", {
        tabId
      });
      await notifyPageSummary(tabId, { state: "loading" });
      const pageText = await getPageTextFromTab(tabId);
      if (!pageText) {
        throw new Error("未提取到网页正文。");
      }
      const summary = await summarizeWithProvider({ text: pageText, mode: "page" });
      await notifyPageSummary(tabId, { state: "done", summary });
      return;
    }

    if (info.menuItemId === MENU_IDS.image) {
      const imageUrl = (info.srcUrl || "").trim();
      await appendDebugLog("info", "menu_image_clicked", {
        tabId,
        imageUrl
      });
      if (!imageUrl) {
        throw new Error("未检测到图片地址。");
      }
      await notifyTransientMessage(tabId, "正在识图总结，请稍候...", "normal");
      const summary = await summarizeImageWithProvider(imageUrl);
      await notifyImageSummary(tabId, summary, imageUrl);
    }
  };

  run().catch(async (error) => {
    const message = error?.message || String(error);
    await appendDebugLog("error", "menu_action_failed", {
      tabId,
      menuItemId: String(info.menuItemId || ""),
      error: message
    });
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
