let button;
let targetImage;

function ensureButton() {
  if (button) return button;
  button = document.createElement("button");
  button.className = "character-asset-send";
  button.textContent = "Send to Character-Asset";
  button.hidden = true;
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!targetImage) return;
    const old = button.textContent;
    button.textContent = "Sending…";
    button.disabled = true;
    try {
      const imageDataUrl = await imageToDataUrl(targetImage);
      const response = await chrome.runtime.sendMessage({ type: "send-image", imageDataUrl });
      if (!response?.ok) throw new Error(response?.error || "Send failed");
      const handoff = response.result?.handoff;
      button.textContent = handoff?.next_direction ? `Sent ✓ · next ${handoff.next_direction}` : "Handoff complete ✓";
    } catch (error) {
      button.textContent = `Error: ${error.message}`;
    } finally {
      window.setTimeout(() => {
        button.textContent = old;
        button.disabled = false;
        button.hidden = true;
      }, 2200);
    }
  });
  document.documentElement.appendChild(button);
  return button;
}

async function imageToDataUrl(img) {
  const src = img.currentSrc || img.src;
  if (!src) throw new Error("Image has no source");
  const response = await fetch(src, { credentials: "include" });
  if (!response.ok) throw new Error(`Could not read image (HTTP ${response.status})`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("Selected resource is not an image");
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not encode image"));
    reader.readAsDataURL(blob);
  });
}

document.addEventListener("mouseover", (event) => {
  const img = event.target instanceof HTMLImageElement ? event.target : null;
  if (!img || Math.max(img.naturalWidth, img.naturalHeight) < 384) return;
  targetImage = img;
  const rect = img.getBoundingClientRect();
  const send = ensureButton();
  send.style.left = `${Math.max(8, rect.right - 190 + window.scrollX)}px`;
  send.style.top = `${Math.max(8, rect.top + 10 + window.scrollY)}px`;
  send.hidden = false;
}, true);

document.addEventListener("scroll", () => { if (button) button.hidden = true; }, true);
