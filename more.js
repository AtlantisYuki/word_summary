const textInput = document.getElementById("textInput");
const imageInput = document.getElementById("imageInput");
const clearImagesBtn = document.getElementById("clearImages");
const runSummaryBtn = document.getElementById("runSummary");
const statusEl = document.getElementById("status");
const resultBox = document.getElementById("resultBox");
const imageListEl = document.getElementById("imageList");

const imageEntries = [];

function setStatus(text) {
  statusEl.textContent = text || "";
}

function setLoading(loading) {
  runSummaryBtn.disabled = loading;
  imageInput.disabled = loading;
  clearImagesBtn.disabled = loading;
}

function renderImageList() {
  imageListEl.innerHTML = "";
  imageEntries.forEach((item, index) => {
    const wrap = document.createElement("div");
    wrap.className = "image-item";

    const img = document.createElement("img");
    img.src = item.dataUrl;
    img.alt = item.name || `图片${index + 1}`;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "移除";
    removeBtn.addEventListener("click", () => {
      imageEntries.splice(index, 1);
      renderImageList();
    });

    wrap.appendChild(img);
    wrap.appendChild(removeBtn);
    imageListEl.appendChild(wrap);
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败。"));
    reader.readAsDataURL(file);
  });
}

async function addImageFiles(fileList) {
  const files = Array.from(fileList || []);
  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      continue;
    }
    const dataUrl = await fileToDataUrl(file);
    imageEntries.push({
      name: file.name || "",
      dataUrl
    });
  }
  renderImageList();
}

function sendCustomSummary(input) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "SUMMARIZE_CUSTOM_INPUT",
        input
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

async function runSummary() {
  const text = (textInput.value || "").trim();
  const images = imageEntries.map((item) => item.dataUrl).filter(Boolean);

  if (!text && images.length === 0) {
    setStatus("请至少输入文字或添加一张图片。");
    return;
  }

  try {
    setLoading(true);
    setStatus("正在总结，请稍候...");
    resultBox.value = "";

    const summary = await sendCustomSummary({ text, images });
    resultBox.value = summary;
    setStatus("完成。");
  } catch (error) {
    setStatus(`失败：${error.message || String(error)}`);
  } finally {
    setLoading(false);
  }
}

imageInput.addEventListener("change", async () => {
  try {
    await addImageFiles(imageInput.files);
  } catch (error) {
    setStatus(`图片读取失败：${error.message || String(error)}`);
  } finally {
    imageInput.value = "";
  }
});

clearImagesBtn.addEventListener("click", () => {
  imageEntries.splice(0, imageEntries.length);
  renderImageList();
  setStatus("");
});

runSummaryBtn.addEventListener("click", () => {
  void runSummary();
});

document.addEventListener("paste", async (event) => {
  const items = Array.from(event.clipboardData?.items || []);
  const imageItems = items.filter((item) => item.kind === "file" && item.type.startsWith("image/"));
  if (!imageItems.length) {
    return;
  }

  try {
    const files = imageItems.map((item) => item.getAsFile()).filter(Boolean);
    await addImageFiles(files);
    setStatus(`已添加 ${files.length} 张粘贴图片。`);
  } catch (error) {
    setStatus(`粘贴图片失败：${error.message || String(error)}`);
  }
});
