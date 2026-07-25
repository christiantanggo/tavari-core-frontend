import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Pause, Play, Plus, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../utils/TavariStyles';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { formatRecurringSchedule } from '../../utils/invoiceRecurringSchedule';
import recurringInvoiceService from '../../services/Invoices/recurringInvoiceService';
import { supabase } from '../../supabaseClient';

const STATUS_COLORS = {
  active: '#059669',
  paused: '#f59e0b',
  ended: '#6b7280',
};

const cardStyles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: '16px',
    marginTop: '20px',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    padding: '20px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
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
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginTop: '16px',
  },
  btn: (primary) => ({
    padding: '8px 14px',
    borderRadius: '8px',
    border: primary ? 'none' : '1px solid #d1d5db',
    backgroundColor: primary ? TavariStyles.colors.primary || '#008080' : '#fff',
    color: primary ? '#fff' : '#374151',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  }),
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

export default function RecurringInvoicesScreen() {
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const { hasPermission } = usePermissions();
  const { formatTaxAmount } = useTaxCalculations(selectedBusinessId);
  const canView = hasPermission('invoices.view');
  const canCreate = hasPermission('invoices.create');
  const canSend = hasPermission('invoices.send');

  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const loadTemplates = useCallback(async () => {
    if (!selectedBusinessId || !canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      recurringInvoiceService.setBusinessId(selectedBusinessId);
      const rows = await recurringInvoiceService.listTemplates();
      setTemplates(rows);
    } catch (err) {
      toast.error(err.message || 'Failed to load recurring invoices');
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId, canView]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleTogglePause = async (template) => {
    if (!canCreate) return;
    setBusyId(template.id);
    try {
      recurringInvoiceService.setBusinessId(selectedBusinessId);
      const nextStatus = template.status === 'active' ? 'paused' : 'active';
      await recurringInvoiceService.setStatus(template.id, nextStatus);
      toast.success(nextStatus === 'paused' ? 'Recurring invoice paused' : 'Recurring invoice resumed');
      await loadTemplates();
    } catch (err) {
      toast.error(err.message || 'Failed to update status');
    } finally {
      setBusyId(null);
    }
  };

  const handleGenerateNow = async (template) => {
    if (!canSend) return;
    setBusyId(template.id);
    try {
      recurringInvoiceService.setBusinessId(selectedBusinessId);
      const { data: authData } = await supabase.auth.getUser();
      const invoice = await recurringInvoiceService.generateNow(template.id, {
        userId: authData?.user?.id,
      });
      toast.success(`Invoice ${invoice.invoice_number} created`);
      navigate(`/dashboard/invoices/${invoice.id}`);
    } catch (err) {
      toast.error(err.message || 'Failed to generate invoice');
    } finally {
      setBusyId(null);
    }
  };

  if (!canView) {
    return (
      <div style={cardStyles.empty}>
        You do not have permission to view recurring invoices.
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
        <p style={{ margin: 0, color: '#6b7280', fontSize: '14px' }}>
          Automatically issue the same invoice each month for subscriptions and retainers.
        </p>
        {canCreate && (
          <button
            type="button"
            onClick={() => navigate('/dashboard/invoices/recurring/new')}
            style={{
              ...cardStyles.btn(true),
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Plus size={16} />
            New recurring invoice
          </button>
        )}
      </div>

      {loading ? (
        <div style={cardStyles.empty}>Loading recurring invoices…</div>
      ) : templates.length === 0 ? (
        <div style={cardStyles.empty}>
          <Calendar size={40} style={{ marginBottom: '12px', opacity: 0.4 }} />
          <p>No recurring invoices yet.</p>
          {canCreate && (
            <button
              type="button"
              onClick={() => navigate('/dashboard/invoices/recurring/new')}
              style={cardStyles.btn(true)}
            >
              Create your first recurring invoice
            </button>
          )}
        </div>
      ) : (
        <div style={cardStyles.grid}>
          {templates.map((template) => (
            <div key={template.id} style={cardStyles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '16px', color: '#111827' }}>
                    {template.name}
                  </div>
                  <div style={{ fontSize: '14px', color: '#6b7280', marginTop: '4px' }}>
                    {template.recipient_name}
                  </div>
                </div>
                <span style={cardStyles.badge(template.status)}>{template.status}</span>
              </div>

              <div style={{ marginTop: '16px', fontSize: '23px', fontWeight: 700, color: TavariStyles.colors.primary }}>
                {formatTaxAmount(template.total)}
              </div>

              <div style={{ marginTop: '8px', fontSize: '13px', color: '#6b7280' }}>
                {formatRecurringSchedule(template)}
                {template.auto_send ? ' · Auto-send email' : ' · Save as draft'}
              </div>
              <div style={{ marginTop: '4px', fontSize: '13px', color: '#6b7280' }}>
                Next run: {template.next_run_date || '—'}
                {template.occurrences_sent > 0 && ` · ${template.occurrences_sent} issued`}
              </div>

              <div style={cardStyles.actions}>
                <button
                  type="button"
                  style={cardStyles.btn(false)}
                  onClick={() => navigate(`/dashboard/invoices/recurring/${template.id}`)}
                  disabled={busyId === template.id}
                >
                  Edit
                </button>
                {template.status !== 'ended' && canCreate && (
                  <button
                    type="button"
                    style={cardStyles.btn(false)}
                    onClick={() => handleTogglePause(template)}
                    disabled={busyId === template.id}
                  >
                    {template.status === 'active' ? (
                      <>
                        <Pause size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                        Pause
                      </>
                    ) : (
                      <>
                        <Play size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                        Resume
                      </>
                    )}
                  </button>
                )}
                {template.status === 'active' && canSend && (
                  <button
                    type="button"
                    style={cardStyles.btn(true)}
                    onClick={() => handleGenerateNow(template)}
                    disabled={busyId === template.id}
                  >
                    <RefreshCw size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                    Generate now
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
