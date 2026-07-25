import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import TavariCheckbox from '../UI/TavariCheckbox';
import invoiceService from '../../services/Invoices/invoiceService';

export default function SummarySourcePicker({
  businessId,
  customerId,
  selectedLineKeys,
  onSelectedLineKeysChange,
  onLinesChange,
  onSourceLinksChange,
}) {
  const [receipts, setReceipts] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedSourceId, setExpandedSourceId] = useState(null);

  useEffect(() => {
    if (!businessId || !customerId) {
      setReceipts([]);
      setBookings([]);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        invoiceService.setBusinessId(businessId);
        const { receipts: r, bookings: b } = await invoiceService.getEligibleSummarySources({
          customerId,
        });
        setReceipts(r);
        setBookings(b);
      } catch (err) {
        toast.error(err.message || 'Failed to load paid transactions');
      } finally {
        setLoading(false);
      }
    })();
  }, [businessId, customerId]);

  const lineKey = (sourceType, sourceId, lineId) => `${sourceType}:${sourceId}:${lineId}`;

  const toggleLine = (source, lineItem, checked) => {
    const key = lineKey(source.source_type, source.source_id, lineItem.id || lineItem.name);
    const nextKeys = new Set(selectedLineKeys);
    if (checked) nextKeys.add(key);
    else nextKeys.delete(key);
    onSelectedLineKeysChange([...nextKeys]);
    rebuildLines([...nextKeys], receipts, bookings);
  };

  const rebuildLines = (keys, receiptList, bookingList) => {
    const lines = [];
    const links = [];

    receiptList.forEach((source) => {
      const picked = (source.line_items || []).filter((line) =>
        keys.includes(lineKey('pos_sale', source.source_id, line.id || line.name))
      );
      if (picked.length === 0) return;

      links.push({
        source_type: 'pos_sale',
        source_id: source.source_id,
        display_label: source.label,
        amount: picked.reduce((s, l) => s + Number(l.total_price || l.quantity * l.unit_price || 0), 0),
        transaction_date: source.date,
        payment_method_summary: (source.payment_methods || []).join(', '),
      });

      picked.forEach((line) => {
        lines.push({
          clientId: lineKey('pos_sale', source.source_id, line.id || line.name),
          line_type: 'source_receipt',
          source_pos_sale_id: source.source_id,
          source_pos_sale_item_id: line.id,
          inventory_id: line.inventory_id,
          name: line.name,
          quantity: line.quantity,
          unit_price: line.unit_price,
          total_price: line.total_prci ?? line.quantity * line.unit_price,
          tax_exempt: false,
        });
      });
    });

    bookingList.forEach((source) => {
      const bookingLineId = `booking-${source.source_id}`;
      if (!keys.includes(lineKey('booking', source.source_id, bookingLineId))) return;

      links.push({
        source_type: 'booking',
        source_id: source.source_id,
        display_label: source.label,
        amount: source.amount,
        transaction_date: source.date,
        payment_method_summary: (source.payment_methods || []).join(', '),
      });

      lines.push({
        clientId: lineKey('booking', source.source_id, bookingLineId),
        line_type: 'source_booking',
        source_booking_id: source.source_id,
        participant_name: source.participant_name,
        name: source.label,
        quantity: 1,
        unit_price: source.amount,
        total_amount: source.amount,
        tax_exempt: false,
      });
    });

    onLinesChange(lines);
    onSourceLinksChange(links);
  };

  useEffect(() => {
    if (selectedLineKeys.length > 0) {
      rebuildLines(selectedLineKeys, receipts, bookings);
    }
  }, [receipts, bookings]);

  if (!customerId) {
    return (
      <p style={{ color: '#6b7280', fontSize: '14px' }}>
        Select a customer to load paid receipts and bookings.
      </p>
    );
  }

  if (loading) {
    return <p style={{ color: '#6b7280' }}>Loading paid transactions…</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <section>
        <h3 style={sectionTitleStyle}>Paid receipts</h3>
        {receipts.length === 0 ? (
          <p style={emptyStyle}>No eligible receipts for this customer.</p>
        ) : (
          receipts.map((source) => (
            <div key={`sale-${source.source_id}`} style={sourceCardStyle}>
              <button
                type="button"
                style={sourceHeaderStyle}
                onClick={() =>
                  setExpandedSourceId((prev) =>
                    prev === source.source_id ? null : source.source_id
                  )
                }
              >
                <span>{source.label}</span>
                <span>${Number(source.amount || 0).toFixed(2)}</span>
              </button>
              {expandedSourceId === source.source_id && (
                <div style={{ padding: '12px' }}>
                  {(source.line_items || []).map((line) => {
                    const key = lineKey('pos_sale', source.source_id, line.id || line.name);
                    return (
                      <TavariCheckbox
                        key={key}
                        checked={selectedLineKeys.includes(key)}
                        onChange={(checked) => toggleLine(source, line, checked)}
                        label={`${line.name} × ${line.quantity} — $${Number(line.total_amount ?? line.quantity * line.unit_price ?? 0).toFixed(2)}`}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </section>

      <section>
        <h3 style={sectionTitleStyle}>Paid bookings</h3>
        {bookings.length === 0 ? (
          <p style={emptyStyle}>No eligible bookings for this customer.</p>
        ) : (
          bookings.map((source) => {
            const bookingLineId = `booking-${source.source_id}`;
            const key = lineKey('booking', source.source_id, bookingLineId);
            return (
              <div key={`booking-${source.source_id}`} style={sourceCardStyle}>
                <TavariCheckbox
                  checked={selectedLineKeys.includes(key)}
                  onChange={(checked) => toggleLine(source, { id: bookingLineId, name: source.label }, checked)}
                  label={`${source.label}${source.participant_name ? ` (${source.participant_name})` : ''} — $${Number(source.amount || 0).toFixed(2)}`}
                />
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

const sectionTitleStyle = { margin: '0 0 8px', fontSize: '15px', fontWeight: 600 };
const emptyStyle = { margin: 0, color: '#6b7280', fontSize: '13px' };
const sourceCardStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  backgroundColor: '#fff',
  overflow: 'hidden',
};
const sourceHeaderStyle = {
  width: '100%',
  display: 'flex',
  justifyContent: 'space-between',
  padding: '12px 14px',
  background: '#f9fafb',
  border: 'none',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '14px',
};
