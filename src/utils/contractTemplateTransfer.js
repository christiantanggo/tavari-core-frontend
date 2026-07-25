/**
 * Contract template export/import between businesses (JSON).
 * Schema matches contract_templates + contract_template_sections inserts.
 */

export const CONTRACT_TEMPLATE_EXPORT_KIND = 'tavari_contract_template_export';
export const CONTRACT_TEMPLATE_EXPORT_VERSION = 1;

const SECTION_KEYS = new Set([
  'title',
  'content',
  'section_order',
  'is_required',
  'required_for',
  'section_type',
  'placeholder_tags',
]);

function stripSubsectionClientIds(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map((sub) => {
    if (!sub || typeof sub !== 'object') return sub;
    const { id: _id, ...rest } = sub;
    return rest;
  });
}

export function sanitizeSectionForExport(row) {
  if (!row || typeof row !== 'object') return null;
  const out = {
    title: row.title ?? '',
    content: row.content ?? '',
    section_order: typeof row.section_order === 'number' ? row.section_order : parseInt(row.section_order, 10) || 0,
    is_required: !!row.is_required,
    required_for: row.required_for || 'all',
    section_type: row.section_type || 'standard',
    placeholder_tags: stripSubsectionClientIds(row.placeholder_tags),
  };
  return out;
}

export function sanitizeSectionForInsert(row, templateId, index) {
  const base = sanitizeSectionForExport(row);
  if (!base) return null;
  return {
    template_id: templateId,
    title: base.title,
    content: base.content,
    section_order: base.section_order || index + 1,
    is_required: base.is_required,
    required_for: base.required_for,
    section_type: base.section_type,
    placeholder_tags: base.placeholder_tags,
  };
}

/**
 * Build downloadable JSON for one or more templates (no DB ids).
 */
export function buildContractTemplateExportPayload({
  templates,
  sourceBusinessName = null,
  sourceBusinessId = null,
}) {
  const cleaned = (templates || []).map((t) => ({
    template_name: t.template_name || 'Untitled',
    contract_type: t.contract_type || 'employment',
    is_default: !!t.is_default,
    is_active: t.is_active !== false,
    sections: (t.sections || []).map((s, i) => {
      const sanitized = sanitizeSectionForExport(s);
      if (sanitized && !sanitized.section_order) {
        sanitized.section_order = i + 1;
      }
      return sanitized;
    }).filter(Boolean),
  }));

  return {
    kind: CONTRACT_TEMPLATE_EXPORT_KIND,
    version: CONTRACT_TEMPLATE_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    sourceBusinessName: sourceBusinessName || undefined,
    sourceBusinessId: sourceBusinessId || undefined,
    templates: cleaned,
  };
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Parse and validate import JSON. Returns { templates } or { error: string }.
 */
export function parseContractTemplateImportPayload(raw) {
  if (!raw || typeof raw !== 'object') {
    return { error: 'File must contain a JSON object.' };
  }

  let list = [];

  if (raw.kind === CONTRACT_TEMPLATE_EXPORT_KIND && Array.isArray(raw.templates)) {
    list = raw.templates;
  } else if (Array.isArray(raw.templates)) {
    list = raw.templates;
  } else if (raw.template && typeof raw.template === 'object') {
    list = [{ ...raw.template, sections: raw.sections || raw.template.sections }];
  } else {
    return { error: 'Unrecognized format. Use a Tavari contract template export (.json).' };
  }

  const templates = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t || typeof t !== 'object') {
      return { error: `Template ${i + 1} is invalid.` };
    }
    const name = typeof t.template_name === 'string' ? t.template_name.trim() : '';
    if (!name) {
      return { error: `Template ${i + 1} is missing template_name.` };
    }
    const sections = Array.isArray(t.sections) ? t.sections : [];
    if (sections.length === 0) {
      return { error: `Template "${name}" has no sections. Add at least one section in the export.` };
    }
    const cleanedSections = sections.map((s, j) => {
      if (!s || typeof s !== 'object') return null;
      const o = {};
      SECTION_KEYS.forEach((k) => {
        if (s[k] !== undefined) o[k] = s[k];
      });
      if (!isNonEmptyString(o.title) && !isNonEmptyString(o.content)) {
        return null;
      }
      return sanitizeSectionForExport(o);
    }).filter(Boolean);

    if (cleanedSections.length === 0) {
      return { error: `Template "${name}" has no valid sections.` };
    }

    templates.push({
      template_name: name,
      contract_type: typeof t.contract_type === 'string' && t.contract_type.trim() ? t.contract_type.trim() : 'employment',
      is_default: false,
      is_active: true,
      sections: cleanedSections.map((s, idx) => ({
        ...s,
        section_order: s.section_order || idx + 1,
      })),
    });
  }

  if (templates.length === 0) {
    return { error: 'No templates found in file.' };
  }

  return { templates };
}

export function slugifyFilename(name, fallback = 'contract-template') {
  const base = (name || fallback)
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || fallback;
}

export function downloadJsonPayload(payload, filenameBase) {
  const safe = slugifyFilename(filenameBase);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safe}.json`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
