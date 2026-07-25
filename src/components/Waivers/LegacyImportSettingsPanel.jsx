import React, { useState, useEffect, useCallback } from 'react';
import { FiPlus, FiTrash2, FiDatabase, FiCopy } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import LegacyWaiverTemplateService from '../../services/Waivers/LegacyWaiverTemplateService';
import WaiverTemplateService from '../../services/Waivers/WaiverTemplateService';
import SmartwaiverPdfImportPanel from './SmartwaiverPdfImportPanel';

const LegacyImportSettingsPanel = ({ businessId }) => {
  const [list, setList] = useState([]);
  const [discoveredTemplates, setDiscoveredTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [legacyId, setLegacyId] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [linking, setLinking] = useState(false);
  const [convertingId, setConvertingId] = useState(null);

  const generateTemplateKey = (value) => {
    const base = String(value || 'legacy-waiver')
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return base || `legacy-waiver-${Date.now()}`;
  };

  const load = useCallback(async () => {
    if (!businessId) return;
    try {
      setLoading(true);
      LegacyWaiverTemplateService.setBusinessId(businessId);
      const [rows, discovered] = await Promise.all([
        LegacyWaiverTemplateService.list(),
        LegacyWaiverTemplateService.listDiscoveredTemplateIds()
      ]);
      setList(rows);
      setDiscoveredTemplates(discovered);
    } catch (e) {
      console.error(e);
      toast.error('Could not load legacy templates');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    try {
      setSaving(true);
      LegacyWaiverTemplateService.setBusinessId(businessId);
      await LegacyWaiverTemplateService.upsert({
        legacy_template_id: legacyId,
        title: title || 'Legacy template',
        waiver_content: content
      });
      toast.success('Template saved');
      setLegacyId('');
      setTitle('');
      setContent('');
      load();
    } catch (e) {
      console.error(e);
      toast.error(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleTemplateSelect = (templateId) => {
    setLegacyId(templateId);
    if (!templateId) return;
    const existing = list.find((row) => String(row.legacy_template_id) === String(templateId));
    if (existing) {
      setTitle(existing.title || `Legacy template ${templateId}`);
      setContent(existing.waiver_content || '');
      return;
    }
    setTitle(`Legacy template ${templateId}`);
  };

  const handleLinkPosCustomers = async () => {
    if (!window.confirm('Create or link POS customer accounts for imported legacy signers (by phone, up to 2,000 rows per run)? Re-run if you have a larger import.')) {
      return;
    }
    try {
      setLinking(true);
      LegacyWaiverTemplateService.setBusinessId(businessId);
      const result = await LegacyWaiverTemplateService.linkPosCustomers(2000);
      const p = result && typeof result === 'object' ? result : {};
      toast.success(
        `Processed ${p.processed ?? 0}, linked ${p.linked ?? 0}, skipped ${p.skipped ?? 0} (phone required; re-run for more rows).`
      );
    } catch (e) {
      console.error(e);
      toast.error(e?.message || 'Link to POS customers failed. Apply the latest database migration, then try again.');
    } finally {
      setLinking(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this legacy template mapping?')) return;
    try {
      LegacyWaiverTemplateService.setBusinessId(businessId);
      await LegacyWaiverTemplateService.remove(id);
      toast.success('Deleted');
      load();
    } catch (e) {
      toast.error('Delete failed');
    }
  };

  const convertToModernTemplate = async (legacyTemplate) => {
    const source = legacyTemplate || {
      legacy_template_id: legacyId,
      title,
      waiver_content: content
    };
    const sourceId = source.legacy_template_id;
    const sourceTitle = String(source.title || `Legacy template ${sourceId || ''}`).trim();
    const sourceContent = String(source.waiver_content || '').trim();

    if (!sourceContent) {
      toast.error('This legacy template has no body content to convert.');
      return;
    }

    try {
      setConvertingId(source.id || 'current');
      WaiverTemplateService.setBusinessId(businessId);
      const templateName = `${sourceTitle} (Modern)`;
      const templateKey = `${generateTemplateKey(sourceTitle)}-modern-${Date.now()}`;

      await WaiverTemplateService.createTemplate({
        templateName,
        templateKey,
        waiverTitle: sourceTitle,
        waiverContent: sourceContent,
        requiresDigitalSignature: true,
        requiresGuardianSignature: false,
        minorAgeThreshold: 18,
        fieldsConfig: {
          participantFields: {
            firstName: true,
            lastName: true,
            phoneNumber: true,
            emailAddress: true,
            birthdate: true,
            address: false,
            postalCode: false
          },
          minorFields: {
            firstName: true,
            lastName: true,
            birthdate: true
          },
          notifications: {}
        }
      });

      toast.success('Modern waiver template created from legacy body.');
    } catch (error) {
      console.error('[LegacyImportSettingsPanel] Convert legacy template failed:', error);
      toast.error(error?.message || 'Could not create modern template.');
    } finally {
      setConvertingId(null);
    }
  };

  if (!businessId) return null;

  return (
    <div style={styles.section}>
      <SmartwaiverPdfImportPanel businessId={businessId} />

      <h3 style={styles.sectionTitle}>
        <FiDatabase style={{ marginRight: 8, verticalAlign: 'middle' }} />
        Wallkids legacy templates
      </h3>
      <p style={styles.helper}>
        Map each <strong>waiver_template_id</strong> from MySQL to the HTML/text you want shown for imported
        waivers. Run the Node import script (see <code>Waivers/WALLKIDS_IMPORT.md</code>) with your four SQL
        files; it fills <strong>legacy_minors</strong> and signer data into <code>legacy_waivers</code>.
        Use the button below to create or match <strong>POS / loyalty customers</strong> for those import rows
        (by normalized phone, same as new waivers). Rows without a valid 10-digit phone are skipped.
      </p>
      <div style={styles.discoveredBox}>
        <strong>Detected non-Smartwaiver templates:</strong>{' '}
        {discoveredTemplates.length === 0
          ? 'None found yet.'
          : `${discoveredTemplates.length} template${discoveredTemplates.length === 1 ? '' : 's'} found.`}
        {discoveredTemplates.length > 0 ? (
          <ul style={styles.discoveredList}>
            {discoveredTemplates.map((row) => (
              <li key={row.legacy_template_id}>
                ID {row.legacy_template_id}: {row.waiver_count.toLocaleString()} waiver
                {row.waiver_count === 1 ? '' : 's'}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div style={styles.linkRow}>
        <button
          type="button"
          onClick={handleLinkPosCustomers}
          disabled={linking}
          style={styles.linkBtn}
        >
          <FiDatabase style={{ marginRight: 6, verticalAlign: 'middle' }} />
          {linking ? 'Linking…' : 'Link import signers to POS customers'}
        </button>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <ul style={styles.list}>
          {list.map((row) => (
            <li key={row.id} style={styles.li}>
              <span style={styles.badge}>ID {row.legacy_template_id}</span>
              <strong style={styles.name}>{row.title}</strong>
              <span style={styles.meta}>{(row.waiver_content || '').length} chars</span>
              <button
                type="button"
                onClick={() => convertToModernTemplate(row)}
                style={styles.convertBtn}
                title="Create a modern waiver template from this legacy body"
                disabled={convertingId === row.id}
              >
                <FiCopy />
              </button>
              <button type="button" onClick={() => handleDelete(row.id)} style={styles.danger} title="Delete">
                <FiTrash2 />
              </button>
            </li>
          ))}
          {list.length === 0 && <li style={styles.empty}>No legacy templates yet.</li>}
        </ul>
      )}

      <h4 style={styles.sub}>Add or update by template id</h4>
      <label style={styles.lbl}>
        Choose detected template
        <select
          value={legacyId}
          onChange={(e) => handleTemplateSelect(e.target.value)}
          style={styles.inp}
        >
          <option value="">Select a detected template...</option>
          {discoveredTemplates.map((row) => (
            <option key={row.legacy_template_id} value={row.legacy_template_id}>
              ID {row.legacy_template_id} ({row.waiver_count.toLocaleString()} waivers)
            </option>
          ))}
        </select>
      </label>
      <div style={styles.row}>
        <label style={styles.lbl}>
          Legacy template id
          <input
            type="number"
            value={legacyId}
            onChange={(e) => handleTemplateSelect(e.target.value)}
            style={styles.inp}
            placeholder="e.g. 2"
          />
        </label>
        <label style={styles.lbl}>
          Title
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={styles.inp}
            placeholder="Display name"
          />
        </label>
      </div>
      <label style={styles.lbl}>
        Waiver content (HTML)
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          style={styles.ta}
          rows={6}
          placeholder="Paste the legacy waiver body text or HTML"
        />
      </label>
      <button
        type="button"
        onClick={handleAdd}
        disabled={saving || legacyId === ''}
        style={styles.btn}
      >
        <FiPlus /> {saving ? 'Saving…' : 'Save template'}
      </button>
      <button
        type="button"
        onClick={() => convertToModernTemplate()}
        disabled={convertingId === 'current' || !content.trim()}
        style={styles.secondaryBtn}
      >
        <FiCopy /> {convertingId === 'current' ? 'Creating…' : 'Create modern template from this body'}
      </button>
    </div>
  );
};

const styles = {
  section: { maxWidth: 720 },
  sectionTitle: { fontSize: TavariStyles.typography.fontSize.lg, marginBottom: TavariStyles.spacing.sm },
  helper: { color: TavariStyles.colors.gray600, fontSize: TavariStyles.typography.fontSize.sm, lineHeight: 1.5 },
  discoveredBox: {
    padding: '0.75rem 1rem',
    background: TavariStyles.colors.gray50,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: 8,
    marginBottom: '1rem',
    fontSize: 14
  },
  discoveredList: {
    margin: '0.5rem 0 0',
    paddingLeft: '1.25rem',
    color: TavariStyles.colors.gray700 || TavariStyles.colors.gray600
  },
  linkRow: { marginBottom: '1rem' },
  linkBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '10px 16px',
    background: TavariStyles.colors.success,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 14
  },
  list: { listStyle: 'none', padding: 0, margin: '1rem 0' },
  li: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0.5rem 0',
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`
  },
  badge: { fontSize: 13, background: TavariStyles.colors.gray200, padding: '2px 8px', borderRadius: 4 },
  name: { flex: 1 },
  meta: { color: TavariStyles.colors.gray500, fontSize: 13 },
  convertBtn: { border: 'none', background: 'none', cursor: 'pointer', color: TavariStyles.colors.primary },
  danger: { border: 'none', background: 'none', cursor: 'pointer', color: TavariStyles.colors.error },
  empty: { color: TavariStyles.colors.gray500, fontStyle: 'italic' },
  sub: { marginTop: '1.5rem', marginBottom: 8 },
  row: { display: 'flex', gap: 16, flexWrap: 'wrap' },
  lbl: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, marginBottom: 8, flex: '1 1 200px' },
  inp: { padding: 8, borderRadius: 6, border: `1px solid ${TavariStyles.colors.gray300}` },
  ta: { width: '100%', padding: 8, borderRadius: 6, border: `1px solid ${TavariStyles.colors.gray300}`, fontFamily: 'inherit' },
  btn: {
    marginTop: 8,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    background: TavariStyles.colors.primary,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontWeight: 600
  },
  secondaryBtn: {
    marginTop: 8,
    marginLeft: 8,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    background: TavariStyles.colors.gray700 || '#374151',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontWeight: 600
  }
};

export default LegacyImportSettingsPanel;
