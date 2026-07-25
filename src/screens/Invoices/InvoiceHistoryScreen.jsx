import React, { useEffect, useState } from 'react';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import invoiceService from '../../services/Invoices/invoiceService';
import toast from 'react-hot-toast';

export default function InvoiceHistoryScreen() {
  const { selectedBusinessId } = useBusinessContext();
  const { hasPermission } = usePermissions();
  const canView = hasPermission('invoices.view');

  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedBusinessId || !canView) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        invoiceService.setBusinessId(selectedBusinessId);
        const rows = await invoiceService.listInvoices({ filter: 'all', limit: 50 });
        setInvoices(rows.filter((r) => r.first_sent_at || r.voided_at));
      } catch (err) {
        toast.error(err.message || 'Failed to load history');
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedBusinessId, canView]);

  if (!canView) {
    return (
      <div style={cardStyle}>You do not have permission to view invoice history.</div>
    );
  }

  return (
    <div style={cardStyle}>
      <h2 style={{ marginTop: 0 }}>Send & activity history</h2>
      <p style={{ color: '#6b7280', fontSize: '14px' }}>
        Recent sends, voids, and payment activity. Reminder dispatch and email open tracking will appear here as those pipelines are wired up.
      </p>
      {loading ? (
        <p>Loading…</p>
      ) : invoices.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No invoice activity yet.</p>
      ) : (
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '14px',
          marginTop: '16px',
        }}>
          <thead>
            <tr style={{ backgroundColor: '#f9fafb' }}>
              <th style={thStyle}>Invoice</th>
              <th style={thStyle}>Recipient</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Sent</th>
              <th style={thStyle}>Opened</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td style={tdStyle}>{inv.invoice_number}</td>
                <td style={tdStyle}>{inv.recipient_name}</td>
                <td style={tdStyle}>{inv.status}</td>
                <td style={tdStyle}>
                  {inv.last_sent_at ? new Date(inv.last_sent_at).toLocaleString() : '—'}
                </td>
                <td style={tdStyle}>
                  {inv.email_opened_at ? new Date(inv.email_opened_at).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const cardStyle = {
  marginTop: '20px',
  backgroundColor: '#fff',
  borderRadius: '12px',
  border: '1px solid #e5e7eb',
  padding: '24px',
};
const thStyle = { textAlign: 'left', padding: '10px 8px', fontSize: '13px', color: '#6b7280' };
const tdStyle = { padding: '10px 8px', borderTop: '1px solid #f3f4f6' };
