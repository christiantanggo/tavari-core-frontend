import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FiRefreshCw, FiSearch, FiSend } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';

const PAGE_SIZE = 50;

/** PostgREST ilike values must be double-quoted when they contain `.` (e.g. email addresses). */
const postgrestQuotedIlikePattern = (searchTerm) => {
  const likeEscaped = searchTerm.replace(/[%_\\]/g, '\\$&');
  const pattern = `%${likeEscaped}%`;
  return `"${pattern.replace(/"/g, '""')}"`;
};

/** Fallback when search_system_email_log RPC is not deployed yet. */
const buildSearchOrFilter = (searchTerm) => {
  const quoted = postgrestQuotedIlikePattern(searchTerm);
  if (searchTerm.includes('@')) {
    return `from_email.ilike.${quoted},recipient_email.ilike.${quoted}`;
  }
  return `subject.ilike.${quoted},from_email.ilike.${quoted},source_module.ilike.${quoted}`;
};

const formatDateTime = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString();
};

const formatAddressList = (addresses) => {
  if (!Array.isArray(addresses) || addresses.length === 0) return 'N/A';
  return addresses.filter(Boolean).join(', ');
};

const getRecipientAddresses = (log) => {
  if (Array.isArray(log?.to_addresses) && log.to_addresses.length > 0) return log.to_addresses;
  return log?.recipient_email ? [log.recipient_email] : [];
};

const hasBodySnapshot = (log) => Boolean(log?.body_html || log?.body_text);

const isBodySnapshotExpired = (log) => {
  if (!log?.body_snapshot_expires_at) return false;
  const expiresAt = new Date(log.body_snapshot_expires_at);
  return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now();
};

const buildEmailHtmlDocument = (html) => `
  <!DOCTYPE html>
  <html>
    <head>
      <base target="_blank" />
      <style>
        body { margin: 0; padding: 16px; font-family: Arial, sans-serif; color: #111827; }
        img { max-width: 100%; height: auto; }
      </style>
    </head>
    <body>${html || ''}</body>
  </html>
`;

const sourceLabels = {
  mail: 'Mail Marketing',
  inbox: 'Inbox',
  waivers: 'Waivers',
  bookings: 'Bookings',
  pos: 'POS',
  hr: 'HR',
  transactional: 'Transactional',
  unknown: 'Unknown',
};

const statusStyles = {
  sent: { backgroundColor: '#e8f5e8', color: '#2e7d32' },
  delivered: { backgroundColor: '#e3f2fd', color: '#1565c0' },
  failed: { backgroundColor: '#ffebee', color: '#c62828' },
  bounced: { backgroundColor: '#ffebee', color: '#b71c1c' },
  complained: { backgroundColor: '#fff3e0', color: '#e65100' },
  rejected: { backgroundColor: '#fce4ec', color: '#c2185b' },
  blocked: { backgroundColor: '#fff3cd', color: '#856404' },
  suppressed: { backgroundColor: '#f3e5f5', color: '#6a1b9a' },
  unsubscribed: { backgroundColor: '#f3e5f5', color: '#6a1b9a' },
};

const SEARCH_DEBOUNCE_MS = 450;

const EmailHistory = ({ businessId }) => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  /** When searching, total row count is not fetched (avoids a second full-table scan). */
  const [searchPageMayHaveMore, setSearchPageMayHaveMore] = useState(false);
  const [filters, setFilters] = useState({
    search: '',
    emailType: 'all',
    status: 'all',
    source: 'all',
  });

  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(filters.search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [filters.search]);

  const totalPages = useMemo(() => {
    if (debouncedSearch.length > 0) {
      return Math.max(1, page + (searchPageMayHaveMore ? 1 : 0));
    }
    return Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  }, [totalCount, debouncedSearch, page, searchPageMayHaveMore]);

  const loadHistory = useCallback(async () => {
    if (!businessId) return;

    try {
      setLoading(true);
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const search = debouncedSearch;
      let query = supabase
        .from('system_email_log')
        .select('*', search ? undefined : { count: 'exact' })
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (filters.emailType !== 'all') {
        query = query.eq('email_type', filters.emailType);
      }
      if (filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }
      if (filters.source !== 'all') {
        query = query.eq('source_module', filters.source);
      }

      let data;
      let error;
      let count;

      if (search) {
        const rpcResult = await supabase.rpc('search_system_email_log', {
          p_business_id: businessId,
          p_search: search,
          p_email_type: filters.emailType !== 'all' ? filters.emailType : null,
          p_status: filters.status !== 'all' ? filters.status : null,
          p_source_module: filters.source !== 'all' ? filters.source : null,
          p_limit: PAGE_SIZE,
          p_offset: from,
        });

        if (rpcResult.error?.code === 'PGRST202' || rpcResult.error?.code === '42883') {
          query = query.or(buildSearchOrFilter(search));
          const fallback = await query;
          data = fallback.data;
          error = fallback.error;
          count = fallback.count;
        } else {
          data = rpcResult.data;
          error = rpcResult.error;
          count = null;
        }
      } else {
        const result = await query;
        data = result.data;
        error = result.error;
        count = result.count;
      }
      if (error) throw error;

      const rows = data || [];
      setLogs(rows);
      setSearchPageMayHaveMore(Boolean(search && rows.length === PAGE_SIZE));
      if (search) {
        setTotalCount(0);
      } else {
        setTotalCount(count ?? 0);
      }
      setSelectedLog((current) => {
        if (!current) return rows[0] || null;
        return rows.find((row) => row.id === current.id) || rows[0] || null;
      });
    } catch (error) {
      console.error('Error loading email history:', error);
      toast.error('Failed to load email history');
    } finally {
      setLoading(false);
    }
  }, [businessId, debouncedSearch, filters.emailType, filters.status, filters.source, page]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <FiSend size={24} />
          <div>
            <h2 style={styles.title}>Email History</h2>
            <p style={styles.subtitle}>System-wide outbound email log for marketing and transactional emails.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={loadHistory}
          style={styles.secondaryButton}
          disabled={loading}
        >
          <FiRefreshCw />
          Refresh
        </button>
      </div>

      <div style={styles.filters}>
        <div style={styles.searchBox}>
          <FiSearch size={18} color={TavariStyles.colors.gray400} />
          <input
            type="text"
            placeholder="Search subject, sender, or source..."
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
            style={styles.searchInput}
          />
        </div>
        <select value={filters.emailType} onChange={(event) => updateFilter('emailType', event.target.value)} style={styles.select}>
          <option value="all">All Types</option>
          <option value="marketing">Marketing</option>
          <option value="transactional">Transactional</option>
        </select>
        <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)} style={styles.select}>
          <option value="all">All Statuses</option>
          <option value="sent">Sent</option>
          <option value="delivered">Delivered (MX accepted)</option>
          <option value="failed">Failed</option>
          <option value="bounced">Bounced</option>
          <option value="complained">Complaint</option>
          <option value="rejected">Rejected (SES)</option>
          <option value="blocked">Blocked</option>
          <option value="suppressed">Suppressed</option>
          <option value="unsubscribed">Unsubscribed</option>
        </select>
        <select value={filters.source} onChange={(event) => updateFilter('source', event.target.value)} style={styles.select}>
          <option value="all">All Sources</option>
          <option value="mail">Mail Marketing</option>
          <option value="inbox">Inbox</option>
          <option value="waivers">Waivers</option>
          <option value="bookings">Bookings</option>
          <option value="pos">POS</option>
          <option value="hr">HR</option>
          <option value="transactional">Transactional</option>
          <option value="unknown">Unknown</option>
        </select>
      </div>

      <div style={styles.content}>
        <div style={styles.tableWrap}>
          {loading && logs.length === 0 ? (
            <div style={styles.emptyState}>Loading email history...</div>
          ) : logs.length === 0 ? (
            <div style={styles.emptyState}>No email history found.</div>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>To</th>
                  <th style={styles.th}>Subject</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Source</th>
                  <th style={styles.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    style={{
                      ...styles.row,
                      ...(selectedLog?.id === log.id ? styles.rowSelected : {}),
                    }}
                  >
                    <td style={styles.td}>{formatDateTime(log.sent_at || log.created_at)}</td>
                    <td style={styles.td}>{formatAddressList(getRecipientAddresses(log))}</td>
                    <td style={styles.tdSubject}>{log.subject || '(No Subject)'}</td>
                    <td style={styles.td}>
                      <span style={styles.typeBadge}>{log.email_type}</span>
                    </td>
                    <td style={styles.td}>{sourceLabels[log.source_module] || log.source_module || 'Unknown'}</td>
                    <td style={styles.td}>
                      <span style={{ ...styles.statusBadge, ...(statusStyles[log.status] || {}) }}>
                        {log.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={styles.pagination}>
            <span>
              {debouncedSearch.length > 0
                ? `${logs.length} on this page`
                : `${totalCount} result${totalCount === 1 ? '' : 's'}`}
            </span>
            <div style={styles.pageButtons}>
              <button type="button" style={styles.secondaryButton} disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                Previous
              </button>
              <span>
                {debouncedSearch.length > 0
                  ? `Page ${page}${searchPageMayHaveMore ? ' · next page may have more' : ''}`
                  : `Page ${page} of ${totalPages}`}
              </span>
              <button
                type="button"
                style={styles.secondaryButton}
                disabled={debouncedSearch.length > 0 ? !searchPageMayHaveMore : page >= totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </div>

        <div style={styles.detailPanel}>
          {selectedLog ? (
            <>
              <h3 style={styles.detailTitle}>{selectedLog.subject || '(No Subject)'}</h3>
              <div style={styles.detailGrid}>
                <div><strong>Status:</strong> {selectedLog.status}</div>
                <div><strong>Type:</strong> {selectedLog.email_type}</div>
                <div><strong>Source:</strong> {sourceLabels[selectedLog.source_module] || selectedLog.source_module || 'Unknown'}</div>
                <div><strong>Sent:</strong> {formatDateTime(selectedLog.sent_at || selectedLog.created_at)}</div>
                {selectedLog.delivered_at && (
                  <div>
                    <strong>Recipient MX accepted (SES):</strong> {formatDateTime(selectedLog.delivered_at)}
                  </div>
                )}
                <div><strong>From:</strong> {selectedLog.from_name ? `${selectedLog.from_name} <${selectedLog.from_email}>` : selectedLog.from_email}</div>
                <div><strong>To:</strong> {formatAddressList(getRecipientAddresses(selectedLog))}</div>
                {selectedLog.cc_addresses?.length > 0 && <div><strong>CC:</strong> {formatAddressList(selectedLog.cc_addresses)}</div>}
                {selectedLog.ses_message_id && <div><strong>SES Message ID:</strong> {selectedLog.ses_message_id}</div>}
                {selectedLog.error_message && (
                  <div style={styles.errorText}>
                    <strong>
                      {['bounced', 'complained', 'rejected'].includes(selectedLog.status)
                        ? 'Recipient outcome'
                        : selectedLog.status === 'delivered'
                          ? 'Delivery detail'
                          : 'Error'}
                      :
                    </strong>{' '}
                    {selectedLog.error_message}
                  </div>
                )}
                {selectedLog.body_snapshot_expires_at && (
                  <div><strong>Body snapshot expires:</strong> {formatDateTime(selectedLog.body_snapshot_expires_at)}</div>
                )}
              </div>
              <div style={styles.bodySection}>
                <h4 style={styles.bodyTitle}>Email Body</h4>
                {!hasBodySnapshot(selectedLog) ? (
                  <div style={styles.bodyUnavailable}>No body snapshot was stored for this older email.</div>
                ) : isBodySnapshotExpired(selectedLog) ? (
                  <div style={styles.bodyUnavailable}>The stored body snapshot has expired. Metadata remains available.</div>
                ) : selectedLog.body_html ? (
                  <iframe
                    title={`Sent email body: ${selectedLog.subject || 'No Subject'}`}
                    srcDoc={buildEmailHtmlDocument(selectedLog.body_html)}
                    sandbox="allow-popups allow-popups-to-escape-sandbox"
                    style={styles.emailFrame}
                  />
                ) : (
                  <pre style={styles.textBody}>{selectedLog.body_text}</pre>
                )}
              </div>
            </>
          ) : (
            <div style={styles.emptyState}>Select an email log to view details.</div>
          )}
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '16px',
    alignItems: 'center',
    padding: '20px',
    borderBottom: '1px solid #e5e7eb',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  title: {
    margin: 0,
    fontSize: '20px',
    fontWeight: 700,
    color: '#111827',
  },
  subtitle: {
    margin: '4px 0 0',
    fontSize: '13px',
    color: '#6b7280',
  },
  filters: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    padding: '16px 20px',
    borderBottom: '1px solid #e5e7eb',
    backgroundColor: '#f9fafb',
  },
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minWidth: '260px',
    flex: '1 1 320px',
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    backgroundColor: '#fff',
  },
  searchInput: {
    border: 'none',
    outline: 'none',
    width: '100%',
    fontSize: '14px',
  },
  select: {
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    backgroundColor: '#fff',
    fontSize: '14px',
  },
  content: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)',
    minHeight: '520px',
  },
  tableWrap: {
    overflowX: 'auto',
    borderRight: '1px solid #e5e7eb',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  th: {
    textAlign: 'left',
    padding: '12px',
    color: '#374151',
    backgroundColor: '#f3f4f6',
    borderBottom: '1px solid #e5e7eb',
    whiteSpace: 'nowrap',
  },
  row: {
    cursor: 'pointer',
    borderBottom: '1px solid #f3f4f6',
  },
  rowSelected: {
    backgroundColor: '#eefafa',
  },
  td: {
    padding: '12px',
    verticalAlign: 'top',
    color: '#374151',
    maxWidth: '220px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  tdSubject: {
    padding: '12px',
    verticalAlign: 'top',
    color: '#111827',
    fontWeight: 600,
    maxWidth: '260px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  typeBadge: {
    display: 'inline-block',
    padding: '4px 8px',
    borderRadius: '999px',
    backgroundColor: '#e0f2fe',
    color: '#075985',
    fontWeight: 700,
    textTransform: 'capitalize',
  },
  statusBadge: {
    display: 'inline-block',
    padding: '4px 8px',
    borderRadius: '999px',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    fontWeight: 700,
    textTransform: 'capitalize',
  },
  detailPanel: {
    padding: '20px',
    backgroundColor: '#fff',
  },
  detailTitle: {
    margin: '0 0 16px',
    fontSize: '18px',
    color: '#111827',
  },
  detailGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    fontSize: '14px',
    color: '#374151',
    wordBreak: 'break-word',
  },
  errorText: {
    color: '#c62828',
  },
  bodySection: {
    marginTop: '24px',
    borderTop: '1px solid #e5e7eb',
    paddingTop: '16px',
  },
  bodyTitle: {
    margin: '0 0 12px',
    fontSize: '15px',
    color: '#111827',
  },
  bodyUnavailable: {
    padding: '16px',
    borderRadius: '8px',
    backgroundColor: '#f9fafb',
    color: '#6b7280',
    fontSize: '14px',
  },
  emailFrame: {
    width: '100%',
    minHeight: '360px',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    backgroundColor: '#fff',
  },
  textBody: {
    whiteSpace: 'pre-wrap',
    fontFamily: 'inherit',
    padding: '16px',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    backgroundColor: '#fff',
    maxHeight: '420px',
    overflow: 'auto',
  },
  emptyState: {
    padding: '48px 20px',
    textAlign: 'center',
    color: '#6b7280',
  },
  pagination: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    borderTop: '1px solid #e5e7eb',
    color: '#6b7280',
    fontSize: '13px',
  },
  pageButtons: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  secondaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    backgroundColor: '#fff',
    color: '#374151',
    cursor: 'pointer',
    fontWeight: 600,
  },
};

export default EmailHistory;
