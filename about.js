const PROJECT_URL = "https://github.com/AtlantisYuki/word_summary";
const RELEASES_LATEST_API = "https://api.github.com/repos/AtlantisYuki/word_summary/releases/latest";
const TAGS_LATEST_API = "https://api.github.com/repos/AtlantisYuki/word_summary/tags?per_page=1";

const currentVersionEl = document.getElementById("current-version");
const checkUpdateBtn = document.getElementById("check-update-btn");
const updateStatusEl = document.getElementById("update-status");
const latestReleaseLinkEl = document.getElementById("latest-release-link");
const projectLinkEl = document.getElementById("project-link");

function setUpdateStatus(text, type = "") {
  updateStatusEl.textContent = text;
  updateStatusEl.className = `status ${type}`.trim();
}

function normalizeVersion(versionText) {
  const clean = String(versionText || "")
    .trim()
    .replace(/^[vV]/, "");
  const parts = clean.split(".");
  return [0, 1, 2].map((idx) => {
    const value = parseInt(parts[idx] || "0", 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  });
}

function compareVersion(aText, bText) {
  const a = normalizeVersion(aText);
  const b = normalizeVersion(bText);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) {
      return 1;
    }
    if (a[i] < b[i]) {
      return -1;
    }
  }
  return 0;
}

async function checkForUpdates() {
  const currentVersion = chrome.runtime.getManifest().version;
  checkUpdateBtn.disabled = true;
  latestReleaseLinkEl.style.display = "none";
  setUpdateStatus("正在检查更新...", "");

  try {
    let latestTag = "";
    let latestUrl = PROJECT_URL;
    let publishedAt = "";

    const releaseResponse = await fetch(RELEASES_LATEST_API, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json"
      }
    });

    if (releaseResponse.ok) {
      const release = await releaseResponse.json();
      latestTag = String(release?.tag_name || "").trim();
      latestUrl = String(release?.html_url || PROJECT_URL).trim();
      publishedAt = String(release?.published_at || "").trim();
    } else if (releaseResponse.status === 404) {
      const tagsResponse = await fetch(TAGS_LATEST_API, {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json"
        }
      });
      if (!tagsResponse.ok) {
        throw new Error(`GitHub Tags API 请求失败（HTTP ${tagsResponse.status}）`);
      }
      const tags = await tagsResponse.json();
      const latestTagObj = Array.isArray(tags) ? tags[0] : null;
      latestTag = String(latestTagObj?.name || "").trim();
      latestUrl = latestTag ? `${PROJECT_URL}/releases/tag/${latestTag}` : PROJECT_URL;
    } else {
      throw new Error(`GitHub API 请求失败（HTTP ${releaseResponse.status}）`);
    }

    if (!latestTag) {
      throw new Error("未读取到最新版本标签。");
    }

    latestReleaseLinkEl.href = latestUrl;
    latestReleaseLinkEl.style.display = "inline";

    const cmp = compareVersion(latestTag, currentVersion);
    if (cmp > 0) {
      const dateText = publishedAt ? `，发布时间：${publishedAt.slice(0, 10)}` : "";
      setUpdateStatus(`发现新版本 ${latestTag}（当前 v${currentVersion}${dateText}）。`, "warn");
      return;
    }
    if (cmp < 0) {
      setUpdateStatus(`当前版本 v${currentVersion} 高于 GitHub 最新发布 ${latestTag}。`, "ok");
      return;
    }
    setUpdateStatus(`当前已是最新版本（v${currentVersion}）。`, "ok");
  } catch (error) {
    setUpdateStatus(`检查失败：${error?.message || String(error)}`, "error");
  } finally {
    checkUpdateBtn.disabled = false;
  }
}

function init() {
  if (typeof window.initSidebar === "function") {
    window.initSidebar("about");
  }

  const currentVersion = chrome.runtime.getManifest().version;
  currentVersionEl.textContent = `v${currentVersion}`;

  projectLinkEl.href = PROJECT_URL;
  projectLinkEl.textContent = PROJECT_URL;

  checkUpdateBtn.addEventListener("click", () => {
    void checkForUpdates();
  });
}

init();
