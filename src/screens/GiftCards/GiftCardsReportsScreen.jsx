import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useBusinessContext } from '../../contexts/BusinessContext';
import * as GiftCardService from '../../services/GiftCards/GiftCardService';
import { gcStyles as s } from './giftCardStyles';

function moneyFmt(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function GiftCardsReportsScreen() {
  const { selectedBusinessId } = useBusinessContext();
  const [stats, setStats] = useState(null);
  const [txs, setTxs] = useState([]);
  const [settlements, setSettlements] = useState([]);

  const load = useCallback(async () => {
    if (!selectedBusinessId) return;
    const [st, history, settles] = await Promise.all([
      GiftCardService.getDashboardStats(selectedBusinessId),
      GiftCardService.listTransactions(selectedBusinessId, { limit: 50 }),
      GiftCardService.listSettlements(selectedBusinessId),
    ]);
    setStats(st);
    setTxs(history);
    setSettlements(settles);
  }, [selectedBusinessId]);

  useEffect(() => {
    load().catch((err) => toast.error(err.message || 'Failed to load reports'));
  }, [load]);

  return (
    <div>
      <div style={s.stats}>
        <div style={s.statCard}>
          <div style={{ fontSize: 13, color: '#6b7280' }}>Outstanding liability</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{moneyFmt(stats?.outstandingLiability)}</div>
        </div>
        <div style={s.statCard}>
          <div style={{ fontSize: 13, color: '#6b7280' }}>Redeemed (30d)</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{moneyFmt(stats?.redeemedLast30Days)}</div>
        </div>
        <div style={s.statCard}>
          <div style={{ fontSize: 13, color: '#6b7280' }}>Open settlements</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>
            {settlements.filter((x) => x.status === 'open').length}
          </div>
        </div>
      </div>

      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>Recent audit activity</h3>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>When</th>
              <th style={s.th}>Type</th>
              <th style={s.th}>Amount</th>
              <th style={s.th}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {txs.map((tx) => (
              <tr key={tx.id}>
                <td style={s.td}>{new Date(tx.created_at).toLocaleString()}</td>
                <td style={s.td}>{tx.transaction_type}</td>
                <td style={s.td}>{moneyFmt(tx.amount)}</td>
                <td style={s.td}>{tx.reason || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>Cross-business settlements</h3>
        {settlements.length === 0 ? (
          <div style={s.empty}>No settlements yet.</div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>When</th>
                <th style={s.th}>Amount</th>
                <th style={s.th}>Fee</th>
                <th style={s.th}>Net</th>
                <th style={s.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((row) => (
                <tr key={row.id}>
                  <td style={s.td}>{new Date(row.created_at).toLocaleString()}</td>
                  <td style={s.td}>{moneyFmt(row.amount)}</td>
                  <td style={s.td}>{moneyFmt(row.fee_amount)}</td>
                  <td style={s.td}>{moneyFmt(row.net_amount)}</td>
                  <td style={s.td}><span style={s.badge}>{row.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
