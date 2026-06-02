/**
 * Runs in the page's MAIN world — patches fetch / XHR to intercept API responses.
 * Emits a CustomEvent for every successful JSON response matching known chat APIs.
 * Platform-specific parsing happens in content.js.
 */
(function () {
  if (window.__chatExporterInjected) return;
  window.__chatExporterInjected = true;

  const API_PATTERNS = [
    // Instagram DM
    /api\/v1\/direct_v2\/threads/,
    /graphql\/query/,
    /api\/v1\/direct_v2\/inbox/,
    // Zalo
    /zalo\.me\/api/,
    /getmsglist/i,
    /getconvinfo/i,
    /conv\/detail/i,
    /chat\/hist/i,
    /sendmsg/i,
  ];

  function shouldIntercept(url) {
    if (!url) return false;
    return API_PATTERNS.some((p) => p.test(url));
  }

  function emit(url, body) {
    window.dispatchEvent(
      new CustomEvent("__chat_exporter_response__", { detail: { url, body } })
    );
  }

  // ── Patch fetch ────────────────────────────────────────────────────────────
  const _fetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await _fetch.apply(this, args);
    const url =
      typeof args[0] === "string"
        ? args[0]
        : args[0] instanceof URL
        ? args[0].href
        : args[0]?.url ?? "";

    if (shouldIntercept(url) && response.status >= 200 && response.status < 300) {
      try {
        response.clone().json().then((body) => emit(url, body)).catch(() => {});
      } catch {}
    }
    return response;
  };

  // ── Patch XMLHttpRequest ───────────────────────────────────────────────────
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__ceUrl = typeof url === "string" ? url : String(url);
    return _open.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    const url = this.__ceUrl ?? "";
    if (shouldIntercept(url)) {
      this.addEventListener("load", () => {
        if (this.status >= 200 && this.status < 300) {
          try {
            emit(url, JSON.parse(this.responseText));
          } catch {}
        }
      });
    }
    return _send.apply(this, args);
  };

  console.debug("[ChatExporter] API interceptor installed");
})();
