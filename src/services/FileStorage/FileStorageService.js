// File Storage: uploads, categories, inbound approval, signed URLs, access log
import { supabase } from '../../supabaseClient';
import JSZip from 'jszip';

const BUCKET = 'business-files';

function extractOriginalFilenameFromNotes(notes) {
  if (!notes || typeof notes !== 'string') return null;
  const m = notes.match(/^Original filename:\s*(.+)$/i);
  return m ? m[1].trim() : null;
}

const BLOCKED_MIME_PREFIXES = ['application/x-msdownload', 'application/x-dosexec', 'application/x-msi'];
const BLOCKED_EXTENSIONS = /\.(exe|bat|cmd|scr|vbs|msi|dll|com)(\.|$)/i;

function assertSafeFile(file) {
  if (!file || !file.name) throw new Error('Invalid file');
  if (BLOCKED_EXTENSIONS.test(file.name)) throw new Error('This file type is not allowed');
  const t = (file.type || '').toLowerCase();
  if (BLOCKED_MIME_PREFIXES.some((p) => t.startsWith(p))) throw new Error('This file type is not allowed');
  if (file.size > 50 * 1024 * 1024) throw new Error('File must be 50 MB or smaller');
}

export async function ensureFileStorageDefaults(businessId) {
  if (!businessId) return;
  const { error } = await supabase.rpc('ensure_file_storage_defaults', {
    p_business_id: businessId,
  });
  if (error) console.warn('ensure_file_storage_defaults:', error.message);
}

export async function fetchSettings(businessId) {
  const { data, error } = await supabase
    .from('file_storage_settings')
    .select('*')
    .eq('business_id', businessId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateSettings(businessId, { inbox_local_part, inbox_domain }) {
  const { error } = await supabase
    .from('file_storage_settings')
    .update({
      inbox_local_part: (inbox_local_part || '').trim().toLowerCase(),
      inbox_domain: (inbox_domain || 'tavarios.ca').trim().toLowerCase(),
    })
    .eq('business_id', businessId);
  if (error) throw error;
}

export async function fetchCategories(businessId) {
  const { data, error } = await supabase
    .from('file_storage_categories')
    .select('*')
    .eq('business_id', businessId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createCategory(businessId, payload) {
  const { data, error } = await supabase
    .from('file_storage_categories')
    .insert({
      business_id: businessId,
      parent_id: payload.parent_id || null,
      name: payload.name,
      sort_order: payload.sort_order ?? 0,
      icon_key: payload.icon_key || null,
      color: payload.color || null,
      retention_years: payload.retention_years ?? null,
      show_document_start: payload.show_document_start !== false,
      show_document_end: payload.show_document_end !== false,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCategory(id, payload) {
  const { error } = await supabase
    .from('file_storage_categories')
    .update({
      name: payload.name,
      parent_id: payload.parent_id,
      sort_order: payload.sort_order,
      icon_key: payload.icon_key,
      color: payload.color,
      retention_years: payload.retention_years,
      show_document_start: payload.show_document_start,
      show_document_end: payload.show_document_end,
    })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteCategory(id) {
  const { error } = await supabase.from('file_storage_categories').delete().eq('id', id);
  if (error) throw error;
}

export async function fetchFiles(businessId, { categoryId = null, includeDeleted = false, includeRetentionHidden = false } = {}) {
  let q = supabase
    .from('file_storage_files')
    .select('*')
    .eq('business_id', businessId)
    .order('uploaded_at', { ascending: false });
  if (categoryId) q = q.eq('category_id', categoryId);
  if (!includeDeleted) q = q.is('deleted_at', null);
  if (!includeRetentionHidden) q = q.is('retention_soft_deleted_at', null);
  const { data: rows, error } = await q;
  if (error) throw error;
  const list = rows || [];

  const cats = await fetchCategories(businessId);
  const byId = Object.fromEntries(cats.map((c) => [c.id, c]));
  const paperCat = cats.find((c) => c.system_key === 'paper_waiver');

  const merged = list.map((r) => {
    const c = byId[r.category_id];
    return {
      ...r,
      file_storage_categories: c ? { name: c.name, system_key: c.system_key } : null,
    };
  });

  /** Paper waivers uploaded only via Waivers module (waiver_uploads + waivers bucket) have no file_storage_files row until bridged. */
  const linkedWaiverIds = new Set(merged.map((r) => r.waiver_upload_id).filter(Boolean));
  const includeLegacyPaper =
    !categoryId || (paperCat && categoryId === paperCat.id);

  let legacyRows = [];
  if (includeLegacyPaper) {
    const { data: waivers, error: wErr } = await supabase
      .from('waiver_uploads')
      .select('*')
      .eq('business_id', businessId)
      .eq('upload_type', 'paper_waiver')
      .order('uploaded_at', { ascending: false });

    if (wErr) {
      console.warn('fetchFiles: could not merge legacy paper waivers:', wErr.message);
    } else {
      legacyRows = (waivers || [])
        .filter((w) => !linkedWaiverIds.has(w.id))
        .map((w) => {
          const display =
            [w.first_name, w.last_name].filter(Boolean).join(' ').trim() ||
            extractOriginalFilenameFromNotes(w.notes) ||
            'Paper waiver';
          return {
            id: w.id,
            business_id: businessId,
            category_id: paperCat?.id ?? null,
            storage_bucket: 'waivers',
            file_path: w.file_path,
            original_filename: extractOriginalFilenameFromNotes(w.notes),
            mime_type: w.mime_type,
            file_size: w.file_size,
            display_name: display,
            document_date_start: w.waiver_filled_date,
            document_date_end: null,
            uploaded_at: w.uploaded_at,
            uploaded_by: w.uploaded_by,
            legal_hold: false,
            deleted_at: null,
            retention_soft_deleted_at: null,
            file_storage_categories: paperCat
              ? { name: paperCat.name, system_key: 'paper_waiver' }
              : { name: 'Paper waiver', system_key: 'paper_waiver' },
            waiver_upload_id: w.id,
            is_legacy_waiver_upload: true,
          };
        });
    }
  }

  const combined = [...legacyRows, ...merged];
  combined.sort((a, b) => {
    const ta = new Date(a.uploaded_at || 0).getTime();
    const tb = new Date(b.uploaded_at || 0).getTime();
    return tb - ta;
  });
  return combined;
}

export async function fetchInboundPending(businessId) {
  const { data, error } = await supabase
    .from('file_storage_inbound')
    .select('*')
    .eq('business_id', businessId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function logFileAccess(businessId, fileId, action, meta = {}) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from('file_storage_access_log').insert({
    business_id: businessId,
    file_id: fileId,
    user_id: user?.id || null,
    action,
    meta,
  });
}

export async function getSignedUrl(filePath, expiresSec = 3600, bucket = BUCKET) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(filePath, expiresSec);
  if (error) throw error;
  return data?.signedUrl;
}

/** Upload from app (auto-approved). Paper waiver category also writes waiver_uploads. */
export async function uploadFileFromApp(businessId, category, file, meta, waiverParticipant) {
  assertSafeFile(file);
  const isPaper = category?.system_key === 'paper_waiver';

  let waiverUploadId = null;
  let storagePath;
  let storageBucket = BUCKET;
  let mimeType = file.type || 'application/octet-stream';

  if (isPaper) {
    const filledDate =
      (waiverParticipant?.waiverFilledDate && String(waiverParticipant.waiverFilledDate).trim()) ||
      (meta?.document_date_start && String(meta.document_date_start).trim()) ||
      '';
    if (!waiverParticipant?.firstName || !waiverParticipant?.lastName || !filledDate) {
      throw new Error(
        'Paper waiver requires first name, last name, and a signed date (Waiver signed date or Doc start).'
      );
    }
    const WaiverStorageService = (await import('../Waivers/WaiverStorageService')).default;
    WaiverStorageService.setBusinessId(businessId);
    const rec = await WaiverStorageService.uploadPaperWaiver(file, {
      firstName: waiverParticipant.firstName,
      lastName: waiverParticipant.lastName,
      dateOfBirth: waiverParticipant.dateOfBirth || '',
      phoneNumber: waiverParticipant.phoneNumber || '',
      email: waiverParticipant.email || '',
      waiverFilledDate: filledDate,
    });
    waiverUploadId = rec?.id || null;
    storagePath = rec?.file_path;
    storageBucket = 'waivers';
    mimeType = file.type || rec?.mime_type || mimeType;
  } else {
    const seg = crypto.randomUUID();
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'upload';
    storagePath = `${businessId}/files/${category.id}/${seg}_${safe}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      contentType: mimeType,
      upsert: false,
    });
    if (upErr) throw upErr;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const anchor =
    meta.document_date_end || meta.document_date_start || new Date().toISOString().slice(0, 10);

  const row = {
    business_id: businessId,
    category_id: category.id,
    storage_bucket: storageBucket,
    file_path: storagePath,
    original_filename: file.name,
    mime_type: mimeType,
    file_size: file.size,
    display_name: (meta.display_name && String(meta.display_name).trim()) || file.name,
    document_date_start: meta.document_date_start || null,
    document_date_end: meta.document_date_end || null,
    uploaded_by: user?.id || null,
    source: 'app',
    approval_status: 'approved',
    approved_at: new Date().toISOString(),
    approved_by: user?.id || null,
    legal_hold: !!meta.legal_hold,
    retention_anchor_date: anchor,
    linked_module_key: meta.linked_module_key || null,
    linked_entity_id: meta.linked_entity_id || null,
    waiver_upload_id: waiverUploadId,
    notes: meta.notes || null,
  };

  const { data: inserted, error: insErr } = await supabase.from('file_storage_files').insert(row).select().single();
  if (insErr) throw insErr;
  return inserted;
}

export async function approveInbound(businessId, inboundRow, categoryId, meta) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const categories = await fetchCategories(businessId);
  const category = categories.find((c) => c.id === categoryId);
  if (!category) throw new Error('Category not found');

  const fromPath = inboundRow.file_path;
  const { data: dl, error: dlErr } = await supabase.storage.from(BUCKET).download(fromPath);
  if (dlErr || !dl) throw dlErr || new Error('Could not download inbound file');

  const buf = await dl.arrayBuffer();
  const fname = inboundRow.original_filename || 'document.pdf';

  let toPath;
  let storageBucket = BUCKET;
  let waiverUploadId = null;

  if (category.system_key === 'paper_waiver') {
    const filledDate =
      (meta?.waiverFilledDate && String(meta.waiverFilledDate).trim()) ||
      (meta?.document_date_start && String(meta.document_date_start).trim()) ||
      '';
    if (!meta?.firstName || !meta?.lastName || !filledDate) {
      throw new Error(
        'Paper waiver requires participant first name, last name, and a signed date (waiver signed date or document start).'
      );
    }
    const file = new File([buf], fname, { type: inboundRow.mime_type || 'application/pdf' });
    const WaiverStorageService = (await import('../Waivers/WaiverStorageService')).default;
    WaiverStorageService.setBusinessId(businessId);
    const rec = await WaiverStorageService.uploadPaperWaiver(file, {
      firstName: meta.firstName,
      lastName: meta.lastName,
      dateOfBirth: meta.dateOfBirth || '',
      phoneNumber: meta.phoneNumber || '',
      email: meta.email || '',
      waiverFilledDate: filledDate,
    });
    waiverUploadId = rec?.id || null;
    toPath = rec?.file_path;
    storageBucket = 'waivers';
  } else {
    const seg = crypto.randomUUID();
    const safe = fname.replace(/[^a-zA-Z0-9._-]/g, '_');
    toPath = `${businessId}/files/${categoryId}/${seg}_${safe}`;
    const { error: up2 } = await supabase.storage.from(BUCKET).upload(toPath, buf, {
      contentType: inboundRow.mime_type || 'application/octet-stream',
      upsert: false,
    });
    if (up2) throw up2;
  }

  const anchor = meta.document_date_end || meta.document_date_start || new Date().toISOString().slice(0, 10);

  const { data: fileRow, error: fErr } = await supabase
    .from('file_storage_files')
    .insert({
      business_id: businessId,
      category_id: categoryId,
      storage_bucket: storageBucket,
      file_path: toPath,
      original_filename: inboundRow.original_filename,
      mime_type: inboundRow.mime_type,
      file_size: inboundRow.file_size,
      display_name: (meta.display_name && String(meta.display_name).trim()) || inboundRow.original_filename,
      document_date_start: meta.document_date_start || null,
      document_date_end: meta.document_date_end || null,
      uploaded_by: user?.id,
      source: 'email',
      approval_status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: user?.id,
      legal_hold: !!meta.legal_hold,
      retention_anchor_date: anchor,
      linked_module_key: meta.linked_module_key || null,
      linked_entity_id: meta.linked_entity_id || null,
      waiver_upload_id: waiverUploadId,
    })
    .select()
    .single();
  if (fErr) throw fErr;

  await supabase
    .from('file_storage_inbound')
    .update({
      status: 'approved',
      resolved_by: user?.id,
      resolved_at: new Date().toISOString(),
      file_storage_file_id: fileRow.id,
    })
    .eq('id', inboundRow.id);

  return fileRow;
}

export async function rejectInbound(inboundId, reason) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('file_storage_inbound')
    .update({
      status: 'rejected',
      resolved_by: user?.id,
      resolved_at: new Date().toISOString(),
      rejection_reason: reason || null,
    })
    .eq('id', inboundId);
  if (error) throw error;
}

export async function softDeleteFile(fileId, businessId) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('file_storage_files')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: user?.id,
    })
    .eq('id', fileId)
    .eq('business_id', businessId);
  if (error) throw error;
}

/** Remove a paper waiver that exists only in waiver_uploads / waivers bucket (uploaded via Waivers module, not file_storage_files). */
export async function deleteLegacyPaperWaiverUpload(waiverUploadId) {
  const WaiverStorageService = (await import('../Waivers/WaiverStorageService')).default;
  return WaiverStorageService.deleteUpload(waiverUploadId);
}

export async function setLegalHold(fileId, businessId, on) {
  const { error } = await supabase.from('file_storage_files').update({ legal_hold: !!on }).eq('id', fileId).eq('business_id', businessId);
  if (error) throw error;
}

export async function fetchAccessLogForExport(businessId, fileIds) {
  if (!fileIds?.length) return [];
  const { data, error } = await supabase
    .from('file_storage_access_log')
    .select('*')
    .eq('business_id', businessId)
    .in('file_id', fileIds)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Owner: ZIP files in date range on uploaded_at */
export async function exportZipForRange(businessId, dateFrom, dateTo, onProgress) {
  const start = new Date(dateFrom);
  const end = new Date(dateTo);
  end.setHours(23, 59, 59, 999);

  const { data: rows, error } = await supabase
    .from('file_storage_files')
    .select('id, file_path, original_filename, uploaded_at, storage_bucket')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .gte('uploaded_at', start.toISOString())
    .lte('uploaded_at', end.toISOString());

  if (error) throw error;
  const zip = new JSZip();
  let i = 0;
  for (const row of rows || []) {
    i += 1;
    onProgress?.(i, rows.length);
    const url = await getSignedUrl(row.file_path, 120, row.storage_bucket || BUCKET);
    const res = await fetch(url);
    if (!res.ok) continue;
    const buf = await res.arrayBuffer();
    const name = `${row.id.slice(0, 8)}_${(row.original_filename || 'file').replace(/[/\\]/g, '_')}`;
    zip.file(name, buf);
    await logFileAccess(businessId, row.id, 'export_zip', { range: { dateFrom, dateTo } });
  }
  return zip.generateAsync({ type: 'blob' });
}

/** Printable blank/legacy form templates for staff. */
export async function fetchPaperForms(businessId) {
  const { data, error } = await supabase
    .from('file_storage_paper_forms')
    .select('*')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .order('name', { ascending: true })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function uploadPaperForm(businessId, name, file) {
  assertSafeFile(file);
  const trimmedName = (name || '').trim();
  if (!trimmedName) throw new Error('Form name is required');

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const seg = crypto.randomUUID();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'form';
  const storagePath = `${businessId}/paper-forms/${seg}_${safe}`;
  const mimeType = file.type || 'application/octet-stream';

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
    contentType: mimeType,
    upsert: false,
  });
  if (upErr) throw upErr;

  const { data, error } = await supabase
    .from('file_storage_paper_forms')
    .insert({
      business_id: businessId,
      name: trimmedName,
      storage_bucket: BUCKET,
      file_path: storagePath,
      original_filename: file.name,
      mime_type: mimeType,
      file_size: file.size,
      uploaded_by: user?.id || null,
      updated_by: user?.id || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function replacePaperFormFile(formId, businessId, file) {
  assertSafeFile(file);
  const { data: existing, error: fetchErr } = await supabase
    .from('file_storage_paper_forms')
    .select('*')
    .eq('id', formId)
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .single();
  if (fetchErr || !existing) throw fetchErr || new Error('Form not found');

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const seg = crypto.randomUUID();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'form';
  const storagePath = `${businessId}/paper-forms/${seg}_${safe}`;
  const mimeType = file.type || 'application/octet-stream';

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
    contentType: mimeType,
    upsert: false,
  });
  if (upErr) throw upErr;

  const { data, error } = await supabase
    .from('file_storage_paper_forms')
    .update({
      file_path: storagePath,
      storage_bucket: BUCKET,
      original_filename: file.name,
      mime_type: mimeType,
      file_size: file.size,
      updated_by: user?.id || null,
    })
    .eq('id', formId)
    .eq('business_id', businessId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletePaperForm(formId, businessId) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('file_storage_paper_forms')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: user?.id || null,
    })
    .eq('id', formId)
    .eq('business_id', businessId);
  if (error) throw error;
}
