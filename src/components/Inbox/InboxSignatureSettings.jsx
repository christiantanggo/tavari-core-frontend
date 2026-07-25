import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { FiEdit2, FiImage, FiPlus, FiTrash2 } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import ModuleDeactivationPanel from '../Modules/ModuleDeactivationPanel';

const DEFAULT_SIGNATURE_TEXT = [
  'Best,',
  '{{first_name}} {{last_name}}',
  '{{position_title}}',
  '{{business_name}}',
  '{{business_phone}}',
  '{{business_address}}'
].join('\n');

const emptyForm = {
  id: null,
  name: '',
  text_content: DEFAULT_SIGNATURE_TEXT,
  image_url: '',
  assigned_user_ids: [],
  apply_mode: 'all',
  is_default: false
};

const applyModeLabels = {
  all: 'All emails',
  new_only: 'New emails only',
  replies_only: 'Replies only',
  forwards_only: 'Forwards only',
  manual: 'Manual only'
};

const formatEmployeeName = (employee) => {
  const name = [employee.first_name, employee.last_name].filter(Boolean).join(' ').trim();
  return name || employee.email || 'Unnamed user';
};

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const buildSignatureHtml = (textContent, imageUrl) => {
  const lines = String(textContent || '').split('\n');
  const textHtml = lines
    .map(line => line.trim()
      ? `<div>${escapeHtml(line)}</div>`
      : '<div style="height: 8px;"></div>')
    .join('');
  const imageHtml = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="Signature image" style="max-width: 180px; height: auto; margin-top: 8px;" />`
    : '';

  return `<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.4;">${textHtml}${imageHtml}</div>`;
};

const replaceSignatureTokens = (value, variables) => String(value || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, key) => {
  return variables[key] || '';
});

const getBusinessAddress = (business) => {
  if (business?.business_address) return business.business_address;
  return [
    business?.address_line1 || business?.address || business?.street_address,
    business?.address_line2,
    business?.business_city || business?.city,
    business?.business_state || business?.province || business?.state,
    business?.business_postal || business?.postal_code || business?.zip
  ].filter(Boolean).join(', ');
};

const getBusinessPhone = (business) => (
  business?.business_phone ||
  business?.phone ||
  business?.phone_number ||
  ''
);

export default function InboxSignatureSettings({ businessId }) {
  const { authUser } = usePOSAuth();
  const [signatures, setSignatures] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [businessProfile, setBusinessProfile] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const selectedSignature = useMemo(
    () => signatures.find(signature => signature.id === formData.id),
    [formData.id, signatures]
  );

  const previewEmployee = useMemo(() => {
    const assignedIds = formData.assigned_user_ids || [];
    return (
      employees.find(employee => employee.id === assignedIds[0]) ||
      employees.find(employee => employee.id === authUser?.id) ||
      employees[0] ||
      null
    );
  }, [authUser?.id, employees, formData.assigned_user_ids]);

  const previewVariables = useMemo(() => ({
    first_name: previewEmployee?.first_name || '',
    last_name: previewEmployee?.last_name || '',
    full_name: [previewEmployee?.first_name, previewEmployee?.last_name].filter(Boolean).join(' '),
    position_title: previewEmployee?.position || '',
    business_name: businessProfile?.name || '',
    business_phone: getBusinessPhone(businessProfile),
    business_address: getBusinessAddress(businessProfile)
  }), [businessProfile, previewEmployee]);

  const previewText = useMemo(
    () => replaceSignatureTokens(formData.text_content, previewVariables),
    [formData.text_content, previewVariables]
  );

  const loadData = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [signaturesResult, employeesResult] = await Promise.all([
        supabase
          .from('mailbox_signatures')
          .select('*')
          .eq('business_id', businessId)
          .order('created_at', { ascending: false }),
        supabase
          .from('users')
          .select('id, first_name, last_name, email, position, business_users!inner(business_id, role)')
          .eq('business_users.business_id', businessId)
          .order('first_name')
      ]);

      const businessResult = await supabase
        .from('businesses')
        .select('*')
        .eq('id', businessId)
        .maybeSingle();

      if (signaturesResult.error) throw signaturesResult.error;
      if (employeesResult.error) throw employeesResult.error;
      if (businessResult.error) throw businessResult.error;

      setSignatures(signaturesResult.data || []);
      setEmployees(employeesResult.data || []);
      setBusinessProfile(businessResult.data || null);
    } catch (error) {
      console.error('Error loading signatures:', error);
      toast.error('Failed to load signatures');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const resetForm = () => {
    setFormData(emptyForm);
  };

  const editSignature = (signature) => {
    setFormData({
      id: signature.id,
      name: signature.name || '',
      text_content: signature.text_content || DEFAULT_SIGNATURE_TEXT,
      image_url: signature.image_url || '',
      assigned_user_ids: signature.assigned_user_ids || [],
      apply_mode: signature.apply_mode || 'all',
      is_default: Boolean(signature.is_default)
    });
  };

  const toggleAssignedUser = (userId) => {
    setFormData(prev => {
      const current = prev.assigned_user_ids || [];
      return {
        ...prev,
        assigned_user_ids: current.includes(userId)
          ? current.filter(id => id !== userId)
          : [...current, userId]
      };
    });
  };

  const handleImageUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !businessId) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    setUploadingImage(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${businessId}/signatures/${crypto.randomUUID()}-${safeName}`;
      const { error } = await supabase.storage
        .from('email-images')
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type
        });

      if (error) throw error;
      const { data } = supabase.storage.from('email-images').getPublicUrl(path);
      const imageUrl = data?.publicUrl || '';
      setFormData(prev => ({
        ...prev,
        image_url: imageUrl
      }));
      toast.success('Signature image added');
    } catch (error) {
      console.error('Error uploading signature image:', error);
      toast.error('Failed to upload image');
    } finally {
      setUploadingImage(false);
      event.target.value = '';
    }
  };

  const saveSignature = async (event) => {
    event.preventDefault();
    const name = formData.name.trim();
    if (!name) {
      toast.error('Signature name is required');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        business_id: businessId,
        name,
        html_content: buildSignatureHtml(formData.text_content, formData.image_url),
        text_content: formData.text_content || '',
        image_url: formData.image_url || null,
        assigned_user_ids: formData.assigned_user_ids || [],
        apply_mode: formData.apply_mode,
        is_default: formData.is_default,
        created_by_user_id: authUser?.id || null
      };

      if (formData.id) {
        const { error } = await supabase
          .from('mailbox_signatures')
          .update(payload)
          .eq('id', formData.id);
        if (error) throw error;
        toast.success('Signature updated');
      } else {
        const { error } = await supabase
          .from('mailbox_signatures')
          .insert(payload);
        if (error) throw error;
        toast.success('Signature created');
      }

      resetForm();
      loadData();
    } catch (error) {
      console.error('Error saving signature:', error);
      toast.error('Failed to save signature');
    } finally {
      setSaving(false);
    }
  };

  const deleteSignature = async (signatureId) => {
    if (!confirm('Delete this signature?')) return;
    try {
      const { error } = await supabase
        .from('mailbox_signatures')
        .delete()
        .eq('id', signatureId);
      if (error) throw error;
      if (formData.id === signatureId) resetForm();
      setSignatures(prev => prev.filter(signature => signature.id !== signatureId));
      toast.success('Signature deleted');
    } catch (error) {
      console.error('Error deleting signature:', error);
      toast.error('Failed to delete signature');
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h3 style={styles.title}>Email Signatures</h3>
          <p style={styles.subtitle}>
            Create signatures with images, assign them to employees, and choose when they apply.
          </p>
        </div>
        <button type="button" onClick={resetForm} style={styles.secondaryButton}>
          <FiPlus size={16} />
          New Signature
        </button>
      </div>

      <div style={styles.layout}>
        <div style={styles.listPanel}>
          {loading ? (
            <p style={styles.mutedText}>Loading signatures...</p>
          ) : signatures.length === 0 ? (
            <p style={styles.mutedText}>No signatures yet.</p>
          ) : (
            signatures.map(signature => (
              <div
                key={signature.id}
                style={{
                  ...styles.signatureCard,
                  ...(selectedSignature?.id === signature.id ? styles.signatureCardActive : {})
                }}
              >
                <button type="button" onClick={() => editSignature(signature)} style={styles.signatureInfoButton}>
                  <strong>{signature.name}</strong>
                  <span>{applyModeLabels[signature.apply_mode] || 'All emails'}</span>
                  <span>{signature.assigned_user_ids?.length || 0} assigned user(s)</span>
                </button>
                <div style={styles.cardActions}>
                  <button type="button" onClick={() => editSignature(signature)} style={styles.iconButton}>
                    <FiEdit2 size={15} />
                  </button>
                  <button type="button" onClick={() => deleteSignature(signature.id)} style={{ ...styles.iconButton, color: '#b91c1c' }}>
                    <FiTrash2 size={15} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <form style={styles.formPanel} onSubmit={saveSignature}>
          <div style={styles.field}>
            <label style={styles.label}>Signature Name</label>
            <input
              value={formData.name}
              onChange={(event) => setFormData(prev => ({ ...prev, name: event.target.value }))}
              placeholder="Default employee signature"
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Apply To</label>
            <select
              value={formData.apply_mode}
              onChange={(event) => setFormData(prev => ({ ...prev, apply_mode: event.target.value }))}
              style={styles.input}
            >
              {Object.entries(applyModeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Assign to People</label>
            <div style={styles.checkboxList}>
              {employees.map(employee => (
                <TavariCheckbox
                  key={employee.id}
                  id={`signature-user-${employee.id}`}
                  checked={(formData.assigned_user_ids || []).includes(employee.id)}
                  onChange={() => toggleAssignedUser(employee.id)}
                  label={`${formatEmployeeName(employee)} (${employee.email})`}
                  appearance="native"
                  size="sm"
                  style={styles.checkboxItem}
                />
              ))}
            </div>
          </div>

          <TavariCheckbox
            id="signature-default"
            checked={formData.is_default}
            onChange={(checked) => setFormData(prev => ({ ...prev, is_default: checked }))}
            label="Use as fallback default when a person has no assigned signature"
            appearance="native"
            style={styles.field}
          />

          <div style={styles.field}>
            <label style={styles.label}>Signature</label>
            <textarea
              value={formData.text_content}
              onChange={(event) => setFormData(prev => ({ ...prev, text_content: event.target.value }))}
              rows={8}
              style={styles.textarea}
              placeholder="Best,\n{{first_name}} {{last_name}}\n{{position_title}}"
            />
            <p style={styles.helpText}>
              Write this like a normal email signature. The system will format it for outgoing emails.
            </p>
          </div>

          <div style={styles.field}>
            <label style={styles.uploadButton}>
              <FiImage size={16} />
              {uploadingImage ? 'Uploading...' : 'Add Image to Signature'}
              <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} disabled={uploadingImage} />
            </label>
            {formData.image_url && (
              <img src={formData.image_url} alt="Signature preview" style={styles.imagePreview} />
            )}
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Preview</label>
            {previewEmployee && (
              <p style={styles.helpText}>
                Previewing as {formatEmployeeName(previewEmployee)}
              </p>
            )}
            <div style={styles.previewBox}>
              {previewText.split('\n').map((line, index) => (
                line.trim()
                  ? <div key={`${line}-${index}`}>{line}</div>
                  : <div key={`blank-${index}`} style={{ height: '8px' }} />
              ))}
              {formData.image_url && (
                <img src={formData.image_url} alt="Signature preview" style={styles.imagePreview} />
              )}
            </div>
          </div>

          <div style={styles.tokens}>
            <strong>Available defaults:</strong>
            <span>{'{{first_name}}'}</span>
            <span>{'{{last_name}}'}</span>
            <span>{'{{full_name}}'}</span>
            <span>{'{{position_title}}'}</span>
            <span>{'{{business_name}}'}</span>
            <span>{'{{business_phone}}'}</span>
            <span>{'{{business_address}}'}</span>
          </div>

          <div style={styles.actions}>
            <button type="button" onClick={resetForm} style={styles.secondaryButton}>Cancel</button>
            <button type="submit" disabled={saving} style={{ ...styles.primaryButton, opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving...' : formData.id ? 'Update Signature' : 'Create Signature'}
            </button>
          </div>
        </form>
      </div>

      <ModuleDeactivationPanel moduleKey="inbox" />
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '16px'
  },
  title: {
    margin: '0 0 6px 0',
    fontSize: '23px',
    color: '#111827'
  },
  subtitle: {
    margin: 0,
    color: '#6b7280',
    fontSize: '14px'
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: '320px minmax(0, 1fr)',
    gap: '20px'
  },
  listPanel: {
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '12px',
    backgroundColor: '#f9fafb',
    minHeight: '420px'
  },
  formPanel: {
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '18px',
    backgroundColor: '#ffffff'
  },
  signatureCard: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '10px',
    borderRadius: '10px',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    marginBottom: '10px'
  },
  signatureCardActive: {
    borderColor: TavariStyles.colors.primary,
    backgroundColor: TavariStyles.colors.primaryLight
  },
  signatureInfoButton: {
    border: 'none',
    background: 'transparent',
    padding: 0,
    textAlign: 'left',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    cursor: 'pointer',
    color: '#374151',
    fontSize: '13px',
    minWidth: 0
  },
  cardActions: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '4px'
  },
  iconButton: {
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    color: '#4b5563',
    padding: '4px'
  },
  field: {
    marginBottom: '16px'
  },
  label: {
    display: 'block',
    fontWeight: 700,
    fontSize: '14px',
    marginBottom: '6px',
    color: '#374151'
  },
  input: {
    width: '100%',
    padding: '10px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '14px'
  },
  textarea: {
    width: '100%',
    padding: '10px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '14px',
    fontFamily: 'Arial, sans-serif',
    resize: 'vertical'
  },
  helpText: {
    margin: '6px 0 0 0',
    color: '#6b7280',
    fontSize: '13px'
  },
  checkboxList: {
    maxHeight: '180px',
    overflowY: 'auto',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '10px'
  },
  checkboxItem: {
    marginBottom: '8px'
  },
  uploadButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 14px',
    backgroundColor: '#eef2ff',
    color: '#3730a3',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: '14px'
  },
  imagePreview: {
    display: 'block',
    maxWidth: '180px',
    maxHeight: '120px',
    marginTop: '10px',
    borderRadius: '6px',
    border: '1px solid #e5e7eb'
  },
  previewBox: {
    padding: '14px',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    backgroundColor: '#ffffff',
    color: '#111827',
    fontFamily: 'Arial, sans-serif',
    fontSize: '14px',
    lineHeight: 1.4,
    minHeight: '100px'
  },
  tokens: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    padding: '12px',
    backgroundColor: '#f9fafb',
    borderRadius: '8px',
    fontSize: '13px',
    color: '#4b5563',
    marginBottom: '16px'
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px'
  },
  primaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 16px',
    backgroundColor: TavariStyles.colors.primary,
    color: '#ffffff',
    fontWeight: 700,
    cursor: 'pointer'
  },
  secondaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    padding: '10px 16px',
    backgroundColor: '#ffffff',
    color: '#374151',
    fontWeight: 700,
    cursor: 'pointer'
  },
  mutedText: {
    color: '#6b7280',
    fontSize: '14px',
    margin: 0
  }
};
