const openOptionsBtn = document.getElementById("open-options");
const openMoreBtn = document.getElementById("open-more");

openOptionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

openMoreBtn.addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("more.html")
  });
});
