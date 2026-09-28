import jsQR from "jsqr";

/**
 * Reads the mini QR printed on a Thai bank transfer slip and returns its raw
 * text, or null when the image has none or it cannot be read.
 *
 * This only helps the server spot a slip that was already used: the server
 * checks the payload's CRC and decides whether it counts. A slip that cannot
 * be read still uploads, and the trainer checks it with extra care.
 */
export async function readSlipQr(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return null;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    // Phone screenshots are large; the QR is small. Try the full image first,
    // then a reduced one, which also helps jsQR with noisy photos.
    for (const scale of scalesFor(bitmap.width, bitmap.height)) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(bitmap, 0, 0, width, height);
      const code = jsQR(context.getImageData(0, 0, width, height).data, width, height, { inversionAttempts: "attemptBoth" });
      if (code?.data) return code.data;
    }
    return null;
  } finally {
    bitmap.close();
  }
}

function scalesFor(width: number, height: number): number[] {
  const longest = Math.max(width, height);
  // Cap the first pass at 2,000px so a 12-megapixel photo does not stall the tab.
  const first = longest > 2000 ? 2000 / longest : 1;
  return first > 0.6 ? [first, first * 0.5] : [first];
}
