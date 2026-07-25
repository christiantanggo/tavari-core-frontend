import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import * as DealsService from '../../services/Deals/DealsService';
import { gcStyles as s } from '../GiftCards/giftCardStyles';

export default function DealsPrintScreen() {
  const { selectedBusinessId } = useBusinessContext();
  const { userId } = usePermissions();
  const [deals, setDeals] = useState([]);
  const [dealId, setDealId] = useState('');
  const [qty, setQty] = useState('10');
  const [expiresAt, setExpiresAt] = useState('');
  const [printed, setPrinted] = useState([]);

  const load = useCallback(async () => {
    if (!selectedBusinessId) return;
    const rows = await DealsService.listDeals(selectedBusinessId);
    setDeals(rows.filter((d) => d.is_printable));
  }, [selectedBusinessId]);

  useEffect(() => {
    load().catch((err) => toast.error(err.message || 'Failed to load deals'));
  }, [load]);

  const handlePrint = async (e) => {
    e.preventDefault();
    if (!dealId) {
      toast.error('Select a deal');
      return;
    }
    try {
      const vouchers = await DealsService.printDealVouchers({
        businessId: selectedBusinessId,
        dealId,
        quantity: Number(qty) || 1,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        processedByUserId: userId || null,
      });
      setPrinted(vouchers);
      toast.success(`Created ${vouchers.length} vouchers`);

      const deal = deals.find((d) => d.id === dealId);
      const w = window.open('', '_blank', 'width=900,height=700');
      if (!w) return;
      const cards = vouchers.map((v) => `
        <div style="border:2px dashed #0f766e;border-radius:12px;padding:16px;width:240px;margin:8px;display:inline-block;vertical-align:top">
          <div style="font-weight:700;font-size: 16px">${deal?.name || 'Voucher'}</div>
          <div style="margin:12px 0;font-size: 20px;letter-spacing:1px">${v.code}</div>
          <div style="font-size: 11px;color:#64748b">${v.qr_payload}</div>
          ${v.expires_at ? `<div style="margin-top:8px;font-size: 13px">Expires ${new Date(v.expires_at).toLocaleDateString()}</div>` : ''}
        </div>`).join('');
      w.document.write(`<!doctype html><html><head><title>Print vouchers</title></head><body style="font-family:system-ui,sans-serif;padding:16px">${cards}<script>window.print()</script></body></html>`);
      w.document.close();
    } catch (err) {
      toast.error(err.message || 'Print failed');
    }
  };

  return (
    <div style={s.panel}>
      <h3 style={{ marginTop: 0 }}>Print handout vouchers</h3>
      <p style={s.muted}>Use for free-item coupons (e.g. small fry). These can expire — they are not Ontario money gift cards.</p>
      <form onSubmit={handlePrint}>
        <div style={s.grid2}>
          <div>
            <label style={s.label}>Deal</label>
            <select style={s.select} value={dealId} onChange={(e) => setDealId(e.target.value)} required>
              <option value="">Select…</option>
              {deals.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label style={s.label}>Quantity</label>
            <input style={s.input} type="number" min="1" max="500" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div>
            <label style={s.label}>Expires</label>
            <input style={s.input} type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
        </div>
        <button type="submit" style={{ ...s.button, marginTop: 16 }}>Generate & print</button>
      </form>

      {printed.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h4>Generated codes</h4>
          <ul>
            {printed.map((v) => <li key={v.id}>{v.code}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
