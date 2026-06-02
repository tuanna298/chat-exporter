/**
 * Content script — runs on Instagram DM and Zalo chat pages.
 *
 * Architecture: Platform Adapter pattern
 *   Each adapter implements a common interface so the core engine is platform-agnostic.
 *
 * Adapter interface:
 *   name          : string
 *   detect()      : boolean          — returns true if current page belongs to this platform
 *   apiPatterns   : RegExp[]         — used to filter intercepted responses
 *   parseApiResponse(url, body)      — returns ExportedMessage[] | null
 *   detectParticipants()             — returns { me, other, otherUsername }
 *   findScrollContainer()            — returns HTMLElement | null
 *   extractFromDom(participants, container) — returns ExportedMessage[]
 */

// ─── Inject page-world interceptor ──────────────────────────────────────────
(function injectPageScript() {
  if (document.getElementById("__ce_injected__")) return;
  const s = document.createElement("script");
  s.id = "__ce_injected__";
  s.src = chrome.runtime.getURL("injected.js");
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
})();

// ─── Shared utilities ────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...args) { console.log("[ChatExporter]", ...args); }

// Generic: find the main scrollable messages container by heuristics
function findGenericScrollContainer() {
  const scrollables = [...document.querySelectorAll("*")].filter((el) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      (cs.overflowY === "scroll" || cs.overflowY === "auto") &&
      el.scrollHeight > el.clientHeight + 50 &&
      rect.width > 300 &&
      rect.left > 20
    );
  });
  if (!scrollables.length) return null;
  return scrollables.reduce((a, b) =>
    a.scrollHeight > b.scrollHeight ? a : b
  );
}

// ─── Message type helpers ────────────────────────────────────────────────────

function parseTimestamp(ts) {
  if (!ts) return undefined;
  const n = typeof ts === "string" ? Number(ts) : ts;
  if (isNaN(n)) return undefined;
  return new Date(n > 1e12 ? n / 1000 : n).toISOString();
}

function messageKey(m) {
  return `${m.sender}|||${m.content ?? m.mediaUrl ?? ""}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PLATFORM ADAPTER: Instagram
// ═══════════════════════════════════════════════════════════════════════════

const InstagramAdapter = {
  name: "Instagram",

  detect() {
    return location.hostname === "www.instagram.com" &&
      location.pathname.startsWith("/direct/");
  },

  apiPatterns: [
    /api\/v1\/direct_v2\/threads/,
    /graphql\/query/,
    /api\/v1\/direct_v2\/inbox/,
  ],

  // ── API parsing (ported from apiExtractor.ts) ──────────────────────────

  parseApiResponse(_url, body) {
    const msgs = [];
    const root = body;
    const data = root.data;
    const thread = root.thread ?? data?.message_thread;

    if (thread?.items) {
      return this._extractThread(thread);
    }
    if (root.inbox?.threads) {
      for (const t of root.inbox.threads) msgs.push(...this._extractThread(t));
      return msgs;
    }
    if (Array.isArray(root.threads)) {
      for (const t of root.threads) msgs.push(...this._extractThread(t));
      return msgs;
    }
    return null;
  },

  _extractThread(thread) {
    const participants = new Map();
    for (const u of thread.users ?? []) {
      const id = String(u.pk ?? u.pk_id ?? "");
      if (id) participants.set(id, u.full_name || u.username || id);
    }
    if (thread.inviter) {
      const id = String(thread.inviter.pk ?? thread.inviter.pk_id ?? "");
      if (id) participants.set(id, thread.inviter.full_name || thread.inviter.username || id);
    }
    return (thread.items ?? []).map((item) => this._parseItem(item, participants));
  },

  _parseItem(item, participants) {
    const userId = String(item.user_id ?? "");
    const sender = participants.get(userId) || userId || "Unknown";
    const id = item.item_id ?? String(item.timestamp ?? Math.random());

    const typeMap = {
      text: "text", media: "image", reel_share: "reel",
      story_share: "story_share", media_share: "post_share",
      animated_media: "sticker", like: "emoji", link: "text",
      video_call_event: "unknown",
    };
    const type = typeMap[item.item_type] ?? "unknown";
    const base = { id, timestamp: parseTimestamp(item.timestamp), sender, type };

    switch (item.item_type) {
      case "text":  base.content = item.text; break;
      case "link":
        base.content = item.link?.text ?? item.link?.link_context?.link_url;
        base.metadata = { linkUrl: item.link?.link_context?.link_url };
        break;
      case "like":  base.type = "emoji"; base.content = item.like ?? "❤️"; break;
      case "media": {
        const v = item.video_versions ?? [];
        const c = item.image_versions2?.candidates ?? [];
        if (v.length) { base.type = "video"; base.mediaUrl = v[0].url; }
        else if (c.length) { base.type = "image"; base.mediaUrl = c[0].url; }
        break;
      }
      case "reel_share": {
        const m = item.reel_share?.media;
        base.mediaUrl = m?.video_versions?.[0]?.url ?? m?.image_versions2?.candidates?.[0]?.url;
        base.content = item.text;
        break;
      }
      case "story_share":
        base.mediaUrl = item.story_share?.media?.image_versions2?.candidates?.[0]?.url;
        break;
      case "media_share": {
        const m = item.media_share;
        base.mediaUrl = m?.video_versions?.[0]?.url ?? m?.image_versions2?.candidates?.[0]?.url;
        break;
      }
      case "animated_media":
        base.mediaUrl = item.animated_media?.images?.fixed_height?.url;
        break;
      default:
        base.metadata = { rawType: item.item_type };
    }
    return base;
  },

  // ── Participants ───────────────────────────────────────────────────────

  detectParticipants() {
    let me = null;
    const skip = ["explore","reels","direct","accounts","stories","tv","messages"];
    for (const a of document.querySelectorAll("a[href]")) {
      const m = a.href.match(/instagram\.com\/([^/?#]+)\/?$/);
      if (m && !skip.includes(m[1]) && a.querySelector("img")) { me = m[1]; break; }
    }

    let other = "Unknown", otherUsername = "";
    for (const a of document.querySelectorAll("a[href]")) {
      const m = a.href.match(/instagram\.com\/([^/?#]+)\/?$/);
      if (!m || skip.includes(m[1]) || m[1] === me) continue;
      const rect = a.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < 140 && rect.width > 0) {
        otherUsername = m[1];
        const candidates = [...a.querySelectorAll("*")]
          .map((el) => el.textContent?.trim() ?? "")
          .filter((t) => t && t !== m[1] && !t.includes("· Instagram"));
        other = candidates[0] || m[1];
        break;
      }
    }
    return { me, other, otherUsername };
  },

  findScrollContainer() { return findGenericScrollContainer(); },

  // ── DOM extraction ─────────────────────────────────────────────────────

  TIMESTAMP_RE: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Today|Yesterday|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{1,2}\/\d{1,2}|\d{1,2}:\d{2})/i,
  JUNK_RE: /^(Edited|You replied to |Reacted .+ to your message|Liked a message|Unsent a message)/i,

  extractFromDom(participants, container) {
    const { me: myUser, other: otherName, otherUsername } = participants;
    const containerRect = container.getBoundingClientRect();
    const midX = containerRect.left + containerRect.width / 2;

    const leaves = [...container.querySelectorAll("[dir='auto']")].filter(
      (el) => !el.querySelector("[dir='auto']")
    );

    const results = [], seen = new Set();

    leaves.forEach((el, index) => {
      const text = el.textContent?.trim() ?? "";
      if (!text || text.length > 2000) return;
      if (this.TIMESTAMP_RE.test(text)) return;
      if (this.JUNK_RE.test(text)) return;
      if (text.includes("· Instagram")) return;
      if (text === otherName || text === otherUsername || text === myUser) return;

      const rect = el.getBoundingClientRect();
      if (rect.top < containerRect.top - 20 || rect.bottom > containerRect.bottom + 20 || rect.width === 0) return;

      const key = `${Math.round(rect.top / 4)}|${text}`;
      if (seen.has(key)) return;
      seen.add(key);

      const isSent = (rect.left + rect.width / 2) > midX;
      const sender = isSent ? (myUser ?? "You") : otherName;

      let timestamp;
      let node = el.parentElement;
      for (let i = 0; i < 10 && node; i++) {
        const t = node.querySelector("time[datetime]");
        if (t) { timestamp = t.getAttribute("datetime") ?? undefined; break; }
        node = node.parentElement;
      }

      let type = "text", mediaUrl;
      let bubble = el.parentElement;
      for (let i = 0; i < 7 && bubble; i++) {
        const video = bubble.querySelector("video[src]");
        if (video) { type = "video"; mediaUrl = video.src; break; }
        const img = [...bubble.querySelectorAll("img[src]")].find(
          (im) => im.src && !im.src.includes("s150x150") && !im.src.includes("s32x32") &&
                  !im.src.includes("profile_pic") && im.width > 80
        );
        if (img) { type = "image"; mediaUrl = img.src; break; }
        bubble = bubble.parentElement;
      }

      results.push({
        id: `dom-${index}-${Date.now()}`,
        sender, type,
        content: type === "text" ? text : undefined,
        mediaUrl, timestamp,
      });
    });

    return results;
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PLATFORM ADAPTER: Zalo
// ═══════════════════════════════════════════════════════════════════════════
//
// DOM layout (from live inspection):
//   #chatViewContainer > #chatView > #messageView > #messageViewContainer
//     > div.transform-gpu   (overflowY:scroll, the actual scroll element)
//       > #messageViewScroll .message-view__scroll__inner
//           > .chat-item[.me]   ← one per message
//               .text-message__container  ← text
//               .card-send-time           ← "15:52"
//   .chat-item has class "me" when sent by logged-in user.
//
// Zalo uses virtual scrolling — the `.transform-gpu` div has overflowY:scroll
// but scrollHeight - clientHeight ≈ 20px (nearly equal, fails our old > 50
// threshold). Scrolling is triggered via WheelEvent, NOT scrollTop.

const ZaloAdapter = {
  name: "Zalo",

  detect() { return location.hostname === "chat.zalo.me"; },

  apiPatterns: [
    /zalo\.me\/api/,
    /getmsglist/i,
    /getconvinfo/i,
    /conv\/detail/i,
    /chat\/hist/i,
  ],

  // ── API parsing ────────────────────────────────────────────────────────
  // Zalo API response shape:
  //   { error: 0, data: { msgs: [...] } }
  //   Each msg: { msgId, sendDttm (ms), uidFrom, toId, message, msgType }
  //   msgType: 1=text, 2=image, 3=video, 6=sticker, 8=file, 17=link

  _participants: new Map(),

  parseApiResponse(_url, body) {
    if (body.error !== undefined && body.error !== 0) return null;

    const data = body.data ?? body;
    this._accumulateParticipants(data);

    const msgList = data.msgs ?? data.messages ?? data.listMsgs;
    if (Array.isArray(msgList) && msgList.length > 0) {
      return msgList.map((m) => this._parseMsg(m)).filter(Boolean);
    }

    const conv = data.conversation ?? data.thread;
    if (conv) {
      const convMsgs = conv.msgs ?? conv.messages ?? [];
      if (convMsgs.length > 0) return convMsgs.map((m) => this._parseMsg(m)).filter(Boolean);
    }

    return null;
  },

  _accumulateParticipants(data) {
    for (const u of data.members ?? data.participants ?? data.users ?? []) {
      const uid = String(u.uid ?? u.userId ?? u.id ?? "");
      const name = u.displayName ?? u.name ?? u.zaloName ?? uid;
      if (uid) this._participants.set(uid, name);
    }
    if (data.uid && (data.name || data.displayName)) {
      this._participants.set(String(data.uid), data.displayName ?? data.name);
    }
  },

  _parseMsg(item) {
    if (!item) return null;
    const id = String(item.msgId ?? item.clientId ?? item.id ?? Math.random());
    const ts = item.sendDttm ?? item.ts ?? item.timestamp;
    const timestamp = ts ? new Date(Number(ts)).toISOString() : undefined;
    const uidFrom = String(item.uidFrom ?? item.senderId ?? item.from ?? "");
    const sender = this._participants.get(uidFrom) || uidFrom || "Unknown";

    const rawType = Number(item.msgType ?? item.type ?? 1);
    let type = "text", content, mediaUrl;

    if      (rawType === 1)  { type = "text";    content  = item.message ?? item.content ?? item.text; }
    else if (rawType === 2)  { type = "image";   mediaUrl = item.href ?? item.url ?? item.attach?.href; }
    else if (rawType === 3)  { type = "video";   mediaUrl = item.href ?? item.url ?? item.attach?.href; }
    else if (rawType === 6)  { type = "sticker"; mediaUrl = item.href ?? item.url; }
    else if (rawType === 8)  { type = "unknown"; content  = item.attach?.title ?? "[File]"; }
    else if (rawType === 17) { type = "text";    content  = item.message ?? item.attach?.title; }
    else                     { type = "text";    content  = item.message ?? item.content ?? item.text; }

    if (!content && !mediaUrl) content = item.message ?? item.content ?? item.text;

    return { id, timestamp, sender, type, content, mediaUrl };
  },

  // ── Participants ───────────────────────────────────────────────────────

  detectParticipants() {
    let other = "Unknown";

    // Strategy 1 — anchor on the status text visible in the header.
    // Zalo always shows "Truy cập X phút trước" / "Online" / "Đang hoạt động"
    // directly below the person's name in the chat header (right panel, top area).
    // We find that status element, then grab the preceding sibling as the name.
    const statusEl = [...document.querySelectorAll("*")].find((el) => {
      if (el.childElementCount !== 0) return false;
      const rect = el.getBoundingClientRect();
      if (rect.left <= 400 || rect.top < 0 || rect.top > 250) return false;
      const t = el.textContent?.trim() ?? "";
      return /Truy cập|phút trước|giờ trước|ngày trước|Online|Đang hoạt động|Đang chat|thành viên/i.test(t);
    });

    if (statusEl) {
      // Name is usually the immediate previous sibling, or first child of parent
      const nameCandidates = [
        statusEl.previousElementSibling,
        statusEl.parentElement?.previousElementSibling,
        statusEl.parentElement?.firstElementChild,
        statusEl.parentElement?.parentElement?.querySelector("span, div, h2, h3"),
      ];
      for (const el of nameCandidates) {
        if (!el || el === statusEl) continue;
        const t = el.textContent?.trim();
        if (t && t.length > 0 && t.length < 80 &&
            !/Truy cập|Online|Đang|thành viên/i.test(t)) {
          other = t;
          break;
        }
      }
    }

    // Strategy 2 — first short leaf text in the right-panel header area
    // (left > 400px, vertically near the top). Skip status/button texts.
    if (other === "Unknown") {
      const headerLeaf = [...document.querySelectorAll("*")].find((el) => {
        if (el.childElementCount !== 0) return false;
        const rect = el.getBoundingClientRect();
        if (rect.left <= 400 || rect.top < 0 || rect.top > 120 || rect.width < 20) return false;
        const t = el.textContent?.trim() ?? "";
        return (
          t.length > 1 && t.length < 60 &&
          !/Truy cập|phút trước|Online|Đang|Tìm kiếm|^\d/i.test(t)
        );
      });
      if (headerLeaf) other = headerLeaf.textContent.trim();
    }

    // Strategy 3 — page title (Zalo usually sets title = conversation name)
    if (other === "Unknown") {
      const titleClean = document.title
        .replace(/\s*[|\-–]\s*Zalo.*/i, "")
        .replace(/^Zalo\s*[|\-–]\s*/i, "")
        .trim();
      if (titleClean && titleClean.toLowerCase() !== "zalo" && titleClean.length > 0) {
        other = titleClean;
      }
    }

    return { me: null, other, otherUsername: "" };
  },

  // ── Scroll container ───────────────────────────────────────────────────
  // Returns the .transform-gpu child of #messageViewContainer, which is the
  // actual scrollable element Zalo uses. Falls back through stable IDs.

  findScrollContainer() {
    // Primary: the virtual-scroll inner div inside #messageViewContainer
    const mvc = document.getElementById("messageViewContainer");
    if (mvc) {
      // Find direct child with overflowY:scroll (the .transform-gpu div)
      for (const child of mvc.children) {
        if (getComputedStyle(child).overflowY === "scroll") return child;
      }
      return mvc; // fallback to container itself
    }

    // Secondary IDs
    for (const id of ["messageView", "messageViewScroll", "chatViewContainer", "chatView"]) {
      const el = document.getElementById(id);
      if (el) return el;
    }

    // Tertiary: class-based
    const byClass = document.querySelector(
      ".message-view__scroll__inner, .message-view__scroll, .message-view"
    );
    if (byClass) return byClass;

    return findGenericScrollContainer();
  },

  // ── Platform-specific scroll ───────────────────────────────────────────
  // Zalo uses virtual scrolling. We try three strategies in order:
  //   1. scrollTop = 0 on .transform-gpu (native scroll → fires 'scroll' event)
  //   2. WheelEvent on #messageView (Zalo may intercept wheel to drive virtual list)
  //   3. scrollIntoView on the topmost visible .chat-item (forces viewport change)

  scrollUp(container) {
    const mvc = document.getElementById("messageViewContainer");

    // Find .transform-gpu child (the overflow:scroll element)
    const scrollEl = (() => {
      if (mvc) {
        for (const c of mvc.children) {
          if (getComputedStyle(c).overflowY === "scroll") return c;
        }
      }
      return container;
    })();

    // Strategy 1: native scrollTop → browser fires 'scroll' natively (isTrusted=true equivalent)
    scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop - 9999);
    scrollEl.dispatchEvent(new Event("scroll", { bubbles: true }));

    // Strategy 2: WheelEvent on the message view pane
    const msgView = document.getElementById("messageView") ||
                    document.getElementById("chatView") ||
                    scrollEl;
    for (let i = 0; i < 6; i++) {
      msgView.dispatchEvent(new WheelEvent("wheel", {
        deltaY: -600, deltaMode: 0, bubbles: true, cancelable: true,
      }));
    }

    // Strategy 3: scroll the topmost visible .chat-item into view
    const firstItem = document.querySelector(
      "#messageViewScroll .chat-item, .message-view__scroll__inner .chat-item"
    );
    if (firstItem) {
      firstItem.scrollIntoView({ block: "start", behavior: "auto" });
    }
  },

  // ── DOM extraction ─────────────────────────────────────────────────────
  // Uses .chat-item elements found anywhere in the chat area (left > 400px).
  // .chat-item has class "me" when sent by the logged-in user.
  // Text is in .text-message__container; media in video/img inside .message-frame.

  SYSTEM_RE: /tham gia cuộc|được .+ thêm vào|đã rời nhóm|đã tạo nhóm|đặt tên nhóm|[Kk]hông có tin nhắn gần đây/i,

  extractFromDom(participants, _container) {
    const { me: myUser, other: otherName } = participants;
    const results = [], seen = new Set();

    // Query the whole document but filter to chat-area items only (left > 400)
    const chatItems = [...document.querySelectorAll(".chat-item")].filter((el) => {
      const rect = el.getBoundingClientRect();
      // Must be in the right panel and actually visible
      return rect.left > 400 && rect.height > 0 && rect.width > 0;
    });

    log(`Zalo DOM: ${chatItems.length} .chat-item in chat area`);

    chatItems.forEach((item, index) => {
      const isSent = item.classList.contains("me");
      const sender = isSent ? (myUser ?? "Bạn") : otherName;

      // ── Text (highest priority) ──────────────────────────────────────
      // Zalo renders inline emoji as <img> tags inside .text-message__container.
      // We read textContent (strips tags) to get the plain text string.
      const textEl = item.querySelector(".text-message__container");
      const text = textEl?.textContent?.trim() || undefined;
      if (this.SYSTEM_RE.test(text ?? "")) return;

      let type = "text", content = text, mediaUrl;

      // ── Media (only when there is NO text) ──────────────────────────
      // Prevents emoji/reaction <img> tags inside text bubbles from being
      // mistaken for actual image messages.
      if (!text) {
        const video = item.querySelector("video[src]");
        // Target only Zalo photo/sticker containers, not inline emoji images
        const photoImg = item.querySelector(
          "[class*='image-content'] img, [class*='photo'] img, " +
          "[class*='media-message'] img, [class*='sticker'] img, " +
          "[class*='image-message'] img"
        );
        if (video)         { type = "video";   mediaUrl = video.src; }
        else if (photoImg) { type = "image";   mediaUrl = photoImg.src || photoImg.dataset.src; }
        else               { type = "unknown"; content = "[Media]"; }
      }

      if (!content && !mediaUrl) return;

      const key = `${isSent}|${(content || mediaUrl || "").slice(0, 80)}`;
      if (seen.has(key)) return;
      seen.add(key);

      results.push({
        id: `dom-${index}-${Date.now()}`,
        sender, type, content, mediaUrl,
      });
    });

    return results;
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PLATFORM DETECTION
// ═══════════════════════════════════════════════════════════════════════════

const ADAPTERS = [InstagramAdapter, ZaloAdapter];

function detectAdapter() {
  return ADAPTERS.find((a) => a.detect()) ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE ENGINE
// ═══════════════════════════════════════════════════════════════════════════

function createApiExtractor(adapter) {
  const collected = new Map();

  function onResponse(event) {
    const { url, body } = event.detail ?? {};
    if (!body || !adapter.apiPatterns.some((p) => p.test(url ?? ""))) return;

    const msgs = adapter.parseApiResponse(url, body);
    if (!msgs) return;

    let newCount = 0;
    for (const m of msgs) {
      if (!collected.has(m.id)) newCount++;
      collected.set(m.id, m);
    }
    if (newCount > 0) log(`API: +${newCount} msgs (total ${collected.size})`);
  }

  return {
    start()  { window.addEventListener("__chat_exporter_response__", onResponse); },
    stop()   { window.removeEventListener("__chat_exporter_response__", onResponse); },
    getMessages() {
      return [...collected.values()].sort((a, b) => {
        if (!a.timestamp && !b.timestamp) return 0;
        if (!a.timestamp) return 1;
        if (!b.timestamp) return -1;
        return a.timestamp.localeCompare(b.timestamp);
      });
    },
    getCount() { return collected.size; },
  };
}

function deduplicateMessages(messages) {
  const seen = new Set();
  return messages.filter((m) => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
}

// ─── Exporters ────────────────────────────────────────────────────────────────

function toJson(messages) { return JSON.stringify(messages, null, 2); }

function toMarkdown(messages) {
  function fmt(ts) {
    if (!ts) return "";
    try {
      const d = new Date(ts);
      const p = (n) => String(n).padStart(2, "0");
      return `[${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}]`;
    } catch { return `[${ts}]`; }
  }
  const lines = ["# Chat Export", ""];
  for (const m of messages) {
    if (m.timestamp) lines.push(fmt(m.timestamp));
    lines.push(`**${m.sender}:**`);
    switch (m.type) {
      case "text": case "emoji": if (m.content) lines.push(m.content); break;
      case "image":      lines.push("[Ảnh]");      if (m.mediaUrl) lines.push(`URL: ${m.mediaUrl}`); break;
      case "video":      lines.push("[Video]");     if (m.mediaUrl) lines.push(`URL: ${m.mediaUrl}`); break;
      case "reel":       lines.push("[Reel]");      if (m.content) lines.push(m.content); if (m.mediaUrl) lines.push(`URL: ${m.mediaUrl}`); break;
      case "story_share":lines.push("[Story]");     if (m.mediaUrl) lines.push(`URL: ${m.mediaUrl}`); break;
      case "post_share": lines.push("[Bài đăng]");  if (m.mediaUrl) lines.push(`URL: ${m.mediaUrl}`); break;
      case "sticker":    lines.push("[Sticker]");   if (m.mediaUrl) lines.push(`URL: ${m.mediaUrl}`); break;
      default:           lines.push("[Không rõ loại]"); if (m.content) lines.push(m.content);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function buildStats(messages) {
  const s = { text: 0, image: 0, video: 0, sticker: 0, other: 0 };
  for (const m of messages) {
    if      (m.type === "text" || m.type === "emoji")  s.text++;
    else if (m.type === "image")                       s.image++;
    else if (m.type === "video" || m.type === "reel")  s.video++;
    else if (m.type === "sticker")                     s.sticker++;
    else                                               s.other++;
  }
  return s;
}

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════════════

async function runCrawl(adapter, config, onProgress) {
  onProgress({ phase: "init", text: "Đang khởi động..." });

  const participants = adapter.detectParticipants();
  onProgress({ phase: "init", text: `Cuộc trò chuyện: ${participants.me ?? "?"} ↔ ${participants.other}` });

  const apiExtractor = createApiExtractor(adapter);
  apiExtractor.start();

  const batches = [];
  const globalSeen = new Set();

  function addBatch(batch) {
    const newOnes = batch.filter((m) => !globalSeen.has(messageKey(m)));
    batch.forEach((m) => globalSeen.add(messageKey(m)));
    if (newOnes.length > 0 || batches.length === 0) batches.push(batch);
    return newOnes.length;
  }

  const container = adapter.findScrollContainer();
  if (!container) onProgress({ phase: "warn", text: "Không tìm thấy khung chat. Hãy mở đúng cuộc trò chuyện." });

  const initial = container ? adapter.extractFromDom(participants, container) : [];
  addBatch(initial);
  onProgress({ phase: "extract", text: `Lần đầu: ${initial.length} tin nhắn`, count: initial.length });

  if (container) {
    let stableRounds = 0;
    let totalDom = initial.length;

    while (stableRounds < config.maxScrollRetries) {
      // Use adapter-specific scroll if defined (e.g. Zalo uses WheelEvent),
      // otherwise fall back to direct scrollTop manipulation.
      if (typeof adapter.scrollUp === "function") {
        adapter.scrollUp(container);
      } else {
        container.scrollTop -= 6400;
      }
      await sleep(config.scrollTimeoutMs);

      const batch = adapter.extractFromDom(participants, container);
      const newCount = addBatch(batch);
      totalDom += newCount;

      const displayed = Math.max(totalDom, apiExtractor.getCount());

      if (newCount > 0) {
        stableRounds = 0;
        onProgress({ phase: "scroll", text: `Đang tải thêm... (+${newCount})`, count: displayed });
      } else {
        stableRounds++;
        const pct = Math.round((stableRounds / config.maxScrollRetries) * 100);
        onProgress({ phase: "scroll", text: `Không có tin nhắn mới (${stableRounds}/${config.maxScrollRetries})`, count: displayed, progress: pct });
      }
    }
  }

  apiExtractor.stop();
  const apiMessages = apiExtractor.getMessages();

  const chronoSeen = new Set();
  const chronoMessages = [];
  for (let i = batches.length - 1; i >= 0; i--) {
    for (const m of batches[i]) {
      const k = messageKey(m);
      if (!chronoSeen.has(k)) { chronoSeen.add(k); chronoMessages.push(m); }
    }
  }

  let finalMessages = chronoMessages;
  if (apiMessages.length > 0) {
    onProgress({ phase: "merge", text: `Gộp ${apiMessages.length} tin nhắn từ API...` });
    finalMessages = deduplicateMessages([...apiMessages, ...chronoMessages]);
  }

  onProgress({ phase: "done", text: `Hoàn tất: ${finalMessages.length} tin nhắn`, count: finalMessages.length, progress: 100 });
  return { messages: finalMessages, participants, stats: buildStats(finalMessages) };
}

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE ROUTER
// ═══════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "PING") {
    const adapter = detectAdapter();
    sendResponse({ ok: true, platform: adapter?.name ?? null });
    return;
  }

  if (message.type === "START_CRAWL") {
    const adapter = detectAdapter();
    if (!adapter) { sendResponse({ ok: false, error: "Trang này không được hỗ trợ" }); return; }

    const config = {
      scrollTimeoutMs: message.scrollTimeoutMs ?? 3000,
      maxScrollRetries: message.maxScrollRetries ?? 5,
    };

    sendResponse({ ok: true });

    runCrawl(adapter, config, (progress) => {
      chrome.runtime.sendMessage({ type: "PROGRESS", ...progress }).catch(() => {});
    }).then(({ messages, participants, stats }) => {
      chrome.runtime.sendMessage({
        type: "CRAWL_DONE",
        platform: adapter.name,
        count: messages.length,
        participants, stats,
        jsonContent: toJson(messages),
        mdContent: toMarkdown(messages),
      });
    }).catch((err) => {
      log("Error:", err);
      chrome.runtime.sendMessage({ type: "CRAWL_ERROR", error: String(err) });
    });

    return true;
  }
});

log("Ready —", detectAdapter()?.name ?? "unsupported page");
