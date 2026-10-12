"use client";

/** Longest side of an uploaded question image (the projector shows it at ~20rem). */
const MAX_SIDE = 1600;

/**
 * Shrinks a picture the quizmaster picked to at most 1600 px on its longest side
 * and re-encodes it (WebP, or JPEG where WebP isn't supported). Also turns SVG,
 * GIF etc. into a plain bitmap, so nothing executable is ever uploaded.
 */
export async function shrinkImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("That isn't an image. Pick a JPEG, PNG or WebP.");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode().catch(() => {
      throw new Error("Couldn't read that image. Try a JPEG or PNG.");
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't resize images.");
    // Transparent PNGs get the projector's panel colour behind them, not black.
    ctx.fillStyle = "#0b1114";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const encode = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.85));
    const blob = (await encode("image/webp")) ?? (await encode("image/jpeg"));
    if (!blob) throw new Error("Couldn't prepare the image.");
    // Some browsers silently fall back to PNG for WebP; that's fine, the server accepts it.
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Saves text as a file download (CSV/JSON exports, the template). */
export function downloadText(filename: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
