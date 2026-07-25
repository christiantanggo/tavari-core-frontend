import { extractText } from "npm:unpdf@1.6.2";

/** Extract plain text from a PDF in edge/serverless runtimes (unpdf + pdf.js serverless build). */
export async function extractTextFromPdfBytes(bytes: Uint8Array): Promise<string> {
  if (!bytes?.length) return "";
  try {
    const { text, totalPages } = await extractText(bytes, { mergePages: true });
    const merged = Array.isArray(text) ? text.join("\n\n") : String(text || "");
    if (merged.trim().length > 0) {
      console.log(`[pdfTextExtract] unpdf extracted ${merged.trim().length} chars from ${totalPages} page(s)`);
      return merged.trim();
    }
  } catch (e) {
    console.warn("[pdfTextExtract] unpdf failed, trying legacy pdfjs:", e);
  }

  try {
    const pdfjsLib = await import("npm:pdfjs-dist@2.16.105/legacy/build/pdf.mjs");
    const loadingTask = pdfjsLib.getDocument({
      data: bytes,
      disableFontFace: true,
      useSystemFonts: true,
      verbosity: 0,
    });
    const pdf = await loadingTask.promise;
    const pageTexts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      type Item = { str?: string; transform?: number[] };
      const items = (textContent.items as Item[]).filter((item) => item.str != null && item.str.trim() !== "");
      if (items.length === 0) continue;
      const lineTolerance = 3;
      const withPos = items.map((item) => ({
        str: (item.str ?? "").trim(),
        y: item.transform?.[5] ?? 0,
        x: item.transform?.[4] ?? 0,
      }));
      withPos.sort(
        (a, b) =>
          Math.round(b.y / lineTolerance) * lineTolerance - Math.round(a.y / lineTolerance) * lineTolerance ||
          a.x - b.x,
      );
      const lines: string[] = [];
      let lastY: number | null = null;
      let currentLine: string[] = [];
      for (const { str, y } of withPos) {
        const lineY = Math.round(y / lineTolerance) * lineTolerance;
        if (lastY !== null && Math.abs(lineY - lastY) > lineTolerance) {
          if (currentLine.length) lines.push(currentLine.join(" ").trim());
          currentLine = [];
        }
        currentLine.push(str);
        lastY = lineY;
      }
      if (currentLine.length) lines.push(currentLine.join(" ").trim());
      pageTexts.push(lines.join("\n"));
    }
    return pageTexts.join("\n\n").trim();
  } catch (e) {
    console.warn("[pdfTextExtract] legacy pdfjs failed:", e);
    return "";
  }
}

/** Render first embedded page image from a PDF for vision fallback (logos/banners only — not full page). */
export async function getFirstImageFromPdfBytes(bytes: Uint8Array): Promise<{ base64: string; mime: string } | null> {
  try {
    const pdfjsLib = await import("npm:pdfjs-dist@2.16.105/legacy/build/pdf.mjs");
    const pdf = await pdfjsLib.getDocument({ data: bytes, disableFontFace: true, verbosity: 0 }).promise;
    if (pdf.numPages < 1) return null;
    const page = await pdf.getPage(1);
    const opList = await page.getOperatorList();
    const fnArray = opList?.fnArray ?? [];
    const argsArray = opList?.argsArray ?? [];
    const paintImageOp = 85;
    const paintJpegOp = 82;
    let best: { base64: string; mime: string; pixels: number } | null = null;
    const pageAny = page as { objs?: { get: (id: string, cb: (v: unknown) => void) => void } };
    for (let i = 0; i < fnArray.length; i++) {
      const op = fnArray[i];
      if (op !== paintImageOp && op !== paintJpegOp) continue;
      const name = argsArray[i]?.[0];
      if (name == null) continue;
      const img = await new Promise<{ data?: Uint8Array; width?: number; height?: number } | null>((resolve) => {
        const t = setTimeout(() => resolve(null), 8000);
        if (!pageAny.objs?.get) {
          clearTimeout(t);
          resolve(null);
          return;
        }
        pageAny.objs.get(String(name), (v: unknown) => {
          clearTimeout(t);
          resolve(v as { data?: Uint8Array; width?: number; height?: number } | null);
        });
      });
      const d = img?.data;
      if (!d?.length) continue;
      const pixels = (img?.width ?? 0) * (img?.height ?? 0);
      if (pixels < 200_000) continue;
      const binary = d.length <= 8192
        ? String.fromCharCode.apply(null, Array.from(d))
        : Array.from({ length: Math.ceil(d.length / 8192) }, (_, j) =>
            String.fromCharCode.apply(null, Array.from(d.subarray(j * 8192, Math.min((j + 1) * 8192, d.length)))),
          ).join("");
      const candidate = {
        base64: btoa(binary),
        mime: op === paintJpegOp ? "image/jpeg" : "image/png",
        pixels,
      };
      if (!best || candidate.pixels > best.pixels) best = candidate;
    }
    return best ? { base64: best.base64, mime: best.mime } : null;
  } catch (e) {
    console.warn("[pdfTextExtract] first-image extraction failed:", e);
    return null;
  }
}
