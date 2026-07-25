import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, FileImage, Loader, Receipt, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { employeeAppPath } from '../../utils/employeeAppRouting';
import { getEmployeePortalSelectedBusinessId } from '../../utils/employeeProfileSelection';

const ACCEPT = 'image/*,.pdf,application/pdf,.jpg,.jpeg,.png,.webp';

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      if (!base64) reject(new Error('Could not read file'));
      else resolve(base64);
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });

const PortalExpenseReceipts = () => {
  const navigate = useNavigate();
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [businessId, setBusinessId] = useState(null);
  const [recentUploads, setRecentUploads] = useState([]);

  useEffect(() => {
    checkAccess();
    window.addEventListener('employee-profile-selection-changed', checkAccess);
    return () => window.removeEventListener('employee-profile-selection-changed', checkAccess);
  }, []);

  const checkAccess = async () => {
    try {
      setLoading(true);
      const selectedBusinessId = getEmployeePortalSelectedBusinessId();
      const { data, error } = await supabase.functions.invoke('employee-expense-receipt-upload', {
        body: { action: 'check_access', business_id: selectedBusinessId || undefined },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setAllowed(!!data?.allowed);
      setBusinessId(data?.business_id || selectedBusinessId || null);
      setBusinessName(data?.business_name || '');
      if (!data?.allowed) {
        toast.error('Only managers, admins, or owners can upload expense receipts.');
      }
    } catch (error) {
      console.error('[PortalExpenseReceipts] access check failed:', error);
      setAllowed(false);
      toast.error(error.message || 'Could not verify upload access');
    } finally {
      setLoading(false);
    }
  };

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length || uploading || !allowed) return;

    setUploading(true);
    let ok = 0;
    let failed = 0;
    const uploaded = [];

    try {
      for (const file of files) {
        try {
          const fileBase64 = await fileToBase64(file);
          const { data, error } = await supabase.functions.invoke('employee-expense-receipt-upload', {
            body: {
              action: 'upload',
              business_id: businessId || getEmployeePortalSelectedBusinessId() || undefined,
              filename: file.name || 'receipt.jpg',
              content_type: file.type || undefined,
              file_base64: fileBase64,
              extract: true,
            },
          });
          if (error) throw error;
          if (data?.error) throw new Error(data.error);
          ok += 1;
          uploaded.push({
            id: data?.draft?.id,
            name: file.name,
            extracted: data?.extraction?.ok === true,
            extractError: data?.extraction?.error || null,
          });
        } catch (fileErr) {
          console.error('[PortalExpenseReceipts] upload failed:', file?.name, fileErr);
          failed += 1;
        }
      }

      if (uploaded.length) {
        setRecentUploads((prev) => [...uploaded, ...prev].slice(0, 12));
      }

      if (ok > 0) {
        toast.success(
          `Uploaded ${ok} receipt${ok === 1 ? '' : 's'} to the expense queue${failed ? ` (${failed} failed)` : ''}.`
        );
      } else {
        toast.error('Upload failed');
      }
    } finally {
      setUploading(false);
      if (cameraInputRef.current) cameraInputRef.current.value = '';
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.muted}>Checking access…</div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div style={styles.page}>
        <button type="button" style={styles.backBtn} onClick={() => navigate(employeeAppPath('/portal/account'))}>
          <ArrowLeft size={18} /> Back to Account
        </button>
        <section style={styles.card}>
          <h1 style={styles.title}>Expense receipts</h1>
          <p style={styles.muted}>
            Receipt upload is only available for managers, admins, or owners on the selected business profile.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <button type="button" style={styles.backBtn} onClick={() => navigate(employeeAppPath('/portal/account'))}>
        <ArrowLeft size={18} /> Back to Account
      </button>

      <section style={styles.hero}>
        <div style={styles.eyebrow}>Accounting</div>
        <h1 style={styles.title}>Upload receipts</h1>
        <p style={styles.subtitle}>
          Send photos or PDFs to the Tavari Accounting expense queue
          {businessName ? ` for ${businessName}` : ''}. Review and approve them later in Accounting → Queue.
        </p>
      </section>

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        disabled={uploading}
        onChange={(e) => uploadFiles(e.target.files)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        style={{ display: 'none' }}
        disabled={uploading}
        onChange={(e) => uploadFiles(e.target.files)}
      />

      <section style={styles.actions}>
        <button
          type="button"
          style={styles.primaryBtn}
          disabled={uploading}
          onClick={() => cameraInputRef.current?.click()}
        >
          {uploading ? <Loader size={20} className="spin" /> : <Camera size={20} />}
          {uploading ? 'Uploading…' : 'Take photo'}
        </button>
        <button
          type="button"
          style={styles.secondaryBtn}
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={20} />
          Choose files
        </button>
      </section>

      <section style={styles.card}>
        <div style={styles.cardHeader}>
          <FileImage size={18} />
          <strong>Accepted files</strong>
        </div>
        <p style={styles.muted}>JPG, PNG, WEBP, or PDF — up to 10 MB each. Multi-select is supported.</p>
      </section>

      {recentUploads.length > 0 && (
        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <Receipt size={18} />
            <strong>Just uploaded</strong>
          </div>
          <ul style={styles.list}>
            {recentUploads.map((item) => (
              <li key={`${item.id}-${item.name}`} style={styles.listItem}>
                <span style={styles.fileName}>{item.name}</span>
                <span style={styles.status}>
                  {item.extracted ? 'Queued + extracted' : item.extractError ? 'Queued (extract later)' : 'Queued'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

const styles = {
  page: {
    padding: TavariStyles.spacing.lg,
    maxWidth: 720,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.lg,
    boxSizing: 'border-box',
  },
  backBtn: {
    alignSelf: 'flex-start',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    border: 'none',
    background: 'transparent',
    color: TavariStyles.colors.primary,
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0,
  },
  hero: {
    background: `linear-gradient(135deg, ${TavariStyles.colors.primary}, #0f766e)`,
    color: TavariStyles.colors.white,
    borderRadius: 24,
    padding: TavariStyles.spacing.xl,
    boxShadow: TavariStyles.shadows?.lg || '0 10px 20px rgba(0,0,0,0.15)',
  },
  eyebrow: {
    fontSize: TavariStyles.typography.fontSize.sm,
    opacity: 0.85,
    marginBottom: TavariStyles.spacing.xs,
  },
  title: {
    margin: 0,
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: TavariStyles.typography.fontWeight.bold,
  },
  subtitle: {
    marginTop: TavariStyles.spacing.sm,
    opacity: 0.95,
    lineHeight: 1.5,
  },
  actions: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: TavariStyles.spacing.md,
  },
  primaryBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    border: 'none',
    borderRadius: 16,
    padding: '16px 18px',
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    fontWeight: 700,
    fontSize: TavariStyles.typography.fontSize.base,
    cursor: 'pointer',
  },
  secondaryBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: 16,
    padding: '16px 18px',
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.gray900,
    fontWeight: 700,
    fontSize: TavariStyles.typography.fontSize.base,
    cursor: 'pointer',
  },
  card: {
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: 18,
    backgroundColor: TavariStyles.colors.white,
    padding: TavariStyles.spacing.lg,
    boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: TavariStyles.colors.gray900,
    marginBottom: TavariStyles.spacing.sm,
  },
  muted: {
    margin: 0,
    color: TavariStyles.colors.gray600,
    lineHeight: 1.45,
    fontSize: TavariStyles.typography.fontSize.sm,
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  listItem: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'center',
  },
  fileName: {
    color: TavariStyles.colors.gray900,
    fontSize: TavariStyles.typography.fontSize.sm,
    overflowWrap: 'anywhere',
  },
  status: {
    color: TavariStyles.colors.primary,
    fontSize: TavariStyles.typography.fontSize.xs,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
};

export default PortalExpenseReceipts;
