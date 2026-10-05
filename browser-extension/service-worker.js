const DEFAULT_BASE = "http://127.0.0.1:8787";

async function baseUrl() {
  const saved = await chrome.storage.local.get("characterAssetBase");
  return saved.characterAssetBase || DEFAULT_BASE;
}

async function jsonFetch(path, options = {}) {
  const base = await baseUrl();
  const response = await fetch(base + path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || `Character-Asset HTTP ${response.status}`);
  return data;
}

async function activeHandoff() {
  return (await jsonFetch("/companion/handoffs/active")).handoff;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === "companion-state") {
      sendResponse({ ok: true, handoff: await activeHandoff(), base: await baseUrl() });
      return;
    }
    if (message?.type === "set-base") {
      await chrome.storage.local.set({ characterAssetBase: message.base.replace(/\/$/, "") });
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "send-image") {
      const handoff = await activeHandoff();
      if (!handoff) throw new Error("No active Character-Asset image handoff.");
      const direction = handoff.next_direction;
      if (!direction) throw new Error("The active handoff is already complete.");
      const result = await jsonFetch(
        `/companion/handoffs/${encodeURIComponent(handoff.handoff_id)}/images/${encodeURIComponent(direction)}`,
        { method: "POST", body: JSON.stringify({ image_data_url: message.imageDataUrl }) }
      );
      sendResponse({ ok: true, result });
      return;
    }
    sendResponse({ ok: false, error: "Unknown companion message" });
  })().catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
