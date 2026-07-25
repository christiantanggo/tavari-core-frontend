import { PDFDocument, StandardFonts } from "npm:pdf-lib@1.17.1";
import { normalizeEmailBodyForExtraction } from "./emailBodyNormalize.ts";

/** Helvetica StandardFonts only supports WinAnsi; strip/replace common Unicode from decoded HTML emails. */
function sanitizeLineForPdfDraw(line: string): string {
  return line
    .replace(/\u2007|\u2009|\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "")
    .trim();
}

function htmlToStructuredText(html: string): string {
  if (!html?.trim()) return "";
  let s = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(tr|p|div|li|h[1-6])/gi, "\n")
    .replace(/<\s*\/\s*(td|th)/gi, "\t")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/[ \t\f\v\u2007\u2009\u00a0]+/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s.split(/\n/).map((line) => line.trim()).filter(Boolean).join("\n");
}

/** Build a readable PDF from email body (decodes base64 iPhone/Outlook forwards). */
export async function emailBodyToPdf(
  bodyText: string | null,
  bodyHtml: string | null,
): Promise<Uint8Array | null> {
  const text = normalizeEmailBodyForExtraction(bodyText, bodyHtml);
  if (!text.trim()) return null;

  try {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontSize = 10;
    const lineHeight = fontSize * 1.35;
    const maxLines = 220;
    const lines = text.split(/\n/).slice(0, maxLines).flatMap((line) => {
      const cleaned = sanitizeLineForPdfDraw(line.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ""));
      if (!cleaned) return [];
      if (/^[A-Za-z0-9+/=]{80,}$/.test(cleaned.replace(/\s/g, ""))) return [];
      const chunks: string[] = [];
      for (let i = 0; i < cleaned.length; i += 95) chunks.push(cleaned.slice(i, i + 95));
      return chunks;
    });

    if (lines.length === 0) return null;

    let page = doc.addPage([595, 842]);
    let y = 822;
    for (const line of lines) {
      if (y < 48) {
        page = doc.addPage([595, 842]);
        y = 822;
      }
      try {
        page.drawText(line, { x: 44, y, size: fontSize, font });
      } catch {
        const fallback = line.replace(/[^\x20-\x7e]/g, "");
        if (fallback) page.drawText(fallback, { x: 44, y, size: fontSize, font });
      }
      y -= lineHeight;
    }
    return await doc.save();
  } catch (e) {
    console.error("emailBodyToPdf failed:", e);
    return null;
  }
}

export { htmlToStructuredText };
