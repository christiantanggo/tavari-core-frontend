// File Storage module — HR/Accounting-style top tabs, action cards, dashboard
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  FiFolder,
  FiUpload,
  FiInbox,
  FiGrid,
  FiSettings,
  FiDownload,
  FiTrash2,
  FiLock,
  FiUnlock,
  FiCamera,
  FiFilter,
  FiSearch,
  FiEye,
  FiExternalLink,
  FiFileText,
  FiPrinter,
} from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { useModuleEnabled } from '../../hooks/useModuleEnabled';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import toast from 'react-hot-toast';
import ModuleDeactivationPanel from '../../components/Modules/ModuleDeactivationPanel';
import * as FileStorageService from '../../services/FileStorage/FileStorageService';
import { formatDateShort, formatDateTimeForBusiness, getBusinessTimezone } from '../../utils/businessDateFormat';

const TAB_ROUTES = {
  home: '/dashboard/file-storage',
  files: '/dashboard/file-storage/files',
  pending: '/dashboard/file-storage/pending',
  paperForms: '/dashboard/file-storage/paper-forms',
  categories: '/dashboard/file-storage/categories',
  upload: '/dashboard/file-storage/upload',
  settings: '/dashboard/file-storage/settings',
};

const TABS = [
  { id: 'home', label: 'Dashboard', icon: FiFolder },
  { id: 'files', label: 'Files', icon: FiGrid },
  { id: 'pending', label: 'Pending', icon: FiInbox },
  { id: 'paperForms', label: 'Paper Forms', icon: FiFileText },
  { id: 'categories', label: 'Categories', icon: FiFolder },
  { id: 'upload', label: 'Upload', icon: FiUpload },
  { id: 'settings', label: 'Settings', icon: FiSettings },
];

function isFileStorageSchemaMissingError(err) {
  const code = err?.code;
  const msg = String(err?.message || err || '').toLowerCase();
  if (code === '42P01') return true;
  if (msg.includes('file_storage_') && msg.includes('does not exist')) return true;
  if (msg.includes('file_storage_paper_forms') && msg.includes('does not exist')) return true;
  if (msg.includes('ensure_file_storage_defaults') && (msg.includes('schema cache') || msg.includes('not find'))) return true;
  return false;
}

function pathToTab(pathname) {
  if (pathname.includes('/file-storage/files')) return 'files';
  if (pathname.includes('/file-storage/pending')) return 'pending';
  if (pathname.includes('/file-storage/paper-forms')) return 'paperForms';
  if (pathname.includes('/file-storage/categories')) return 'categories';
  if (pathname.includes('/file-storage/upload')) return 'upload';
  if (pathname.includes('/file-storage/settings')) return 'settings';
  return 'home';
}

/** Client-side search across file rows (includes merged legacy paper waivers). */
function fileMatchesSearch(file, rawQuery) {
  const q = (rawQuery || '').trim().toLowerCase();
  if (!q) return true;
  const parts = [
    file.display_name,
    file.original_filename,
    file.file_storage_categories?.name,
    file.notes,
    file.linked_module_key,
    file.linked_entity_id != null ? String(file.linked_entity_id) : '',
    file.mime_type,
    file.document_date_start,
    file.document_date_end,
    file.file_path,
    file.storage_bucket,
  ];
  if (parts.some((s) => s && String(s).toLowerCase().includes(q))) return true;
  if (file.legal_hold && (q.includes('hold') || q.includes('legal'))) return true;
  return false;
}

function formatShortDateLocal(isoOrDate, businessTimezone) {
  if (isoOrDate == null || isoOrDate === '') return null;
  return formatDateShort(isoOrDate, businessTimezone);
}

/** Display document_date_start / document_date_end (or legacy waiver filled date as start). */
function formatDocumentDateCell(file, businessTimezone) {
  const start = formatShortDateLocal(file.document_date_start, businessTimezone);
  const end = formatShortDateLocal(file.document_date_end, businessTimezone);
  if (start && end) {
    if (start === end) return start;
    return `${start} – ${end}`;
  }
  if (start) return start;
  if (end) return end;
  return '—';
}

export default function FileStorageDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedBusinessId } = useBusinessContext();
  const { authLoading, userRole, businessData, isOwner } = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner', 'admin'],
    requireBusiness: true,
    componentName: 'FileStorageDashboard',
  });
  const { isEnabled, loading: modLoading } = useModuleEnabled('file_storage');
  /** Local Vite dev: show UI without business_module_usage row so you can build/test before enabling in Supabase */
  const moduleUnlocked = isEnabled || import.meta.env.DEV;
  const [activeTab, setActiveTab] = useState(() => pathToTab(location.pathname));
  const [categories, setCategories] = useState([]);
  const [files, setFiles] = useState([]);
  const [inbound, setInbound] = useState([]);
  const [paperForms, setPaperForms] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const ownerOk = typeof isOwner === 'function' ? isOwner() : userRole === 'owner';
  const businessTimezone = getBusinessTimezone(businessData);

  useEffect(() => setActiveTab(pathToTab(location.pathname)), [location.pathname]);

  const refresh = useCallback(async () => {
    if (!selectedBusinessId) return;
    setLoading(true);
    try {
      setSchemaMissing(false);
      await FileStorageService.ensureFileStorageDefaults(selectedBusinessId);
      const [cats, fl, pend, forms, st] = await Promise.all([
        FileStorageService.fetchCategories(selectedBusinessId),
        FileStorageService.fetchFiles(selectedBusinessId),
        FileStorageService.fetchInboundPending(selectedBusinessId),
        FileStorageService.fetchPaperForms(selectedBusinessId).catch((e) => {
          if (isFileStorageSchemaMissingError(e)) throw e;
          console.warn('fetchPaperForms:', e.message);
          return [];
        }),
        FileStorageService.fetchSettings(selectedBusinessId),
      ]);
      setCategories(cats);
      setFiles(fl);
      setInbound(pend);
      setPaperForms(forms);
      setSettings(st);
    } catch (e) {
      console.error(e);
      if (isFileStorageSchemaMissingError(e)) {
        setSchemaMissing(true);
        setCategories([]);
        setFiles([]);
        setInbound([]);
        setPaperForms([]);
        setSettings(null);
        toast.error('File Storage database tables are missing — run the full SQL migration in Supabase (see on-screen steps).', { duration: 6000 });
      } else {
        toast.error(e.message || 'Failed to load file storage');
      }
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId]);

  useEffect(() => {
    if (selectedBusinessId && moduleUnlocked) refresh();
  }, [selectedBusinessId, moduleUnlocked, refresh]);

  const handleTab = (id) => {
    const p = TAB_ROUTES[id] || TAB_ROUTES.home;
    navigate(p);
    setActiveTab(id);
  };

  if (authLoading || modLoading) {
    return (
      <POSAuthWrapper componentName="FileStorageDashboard">
        <div style={TavariStyles.loadingContainer}>Loading…</div>
      </POSAuthWrapper>
    );
  }

  if (!moduleUnlocked) {
    return (
      <POSAuthWrapper componentName="FileStorageDashboard">
        <div style={{ padding: 48, textAlign: 'center', maxWidth: 520, margin: '0 auto' }}>
          <h2>File Storage</h2>
          <p style={{ color: TavariStyles.colors.gray600 }}>
            Turn on <strong>File Storage</strong> for this business in <strong>Tavari Modules</strong> (or App Builder module management).
          </p>
          <p style={{ color: TavariStyles.colors.gray600, fontSize: 14 }}>
            If the module is missing from the list, run <strong>step 1</strong> then <strong>step 2</strong> in Supabase (see{' '}
            <code style={{ fontSize: 13 }}>RUN_THIS_enable_file_storage_module.sql</code> header).
          </p>
        </div>
      </POSAuthWrapper>
    );
  }

  if (schemaMissing) {
    return (
      <POSAuthWrapper componentName="FileStorageDashboard">
        <div style={{ padding: '32px 24px', maxWidth: 720, margin: '0 auto', fontFamily: TavariStyles.typography.fontFamily }}>
          <h1 style={{ marginTop: 0 }}>File Storage — run the database migration first</h1>
          <p style={{ color: TavariStyles.colors.gray700, lineHeight: 1.6 }}>
            Your Supabase project does not have the File Storage tables yet. The error{' '}
            <code>relation &quot;file_storage_categories&quot; does not exist</code> means the <strong>schema</strong> was never
            applied to <strong>this</strong> project (even if you ran SQL locally).
          </p>
          <div
            style={{
              background: '#fef3c7',
              border: '1px solid #f59e0b',
              borderRadius: 8,
              padding: 16,
              margin: '20px 0',
            }}
          >
            <strong>Common mistake:</strong> <code>RUN_THIS_enable_file_storage_module.sql</code> only enables the module in the
            UI. It does <strong>not</strong> create tables. You must run the full migration file first.
          </div>
          <h2 style={{ fontSize: 18 }}>Do this in Supabase (hosted project)</h2>
          <ol style={{ lineHeight: 1.8, color: TavariStyles.colors.gray800 }}>
            <li>
              Open{' '}
              <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">
                Supabase Dashboard
              </a>{' '}
              → your project → <strong>SQL Editor</strong> → New query.
            </li>
            <li>
              In your repo, open <code>supabase/migrations/20260324120000_file_storage_module.sql</code> — copy the{' '}
              <strong>entire</strong> file (all lines).
            </li>
            <li>Paste into the SQL Editor and click <strong>Run</strong>.</li>
            <li>
              (Optional) Then run <code>RUN_THIS_enable_file_storage_module.sql</code> if the sidebar module toggle is still off.
            </li>
            <li>Reload this app page.</li>
          </ol>
          <p style={{ color: TavariStyles.colors.gray600, fontSize: 14 }}>
            CLI alternative from the project root: <code>npx supabase db push</code> (links your migrations to the linked remote
            project).
          </p>
          <button
            type="button"
            style={{
              marginTop: 16,
              padding: '12px 20px',
              borderRadius: 8,
              border: 'none',
              background: TavariStyles.colors.primary,
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
            onClick={() => refresh()}
          >
            Retry after running SQL
          </button>
        </div>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper componentName="FileStorageDashboard">
      <SecurityWrapper componentName="FileStorageDashboard" sensitiveComponent>
        <div style={styles.container}>
          {import.meta.env.DEV && !isEnabled && (
            <div
              style={{
                marginBottom: 16,
                padding: '10px 14px',
                background: '#fef3c7',
                borderRadius: 8,
                fontSize: 13,
                color: '#92400e',
              }}
            >
              <strong>Dev mode:</strong> File Storage is unlocked without enabling it in the database. Production builds still require{' '}
              <code>business_module_usage</code> (run <code>RUN_THIS_enable_file_storage_module.sql</code> or enable in Tavari Modules).
            </div>
          )}
          <TavariModuleHeader
            title="File Storage"
            description="Store, organize, upload, and review business documents with retention controls."
            actionLabel="Upload File"
            actionIcon={<FiUpload size={18} />}
            onAction={() => handleTab('upload')}
          />

          <TavariTabSystemComponent
            tabs={TABS.map((tab) => ({
              id: tab.id,
              label: tab.label,
              icon: tab.icon,
            }))}
            mode="state"
            activeTab={activeTab}
            onTabChange={handleTab}
            ariaLabel="File Storage module"
            variant="module"
          />

          <div style={styles.tabContent}>
            {activeTab === 'home' && (
              <HomeTab
                files={files}
                inbound={inbound}
                categories={categories}
                loading={loading}
                onRefresh={refresh}
                onGo={(t) => handleTab(t)}
                businessTimezone={businessTimezone}
              />
            )}
            {activeTab === 'files' && (
              <FilesTab
                files={files}
                categories={categories}
                loading={loading}
                onRefresh={refresh}
                selectedBusinessId={selectedBusinessId}
                ownerOk={ownerOk}
                businessTimezone={businessTimezone}
              />
            )}
            {activeTab === 'pending' && (
              <PendingTab
                inbound={inbound}
                categories={categories}
                loading={loading}
                onRefresh={refresh}
                selectedBusinessId={selectedBusinessId}
              />
            )}
            {activeTab === 'paperForms' && (
              <PaperFormsTab
                paperForms={paperForms}
                loading={loading}
                onRefresh={refresh}
                selectedBusinessId={selectedBusinessId}
                businessTimezone={businessTimezone}
                ownerOk={ownerOk}
              />
            )}
            {activeTab === 'categories' && (
              <CategoriesTab categories={categories} loading={loading} onRefresh={refresh} selectedBusinessId={selectedBusinessId} />
            )}
            {activeTab === 'upload' && (
              <UploadTab categories={categories} selectedBusinessId={selectedBusinessId} onDone={refresh} />
            )}
            {activeTab === 'settings' && (
              <SettingsTab
                settings={settings}
                selectedBusinessId={selectedBusinessId}
                ownerOk={ownerOk}
                onRefresh={refresh}
              />
            )}
          </div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
}

function HomeTab({ files, inbound, categories, loading, onRefresh, onGo, businessTimezone }) {
  const [fileSearch, setFileSearch] = useState('');
  const displayedFiles = useMemo(() => {
    const q = fileSearch.trim();
    if (!q) return files.slice(0, 10);
    return files.filter((f) => fileMatchesSearch(f, q)).slice(0, 50);
  }, [files, fileSearch]);
  const roots = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);
  const countByCat = useMemo(() => {
    const m = {};
    const paperCat = categories.find((c) => c.system_key === 'paper_waiver');
    for (const f of files) {
      let cid = f.category_id;
      if (f.is_legacy_waiver_upload && !cid && paperCat) cid = paperCat.id;
      if (!cid) continue;
      m[cid] = (m[cid] || 0) + 1;
    }
    return m;
  }, [files, categories]);
  const holdCount = useMemo(() => files.filter((f) => f.legal_hold).length, [files]);

  const subCount = (parentId) => categories.filter((c) => c.parent_id === parentId).length;

  return (
    <div>
      <div style={styles.statsGrid}>
        <button type="button" style={styles.statCardButton} onClick={() => onGo('files')}>
          <h3 style={styles.statTitle}>Total files</h3>
          <p style={{ ...styles.statValue, color: TavariStyles.colors.primary }}>{files.length}</p>
        </button>
        <button type="button" style={styles.statCardButton} onClick={() => onGo('pending')}>
          <h3 style={styles.statTitle}>Pending email</h3>
          <p style={{ ...styles.statValue, color: TavariStyles.colors.warning }}>{inbound.length}</p>
        </button>
        <button type="button" style={styles.statCardButton} onClick={() => onGo('categories')}>
          <h3 style={styles.statTitle}>Categories</h3>
          <p style={{ ...styles.statValue, color: TavariStyles.colors.success }}>{categories.length}</p>
        </button>
        <button type="button" style={styles.statCardButton} onClick={() => onGo('files')}>
          <h3 style={styles.statTitle}>Legal hold</h3>
          <p style={{ ...styles.statValue, color: TavariStyles.colors.gray700 }}>{holdCount}</p>
        </button>
      </div>

      <div style={styles.recentSection}>
        <h2 style={styles.sectionTitle}>Quick actions</h2>
        <div style={styles.waiverList}>
          <button type="button" style={styles.waiverCard} onClick={() => onGo('upload')}>
            <div style={styles.waiverInfo}>
              <h4 style={styles.waiverName}>
                <FiUpload size={20} style={{ verticalAlign: 'middle', marginRight: 10, color: TavariStyles.colors.primary }} />
                Upload
              </h4>
              <p style={styles.waiverContact}>Files auto-approve when uploaded from the app</p>
            </div>
          </button>
          <button type="button" style={styles.waiverCard} onClick={() => onGo('pending')}>
            <div style={styles.waiverInfo}>
              <h4 style={styles.waiverName}>
                <FiInbox size={20} style={{ verticalAlign: 'middle', marginRight: 10, color: TavariStyles.colors.warning }} />
                Pending ({inbound.length})
              </h4>
              <p style={styles.waiverContact}>Email intake — approve into a category</p>
            </div>
          </button>
          <button type="button" style={styles.waiverCard} onClick={() => onGo('paperForms')}>
            <div style={styles.waiverInfo}>
              <h4 style={styles.waiverName}>
                <FiFileText size={20} style={{ verticalAlign: 'middle', marginRight: 10, color: TavariStyles.colors.primary }} />
                Paper Forms
              </h4>
              <p style={styles.waiverContact}>Printable blank and legacy forms for staff</p>
            </div>
          </button>
          <button type="button" style={styles.waiverCard} onClick={() => onGo('files')}>
            <div style={styles.waiverInfo}>
              <h4 style={styles.waiverName}>
                <FiGrid size={20} style={{ verticalAlign: 'middle', marginRight: 10, color: TavariStyles.colors.primary }} />
                All files
              </h4>
              <p style={styles.waiverContact}>View, download, legal hold</p>
            </div>
          </button>
        </div>
      </div>

      <div style={{ ...styles.recentSection, marginTop: TavariStyles.spacing.xl || '24px' }}>
        <h2 style={styles.sectionTitle}>Categories</h2>
        {loading ? (
          <p style={styles.muted}>Loading…</p>
        ) : roots.length === 0 ? (
          <p style={styles.emptyState}>No categories yet.</p>
        ) : (
          <div style={styles.waiverList}>
            {roots.map((c) => (
              <div
                key={c.id}
                style={{
                  ...styles.waiverCard,
                  cursor: 'default',
                  borderLeft: `4px solid ${c.color || TavariStyles.colors.primary}`,
                }}
              >
                <div style={styles.waiverInfo}>
                  <h4 style={styles.waiverName}>
                    <span style={{ marginRight: 10, fontSize: '1.25rem' }} aria-hidden>
                      {c.icon_key || '📁'}
                    </span>
                    {c.name}
                    {c.is_system && <span style={styles.badge}>System</span>}
                  </h4>
                  <p style={styles.waiverContact}>
                    {subCount(c.id)} subcategories · {countByCat[c.id] || 0} files
                    {c.retention_years != null ? ` · ${c.retention_years} yr retention` : ''}
                  </p>
                </div>
                <div style={styles.waiverStatus}>
                  <button type="button" style={styles.textLinkBtn} onClick={() => onGo('categories')}>
                    Manage
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ ...styles.recentSection, marginTop: TavariStyles.spacing.xl || '24px' }}>
        <div style={styles.sectionHeadRow}>
          <h2 style={{ ...styles.sectionTitle, marginBottom: 0 }}>
            {fileSearch.trim() ? 'Matching files' : 'Recent files'}
          </h2>
          <button type="button" style={styles.linkBtn} onClick={onRefresh} disabled={loading}>
            Refresh
          </button>
        </div>
        <div style={{ ...styles.searchGroup, marginBottom: TavariStyles.spacing.lg || '16px', maxWidth: 480 }}>
          <FiSearch size={20} style={styles.searchIcon} />
          <input
            type="search"
            placeholder="Search files by name, category, notes…"
            value={fileSearch}
            onChange={(e) => setFileSearch(e.target.value)}
            style={styles.searchInput}
            aria-label="Search files"
          />
        </div>
        {loading ? (
          <div style={styles.loadingState}>
            <p>Loading…</p>
          </div>
        ) : files.length === 0 ? (
          <p style={styles.emptyState}>No files yet. Upload or approve email intake.</p>
        ) : displayedFiles.length === 0 ? (
          <p style={styles.emptyState}>No files match your search.</p>
        ) : (
          <div style={styles.waiverList}>
            {displayedFiles.map((f) => (
              <div
                key={f.is_legacy_waiver_upload ? `legacy-${f.waiver_upload_id}` : f.id}
                style={{ ...styles.waiverCard, cursor: 'default' }}
              >
                <div style={styles.waiverInfo}>
                  <h4 style={styles.waiverName}>
                    {f.display_name || f.original_filename}
                    {f.is_legacy_waiver_upload && (
                      <span style={{ ...styles.badge, marginLeft: 8 }}>Waivers</span>
                    )}
                  </h4>
                  <p style={styles.waiverContact}>{f.file_storage_categories?.name || '—'}</p>
                  {f.uploaded_at && (
                    <p style={styles.waiverDate}>
                      {formatDateTimeForBusiness(f.uploaded_at, businessTimezone)}
                    </p>
                  )}
                </div>
                {f.legal_hold && (
                  <div style={styles.waiverStatus} title="Legal hold">
                    <FiLock size={22} style={{ color: TavariStyles.colors.warning }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilesTab({ files, categories, loading, onRefresh, selectedBusinessId, ownerOk, businessTimezone }) {
  const [catFilter, setCatFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const paperCategoryId = useMemo(
    () => categories.find((c) => c.system_key === 'paper_waiver')?.id,
    [categories],
  );

  const filtered = useMemo(() => {
    let list = files;
    if (catFilter) {
      list = list.filter((f) => {
        if (f.category_id === catFilter) return true;
        if (f.is_legacy_waiver_upload && !f.category_id && paperCategoryId && catFilter === paperCategoryId) return true;
        return false;
      });
    }
    if (searchTerm.trim()) {
      list = list.filter((f) => fileMatchesSearch(f, searchTerm));
    }
    return list;
  }, [files, catFilter, paperCategoryId, searchTerm]);

  const download = async (row) => {
    try {
      const bucket = row.storage_bucket || 'business-files';
      const url = await FileStorageService.getSignedUrl(row.file_path, 3600, bucket);
      if (!row.is_legacy_waiver_upload) {
        await FileStorageService.logFileAccess(selectedBusinessId, row.id, 'download', {});
      }
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast.error(e.message || 'Download failed');
    }
  };

  const softDelete = async (row) => {
    if (row.is_legacy_waiver_upload) {
      if (!window.confirm('Delete this paper waiver from Waivers storage? This removes the file and the upload record.')) return;
      try {
        await FileStorageService.deleteLegacyPaperWaiverUpload(row.waiver_upload_id);
        toast.success('Paper waiver removed');
        onRefresh();
      } catch (e) {
        toast.error(e.message || 'Delete failed');
      }
      return;
    }
    if (!window.confirm('Soft-delete this file? (Owner only; file remains in storage.)')) return;
    try {
      await FileStorageService.softDeleteFile(row.id, selectedBusinessId);
      toast.success('File removed from list');
      onRefresh();
    } catch (e) {
      toast.error(e.message || 'Delete failed');
    }
  };

  const toggleHold = async (row) => {
    if (row.is_legacy_waiver_upload) return;
    try {
      await FileStorageService.setLegalHold(row.id, selectedBusinessId, !row.legal_hold);
      toast.success(row.legal_hold ? 'Legal hold cleared' : 'Legal hold on');
      onRefresh();
    } catch (e) {
      toast.error(e.message || 'Update failed');
    }
  };

  return (
    <div>
      <div style={styles.controls}>
        <div style={styles.searchSection}>
          <div style={styles.searchGroup}>
            <FiSearch size={20} style={styles.searchIcon} />
            <input
              type="search"
              placeholder="Search by name, category, notes, module link, path…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={styles.searchInput}
              aria-label="Search files"
            />
          </div>
          <div style={styles.filterGroup}>
            <FiFilter size={20} style={styles.filterIcon} />
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              style={styles.filterSelect}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon_key ? `${c.icon_key} ` : ''}
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <button type="button" style={styles.secondaryBtn} onClick={onRefresh} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>
      {loading ? (
        <div style={styles.loadingState}>
          <p>Loading…</p>
        </div>
      ) : (
        <div style={styles.recentSection}>
          <h2 style={styles.sectionTitle}>Files</h2>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Category</th>
                <th style={styles.th}>Document date</th>
                <th style={styles.th}>Uploaded</th>
                <th style={styles.th}>Hold</th>
                <th style={styles.th} />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td style={{ ...styles.td, textAlign: 'center', color: TavariStyles.colors.gray600 }} colSpan={6}>
                    {files.length === 0
                      ? 'No files yet.'
                      : 'No files match your search or category filter.'}
                  </td>
                </tr>
              ) : (
                filtered.map((f) => (
                <tr key={f.is_legacy_waiver_upload ? `legacy-${f.waiver_upload_id}` : f.id}>
                  <td style={styles.td}>
                    {f.display_name || f.original_filename}
                    {f.is_legacy_waiver_upload && (
                      <span style={{ ...styles.badge, marginLeft: 8 }} title="Uploaded via Waivers → Paper Waivers before File Storage">
                        Waivers
                      </span>
                    )}
                  </td>
                  <td style={styles.td}>{f.file_storage_categories?.name || '—'}</td>
                  <td style={styles.td}>{formatDocumentDateCell(f, businessTimezone)}</td>
                  <td style={styles.td}>{f.uploaded_at ? formatDateTimeForBusiness(f.uploaded_at, businessTimezone) : '—'}</td>
                  <td style={styles.td}>{f.is_legacy_waiver_upload ? '—' : f.legal_hold ? 'Yes' : '—'}</td>
                  <td style={styles.td}>
                    <button type="button" style={styles.iconBtn} title="Download" onClick={() => download(f)}>
                      <FiDownload />
                    </button>
                    {!f.is_legacy_waiver_upload && (
                      <button type="button" style={styles.iconBtn} title="Legal hold" onClick={() => toggleHold(f)}>
                        {f.legal_hold ? <FiUnlock /> : <FiLock />}
                      </button>
                    )}
                    {ownerOk && (
                      <button
                        type="button"
                        style={styles.iconBtnDanger}
                        title={f.is_legacy_waiver_upload ? 'Delete paper waiver (Waivers storage)' : 'Delete (owner)'}
                        onClick={() => softDelete(f)}
                      >
                        <FiTrash2 />
                      </button>
                    )}
                  </td>
                </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

function filePreviewKind(row) {
  const mime = (row?.mime_type || '').toLowerCase();
  const name = (row?.original_filename || '').toLowerCase();
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (mime.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|heic)$/.test(name)) return 'image';
  return 'other';
}

function PendingTab({ inbound, categories, loading, onRefresh, selectedBusinessId }) {
  const [sel, setSel] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [cat, setCat] = useState('');
  const [meta, setMeta] = useState({
    display_name: '',
    document_date_start: '',
    document_date_end: '',
    firstName: '',
    lastName: '',
    waiverFilledDate: '',
    dateOfBirth: '',
    phoneNumber: '',
    email: '',
    linked_module_key: '',
    linked_entity_id: '',
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPreviewUrl(null);
      setPreviewError(null);
      if (!sel?.file_path) {
        if (!cancelled) setPreviewLoading(false);
        return;
      }
      setPreviewLoading(true);
      try {
        const url = await FileStorageService.getSignedUrl(sel.file_path, 3600);
        if (!cancelled) setPreviewUrl(url || null);
      } catch (e) {
        if (!cancelled) setPreviewError(e.message || 'Could not load preview');
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sel?.id, sel?.file_path]);

  const openPreviewTab = () => {
    if (previewUrl) window.open(previewUrl, '_blank', 'noopener');
  };

  const approve = async () => {
    if (!sel || !cat) {
      toast.error('Select a row and category');
      return;
    }
    try {
      await FileStorageService.approveInbound(selectedBusinessId, sel, cat, meta);
      toast.success('Approved');
      setSel(null);
      onRefresh();
    } catch (e) {
      toast.error(e.message || 'Approve failed');
    }
  };

  const reject = async (row) => {
    const reason = window.prompt('Reason (optional)?') || '';
    try {
      await FileStorageService.rejectInbound(row.id, reason);
      toast.success('Rejected');
      onRefresh();
    } catch (e) {
      toast.error(e.message || 'Reject failed');
    }
  };

  const paper = categories.find((c) => c.system_key === 'paper_waiver');
  const previewKind = sel ? filePreviewKind(sel) : null;

  return (
    <div style={styles.split}>
      <div style={{ flex: '0 0 300px', minWidth: 260, maxWidth: '100%' }}>
        <div style={styles.recentSection}>
          <h2 style={styles.sectionTitle}>Inbound (email)</h2>
          {loading ? (
            <div style={styles.loadingState}>
              <p>Loading…</p>
            </div>
          ) : inbound.length === 0 ? (
            <p style={styles.emptyState}>No pending items.</p>
          ) : (
            <div style={styles.waiverList}>
              {inbound.map((r) => (
                <div
                  key={r.id}
                  style={{
                    ...styles.waiverCard,
                    cursor: 'default',
                    ...(sel?.id === r.id ? { borderColor: TavariStyles.colors.primary, background: '#eff6ff' } : {}),
                  }}
                >
                  <button type="button" style={styles.inboundBtn} onClick={() => setSel(r)}>
                    <div style={styles.waiverInfo}>
                      <h4 style={styles.waiverName}>{r.original_filename || 'file'}</h4>
                      <p style={styles.waiverContact}>
                        From {r.from_address} · {r.subject || '(no subject)'}
                      </p>
                    </div>
                  </button>
                  <div style={styles.waiverStatus}>
                    <button type="button" style={styles.smallDanger} onClick={() => reject(r)}>
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{ ...styles.recentSection, ...styles.previewPanel }}>
        <div style={styles.previewHeader}>
          <h2 style={styles.sectionTitle}>Document preview</h2>
          {sel && previewUrl && (
            <button type="button" style={styles.secondaryBtn} onClick={openPreviewTab} title="Open in new tab">
              <FiExternalLink size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              Open
            </button>
          )}
        </div>
        {!sel ? (
          <p style={styles.emptyState}>Select a file on the left to preview the attachment before approving.</p>
        ) : previewLoading ? (
          <div style={styles.loadingState}>
            <p>Loading preview…</p>
          </div>
        ) : previewError ? (
          <div style={styles.previewFrame}>
            <p style={{ ...styles.emptyState, color: TavariStyles.colors.danger || '#b91c1c' }}>{previewError}</p>
          </div>
        ) : !previewUrl ? (
          <p style={styles.emptyState}>Preview unavailable.</p>
        ) : previewKind === 'pdf' ? (
          <div style={styles.previewFrame}>
            <iframe title={`Preview: ${sel.original_filename || 'document'}`} src={previewUrl} style={styles.previewIframe} />
          </div>
        ) : previewKind === 'image' ? (
          <div style={{ ...styles.previewFrame, padding: 12, overflow: 'auto' }}>
            <img src={previewUrl} alt={sel.original_filename || 'Attachment'} style={styles.previewImage} />
          </div>
        ) : (
          <div style={styles.previewFrame}>
            <div style={{ ...styles.emptyState, padding: 24 }}>
              <FiEye size={32} style={{ marginBottom: 12, opacity: 0.5 }} />
              <p style={{ margin: '0 0 12px' }}>
                Inline preview is not available for this file type
                {sel.mime_type ? ` (${sel.mime_type})` : ''}.
              </p>
              <button type="button" style={styles.primaryBtn} onClick={openPreviewTab}>
                Open file
              </button>
            </div>
          </div>
        )}
      </div>
      <div style={{ ...styles.recentSection, flex: '0 0 340px', minWidth: 280 }}>
        <h2 style={styles.sectionTitle}>Approve into category</h2>
        {!sel ? (
          <p style={styles.emptyState}>Select a file on the left.</p>
        ) : (
          <>
            <label style={styles.lbl}>
              Category *
              <select value={cat} onChange={(e) => setCat(e.target.value)} style={styles.select}>
                <option value="">— choose —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={styles.lbl}>
              Display name
              <input
                style={styles.input}
                value={meta.display_name}
                onChange={(e) => setMeta((m) => ({ ...m, display_name: e.target.value }))}
                placeholder={sel.original_filename}
              />
            </label>
            <label style={styles.lbl}>
              Document start
              <input
                type="date"
                style={styles.input}
                value={meta.document_date_start}
                onChange={(e) => setMeta((m) => ({ ...m, document_date_start: e.target.value }))}
              />
            </label>
            <label style={styles.lbl}>
              Document end
              <input
                type="date"
                style={styles.input}
                value={meta.document_date_end}
                onChange={(e) => setMeta((m) => ({ ...m, document_date_end: e.target.value }))}
              />
            </label>
            {paper && cat === paper.id && (
              <div style={styles.box}>
                <div style={styles.mutedSm}>Paper waiver participant</div>
                <input
                  style={styles.input}
                  placeholder="First name *"
                  value={meta.firstName}
                  onChange={(e) => setMeta((m) => ({ ...m, firstName: e.target.value }))}
                />
                <input
                  style={styles.input}
                  placeholder="Last name *"
                  value={meta.lastName}
                  onChange={(e) => setMeta((m) => ({ ...m, lastName: e.target.value }))}
                />
                <label style={styles.lbl}>
                  Waiver signed date (optional)
                  <input
                    type="date"
                    style={styles.input}
                    value={meta.waiverFilledDate}
                    onChange={(e) => setMeta((m) => ({ ...m, waiverFilledDate: e.target.value }))}
                  />
                  <span style={styles.mutedSm}>If empty, Document start above is used.</span>
                </label>
                <input
                  style={styles.input}
                  placeholder="Email"
                  value={meta.email}
                  onChange={(e) => setMeta((m) => ({ ...m, email: e.target.value }))}
                />
              </div>
            )}
            <label style={styles.lbl}>
              Linked module key (optional)
              <input
                style={styles.input}
                value={meta.linked_module_key}
                onChange={(e) => setMeta((m) => ({ ...m, linked_module_key: e.target.value }))}
                placeholder="bookings"
              />
            </label>
            <label style={styles.lbl}>
              Linked entity id (optional)
              <input
                style={styles.input}
                value={meta.linked_entity_id}
                onChange={(e) => setMeta((m) => ({ ...m, linked_entity_id: e.target.value }))}
              />
            </label>
            <button type="button" style={styles.primaryBtn} onClick={approve}>
              Approve
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function PaperFormsTab({ paperForms, loading, onRefresh, selectedBusinessId, businessTimezone, ownerOk }) {
  const [sel, setSel] = useState(null);
  const [formName, setFormName] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const previewIframeRef = useRef(null);
  const fileInputRef = useRef(null);
  const replaceInputRef = useRef(null);
  const [pendingUploadFile, setPendingUploadFile] = useState(null);
  const [pendingReplaceFile, setPendingReplaceFile] = useState(null);

  useEffect(() => {
    setPendingReplaceFile(null);
    if (replaceInputRef.current) replaceInputRef.current.value = '';
  }, [sel?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPreviewUrl(null);
      setPreviewError(null);
      if (!sel?.file_path) {
        if (!cancelled) setPreviewLoading(false);
        return;
      }
      setPreviewLoading(true);
      try {
        const url = await FileStorageService.getSignedUrl(sel.file_path, 3600, sel.storage_bucket || 'business-files');
        if (!cancelled) setPreviewUrl(url || null);
      } catch (e) {
        if (!cancelled) setPreviewError(e.message || 'Could not load preview');
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sel?.id, sel?.file_path, sel?.storage_bucket]);

  const previewKind = sel ? filePreviewKind(sel) : null;

  const uploadNew = async (file) => {
    if (!file) {
      toast.error('Choose a file to upload');
      return;
    }
    const name = formName.trim();
    if (!name) {
      toast.error('Enter a form name');
      return;
    }
    setBusy(true);
    try {
      const row = await FileStorageService.uploadPaperForm(selectedBusinessId, name, file);
      toast.success('Form uploaded');
      setFormName('');
      setPendingUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setSel(row);
      onRefresh();
    } catch (e) {
      toast.error(e.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const replaceSelected = async (file) => {
    if (!sel) return;
    if (!file) {
      toast.error('Choose a file to replace with');
      return;
    }
    setBusy(true);
    try {
      const row = await FileStorageService.replacePaperFormFile(sel.id, selectedBusinessId, file);
      toast.success('Form file updated');
      setPendingReplaceFile(null);
      if (replaceInputRef.current) replaceInputRef.current.value = '';
      setSel(row);
      onRefresh();
    } catch (e) {
      toast.error(e.message || 'Replace failed');
    } finally {
      setBusy(false);
    }
  };

  const removeForm = async (row) => {
    if (!window.confirm(`Remove "${row.name}" from the forms library?`)) return;
    try {
      await FileStorageService.deletePaperForm(row.id, selectedBusinessId);
      toast.success('Form removed');
      if (sel?.id === row.id) setSel(null);
      onRefresh();
    } catch (e) {
      toast.error(e.message || 'Remove failed');
    }
  };

  const openPreviewTab = () => {
    if (previewUrl) window.open(previewUrl, '_blank', 'noopener');
  };

  const downloadForm = async () => {
    if (!previewUrl || !sel) return;
    try {
      const res = await fetch(previewUrl);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = sel.original_filename || `${sel.name}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      toast.error(e.message || 'Download failed');
    }
  };

  const printForm = () => {
    if (!previewUrl) return;
    if (previewKind === 'pdf' && previewIframeRef.current?.contentWindow) {
      try {
        previewIframeRef.current.contentWindow.focus();
        previewIframeRef.current.contentWindow.print();
        return;
      } catch (_) {
        /* fall through */
      }
    }
    const w = window.open(previewUrl, '_blank', 'noopener');
    if (w) {
      w.onload = () => {
        try {
          w.print();
        } catch (_) {
          /* ignore */
        }
      };
    }
  };

  const formatFormDate = (iso) => (iso ? formatDateTimeForBusiness(iso, businessTimezone) : '—');

  return (
    <div style={styles.paperFormsSplit}>
      <div style={styles.paperFormsCol1}>
        <div style={styles.recentSection}>
          <h2 style={styles.sectionTitle}>Upload form</h2>
          <p style={styles.mutedSm}>
            Add printable blank or legacy forms for staff when digital systems are down or unavailable.
          </p>
          <label style={styles.lbl}>
            Form name *
            <input
              style={styles.input}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g. Incident report, Legacy waiver"
              disabled={busy}
            />
          </label>
          <label style={styles.lbl}>
            File (PDF or image)
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*"
              style={styles.input}
              disabled={busy}
              onChange={(e) => setPendingUploadFile(e.target.files?.[0] || null)}
            />
          </label>
          {pendingUploadFile && (
            <p style={styles.mutedSm}>
              Selected: <strong>{pendingUploadFile.name}</strong>
            </p>
          )}
          <button
            type="button"
            style={{
              ...styles.primaryBtn,
              width: '100%',
              opacity: busy || !formName.trim() || !pendingUploadFile ? 0.6 : 1,
              cursor: busy || !formName.trim() || !pendingUploadFile ? 'not-allowed' : 'pointer',
            }}
            disabled={busy || !formName.trim() || !pendingUploadFile}
            onClick={() => uploadNew(pendingUploadFile)}
          >
            <FiUpload size={16} style={{ marginRight: 8, verticalAlign: 'middle' }} />
            {busy ? 'Uploading…' : 'Upload form'}
          </button>
          {sel && (
            <div style={{ ...styles.box, marginTop: 12 }}>
              <div style={styles.mutedSm}>
                Replace file for selected form: <strong>{sel.name}</strong>
              </div>
              <label style={{ ...styles.lbl, marginTop: 8 }}>
                New file
                <input
                  ref={replaceInputRef}
                  type="file"
                  accept=".pdf,image/*"
                  style={styles.input}
                  disabled={busy}
                  onChange={(e) => setPendingReplaceFile(e.target.files?.[0] || null)}
                />
              </label>
              {pendingReplaceFile && (
                <p style={styles.mutedSm}>
                  Selected: <strong>{pendingReplaceFile.name}</strong>
                </p>
              )}
              <button
                type="button"
                style={{
                  ...styles.secondaryBtn,
                  width: '100%',
                  marginTop: 8,
                  opacity: busy || !pendingReplaceFile ? 0.6 : 1,
                  cursor: busy || !pendingReplaceFile ? 'not-allowed' : 'pointer',
                }}
                disabled={busy || !pendingReplaceFile}
                onClick={() => replaceSelected(pendingReplaceFile)}
              >
                {busy ? 'Updating…' : 'Replace file'}
              </button>
            </div>
          )}
        </div>

        <div style={{ ...styles.recentSection, marginTop: TavariStyles.spacing.xl || '24px' }}>
          <h2 style={styles.sectionTitle}>Forms library</h2>
          {loading ? (
            <div style={styles.loadingState}>
              <p>Loading…</p>
            </div>
          ) : paperForms.length === 0 ? (
            <p style={styles.emptyState}>No paper forms yet. Upload one above.</p>
          ) : (
            <div style={styles.waiverList}>
              {paperForms.map((f) => {
                const updated =
                  f.updated_at &&
                  f.uploaded_at &&
                  new Date(f.updated_at).getTime() !== new Date(f.uploaded_at).getTime();
                return (
                  <div
                    key={f.id}
                    style={{
                      ...styles.waiverCard,
                      cursor: 'default',
                      ...(sel?.id === f.id ? { borderColor: TavariStyles.colors.primary, background: '#eff6ff' } : {}),
                    }}
                  >
                    <button type="button" style={styles.inboundBtn} onClick={() => setSel(f)}>
                      <div style={styles.waiverInfo}>
                        <h4 style={styles.waiverName}>{f.name}</h4>
                        <p style={styles.waiverContact}>Uploaded {formatFormDate(f.uploaded_at)}</p>
                        {updated && (
                          <p style={styles.waiverDate}>Updated {formatFormDate(f.updated_at)}</p>
                        )}
                      </div>
                    </button>
                    {ownerOk && (
                      <div style={styles.waiverStatus}>
                        <button type="button" style={styles.smallDanger} onClick={() => removeForm(f)}>
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div style={{ ...styles.recentSection, ...styles.paperFormsCol2 }}>
        <div style={styles.previewHeader}>
          <h2 style={styles.sectionTitle}>Preview</h2>
          {sel && previewUrl && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" style={styles.secondaryBtn} onClick={downloadForm} title="Download">
                <FiDownload size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                Download
              </button>
              <button type="button" style={styles.secondaryBtn} onClick={printForm} title="Print">
                <FiPrinter size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                Print
              </button>
              <button type="button" style={styles.secondaryBtn} onClick={openPreviewTab} title="Open in new tab">
                <FiExternalLink size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                Open
              </button>
            </div>
          )}
        </div>
        {!sel ? (
          <p style={styles.emptyState}>Select a form to preview, download, or print.</p>
        ) : previewLoading ? (
          <div style={styles.loadingState}>
            <p>Loading preview…</p>
          </div>
        ) : previewError ? (
          <div style={styles.previewFrame}>
            <p style={{ ...styles.emptyState, color: TavariStyles.colors.danger || '#b91c1c' }}>{previewError}</p>
          </div>
        ) : !previewUrl ? (
          <p style={styles.emptyState}>Preview unavailable.</p>
        ) : previewKind === 'pdf' ? (
          <div style={styles.previewFrame}>
            <iframe
              ref={previewIframeRef}
              title={`Preview: ${sel.name}`}
              src={previewUrl}
              style={styles.previewIframe}
            />
          </div>
        ) : previewKind === 'image' ? (
          <div style={{ ...styles.previewFrame, padding: 12, overflow: 'auto' }}>
            <img src={previewUrl} alt={sel.name} style={styles.previewImage} />
          </div>
        ) : (
          <div style={styles.previewFrame}>
            <div style={{ ...styles.emptyState, padding: 24 }}>
              <FiEye size={32} style={{ marginBottom: 12, opacity: 0.5 }} />
              <p style={{ margin: '0 0 12px' }}>
                Inline preview is not available for this file type
                {sel.mime_type ? ` (${sel.mime_type})` : ''}.
              </p>
              <button type="button" style={styles.primaryBtn} onClick={openPreviewTab}>
                Open file
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CategoriesTab({ categories, loading, onRefresh, selectedBusinessId }) {
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [retention, setRetention] = useState('');
  const [icon, setIcon] = useState('📁');
  const [color, setColor] = useState('#64748b');

  const roots = categories.filter((c) => !c.parent_id);
  const childrenOf = (id) => categories.filter((c) => c.parent_id === id);

  const add = async () => {
    if (!name.trim()) {
      toast.error('Name required');
      return;
    }
    try {
      await FileStorageService.createCategory(selectedBusinessId, {
        name: name.trim(),
        parent_id: parent || null,
        retention_years: retention === '' ? null : parseInt(retention, 10),
        icon_key: icon,
        color,
        sort_order: categories.length,
      });
      setName('');
      toast.success('Category created');
      onRefresh();
    } catch (e) {
      toast.error(e.message || 'Failed');
    }
  };

  const remove = async (c) => {
    if (c.is_system) {
      toast.error('Cannot delete system category');
      return;
    }
    if (!window.confirm(`Delete "${c.name}"?`)) return;
    try {
      await FileStorageService.deleteCategory(c.id);
      onRefresh();
    } catch (e) {
      toast.error(e.message || 'Delete failed — remove files first');
    }
  };

  return (
    <div>
      <div style={styles.recentSection}>
        <h2 style={styles.sectionTitle}>New category / subcategory</h2>
        <div style={styles.formRow}>
          <input style={styles.input} placeholder="Name *" value={name} onChange={(e) => setName(e.target.value)} />
          <select style={styles.select} value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">— Top level —</option>
            {roots.map((c) => (
              <option key={c.id} value={c.id}>
                Under: {c.name}
              </option>
            ))}
          </select>
          <input style={styles.input} placeholder="Retention (years, empty = forever)" value={retention} onChange={(e) => setRetention(e.target.value)} />
          <input style={styles.input} value={icon} onChange={(e) => setIcon(e.target.value)} title="Icon" />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 48, height: 40 }} />
          <button type="button" style={styles.primaryBtn} onClick={add}>
            Add
          </button>
        </div>
        <p style={styles.mutedSm}>Retention uses document end date + years + 6 months (falls back to upload date).</p>
      </div>
      <div style={{ ...styles.recentSection, marginTop: TavariStyles.spacing.xl || '24px' }}>
        <h2 style={styles.sectionTitle}>Your categories</h2>
        {loading ? (
          <div style={styles.loadingState}>
            <p>Loading…</p>
          </div>
        ) : roots.length === 0 ? (
          <p style={styles.emptyState}>No categories yet.</p>
        ) : (
          <div style={styles.waiverList}>
            {roots.map((c) => (
              <div
                key={c.id}
                style={{
                  ...styles.waiverCard,
                  cursor: 'default',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  borderLeft: `4px solid ${c.color || TavariStyles.colors.primary}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={styles.waiverInfo}>
                    <h4 style={styles.waiverName}>
                      <span style={{ marginRight: 10, fontSize: '1.25rem' }} aria-hidden>
                        {c.icon_key || '📁'}
                      </span>
                      {c.name}
                      {c.is_system && <span style={styles.badge}>System</span>}
                    </h4>
                    <p style={styles.waiverContact}>
                      {c.retention_years != null ? `${c.retention_years} yr retention` : 'No fixed retention'}
                    </p>
                  </div>
                  {!c.is_system && (
                    <button type="button" style={styles.smallDanger} onClick={() => remove(c)}>
                      Delete
                    </button>
                  )}
                </div>
                {childrenOf(c.id).length > 0 && (
                  <div style={{ marginTop: TavariStyles.spacing.md || '12px', paddingTop: 12, borderTop: `1px solid ${TavariStyles.colors.gray200}` }}>
                    {childrenOf(c.id).map((sub) => (
                      <div
                        key={sub.id}
                        style={{
                          ...styles.waiverCard,
                          marginTop: 8,
                          padding: TavariStyles.spacing.md || '12px',
                          borderLeft: `4px solid ${sub.color || TavariStyles.colors.gray400}`,
                          display: 'flex',
                          flexDirection: 'row',
                          alignItems: 'center',
                        }}
                      >
                        <div style={styles.waiverInfo}>
                          <h4 style={{ ...styles.waiverName, fontSize: TavariStyles.typography.fontSize.sm }}>
                            <span style={{ marginRight: 8 }} aria-hidden>
                              {sub.icon_key || '📁'}
                            </span>
                            {sub.name}
                          </h4>
                        </div>
                        <div style={styles.waiverStatus}>
                          <button type="button" style={styles.smallDanger} onClick={() => remove(sub)}>
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UploadTab({ categories, selectedBusinessId, onDone }) {
  const [catId, setCatId] = useState('');
  const [meta, setMeta] = useState({
    display_name: '',
    document_date_start: '',
    document_date_end: '',
    notes: '',
    linked_module_key: '',
    linked_entity_id: '',
    legal_hold: false,
  });
  const [waiver, setWaiver] = useState({
    firstName: '',
    lastName: '',
    waiverFilledDate: '',
    dateOfBirth: '',
    phoneNumber: '',
    email: '',
  });
  const [busy, setBusy] = useState(false);
  const [scanPages, setScanPages] = useState([]);
  /** Avoid stale meta.display_name on mobile when file picker fires before React re-renders after typing. */
  const displayNameInputRef = useRef(null);

  const category = categories.find((c) => c.id === catId);
  const isPaper = category?.system_key === 'paper_waiver';

  const metaForUpload = () => {
    const fromDom = displayNameInputRef.current?.value;
    const display_name =
      (typeof fromDom === 'string' ? fromDom : meta.display_name).trim();
    return { ...meta, display_name };
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !catId) {
      toast.error('Choose a category first');
      return;
    }
    setBusy(true);
    try {
      await FileStorageService.uploadFileFromApp(
        selectedBusinessId,
        category,
        file,
        metaForUpload(),
        isPaper ? waiver : null
      );
      toast.success('Uploaded');
      e.target.value = '';
      onDone();
    } catch (err) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const addScanPage = (e) => {
    const f = e.target.files?.[0];
    if (!f || !f.type.startsWith('image/')) {
      toast.error('Use an image');
      return;
    }
    setScanPages((p) => [...p, f]);
    e.target.value = '';
  };

  const uploadScannedPdf = async () => {
    if (!catId || scanPages.length === 0) {
      toast.error('Category and at least one page required');
      return;
    }
    setBusy(true);
    try {
      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.create();
      for (const imgFile of scanPages) {
        const bytes = await imgFile.arrayBuffer();
        let embedded;
        if (imgFile.type === 'image/png') embedded = await pdf.embedPng(bytes);
        else embedded = await pdf.embedJpg(bytes);
        const page = pdf.addPage([embedded.width, embedded.height]);
        page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
      }
      const out = await pdf.save();
      const blob = new Blob([out], { type: 'application/pdf' });
      const file = new File([blob], `scan-${Date.now()}.pdf`, { type: 'application/pdf' });
      await FileStorageService.uploadFileFromApp(
        selectedBusinessId,
        category,
        file,
        metaForUpload(),
        isPaper ? waiver : null
      );
      setScanPages([]);
      toast.success('PDF uploaded');
      onDone();
    } catch (err) {
      toast.error(err.message || 'Scan PDF failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.recentSection}>
      <h2 style={styles.sectionTitle}>Upload file</h2>
      <label style={styles.lbl}>
        Category *
        <select value={catId} onChange={(e) => setCatId(e.target.value)} style={styles.select}>
          <option value="">— choose —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {isPaper && (
        <div style={styles.grid2}>
          <input style={styles.input} placeholder="First name *" value={waiver.firstName} onChange={(e) => setWaiver((w) => ({ ...w, firstName: e.target.value }))} />
          <input style={styles.input} placeholder="Last name *" value={waiver.lastName} onChange={(e) => setWaiver((w) => ({ ...w, lastName: e.target.value }))} />
          <label style={styles.lbl}>
            Waiver signed date (optional)
            <input type="date" style={styles.input} value={waiver.waiverFilledDate} onChange={(e) => setWaiver((w) => ({ ...w, waiverFilledDate: e.target.value }))} />
            <span style={styles.mutedSm}>If empty, Doc start below is used.</span>
          </label>
          <input style={styles.input} placeholder="Email" value={waiver.email} onChange={(e) => setWaiver((w) => ({ ...w, email: e.target.value }))} />
        </div>
      )}
      <div style={styles.grid2}>
        <label style={styles.lbl}>
          Display name
          <input
            ref={displayNameInputRef}
            style={styles.input}
            value={meta.display_name}
            onChange={(e) => setMeta((m) => ({ ...m, display_name: e.target.value }))}
          />
        </label>
        <label style={styles.lbl}>
          {isPaper ? 'Doc start (waiver signed date if empty above) *' : 'Doc start'}
          <input type="date" style={styles.input} value={meta.document_date_start} onChange={(e) => setMeta((m) => ({ ...m, document_date_start: e.target.value }))} />
        </label>
        <label style={styles.lbl}>
          Doc end
          <input type="date" style={styles.input} value={meta.document_date_end} onChange={(e) => setMeta((m) => ({ ...m, document_date_end: e.target.value }))} />
        </label>
        <label style={styles.lbl}>
          <input type="checkbox" checked={meta.legal_hold} onChange={(e) => setMeta((m) => ({ ...m, legal_hold: e.target.checked }))} /> Legal hold
        </label>
      </div>
      <label style={styles.lbl}>
        File
        <input type="file" disabled={busy || !catId} onChange={onFile} style={{ marginTop: 8 }} />
      </label>

      <div style={{ marginTop: 24, paddingTop: 24, borderTop: `1px solid ${TavariStyles.colors.border}` }}>
        <h4 style={styles.h4}>
          <FiCamera style={{ verticalAlign: 'middle', marginRight: 8 }} />
          Mobile scan → multi-page PDF
        </h4>
        <p style={styles.mutedSm}>Add one or more photos (pages), then merge to PDF and upload. (Perspective / background removal can be added later.)</p>
        <input type="file" accept="image/*" capture="environment" multiple disabled={busy || !catId} onChange={addScanPage} />
        <div style={{ marginTop: 8 }}>Pages: {scanPages.length}</div>
        <button type="button" style={styles.secondaryBtn} disabled={busy || scanPages.length === 0} onClick={() => setScanPages([])}>
          Clear pages
        </button>
        <button type="button" style={styles.primaryBtn} disabled={busy || scanPages.length === 0} onClick={uploadScannedPdf}>
          Merge & upload PDF
        </button>
      </div>
    </div>
  );
}

function SettingsTab({ settings, selectedBusinessId, ownerOk, onRefresh }) {
  const [localPart, setLocalPart] = useState('');
  const [domain, setDomain] = useState('tavarios.ca');
  const [expFrom, setExpFrom] = useState('');
  const [expTo, setExpTo] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (settings) {
      setLocalPart(settings.inbox_local_part || '');
      setDomain(settings.inbox_domain || 'tavarios.ca');
    }
  }, [settings]);

  const saveInbox = async () => {
    try {
      await FileStorageService.updateSettings(selectedBusinessId, { inbox_local_part: localPart, inbox_domain: domain });
      toast.success('Inbox address updated');
      onRefresh();
    } catch (e) {
      toast.error(e.message || 'Save failed');
    }
  };

  const runExport = async () => {
    if (!expFrom || !expTo) {
      toast.error('Select export date range');
      return;
    }
    setExporting(true);
    try {
      const blob = await FileStorageService.exportZipForRange(selectedBusinessId, expFrom, expTo);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `file-storage-export-${expFrom}-to-${expTo}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Export started');
    } catch (e) {
      toast.error(e.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const inboxAddress = localPart && domain ? `${localPart}@${domain}` : '—';

  return (
    <div style={styles.recentSection}>
      <h2 style={styles.sectionTitle}>Email intake</h2>
      <p style={styles.muted}>
        Send PDF or images to this address. Messages appear under <strong>Pending</strong> until approved.
      </p>
      <p style={styles.mutedSm}>
        If senders get a bounce like <strong>552 5.2.3</strong> or “message too large,” your AWS SES inbound rule must <strong>save mail to S3</strong> before SNS (same setup as accounting email). Without S3, SES + SNS only allows ~150 KB per message. See{' '}
        <code style={{ fontSize: 13 }}>supabase/functions/receive-email/README.md</code>.
      </p>
      <p style={styles.inboxAddr}>{inboxAddress}</p>
      <label style={styles.lbl}>
        Local part (before @)
        <input style={styles.input} value={localPart} onChange={(e) => setLocalPart(e.target.value.trim().toLowerCase())} />
      </label>
      <label style={styles.lbl}>
        Domain
        <input style={styles.input} value={domain} onChange={(e) => setDomain(e.target.value.trim().toLowerCase())} />
      </label>
      <button type="button" style={styles.primaryBtn} onClick={saveInbox}>
        Save inbox settings
      </button>

      {ownerOk && (
        <div style={{ marginTop: 32 }}>
          <h3 style={styles.h3}>Owner export (ZIP by upload date)</h3>
          <div style={styles.formRow}>
            <input type="date" style={styles.input} value={expFrom} onChange={(e) => setExpFrom(e.target.value)} />
            <input type="date" style={styles.input} value={expTo} onChange={(e) => setExpTo(e.target.value)} />
            <button type="button" style={styles.primaryBtn} disabled={exporting} onClick={runExport}>
              {exporting ? 'Working…' : 'Download ZIP'}
            </button>
          </div>
          <p style={styles.mutedSm}>Access log entries are written for each file included in the export.</p>
        </div>
      )}
      <ModuleDeactivationPanel moduleKey="file_storage" />
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: TavariStyles.colors.gray50 || '#f9fafb',
    padding: '20px',
    paddingTop: '80px',
    fontFamily: TavariStyles.typography.fontFamily,
  },
  header: {
    marginBottom: '20px',
    textAlign: 'center',
  },
  mainTitle: {
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.text || '#111827',
    margin: 0,
    marginBottom: '8px',
  },
  subtitle: {
    fontSize: TavariStyles.typography.fontSize.base,
    color: TavariStyles.colors.gray600,
    margin: 0,
  },
  tabContent: {
    width: '100%',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: TavariStyles.spacing.lg || '16px',
    marginBottom: TavariStyles.spacing.xl || '24px',
  },
  statCardButton: {
    backgroundColor: TavariStyles.colors.white,
    padding: TavariStyles.spacing.xl || '24px',
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    textAlign: 'center',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.2s ease',
    appearance: 'none',
    WebkitAppearance: 'none',
  },
  statTitle: {
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.medium,
    color: TavariStyles.colors.gray600,
    margin: 0,
    marginBottom: '8px',
  },
  statValue: {
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: TavariStyles.typography.fontWeight.bold,
    margin: 0,
  },
  controls: {
    width: '100%',
    marginBottom: TavariStyles.spacing.xl || '24px',
  },
  searchSection: {
    display: 'flex',
    gap: TavariStyles.spacing.lg || '16px',
    width: '100%',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  searchGroup: {
    position: 'relative',
    flex: '1 1 280px',
    minWidth: '220px',
  },
  searchIcon: {
    position: 'absolute',
    left: TavariStyles.spacing.md || '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: TavariStyles.colors.gray500,
    zIndex: 1,
    pointerEvents: 'none',
  },
  searchInput: {
    width: '100%',
    padding: `${TavariStyles.spacing.md || '12px'} ${TavariStyles.spacing.md || '12px'} ${TavariStyles.spacing.md || '12px'} 40px`,
    border: `2px solid ${TavariStyles.colors.primary || '#008080'}`,
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    fontSize: TavariStyles.typography.fontSize.base || '16px',
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
  },
  filterGroup: {
    position: 'relative',
    flex: '0 1 280px',
    minWidth: '200px',
  },
  filterIcon: {
    position: 'absolute',
    left: TavariStyles.spacing.md || '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: TavariStyles.colors.gray500,
    zIndex: 1,
    pointerEvents: 'none',
  },
  filterSelect: {
    width: '100%',
    padding: `${TavariStyles.spacing.md || '12px'} ${TavariStyles.spacing.md || '12px'} ${TavariStyles.spacing.md || '12px'} 40px`,
    border: `2px solid ${TavariStyles.colors.primary || '#008080'}`,
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    fontSize: TavariStyles.typography.fontSize.base || '16px',
    backgroundColor: 'white',
    fontFamily: 'inherit',
    cursor: 'pointer',
    outline: 'none',
  },
  recentSection: {
    backgroundColor: TavariStyles.colors.white,
    padding: TavariStyles.spacing.xl || '24px',
    borderRadius: TavariStyles.borderRadius?.md || '8px',
    boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
    border: `1px solid ${TavariStyles.colors.gray200}`,
  },
  sectionTitle: {
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.text || '#111827',
    margin: 0,
    marginBottom: TavariStyles.spacing.lg || '16px',
  },
  sectionHeadRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: TavariStyles.spacing.lg || '16px',
    flexWrap: 'wrap',
    gap: 12,
  },
  waiverList: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.md || '12px',
  },
  waiverCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: TavariStyles.spacing.md || '12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius?.sm || '6px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    backgroundColor: TavariStyles.colors.white,
    width: '100%',
    boxSizing: 'border-box',
    textAlign: 'left',
    fontFamily: 'inherit',
  },
  waiverInfo: {
    flex: 1,
    minWidth: 0,
  },
  waiverName: {
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.text || '#111827',
    margin: 0,
    marginBottom: '4px',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  waiverContact: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    margin: 0,
    marginBottom: '4px',
  },
  waiverDate: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray500,
    margin: 0,
  },
  waiverStatus: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: TavariStyles.spacing.md || '12px',
    flexShrink: 0,
  },
  textLinkBtn: {
    border: 'none',
    background: 'none',
    color: TavariStyles.colors.primary,
    cursor: 'pointer',
    fontWeight: TavariStyles.typography.fontWeight.semibold || 600,
    fontSize: TavariStyles.typography.fontSize.sm,
    padding: '4px 8px',
  },
  linkBtn: {
    border: 'none',
    background: 'none',
    color: TavariStyles.colors.primary,
    cursor: 'pointer',
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: TavariStyles.typography.fontWeight.medium,
  },
  emptyState: {
    textAlign: 'center',
    color: TavariStyles.colors.gray600,
    padding: TavariStyles.spacing.xl || '24px',
    fontSize: TavariStyles.typography.fontSize.base,
    margin: 0,
  },
  loadingState: {
    textAlign: 'center',
    padding: TavariStyles.spacing.xl || '24px',
    color: TavariStyles.colors.gray600,
  },
  h3: {
    fontSize: TavariStyles.typography.fontSize.lg || '18px',
    fontWeight: TavariStyles.typography.fontWeight.bold,
    margin: '0 0 12px',
    color: TavariStyles.colors.text || '#111827',
  },
  h4: {
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    margin: '0 0 12px',
    color: TavariStyles.colors.text || '#111827',
  },
  muted: { color: TavariStyles.colors.gray600, lineHeight: 1.5 },
  mutedSm: { fontSize: 13, color: TavariStyles.colors.gray600 },
  lbl: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 500 },
  select: {
    padding: 10,
    borderRadius: 8,
    border: `2px solid ${TavariStyles.colors.primary || '#008080'}`,
    fontFamily: 'inherit',
    fontSize: TavariStyles.typography.fontSize.base || '16px',
  },
  input: {
    padding: 10,
    borderRadius: 8,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    fontFamily: 'inherit',
    fontSize: TavariStyles.typography.fontSize.base || '16px',
  },
  primaryBtn: {
    marginTop: 12,
    padding: '12px 20px',
    borderRadius: 8,
    border: 'none',
    background: TavariStyles.colors.primary,
    color: '#fff',
    fontWeight: 600,
    cursor: 'pointer',
  },
  secondaryBtn: {
    padding: '10px 16px',
    borderRadius: 8,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    background: '#fff',
    cursor: 'pointer',
    fontWeight: TavariStyles.typography.fontWeight.medium,
  },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: { textAlign: 'left', padding: 10, borderBottom: `2px solid ${TavariStyles.colors.gray200}` },
  td: { padding: 10, borderBottom: `1px solid ${TavariStyles.colors.gray200}` },
  iconBtn: {
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    marginRight: 8,
    color: TavariStyles.colors.primary,
  },
  iconBtnDanger: {
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    marginRight: 8,
    color: TavariStyles.colors.danger || TavariStyles.colors.error,
  },
  split: { display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' },
  paperFormsSplit: {
    display: 'flex',
    gap: 24,
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  paperFormsCol1: {
    flex: '0 0 380px',
    minWidth: 280,
    maxWidth: '100%',
  },
  paperFormsCol2: {
    flex: '1 1 480px',
    minWidth: 320,
    minHeight: 520,
    display: 'flex',
    flexDirection: 'column',
  },
  previewPanel: {
    flex: '1 1 360px',
    minWidth: 280,
    minHeight: 480,
    display: 'flex',
    flexDirection: 'column',
  },
  previewHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 4,
  },
  previewFrame: {
    flex: 1,
    minHeight: 420,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: 8,
    background: TavariStyles.colors.gray50 || '#f9fafb',
    overflow: 'hidden',
  },
  previewIframe: {
    width: '100%',
    height: '100%',
    minHeight: 420,
    border: 'none',
    display: 'block',
  },
  previewImage: {
    maxWidth: '100%',
    maxHeight: '70vh',
    objectFit: 'contain',
    display: 'block',
    margin: '0 auto',
  },
  inboundBtn: {
    flex: 1,
    minWidth: 0,
    textAlign: 'left',
    padding: TavariStyles.spacing.md || '12px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  smallDanger: {
    padding: '8px 12px',
    fontSize: 13,
    border: 'none',
    background: '#fee2e2',
    color: '#b91c1c',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 600,
  },
  box: {
    padding: 16,
    background: TavariStyles.colors.gray50 || '#f9fafb',
    borderRadius: 8,
    marginBottom: 16,
    border: `1px solid ${TavariStyles.colors.gray200}`,
  },
  formRow: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  badge: { marginLeft: 8, fontSize: 11, background: '#e0e7ff', padding: '2px 8px', borderRadius: 4 },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginTop: 12 },
  inboxAddr: { fontSize: 18, fontWeight: 600, fontFamily: 'monospace', marginBottom: 16 },
};
