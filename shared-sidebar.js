(function bootstrapSidebar() {
  window.initSidebar = function initSidebar(activeKey) {
    const shell = document.querySelector(".shell");
    if (!shell) {
      return;
    }

    const links = Array.from(document.querySelectorAll(".sidebar-nav a[data-nav]"));
    for (const link of links) {
      link.classList.toggle("active", link.dataset.nav === activeKey);
    }
  };
})();
