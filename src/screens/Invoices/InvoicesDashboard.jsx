import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Mail, DollarSign } from 'lucide-react';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../utils/TavariStyles';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import invoiceService from '../../services/Invoices/invoiceService';

const STATUS_COLORS = {
  draft: '#6b7280',
  sent: '#3b82f6',
  viewed: '#8b5cf6',
  partially_paid: '#f59e0b',
  paid: '#059669',
  overdue: '#dc2626',
  void: '#9ca3af',
  refunded: '#6366f1',
};

const cardStyles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '16px',
    marginTop: '20px',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    padding: '20px',
    cursor: 'pointer',
    transition: 'box-shadow 0.2s, border-color 0.2s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '12px',
  },
  recipient: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#111827',
    marginBottom: '4px',
  },
  meta: {
    fontSize: '13px',
    color: '#6b7280',
  },
  amount: {
    fontSize: '23px',
    fontWeight: 700,
    color: TavariStyles.colors.primary || '#008080',
  },
  badge: (status) => ({
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: '999px',
    fontSize: '13px',
    fontWeight: 600,
    textTransform: 'capitalize',
    backgroundColor: `${STATUS_COLORS[status] || '#6b7280'}18`,
    color: STATUS_COLORS[status] || '#6b7280',
  }),
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: '16px',
    marginTop: '20px',
    marginBottom: '8px',
  },
  statCard: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    padding: '16px 20px',
  },
  empty: {
    textAlign: 'center',
    padding: '48px 24px',
    color: '#6b7280',
    backgroundColor: '#fff',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    marginTop: '20px',
  },
};

export default function InvoicesDashboard({ filter = 'all' }) {
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const { hasPermission } = usePermissions();
  const { formatTaxAmount } = useTaxCalculations(selectedBusinessId);
  const canView = hasPermission('invoices.view');

  const [invoices, setInvoices] = useState([]);
  const [stats, setStats] = useState({ total: 0, unpaid: 0, overdue: 0, paid: 0 });
  const [loading, setLoading] = useState(true);

  const loadInvoices = useCallback(async () => {
    if (!selectedBusinessId || !canView) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      invoiceService.setBusinessId(selectedBusinessId);
      const [list, summary] = await Promise.all([
        invoiceService.listInvoices({ filter }),
        invoiceService.getDashboardStats(),
      ]);
      setInvoices(list);
      setStats(summary);
    } catch (err) {
      toast.error(err.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId, canView, filter]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  if (!canView) {
    return (
      <div style={cardStyles.empty}>
        You do not have permission to view invoices.
      </div>
    );
  }

  const filterLabel = {
    all: 'All invoices',
    draft: 'Draft invoices',
    unpaid: 'Unpaid invoices',
    paid: 'Paid invoices',
    summary: 'Summary invoices',
  }[filter] || 'Invoices';

  return (
    <div>
      {filter === 'all' && (
        <div style={cardStyles.stats}>
          <div style={cardStyles.statCard}>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#111827' }}>{stats.total}</div>
            <div style={{ fontSize: '13px', color: '#6b7280' }}>Total invoices</div>
          </div>
          <div style={cardStyles.statCard}>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#dc2626' }}>{stats.unpaid}</div>
            <div style={{ fontSize: '13px', color: '#6b7280' }}>Unpaid</div>
          </div>
          <div style={cardStyles.statCard}>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#f59e0b' }}>{stats.overdue}</div>
            <div style={{ fontSize: '13px', color: '#6b7280' }}>Overdue</div>
          </div>
          <div style={cardStyles.statCard}>
            <div style={{ fontSize: '24px', fontWeight: 700, color: '#059669' }}>{stats.paid}</div>
            <div style={{ fontSize: '13px', color: '#6b7280' }}>Paid</div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={cardStyles.empty}>Loading {filterLabel.toLowerCase()}…</div>
      ) : invoices.length === 0 ? (
        <div style={cardStyles.empty}>
          <FileText size={40} style={{ marginBottom: '12px', opacity: 0.4 }} />
          <p>No {filterLabel.toLowerCase()} yet.</p>
          {hasPermission('invoices.create') && (
            <button
              type="button"
              onClick={() => navigate('/dashboard/invoices/new')}
              style={{
                marginTop: '12px',
                padding: '10px 20px',
                backgroundColor: TavariStyles.colors.primary || '#008080',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Create your first invoice
            </button>
          )}
        </div>
      ) : (
        <div style={cardStyles.grid}>
          {invoices.map((invoice) => (
            <div
              key={invoice.id}
              style={cardStyles.card}
              onClick={() => navigate(`/dashboard/invoices/${invoice.id}`)}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                e.currentTarget.style.borderColor = '#d1d5db';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
                e.currentTarget.style.borderColor = '#e5e7eb';
              }}
            >
              <div style={cardStyles.cardHeader}>
                <div>
                  <div style={cardStyles.recipient}>{invoice.recipient_name}</div>
                  {invoice.recipient_company && (
                    <div style={cardStyles.meta}>{invoice.recipient_company}</div>
                  )}
                  <div style={cardStyles.meta}>
                    {invoice.invoice_number}
                    {invoice.invoice_type === 'summary' ? ' · Summary' : ''}
                  </div>
                </div>
                <span style={cardStyles.badge(invoice.status)}>{invoice.status.replace('_', ' ')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={cardStyles.amount}>${formatTaxAmount(invoice.total)}</div>
                <div style={{ textAlign: 'right' }}>
                  {invoice.balance_due > 0 && (
                    <div style={{ fontSize: '13px', color: '#dc2626', fontWeight: 600 }}>
                      Due: ${formatTaxAmount(invoice.balance_due)}
                    </div>
                  )}
                  {invoice.recipient_email && (
                    <div style={{ ...cardStyles.meta, display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}>
                      <Mail size={12} />
                      {invoice.recipient_email}
                    </div>
                  )}
                  {invoice.due_date && (
                    <div style={{ ...cardStyles.meta, display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}>
                      <DollarSign size={12} />
                      Due {new Date(invoice.due_date + 'T12:00:00').toLocaleDateString('en-CA')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
