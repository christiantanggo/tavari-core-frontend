import { supabase } from '../supabaseClient';
import { extractTextFromPdfFile, renderPdfFirstPageToImage } from './invoicePdfText';

const VISION_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
const MAX_PAGES = 4;

/**
 * Render up to MAX_PAGES of a PDF to PNG data URLs for vision OCR.
 */
async function renderPdfPagesToImages(arrayBuffer) {
  if (typeof document === 'undefined' || !document.createElement) return [];
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdfjsWorker = (await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url')).default;
    if (typeof window !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
    }
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, verbosity: 0 }).promise;
    const pageCount = Math.min(pdf.numPages || 0, MAX_PAGES);
    const images = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const scale = 1.6;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const renderTask = page.render({ canvasContext: ctx, viewport });
      await (renderTask.promise ?? renderTask);
      const dataUrl = canvas.toDataURL('image/png');
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      if (base64) images.push({ image_base64: base64, mime_type: 'image/png' });
    }
    return images;
  } catch (error) {
    console.warn('[camperRegistrationOcr] renderPdfPagesToImages failed:', error);
    return [];
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64 || '');
    };
    reader.onerror = () => reject(new Error('Could not read file for OCR'));
    reader.readAsDataURL(file);
  });
}

/**
 * Prepare a scanned camp registration file for OCR and call the edge function.
 * Returns normalized extraction payload (form_data, identity fields, warnings).
 */
export async function extractCamperRegistrationFromFile(businessId, file) {
  if (!businessId) throw new Error('Business ID is required');
  if (!file) throw new Error('A form file is required');

  const mime = String(file.type || '').toLowerCase().split(';')[0].trim();
  let formText = '';
  let images = [];

  if (mime === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
    formText = await extractTextFromPdfFile(file);
    const buffer = await file.arrayBuffer();
    images = await renderPdfPagesToImages(buffer);
    if (images.length === 0) {
      const first = await renderPdfFirstPageToImage(buffer);
      if (first) {
        const base64 = first.includes(',') ? first.split(',')[1] : first;
        if (base64) images = [{ image_base64: base64, mime_type: 'image/png' }];
      }
    }
  } else if (VISION_MIME.has(mime)) {
    const base64 = await fileToBase64(file);
    if (!base64) throw new Error('Could not read image for OCR');
    images = [{ image_base64: base64, mime_type: mime === 'image/jpg' ? 'image/jpeg' : mime }];
  } else if (/^image\//.test(mime)) {
    // HEIC/other: try reading anyway; edge function may reject unsupported types
    const base64 = await fileToBase64(file);
    if (!base64) throw new Error('Unsupported image type for OCR. Use PDF, JPG, or PNG.');
    images = [{ image_base64: base64, mime_type: 'image/jpeg' }];
  } else {
    throw new Error('Upload a PDF or image (JPG/PNG) to digitize the form.');
  }

  if (!formText && images.length === 0) {
    throw new Error('Could not read this file for OCR. Try a clearer photo or PDF.');
  }

  const { data, error } = await supabase.functions.invoke('camper-registration-extract', {
    body: {
      business_id: businessId,
      form_text: formText || undefined,
      images: images.length ? images : undefined,
    },
  });

  if (error) {
    throw new Error(error.message || 'OCR request failed');
  }
  if (data?.error) {
    throw new Error(data.error);
  }
  if (!data?.ok && !data?.form_data) {
    throw new Error('OCR returned no form data');
  }

  return data;
}
