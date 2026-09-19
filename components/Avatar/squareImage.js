"use client";

/**
 * Square, shrink and re-encode a picture before it is uploaded.
 *
 * An avatar is rendered at 32-64px in the sidebar and 64px on the profile card.
 * A phone photograph is 4000px wide and several megabytes, and uploading it
 * whole means the company pays to store it and every page load pays to fetch
 * it. Doing this in the browser means the big file never leaves the device.
 *
 * Centre-cropped rather than offering a cropper: the interesting part of a
 * portrait is the middle, the control is one file picker instead of a modal,
 * and the shape is decided here rather than left to CSS to fake per surface.
 *
 * Falls back to the original file if anything goes wrong — the server enforces
 * the type and size limits either way, so the worst case is a refused upload
 * with a clear message rather than a broken one.
 */

const SIZE = 512;
const QUALITY = 0.85;

export async function squareImage(file) {
  if (typeof window === "undefined" || !file) return file;

  try {
    const bitmap = await loadBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, SIZE, SIZE);
    bitmap.close?.();

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY)
    );
    if (!blob) return file;

    return new File([blob], renameToJpg(file.name), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch (error) {
    console.log("Could not square the image:", error?.message);
    return file;
  }
}

/**
 * createImageBitmap is the fast path and handles EXIF orientation; the <img>
 * route is there for browsers that do not have it.
 */
async function loadBitmap(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not read that image"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function renameToJpg(name) {
  const base = String(name || "avatar").replace(/\.[^.]+$/, "");
  return `${base || "avatar"}.jpg`;
}
