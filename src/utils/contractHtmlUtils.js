/**
 * Helpers for contract HTML display, PDF generation, and signature embedding.
 */

import { getContractPdfBlob } from './contractPdf';

const MIN_VALID_CONTRACT_HTML_LENGTH = 500;

/** Use only <body> contents when rendering inside React (nested <html> in a div shows blank). */
export const extractBodyHtml = (html) => {
  if (!html || typeof html !== 'string') return '';
  const trimmed = html.trim();
  const bodyMatch = trimmed.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) return bodyMatch[1].trim();
  return trimmed
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .trim();
};

export const contractHtmlNeedsRegeneration = (html, contractData) => {
  if (!html || html.length < MIN_VALID_CONTRACT_HTML_LENGTH) return true;
  const hasTerms =
    html.includes('Contract Terms') || html.includes('<h2>Contract Terms</h2>');
  const sectionMatches = html.match(/<h3>.*?<\/h3>/gi);
  const storedTermsCount = contractData?.selectedTerms?.length || 0;
  const htmlSectionCount = sectionMatches?.length || 0;
  if (!hasTerms && contractData) return true;
  if (storedTermsCount > 0 && htmlSectionCount < Math.min(storedTermsCount, 3)) return true;
  return false;
};

/** Remove empty signature lines only — do not strip arbitrary layout divs. */
export const removeSignaturePlaceholders = (html) => {
  if (!html) return html;
  return html.replace(
    /<div style="border-bottom: 1px solid #000; height: 40px[^"]*"><\/div>/gi,
    ''
  );
};

export const embedEmployeeSignature = (contractHTML, signatureRecord, signerName, signatureDate) => {
  let html = contractHTML || '';
  const employeeSignatureSection =
    /(<div style="margin-top: [0-9]+px;">[\s\S]*?<p style="margin-bottom: 15px;"><strong>For the Employee:<\/strong><\/p>[\s\S]*?<div style="margin-bottom: 25px;">[\s\S]*?<p style="margin-bottom: 4px; font-size: [0-9]+px;">Employee Signature:<\/p>)([\s\S]*?)(<div style="border-bottom: 1px solid #000; height: 40px; margin-bottom: 15px;"><\/div>)([\s\S]*?<p style="margin-bottom: 4px; font-size: [0-9]+px;">Date:<\/p>)([\s\S]*?<div style="border-bottom: 1px solid #000; height: 40px;"><\/div>)([\s\S]*?<\/div>[\s\S]*?<\/div>[\s\S]*?<\/div>)/;

  const signatureReplacement = `$1$2<img src="${signatureRecord.signatureData}" alt="Signature" style="max-width: 300px; height: auto; border: 1px solid #ccc; padding: 10px; background: white; margin-bottom: 10px; display: block;" /><p style="margin-bottom: 4px; font-size: 11px;"><strong>${signerName}</strong></p>$4<p style="margin-top: 8px; font-size: 11px;">${signatureDate}</p>$6`;

  if (employeeSignatureSection.test(html)) {
    html = html.replace(employeeSignatureSection, signatureReplacement);
  } else {
    const simplePattern =
      /(<p style="margin-bottom: 4px; font-size: [0-9]+px;">Employee Signature:<\/p>)([\s\S]*?)(<div style="border-bottom: 1px solid #000; height: 40px; margin-bottom: 15px;"><\/div>)([\s\S]*?<p style="margin-bottom: 4px; font-size: [0-9]+px;">Date:<\/p>)([\s\S]*?<div style="border-bottom: 1px solid #000; height: 40px;"><\/div>)/;
    if (simplePattern.test(html)) {
      html = html.replace(
        simplePattern,
        `$1<img src="${signatureRecord.signatureData}" alt="Signature" style="max-width: 300px; height: auto; border: 1px solid #ccc; padding: 10px; background: white; margin-bottom: 10px; display: block;" /><p style="margin-bottom: 4px; font-size: 11px;"><strong>${signerName}</strong></p>$4<p style="margin-top: 8px; font-size: 11px;">${signatureDate}</p>`
      );
    } else {
      html = html.replace(
        '</body>',
        `<div style="margin-top: 20px;"><p><strong>Employee Signature:</strong></p><img src="${signatureRecord.signatureData}" alt="Signature" style="max-width: 300px; height: auto; border: 1px solid #ccc; padding: 10px; background: white;" /><p><strong>${signerName}</strong></p><p>Signed: ${signatureDate}</p></div></body>`
      );
    }
  }

  return removeSignaturePlaceholders(html);
};

export const embedAuthorizedRepSignature = (
  contractHTML,
  signatureRecord,
  signerName,
  signatureDate
) => {
  let html = contractHTML || '';
  const authRepSignatureSection =
    /(<p style="margin-bottom: 20px;">By its authorized representative:<\/p>[\s\S]*?<div style="margin-bottom: 25px;">[\s\S]*?<p style="margin-bottom: 4px; font-size: [0-9]+px;">Authorized Representative<\/p>)([\s\S]*?)(<div style="border-bottom: 1px solid #000; height: 40px; margin-bottom: 15px;"><\/div>)([\s\S]*?<p style="margin-bottom: 4px; font-size: [0-9]+px;">Date:<\/p>)([\s\S]*?<div style="border-bottom: 1px solid #000; height: 40px;"><\/div>)/;

  const signatureReplacement = `$1$2<img src="${signatureRecord.signatureData}" alt="Signature" style="max-width: 300px; height: auto; border: 1px solid #ccc; padding: 10px; background: white; margin-bottom: 10px; display: block;" /><p style="margin-bottom: 4px; font-size: 11px;"><strong>${signerName}</strong></p>$4<p style="margin-top: 8px; font-size: 11px;">${signatureDate}</p>`;

  if (authRepSignatureSection.test(html)) {
    html = html.replace(authRepSignatureSection, signatureReplacement);
  } else {
    const simplePattern =
      /(<p style="margin-bottom: 4px; font-size: [0-9]+px;">Authorized Representative<\/p>)([\s\S]*?)(<div style="border-bottom: 1px solid #000; height: 40px; margin-bottom: 15px;"><\/div>)([\s\S]*?<p style="margin-bottom: 4px; font-size: [0-9]+px;">Date:<\/p>)([\s\S]*?<div style="border-bottom: 1px solid #000; height: 40px;"><\/div>)/;
    if (simplePattern.test(html)) {
      html = html.replace(
        simplePattern,
        `$1<img src="${signatureRecord.signatureData}" alt="Signature" style="max-width: 300px; height: auto; border: 1px solid #ccc; padding: 10px; background: white; margin-bottom: 10px; display: block;" /><p style="margin-bottom: 4px; font-size: 11px;"><strong>${signerName}</strong></p>$4<p style="margin-top: 8px; font-size: 11px;">${signatureDate}</p>`
      );
    } else {
      html = html.replace(
        '</body>',
        `<div style="margin-top: 20px;"><p><strong>Authorized Representative Signature:</strong></p><img src="${signatureRecord.signatureData}" alt="Signature" style="max-width: 300px; height: auto; border: 1px solid #ccc; padding: 10px; background: white;" /><p><strong>${signerName}</strong></p><p>Signed: ${signatureDate}</p></div></body>`
      );
    }
  }

  return removeSignaturePlaceholders(html);
};

/** Build a DOM node suitable for html2pdf from full contract HTML. */
export const createPrintableElement = (contractHTML) => {
  const fragment = extractBodyHtml(contractHTML);
  const tempDiv = document.createElement('div');
  tempDiv.style.position = 'absolute';
  tempDiv.style.left = '-9999px';
  tempDiv.style.top = '0';
  tempDiv.style.width = '8.5in';
  tempDiv.style.backgroundColor = 'white';
  tempDiv.style.color = '#000';
  tempDiv.style.fontFamily = 'Arial, sans-serif';
  tempDiv.innerHTML = fragment;
  document.body.appendChild(tempDiv);
  return tempDiv;
};

export const waitForImages = async (rootEl, timeoutMs = 8000) => {
  const images = rootEl.querySelectorAll('img');
  await Promise.all(
    Array.from(images).map(
      (img, index) =>
        new Promise((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          const done = () => resolve();
          img.onload = done;
          img.onerror = done;
          setTimeout(done, timeoutMs / Math.max(images.length, 1));
        })
    )
  );
};

export const generatePdfBlobFromHtml = async (contractHTML, filename = 'contract.pdf') =>
  getContractPdfBlob(contractHTML, { filename });

export const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result || '').split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

export const blobToUint8Array = async (blob) => {
  const base64 = await blobToBase64(blob);
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
};

/** PostgREST returns bytea as \\x hex, base64, Uint8Array, or numeric-key objects. */
export const decodeByteaToUint8Array = (value) => {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }

  if (typeof value === 'object') {
    if (Array.isArray(value.data)) {
      return Uint8Array.from(value.data);
    }
    const keys = Object.keys(value)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b));
    if (keys.length > 0) {
      return Uint8Array.from(keys.map((key) => value[key]));
    }
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const hexBody = trimmed.startsWith('\\x')
      ? trimmed.slice(2)
      : trimmed.startsWith('0x')
        ? trimmed.slice(2)
        : null;

    if (hexBody && /^[0-9a-fA-F]+$/.test(hexBody) && hexBody.length % 2 === 0) {
      const bytes = new Uint8Array(hexBody.length / 2);
      for (let i = 0; i < hexBody.length; i += 2) {
        bytes[i / 2] = parseInt(hexBody.slice(i, i + 2), 16);
      }
      return bytes;
    }

    try {
      const normalized = trimmed.replace(/^data:application\/pdf;base64,/, '');
      const binary = atob(normalized);
      return Uint8Array.from(binary, (char) => char.charCodeAt(0));
    } catch {
      return null;
    }
  }

  return null;
};

export const isValidPdfBytes = (bytes) => {
  if (!bytes || bytes.length < 4) return false;
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
};

export const byteaToPdfBlob = (value) => {
  const bytes = decodeByteaToUint8Array(value);
  if (!bytes || !isValidPdfBytes(bytes)) return null;
  return new Blob([bytes], { type: 'application/pdf' });
};

export { triggerBlobDownload } from './htmlDocumentPdf';

/**
 * Resolve a downloadable contract PDF: HTML render → storage file → stored bytea.
 */
export const resolveContractPdfBlob = async ({
  contract,
  supabaseClient,
  resolveHtml,
}) => {
  let html = contract?.contract_html || '';
  if (resolveHtml) {
    html = (await resolveHtml(contract)) || html;
  }

  if (html) {
    try {
      return await getContractPdfBlob(html, { filename: 'contract.pdf' });
    } catch (renderError) {
      console.warn('[ContractPdf] HTML render failed, trying stored files:', renderError.message);
    }
  }

  const storagePath = contract?.storage_path || contract?.pdf_url;
  if (storagePath && supabaseClient) {
    const { data, error } = await supabaseClient.storage
      .from('hr-documents')
      .download(storagePath);
    if (!error && data?.size > 0) {
      const header = new Uint8Array(await data.slice(0, 4).arrayBuffer());
      if (isValidPdfBytes(header)) return data;
    }
  }

  if (contract?.signed_pdf_data) {
    const storedBlob = byteaToPdfBlob(contract.signed_pdf_data);
    if (storedBlob) return storedBlob;
  }

  return null;
};

/**
 * Regenerate contract HTML from contract_data when missing or incomplete.
 * Mirrors ContractSignScreen load path.
 */
export const regenerateContractHtml = async (supabase, contractRow) => {
  if (!contractRow?.contract_data) return contractRow?.contract_html || '';

  let contractDataWithSections = { ...contractRow.contract_data };

  if (
    !contractDataWithSections.selectedTerms ||
    contractDataWithSections.selectedTerms.length === 0
  ) {
    const { data: sectionsData } = await supabase
      .from('contract_sections')
      .select('id, contract_id, title, content, section_order, placeholder_tags')
      .eq('contract_id', contractRow.id)
      .order('section_order', { ascending: true })
      .limit(100);

    if (sectionsData?.length) {
      contractDataWithSections.selectedTerms = sectionsData.map((section) => ({
        id: section.id,
        title: section.title || '',
        content: section.content || '',
        placeholder_tags: section.placeholder_tags || [],
      }));
    }
  }

  let businessData = null;
  if (contractRow.business_id) {
    const { data: bizData } = await supabase
      .from('businesses')
      .select('id, name, business_email, phone, address, business_settings, timezone')
      .eq('id', contractRow.business_id)
      .maybeSingle();
    businessData = bizData;
  }

  const contractManagementModule = await import('../screens/HR/ContractManagement');
  if (!contractManagementModule.generateContractPDF) {
    throw new Error('generateContractPDF not available');
  }

  return contractManagementModule.generateContractPDF({
    ...contractDataWithSections,
    businessData: businessData || {},
  });
};

export const ensureContractHtml = async (supabase, contractRow) => {
  let html = contractRow?.contract_html || '';
  if (!contractHtmlNeedsRegeneration(html, contractRow?.contract_data)) {
    return html;
  }
  const regenerated = await regenerateContractHtml(supabase, contractRow);
  if (regenerated && regenerated.length >= MIN_VALID_CONTRACT_HTML_LENGTH) {
    await supabase
      .from('hr_contracts')
      .update({ contract_html: regenerated })
      .eq('id', contractRow.id);
    return regenerated;
  }
  return html || regenerated;
};
