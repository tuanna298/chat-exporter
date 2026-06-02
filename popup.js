/**
 * Popup script — detects platform, controls crawl, shows progress and results.
 */

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const platformBadge  = document.getElementById("platformBadge");
const convAvatar     = document.getElementById("convAvatar");
const convName       = document.getElementById("convName");
const convSub        = document.getElementById("convSub");
const unsupportedBox = document.getElementById("unsupportedBox");
const settingsToggle = document.getElementById("settingsToggle");
const settingsBody   = document.getElementById("settingsBody");
const exportBtn      = document.getElementById("exportBtn");
const progressSection= document.getElementById("progressSection");
const progressStatus = document.getElementById("progressStatus");
const progressCount  = document.getElementById("progressCount");
const progressFill   = document.getElementById("progressFill");
const progressText   = document.getElementById("progressText");
const resultsSection = document.getElementById("resultsSection");
const statsRow       = document.getElementById("statsRow");
const dlJsonBtn      = document.getElementById("dlJson");
const dlMdBtn        = document.getElementById("dlMd");
const fmtJson        = document.getElementById("fmtJson");
const fmtMd          = document.getElementById("fmtMd");

// ─── State ────────────────────────────────────────────────────────────────────
let activeTabId    = null;
let activePlatform = null;
let crawlResult    = null;
let scrollTimeoutMs  = 3000;
let maxScrollRetries = 8;

// ─── Settings persistence ─────────────────────────────────────────────────────

const STORAGE_KEY = "chatExporterSettings";

function saveSettings() {
  const activeSpeed = document.querySelector(".speed-btn.active");
  const activeDepth = document.querySelector(".depth-btn.active");
  chrome.storage.local.set({
    [STORAGE_KEY]: {
      speedMs:  activeSpeed ? parseInt(activeSpeed.dataset.ms, 10)      : 3000,
      retries:  activeDepth ? parseInt(activeDepth.dataset.retries, 10) : 8,
      fmtJson:  fmtJson.checked,
      fmtMd:    fmtMd.checked,
      settingsOpen: settingsBody.classList.contains("open"),
    },
  });
}

function applySettings(s) {
  // Speed button
  document.querySelectorAll(".speed-btn").forEach((btn) => {
    const active = parseInt(btn.dataset.ms, 10) === s.speedMs;
    btn.classList.toggle("active", active);
  });
  scrollTimeoutMs = s.speedMs;

  // Depth button
  document.querySelectorAll(".depth-btn").forEach((btn) => {
    const active = parseInt(btn.dataset.retries, 10) === s.retries;
    btn.classList.toggle("active", active);
  });
  maxScrollRetries = s.retries;

  // Format checkboxes
  fmtJson.checked = s.fmtJson !== false;  // default true
  fmtMd.checked   = s.fmtMd  !== false;

  // Settings panel open/closed state
  if (s.settingsOpen) {
    settingsBody.classList.add("open");
    settingsToggle.classList.add("open");
  }
}

// Load on startup, then init tab detection
chrome.storage.local.get(STORAGE_KEY, (result) => {
  const saved = result[STORAGE_KEY];
  if (saved) applySettings(saved);
  initTab();
});

// ─── Settings: collapsible ────────────────────────────────────────────────────
settingsToggle.addEventListener("click", () => {
  const open = settingsBody.classList.toggle("open");
  settingsToggle.classList.toggle("open", open);
  saveSettings();
});

// Speed buttons
document.querySelectorAll(".speed-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".speed-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    scrollTimeoutMs = parseInt(btn.dataset.ms, 10);
    saveSettings();
  });
});

// Depth buttons
document.querySelectorAll(".depth-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".depth-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    maxScrollRetries = parseInt(btn.dataset.retries, 10);
    saveSettings();
  });
});

// Format checkboxes
fmtJson.addEventListener("change", () => {
  dlJsonBtn.style.opacity = fmtJson.checked ? "" : "0.35";
  saveSettings();
});
fmtMd.addEventListener("change", () => {
  dlMdBtn.style.opacity = fmtMd.checked ? "" : "0.35";
  saveSettings();
});

// ─── Init: detect current tab ─────────────────────────────────────────────────
function initTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) return;
    activeTabId = tab.id;
    const url = tab.url ?? "";

    const isInstagram = url.includes("instagram.com/direct/");
    const isZalo = url.includes("chat.zalo.me");

    if (!isInstagram && !isZalo) {
      setPlatform(null);
      unsupportedBox.classList.add("visible");
      convName.textContent = "Trang không được hỗ trợ";
      convSub.textContent = url || "Không phải trang chat";
      return;
    }

    chrome.tabs.sendMessage(activeTabId, { type: "PING" }, (resp) => {
      if (chrome.runtime.lastError || !resp?.ok) {
        const guessed = isInstagram ? "Instagram" : "Zalo";
        setPlatform(guessed);
        setConvInfo(guessed, tab);
        exportBtn.disabled = false;
        return;
      }
      setPlatform(resp.platform);
      setConvInfo(resp.platform, tab);
      exportBtn.disabled = false;
    });
  });
}

// ─── Platform display ─────────────────────────────────────────────────────────
function setPlatform(platform) {
  activePlatform = platform;
  if (platform === "Instagram") {
    platformBadge.textContent = "Instagram";
    platformBadge.className = "platform-badge instagram";
    convAvatar.className = "conv-avatar instagram";
    exportBtn.classList.remove("zalo");
  } else if (platform === "Zalo") {
    platformBadge.textContent = "Zalo";
    platformBadge.className = "platform-badge zalo";
    convAvatar.className = "conv-avatar zalo";
    exportBtn.classList.add("zalo");
  } else {
    platformBadge.textContent = "Không hỗ trợ";
    platformBadge.className = "platform-badge none";
    convAvatar.className = "conv-avatar none";
  }
}

function setConvInfo(platform, tab) {
  const url = tab.url ?? "";
  if (platform === "Instagram") {
    const m = url.match(/direct\/t\/([^/?#]+)/);
    convName.textContent = m ? `Cuộc trò chuyện #${m[1]}` : "DM Conversation";
    convSub.textContent  = m ? `instagram.com/direct/t/${m[1]}` : url;
    convAvatar.textContent = "IG";
  } else if (platform === "Zalo") {
    convName.textContent = tab.title?.replace(/\s*[\|–-].*$/, "").trim() || "Zalo Chat";
    convSub.textContent  = "chat.zalo.me";
    convAvatar.textContent = "ZL";
  }
}

// ─── Export button ────────────────────────────────────────────────────────────
exportBtn.addEventListener("click", () => {
  if (!activeTabId) return;
  exportBtn.disabled = true;
  exportBtn.textContent = "Đang xuất...";
  crawlResult = null;
  hideResults();
  showProgress();
  setProgress("Đang gửi lệnh...", 0, null);

  chrome.tabs.sendMessage(
    activeTabId,
    { type: "START_CRAWL", scrollTimeoutMs, maxScrollRetries },
    (resp) => {
      if (chrome.runtime.lastError || !resp?.ok) {
        const err = chrome.runtime.lastError?.message ?? resp?.error ?? "Lỗi không xác định";
        setProgress(`❌ ${err}`, 0, 0);
        progressText.textContent = "💡 Thử reload trang rồi mở lại extension.";
        exportBtn.disabled = false;
        exportBtn.textContent = "Thử lại";
      }
    }
  );
});

// ─── Progress messages from content script ────────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case "PROGRESS":
      setProgress(message.text, message.count ?? null, message.progress ?? null);
      break;
    case "CRAWL_DONE":
      crawlResult = message;
      setProgress("✅ Hoàn tất", message.count, 100);
      showResults(message);
      exportBtn.disabled = false;
      exportBtn.textContent = "Xuất lại";
      break;
    case "CRAWL_ERROR":
      setProgress(`❌ Lỗi: ${message.error}`, null, 0);
      exportBtn.disabled = false;
      exportBtn.textContent = "Thử lại";
      break;
  }
});

// ─── Download handlers ────────────────────────────────────────────────────────
dlJsonBtn.addEventListener("click", () => {
  if (!crawlResult || !fmtJson.checked) return;
  download(crawlResult.jsonContent, buildFilename("json"), "application/json");
});
dlMdBtn.addEventListener("click", () => {
  if (!crawlResult || !fmtMd.checked) return;
  download(crawlResult.mdContent, buildFilename("md"), "text/markdown");
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function download(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildFilename(ext) {
  const p = crawlResult?.participants;
  const other = (p?.otherUsername || p?.other || "chat")
    .replace(/[^a-z0-9_.\-]/gi, "_").slice(0, 40);
  const date = new Date().toISOString().slice(0, 10);
  const platform = (crawlResult?.platform ?? activePlatform ?? "chat").toLowerCase();
  return `${platform}_${other}_${date}.${ext}`;
}

function showProgress() { progressSection.classList.add("visible"); }

function setProgress(statusText, count, pct) {
  progressStatus.textContent = statusText;
  if (count !== null && count !== undefined) {
    progressCount.innerHTML = `${count}<span>tin nhắn</span>`;
  }
  if (pct === null) {
    progressFill.classList.add("indeterminate");
    progressFill.style.width = "";
  } else {
    progressFill.classList.remove("indeterminate");
    progressFill.style.width = `${pct}%`;
  }
}

function showResults(result) {
  const s = result.stats ?? {};
  statsRow.innerHTML = [
    ["Văn bản", s.text ?? 0],
    ["Ảnh",     s.image ?? 0],
    ["Video",   s.video ?? 0],
    ["Khác",    (s.sticker ?? 0) + (s.other ?? 0)],
  ].map(([label, val]) => `
    <div class="stat-item">
      <div class="stat-value">${val}</div>
      <div class="stat-label">${label}</div>
    </div>`).join("");

  dlJsonBtn.style.display = fmtJson.checked ? "" : "none";
  dlMdBtn.style.display   = fmtMd.checked   ? "" : "none";
  resultsSection.classList.add("visible");
}

function hideResults() { resultsSection.classList.remove("visible"); }
