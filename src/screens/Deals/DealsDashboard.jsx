import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useBusinessContext } from '../../contexts/BusinessContext';
import * as DealsService from '../../services/Deals/DealsService';
import { gcStyles as s } from '../GiftCards/giftCardStyles';

export default function DealsDashboard() {
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const [stats, setStats] = useState(null);

  const load = useCallback(async () => {
    if (!selectedBusinessId) return;
    setStats(await DealsService.getDealsDashboardStats(selectedBusinessId));
  }, [selectedBusinessId]);

  useEffect(() => {
    load().catch((err) => toast.error(err.message || 'Failed to load deals'));
  }, [load]);

  return (
    <div>
      <div style={s.stats}>
        {[
          ['Total deals', stats?.totalDeals ?? 0],
          ['Active', stats?.activeDeals ?? 0],
          ['Redemptions', stats?.redemptions ?? 0],
        ].map(([label, value]) => (
          <div key={label} style={s.statCard}>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ ...s.panel, ...s.row, justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ margin: '0 0 6px' }}>Deals page</h3>
          <p style={{ ...s.muted, margin: 0 }}>
            Active deals can show on the booking portal, customer portal, website, and customer app.
          </p>
        </div>
        <button type="button" style={s.button} onClick={() => navigate('/dashboard/deals/manage')}>
          Manage deals
        </button>
      </div>
    </div>
  );
}
