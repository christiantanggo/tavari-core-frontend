import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FiBriefcase, FiCalendar, FiPlus, FiRefreshCw, FiTrendingUp } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { isPersonalFinanceBusiness } from '../../config/personalFinanceAccess';
import {
  formatCad,
  formatMoney,
  formatPct,
  formatStableStreak,
  rankInstruments,
} from '../../services/DividendIncome/dividendIncomeMath';
import {
  createPortfolio,
  ensureDefaultPortfolio,
  loadHoldings,
  loadInstruments,
  loadPortfolios,
  refreshQuotes,
  updateInstrumentFields,
} from '../../services/DividendIncome/dividendIncomeService';
import DividendProjectionPanel from './DividendProjectionPanel';
import DividendHoldingsPanel from './DividendHoldingsPanel';

const CASH_AMOUNTS = [1000, 1330, 10000];
const ADD_PORTFOLIO_TAB_ID = 'add_portfolio';

const shellStyles = {
  minHeight: '100vh',
  backgroundColor: TavariStyles.colors.gray50 || '#f9fafb',
  padding: '20px',
  paddingTop: '80px',
  boxSizing: 'border-box',
};

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

function portfolioTabId(id) {
  return `portfolio:${id}`;
}

function DividendIncomeInner() {
  const auth = usePOSAuth({
    requiredRoles: ['owner', 'admin', 'manager'],
    requireBusiness: true,
    componentName: 'DividendIncomeDashboard',
  });
  const { selectedBusinessId, selectedBusiness } = useBusinessContext();
  const businessId = selectedBusinessId || auth.selectedBusinessId;

  const allowed = isPersonalFinanceBusiness(selectedBusiness, businessId);

  const [activeTab, setActiveTab] = useState('best_buy');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [instruments, setInstruments] = useState([]);
  const [holdings, setHoldings] = useState([]);
  const [portfolios, setPortfolios] = useState([]);
  const [usdCadRate, setUsdCadRate] = useState(null);

  const reload = useCallback(
    async (opts = {}) => {
      if (!businessId || !allowed) return;
      setLoading(true);
      try {
        let ports = await ensureDefaultPortfolio(businessId);
        ports = await loadPortfolios(businessId);
        const [inst, holds] = await Promise.all([
          loadInstruments(businessId),
          loadHoldings(businessId),
        ]);
        setPortfolios(ports);
        setInstruments(inst);
        setHoldings(holds);

        if (opts.deletedPortfolioId) {
          setActiveTab((prev) =>
            prev === portfolioTabId(opts.deletedPortfolioId) ? 'best_buy' : prev
          );
        }
        if (opts.focusPortfolioId) {
          setActiveTab(portfolioTabId(opts.focusPortfolioId));
        }
      } catch (e) {
        console.error(e);
        toast.error(e.message || 'Failed to load dividend data');
      } finally {
        setLoading(false);
      }
    },
    [businessId, allowed]
  );

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Public FX API (browser-friendly); used so CAD cash → USD tickers ranks fairly
        const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=CAD');
        if (!res.ok) return;
        const body = await res.json();
        const rate = Number(body?.rates?.CAD);
        if (!cancelled && Number.isFinite(rate) && rate > 0) setUsdCadRate(rate);
      } catch {
        /* Best Buy still ranks within each currency */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tabs = useMemo(
    () => [
      { id: 'best_buy', label: 'Best Buy Today', icon: FiTrendingUp },
      { id: 'projection', label: 'Projection', icon: FiCalendar },
      ...portfolios.map((p) => ({
        id: portfolioTabId(p.id),
        label: p.name,
        icon: FiBriefcase,
      })),
      { id: ADD_PORTFOLIO_TAB_ID, label: 'Add person', icon: FiPlus },
    ],
    [portfolios]
  );

  const ranked = useMemo(
    () => rankInstruments(instruments, CASH_AMOUNTS, { usdCadRate }),
    [instruments, usdCadRate]
  );

  const portfolioTotals = useMemo(() => {
    let value = 0;
    let monthly = 0;
    let hasValue = false;
    let hasMonthly = false;
    for (const h of holdings) {
      const price = Number(h.instrument?.last_price);
      const div = Number(h.instrument?.expected_monthly_dividend);
      const shares = Number(h.shares) || 0;
      if (Number.isFinite(price)) {
        value += shares * price;
        hasValue = true;
      }
      if (Number.isFinite(div)) {
        monthly += shares * div;
        hasMonthly = true;
      }
    }
    return {
      value: hasValue ? value : null,
      monthly: hasMonthly ? monthly : null,
      annual: hasMonthly ? monthly * 12 : null,
    };
  }, [holdings]);

  const handleTabChange = async (id) => {
    if (id === ADD_PORTFOLIO_TAB_ID) {
      const name = window.prompt('Name for this holdings tab (e.g. George, Austin)');
      if (!name || !String(name).trim()) return;
      try {
        const created = await createPortfolio(businessId, name.trim());
        toast.success(`Added ${created.name}`);
        await reload({ focusPortfolioId: created.id });
      } catch (e) {
        toast.error(e.message || 'Could not add portfolio');
      }
      return;
    }
    setActiveTab(id);
  };

  const handleRefreshQuotes = async () => {
    if (!businessId) return;
    setRefreshing(true);
    try {
      const result = await refreshQuotes(businessId);
      const okCount = (result?.results || []).filter((r) => r.ok).length;
      toast.success(`Updated ${okCount} price${okCount === 1 ? '' : 's'}`);
      await reload();
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'Quote refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const handleUpdateDividend = async (instrumentId, value) => {
    try {
      await updateInstrumentFields(businessId, instrumentId, {
        expected_monthly_dividend: value === '' ? null : Number(value),
      });
      toast.success('Dividend updated');
      await reload();
    } catch (err) {
      toast.error(err.message || 'Could not update dividend');
    }
  };

  const handleToggleStreakBypass = async (row, enable) => {
    try {
      await updateInstrumentFields(businessId, row.id, { streak_bypass: !!enable });
      toast.success(
        enable
          ? `${row.ticker} added to ranking (streak bypass)`
          : `${row.ticker} streak bypass removed`
      );
      await reload();
    } catch (err) {
      toast.error(err.message || 'Could not update bypass');
    }
  };

  const activePortfolio = useMemo(() => {
    if (!String(activeTab).startsWith('portfolio:')) return null;
    const id = activeTab.slice('portfolio:'.length);
    return portfolios.find((p) => p.id === id) || null;
  }, [activeTab, portfolios]);

  if (auth.authLoading) {
    return <div style={shellStyles}>Loading…</div>;
  }

  if (!allowed) {
    return (
      <div style={shellStyles}>
        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Dividend Income</h2>
          <p style={{ color: TavariStyles.colors.gray600 }}>
            This module is only available on the <strong>Christian Fournier</strong> personal
            business. Switch businesses in the header to open it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={shellStyles}>
      <TavariModuleHeader
        title="Dividend Income"
        description="Maximize reliable monthly retirement income — not portfolio fluff"
      />

      <div style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, color: TavariStyles.colors.gray500 }}>All portfolios value</div>
          <div style={{ fontSize: 23, fontWeight: 700 }}>{formatCad(portfolioTotals.value)}</div>
        </div>
        <div>
          <div style={{ fontSize: 13, color: TavariStyles.colors.gray500 }}>All monthly income</div>
          <div style={{ fontSize: 23, fontWeight: 700 }}>{formatCad(portfolioTotals.monthly)}</div>
        </div>
        <div>
          <div style={{ fontSize: 13, color: TavariStyles.colors.gray500 }}>All annual income</div>
          <div style={{ fontSize: 23, fontWeight: 700 }}>{formatCad(portfolioTotals.annual)}</div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button
            type="button"
            style={btnPrimary}
            onClick={handleRefreshQuotes}
            disabled={refreshing}
          >
            <FiRefreshCw style={{ marginRight: 8, verticalAlign: 'middle' }} />
            {refreshing ? 'Refreshing…' : 'Refresh prices'}
          </button>
        </div>
      </div>

      <TavariTabSystemComponent
        tabs={tabs}
        mode="state"
        activeTab={activeTab}
        onTabChange={handleTabChange}
        ariaLabel="Dividend Income"
      />

      {loading ? (
        <div style={cardStyle}>Loading…</div>
      ) : activeTab === 'best_buy' ? (
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Best buy today</h3>
          <p style={{ color: TavariStyles.colors.gray600, marginTop: 0 }}>
            Qualified names ranked by <strong>monthly income created per CAD dollar</strong> at
            current price and expected monthly dividend
            {usdCadRate
              ? ` (USD converted at ~${usdCadRate.toFixed(4)} CAD)`
              : ' (USD FX loading…)'}
            .
          </p>
          <div style={tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thTd}>Rank</th>
                  <th style={thTd}>Ticker</th>
                  <th style={thTd}>Price</th>
                  <th style={thTd}>Monthly div</th>
                  <th style={thTd}>Streak</th>
                  <th style={thTd}>Income / $</th>
                  <th style={thTd}>Ann. yield</th>
                  <th style={thTd}>$1,000 → mo</th>
                  <th style={thTd}>$1,330 → mo</th>
                  <th style={thTd}>$10,000 → mo</th>
                  <th style={thTd}>Qualified?</th>
                  <th style={thTd}>Bypass</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((row) => (
                  <tr
                    key={row.id}
                    style={
                      row.rank === 1 ? { background: 'rgba(16, 185, 129, 0.08)' } : undefined
                    }
                  >
                    <td style={thTd}>{row.rank ?? '—'}</td>
                    <td style={thTd}>
                      <strong>
                        {row.ticker}
                        {String(row.currency || 'CAD').toUpperCase() === 'USD' ? '.US' : ''}
                      </strong>
                      <div style={{ fontSize: 11, color: TavariStyles.colors.gray500 }}>
                        {row.provider || '—'} · {String(row.currency || 'CAD').toUpperCase()}
                      </div>
                    </td>
                    <td style={thTd}>{formatMoney(row.last_price, row.currency)}</td>
                    <td style={thTd}>
                      <input
                        style={{ ...inputStyle, maxWidth: 100 }}
                        type="number"
                        step="any"
                        defaultValue={row.expected_monthly_dividend ?? ''}
                        onBlur={(e) => {
                          if (
                            String(e.target.value) !==
                            String(row.expected_monthly_dividend ?? '')
                          ) {
                            handleUpdateDividend(row.id, e.target.value);
                          }
                        }}
                      />
                    </td>
                    <td style={thTd}>
                      <span style={{ fontWeight: 600 }}>
                        {formatStableStreak(row.stable_months)}
                      </span>
                    </td>
                    <td style={thTd}>
                      {row.incomePerDollar != null ? row.incomePerDollar.toFixed(6) : '—'}
                    </td>
                    <td style={thTd}>{formatPct(row.annualYield)}</td>
                    <td style={thTd}>{formatCad(row.incomeByCash[1000]?.monthlyIncome)}</td>
                    <td style={thTd}>{formatCad(row.incomeByCash[1330]?.monthlyIncome)}</td>
                    <td style={thTd}>{formatCad(row.incomeByCash[10000]?.monthlyIncome)}</td>
                    <td style={thTd}>
                      {row.qualified ? (
                        <span style={{ color: '#059669', fontWeight: 600 }}>
                          Yes{row.qualification?.bypassed ? ' (bypass)' : ''}
                        </span>
                      ) : (
                        <span style={{ color: '#b45309' }} title={row.qualification?.reason}>
                          No — {row.qualification?.reason}
                        </span>
                      )}
                    </td>
                    <td style={thTd}>
                      {row.streak_bypass ? (
                        <button
                          type="button"
                          style={{ ...btnGhost, padding: '6px 10px' }}
                          onClick={() => handleToggleStreakBypass(row, false)}
                        >
                          Remove bypass
                        </button>
                      ) : row.variable_distribution || row.pays_monthly === false ? (
                        <span style={{ fontSize: 11, color: TavariStyles.colors.gray500 }}>
                          N/A
                        </span>
                      ) : (
                        <button
                          type="button"
                          style={{ ...btnPrimary, padding: '6px 10px' }}
                          onClick={() => handleToggleStreakBypass(row, true)}
                          disabled={
                            !Number(row.expected_monthly_dividend) || !Number(row.last_price)
                          }
                        >
                          Streak OK — include
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === 'projection' ? (
        <DividendProjectionPanel
          businessId={businessId}
          holdings={holdings}
          instruments={instruments}
          portfolios={portfolios}
        />
      ) : activePortfolio ? (
        <DividendHoldingsPanel
          businessId={businessId}
          portfolio={activePortfolio}
          holdings={holdings}
          instruments={instruments}
          onChanged={reload}
        />
      ) : (
        <div style={cardStyle}>Select a tab.</div>
      )}
    </div>
  );
}

export default function DividendIncomeDashboard() {
  return (
    <POSAuthWrapper>
      <DividendIncomeInner />
    </POSAuthWrapper>
  );
}
