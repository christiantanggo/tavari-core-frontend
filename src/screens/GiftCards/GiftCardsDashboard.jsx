import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useBusinessContext } from '../../contexts/BusinessContext';
import * as GiftCardService from '../../services/GiftCards/GiftCardService';
import { gcStyles as s } from './giftCardStyles';

function moneyFmt(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function GiftCardsDashboard() {
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!selectedBusinessId) return;
    setLoading(true);
    try {
      await GiftCardService.bootstrapGiftCards(selectedBusinessId);
      const data = await GiftCardService.getDashboardStats(selectedBusinessId);
      setStats(data);
    } catch (err) {
      toast.error(err.message || 'Failed to load gift card dashboard');
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div style={s.empty}>Loading…</div>;

  return (
    <div>
      <div style={s.stats}>
        {[
          ['Outstanding liability', moneyFmt(stats?.outstandingLiability)],
          ['Active cards', stats?.activeCards ?? 0],
          ['Issued (30 days)', stats?.issuedLast30Days ?? 0],
          ['Redeemed (30 days)', moneyFmt(stats?.redeemedLast30Days)],
          ['Total cards', stats?.totalCards ?? 0],
        ].map(([label, value]) => (
          <div key={label} style={s.statCard}>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#0f172a' }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ ...s.panel, ...s.row, justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ margin: '0 0 6px' }}>Quick actions</h3>
          <p style={{ ...s.muted, margin: 0 }}>Issue cards, look up balances, or configure products and promos.</p>
        </div>
        <div style={s.row}>
          <button type="button" style={s.button} onClick={() => navigate('/dashboard/gift-cards/issue')}>
            Sell / Issue
          </button>
          <button type="button" style={s.buttonSecondary} onClick={() => navigate('/dashboard/gift-cards/cards')}>
            Find a card
          </button>
          <button type="button" style={s.buttonSecondary} onClick={() => navigate('/dashboard/gift-cards/promotions')}>
            Promotions
          </button>
        </div>
      </div>
    </div>
  );
}
