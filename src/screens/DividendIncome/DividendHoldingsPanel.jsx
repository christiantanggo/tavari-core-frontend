import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../utils/TavariStyles';
import {
  formatCad,
  formatPct,
  holdingMetrics,
} from '../../services/DividendIncome/dividendIncomeMath';
import {
  deleteHolding,
  deletePortfolio,
  renamePortfolio,
  upsertHolding,
} from '../../services/DividendIncome/dividendIncomeService';

const cardStyle = {
  background: TavariStyles.colors.white,
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  border: `1px solid ${TavariStyles.colors.gray200}`,
};

const tableWrap = { overflowX: 'auto' };

const thTd = {
  padding: '10px 12px',
  borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
  fontSize: TavariStyles.typography.fontSize.sm,
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const inputStyle = {
  width: '100%',
  maxWidth: 140,
  padding: '8px 10px',
  borderRadius: 8,
  border: `1px solid ${TavariStyles.colors.gray300}`,
  fontSize: TavariStyles.typography.fontSize.sm,
  boxSizing: 'border-box',
};

const btnPrimary = {
  padding: '10px 16px',
  borderRadius: 8,
  border: 'none',
  background: TavariStyles.colors.primary,
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: TavariStyles.typography.fontSize.sm,
};

const btnGhost = {
  ...btnPrimary,
  background: TavariStyles.colors.gray200,
  color: TavariStyles.colors.gray800,
};

export default function DividendHoldingsPanel({
  businessId,
  portfolio,
  holdings,
  instruments,
  onChanged,
}) {
  const [draftHolding, setDraftHolding] = useState({
    instrument_id: '',
    shares: '',
    avg_cost: '',
  });

  const portfolioHoldings = useMemo(
    () => (holdings || []).filter((h) => h.portfolio_id === portfolio?.id),
    [holdings, portfolio?.id]
  );

  const totals = useMemo(() => {
    let value = 0;
    let monthly = 0;
    let hasValue = false;
    let hasMonthly = false;
    for (const h of portfolioHoldings) {
      const m = holdingMetrics(h, h.instrument);
      if (m.marketValue != null) {
        value += m.marketValue;
        hasValue = true;
      }
      if (m.monthlyIncome != null) {
        monthly += m.monthlyIncome;
        hasMonthly = true;
      }
    }
    return {
      value: hasValue ? value : null,
      monthly: hasMonthly ? monthly : null,
      annual: hasMonthly ? monthly * 12 : null,
    };
  }, [portfolioHoldings]);

  const handleSaveHolding = async (e) => {
    e.preventDefault();
    if (!portfolio?.id) return;
    if (!draftHolding.instrument_id) {
      toast.error('Select a stock');
      return;
    }
    try {
      await upsertHolding(businessId, {
        ...draftHolding,
        portfolio_id: portfolio.id,
      });
      toast.success('Holding saved');
      setDraftHolding({ instrument_id: '', shares: '', avg_cost: '' });
      await onChanged();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not save holding');
    }
  };

  const handleUpdateHoldingRow = async (holding, patch) => {
    try {
      await upsertHolding(businessId, {
        id: holding.id,
        portfolio_id: holding.portfolio_id || portfolio.id,
        instrument_id: holding.instrument_id,
        shares: patch.shares ?? holding.shares,
        avg_cost: patch.avg_cost ?? holding.avg_cost,
        notes: holding.notes,
      });
      toast.success('Updated');
      await onChanged();
    } catch (err) {
      toast.error(err.message || 'Update failed');
    }
  };

  const handleDeleteHolding = async (holdingId) => {
    if (!window.confirm('Remove this holding?')) return;
    try {
      await deleteHolding(businessId, holdingId);
      toast.success('Removed');
      await onChanged();
    } catch (err) {
      toast.error(err.message || 'Delete failed');
    }
  };

  const handleRename = async () => {
    const next = window.prompt('Rename portfolio / person', portfolio?.name || '');
    if (next == null) return;
    try {
      await renamePortfolio(businessId, portfolio.id, next);
      toast.success('Renamed');
      await onChanged();
    } catch (err) {
      toast.error(err.message || 'Rename failed');
    }
  };

  const handleDeletePortfolio = async () => {
    if (
      !window.confirm(
        `Delete portfolio "${portfolio?.name}" and all of its holdings? This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      await deletePortfolio(businessId, portfolio.id);
      toast.success('Portfolio deleted');
      await onChanged({ deletedPortfolioId: portfolio.id });
    } catch (err) {
      toast.error(err.message || 'Delete failed');
    }
  };

  if (!portfolio) return null;

  return (
    <div>
      <div style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <h3 style={{ margin: 0 }}>{portfolio.name}</h3>
          <p style={{ margin: '6px 0 0', color: TavariStyles.colors.gray600, fontSize: 13 }}>
            Purchases for this person / account. Totals use last price and expected monthly dividend.
          </p>
        </div>
        <div>
          <div style={{ fontSize: 13, color: TavariStyles.colors.gray500 }}>Value</div>
          <div style={{ fontWeight: 700 }}>{formatCad(totals.value)}</div>
        </div>
        <div>
          <div style={{ fontSize: 13, color: TavariStyles.colors.gray500 }}>Monthly income</div>
          <div style={{ fontWeight: 700 }}>{formatCad(totals.monthly)}</div>
        </div>
        <div>
          <div style={{ fontSize: 13, color: TavariStyles.colors.gray500 }}>Annual</div>
          <div style={{ fontWeight: 700 }}>{formatCad(totals.annual)}</div>
        </div>
        <button type="button" style={btnGhost} onClick={handleRename}>
          Rename
        </button>
        <button type="button" style={btnGhost} onClick={handleDeletePortfolio}>
          Delete tab
        </button>
      </div>

      <div style={cardStyle}>
        <div style={tableWrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thTd}>Ticker</th>
                <th style={thTd}>Shares</th>
                <th style={thTd}>Avg cost</th>
                <th style={thTd}>Price</th>
                <th style={thTd}>Value</th>
                <th style={thTd}>Monthly income</th>
                <th style={thTd}>YOC</th>
                <th style={thTd} />
              </tr>
            </thead>
            <tbody>
              {portfolioHoldings.length === 0 && (
                <tr>
                  <td style={thTd} colSpan={8}>
                    No holdings yet — add one below.
                  </td>
                </tr>
              )}
              {portfolioHoldings.map((h) => {
                const m = holdingMetrics(h, h.instrument);
                return (
                  <tr key={h.id}>
                    <td style={thTd}>
                      <strong>{h.instrument?.ticker || '—'}</strong>
                      <div style={{ fontSize: 11, color: TavariStyles.colors.gray500 }}>
                        {h.instrument?.name}
                      </div>
                    </td>
                    <td style={thTd}>
                      <input
                        style={inputStyle}
                        type="number"
                        step="any"
                        defaultValue={h.shares}
                        onBlur={(e) => {
                          if (String(e.target.value) !== String(h.shares)) {
                            handleUpdateHoldingRow(h, { shares: e.target.value });
                          }
                        }}
                      />
                    </td>
                    <td style={thTd}>
                      <input
                        style={inputStyle}
                        type="number"
                        step="any"
                        defaultValue={h.avg_cost ?? ''}
                        onBlur={(e) => {
                          if (String(e.target.value) !== String(h.avg_cost ?? '')) {
                            handleUpdateHoldingRow(h, { avg_cost: e.target.value });
                          }
                        }}
                      />
                    </td>
                    <td style={thTd}>{formatCad(h.instrument?.last_price)}</td>
                    <td style={thTd}>{formatCad(m.marketValue)}</td>
                    <td style={thTd}>{formatCad(m.monthlyIncome)}</td>
                    <td style={thTd}>{formatPct(m.yieldOnCost)}</td>
                    <td style={thTd}>
                      <button
                        type="button"
                        style={{ ...btnGhost, padding: '6px 10px' }}
                        onClick={() => handleDeleteHolding(h.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>Add / update holding</h3>
        <form
          onSubmit={handleSaveHolding}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
        >
          <label>
            <div style={{ fontSize: 13, marginBottom: 4 }}>Stock</div>
            <select
              style={{ ...inputStyle, maxWidth: 280 }}
              value={draftHolding.instrument_id}
              onChange={(e) =>
                setDraftHolding((d) => ({ ...d, instrument_id: e.target.value }))
              }
              required
            >
              <option value="">Select…</option>
              {instruments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.ticker}
                  {String(i.currency || 'CAD').toUpperCase() === 'USD' ? ' (USD)' : ''} — {i.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <div style={{ fontSize: 13, marginBottom: 4 }}>Shares</div>
            <input
              style={inputStyle}
              type="number"
              step="any"
              value={draftHolding.shares}
              onChange={(e) => setDraftHolding((d) => ({ ...d, shares: e.target.value }))}
              required
            />
          </label>
          <label>
            <div style={{ fontSize: 13, marginBottom: 4 }}>Avg cost</div>
            <input
              style={inputStyle}
              type="number"
              step="any"
              value={draftHolding.avg_cost}
              onChange={(e) => setDraftHolding((d) => ({ ...d, avg_cost: e.target.value }))}
            />
          </label>
          <button type="submit" style={btnPrimary}>
            Save holding
          </button>
        </form>
      </div>
    </div>
  );
}
