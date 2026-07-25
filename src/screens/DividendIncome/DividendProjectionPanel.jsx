import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { formatCad } from '../../services/DividendIncome/dividendIncomeMath';
import {
  MONTH_NAMES,
  buildDripProjection,
} from '../../services/DividendIncome/dividendProjection';
import {
  deleteProjectionScenario,
  loadProjectionScenarios,
  saveProjectionScenario,
} from '../../services/DividendIncome/dividendIncomeService';

const cardStyle = {
  background: TavariStyles.colors.white,
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  border: `1px solid ${TavariStyles.colors.gray200}`,
};

const tableWrap = { overflowX: 'auto', maxHeight: 520 };

const thTd = {
  padding: '8px 10px',
  borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
  fontSize: TavariStyles.typography.fontSize.sm,
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const inputStyle = {
  width: '100%',
  maxWidth: 160,
  padding: '8px 10px',
  borderRadius: 8,
  border: `1px solid ${TavariStyles.colors.gray300}`,
  fontSize: TavariStyles.typography.fontSize.sm,
  boxSizing: 'border-box',
};

const labelStyle = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 4,
  color: TavariStyles.colors.gray700,
};

const btnPrimary = {
  padding: '8px 14px',
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

function numOrEmpty(v, fallback = '') {
  if (v == null || v === '') return fallback;
  return String(v);
}

/**
 * Networth.csv-style projection: frozen price + dividend, monthly DRIP snowball.
 */
export default function DividendProjectionPanel({
  businessId,
  holdings = [],
  instruments = [],
  portfolios = [],
}) {
  const [portfolioId, setPortfolioId] = useState('');
  const [instrumentId, setInstrumentId] = useState('');
  const [price, setPrice] = useState('');
  const [monthlyDividend, setMonthlyDividend] = useState('');
  const [startingShares, setStartingShares] = useState('');
  const [startYear, setStartYear] = useState(String(new Date().getFullYear()));
  const [startMonthIndex, setStartMonthIndex] = useState(String(new Date().getMonth()));
  const [years, setYears] = useState('20');
  const [startingAge, setStartingAge] = useState('35');
  const [dripEnabled, setDripEnabled] = useState(true);
  const [splitsPerYear, setSplitsPerYear] = useState('0');
  const [contributionWindows, setContributionWindows] = useState([]);
  const [draftWindow, setDraftWindow] = useState({
    name: '',
    amount: '',
    startYear: String(new Date().getFullYear()),
    startMonthIndex: String(new Date().getMonth()),
    endYear: '',
    endMonthIndex: '',
  });
  const [oneTimeAdds, setOneTimeAdds] = useState([]);
  const [draftOneTime, setDraftOneTime] = useState({
    year: String(new Date().getFullYear()),
    monthIndex: String(new Date().getMonth()),
    amount: '',
    note: '',
  });
  const [seeded, setSeeded] = useState(false);
  const [scenarios, setScenarios] = useState([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState('');
  const [scenariosLoading, setScenariosLoading] = useState(false);

  useEffect(() => {
    if (seeded) return;
    if (!instruments.length) return;
    const defaultPortfolio = portfolios[0] || null;
    if (defaultPortfolio) setPortfolioId(defaultPortfolio.id);

    const scopeHoldings = defaultPortfolio
      ? holdings.filter((h) => h.portfolio_id === defaultPortfolio.id)
      : holdings;
    const ftnHolding =
      scopeHoldings.find((h) => h.instrument?.ticker === 'FTN') || scopeHoldings[0] || null;
    const inst =
      instruments.find((i) => i.id === ftnHolding?.instrument_id) ||
      instruments.find((i) => i.ticker === 'FTN') ||
      instruments[0];
    if (!inst) return;
    setInstrumentId(inst.id);
    setPrice(numOrEmpty(inst.last_price, '12.75'));
    setMonthlyDividend(numOrEmpty(inst.expected_monthly_dividend, '0.1257'));
    setStartingShares(numOrEmpty(ftnHolding?.shares, '10586'));
    setSeeded(true);
  }, [seeded, instruments, holdings, portfolios]);

  const reloadScenarios = useCallback(async () => {
    if (!businessId) return;
    setScenariosLoading(true);
    try {
      const list = await loadProjectionScenarios(businessId);
      setScenarios(list);
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'Could not load saved scenarios');
    } finally {
      setScenariosLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    reloadScenarios();
  }, [reloadScenarios]);

  const buildScenarioConfig = useCallback(
    () => ({
      version: 1,
      portfolioId,
      instrumentId,
      price,
      monthlyDividend,
      startingShares,
      startYear,
      startMonthIndex,
      years,
      startingAge,
      dripEnabled,
      splitsPerYear,
      contributionWindows,
      oneTimeAdds,
    }),
    [
      portfolioId,
      instrumentId,
      price,
      monthlyDividend,
      startingShares,
      startYear,
      startMonthIndex,
      years,
      startingAge,
      dripEnabled,
      splitsPerYear,
      contributionWindows,
      oneTimeAdds,
    ]
  );

  const applyScenarioConfig = useCallback((config) => {
    if (!config || typeof config !== 'object') return;
    if (config.portfolioId != null) setPortfolioId(String(config.portfolioId));
    if (config.instrumentId != null) setInstrumentId(String(config.instrumentId));
    if (config.price != null) setPrice(String(config.price));
    if (config.monthlyDividend != null) setMonthlyDividend(String(config.monthlyDividend));
    if (config.startingShares != null) setStartingShares(String(config.startingShares));
    if (config.startYear != null) setStartYear(String(config.startYear));
    if (config.startMonthIndex != null) setStartMonthIndex(String(config.startMonthIndex));
    if (config.years != null) setYears(String(config.years));
    if (config.startingAge != null) setStartingAge(String(config.startingAge));
    if (typeof config.dripEnabled === 'boolean') setDripEnabled(config.dripEnabled);
    if (config.splitsPerYear != null) setSplitsPerYear(String(config.splitsPerYear));
    setContributionWindows(Array.isArray(config.contributionWindows) ? config.contributionWindows : []);
    setOneTimeAdds(Array.isArray(config.oneTimeAdds) ? config.oneTimeAdds : []);
    setSeeded(true);
  }, []);

  const handleSaveScenario = async ({ overwrite = false } = {}) => {
    if (!businessId) return;
    let name = '';
    let id = null;
    if (overwrite && selectedScenarioId) {
      const existing = scenarios.find((s) => s.id === selectedScenarioId);
      if (!existing) {
        toast.error('Select a scenario to overwrite');
        return;
      }
      name = existing.name;
      id = existing.id;
    } else {
      name = window.prompt('Name this projection scenario');
      if (!name || !String(name).trim()) return;
      name = String(name).trim();
      const clash = scenarios.find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (clash) {
        const ok = window.confirm(
          `A scenario named "${clash.name}" already exists. Overwrite it with the current settings?`
        );
        if (!ok) return;
        id = clash.id;
      }
    }

    try {
      const saved = await saveProjectionScenario(businessId, {
        id,
        name,
        config: buildScenarioConfig(),
      });
      toast.success(`Saved “${saved.name}”`);
      setSelectedScenarioId(saved.id);
      await reloadScenarios();
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'Could not save scenario');
    }
  };

  const handleLoadScenario = () => {
    const row = scenarios.find((s) => s.id === selectedScenarioId);
    if (!row) {
      toast.error('Select a saved scenario first');
      return;
    }
    applyScenarioConfig(row.config);
    toast.success(`Loaded “${row.name}”`);
  };

  const handleDeleteScenario = async () => {
    if (!businessId || !selectedScenarioId) return;
    const row = scenarios.find((s) => s.id === selectedScenarioId);
    if (!row) return;
    if (!window.confirm(`Delete scenario “${row.name}”?`)) return;
    try {
      await deleteProjectionScenario(businessId, selectedScenarioId);
      toast.success('Scenario deleted');
      setSelectedScenarioId('');
      await reloadScenarios();
    } catch (e) {
      toast.error(e.message || 'Could not delete scenario');
    }
  };

  const applyHoldingSeed = (nextPortfolioId, nextInstrumentId) => {
    const scope = nextPortfolioId
      ? holdings.filter((h) => h.portfolio_id === nextPortfolioId)
      : holdings;
    const holding =
      scope.find((h) => h.instrument_id === nextInstrumentId) ||
      scope.find((h) => h.instrument?.ticker === 'FTN') ||
      scope[0];
    const inst =
      instruments.find((i) => i.id === (nextInstrumentId || holding?.instrument_id)) ||
      instruments[0];
    if (inst) {
      setInstrumentId(inst.id);
      if (inst.last_price != null) setPrice(String(inst.last_price));
      if (inst.expected_monthly_dividend != null) {
        setMonthlyDividend(String(inst.expected_monthly_dividend));
      }
    }
    if (holding?.shares != null) setStartingShares(String(holding.shares));
  };

  const parsedWindows = useMemo(
    () =>
      (contributionWindows || [])
        .map((w) => ({
          name: w.name || 'Contribution',
          amount: Number(w.amount),
          startYear: Number(w.startYear),
          startMonthIndex: Number(w.startMonthIndex),
          endYear: w.endYear === '' || w.endYear == null ? null : Number(w.endYear),
          endMonthIndex:
            w.endMonthIndex === '' || w.endMonthIndex == null
              ? null
              : Number(w.endMonthIndex),
        }))
        .filter((w) => Number.isFinite(w.amount) && w.amount !== 0),
    [contributionWindows]
  );

  const parsedOneTimes = useMemo(
    () =>
      (oneTimeAdds || [])
        .map((a) => ({
          year: Number(a.year),
          monthIndex: Number(a.monthIndex),
          amount: Number(a.amount),
          note: a.note || '',
        }))
        .filter((a) => Number.isFinite(a.amount) && a.amount !== 0),
    [oneTimeAdds]
  );

  const projection = useMemo(() => {
    try {
      const y = Math.max(1, Math.min(50, Number(years) || 20));
      return buildDripProjection({
        startingShares: Number(startingShares),
        price: Number(price),
        monthlyDividend: Number(monthlyDividend),
        startYear: Number(startYear),
        startMonthIndex: Number(startMonthIndex),
        months: y * 12,
        startingAge: startingAge === '' ? null : Number(startingAge),
        dripEnabled,
        contributionWindows: parsedWindows,
        splitsPerYear: Number(splitsPerYear) || 0,
        oneTimeAdds: parsedOneTimes,
      });
    } catch {
      return null;
    }
  }, [
    startingShares,
    price,
    monthlyDividend,
    startYear,
    startMonthIndex,
    years,
    startingAge,
    dripEnabled,
    splitsPerYear,
    parsedWindows,
    parsedOneTimes,
  ]);

  const error = useMemo(() => {
    try {
      buildDripProjection({
        startingShares: Number(startingShares),
        price: Number(price),
        monthlyDividend: Number(monthlyDividend),
        startYear: Number(startYear),
        startMonthIndex: Number(startMonthIndex),
        months: 1,
      });
      return null;
    } catch (e) {
      return e.message;
    }
  }, [startingShares, price, monthlyDividend, startYear, startMonthIndex]);

  const selectedTicker =
    instruments.find((i) => i.id === instrumentId)?.ticker || '—';

  const addOneTime = (e) => {
    e.preventDefault();
    const amount = Number(draftOneTime.amount);
    if (!Number.isFinite(amount) || amount === 0) return;
    setOneTimeAdds((list) => [
      ...list,
      {
        id: `${Date.now()}-${Math.random()}`,
        year: draftOneTime.year,
        monthIndex: draftOneTime.monthIndex,
        amount: String(amount),
        note: draftOneTime.note || '',
      },
    ]);
    setDraftOneTime((d) => ({ ...d, amount: '', note: '' }));
  };

  const addContributionWindow = (e) => {
    e.preventDefault();
    const amount = Number(draftWindow.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      window.alert('Enter a monthly amount greater than zero.');
      return;
    }

    let endYear = draftWindow.endYear;
    let endMonthIndex = draftWindow.endMonthIndex;
    // If end year is set without a month, default to December of that year
    if (endYear !== '' && endYear != null && (endMonthIndex === '' || endMonthIndex == null)) {
      endMonthIndex = '11';
    }

    const hasEnd = endYear !== '' && endYear != null && endMonthIndex !== '' && endMonthIndex != null;
    if (hasEnd) {
      const startKey =
        Number(draftWindow.startYear) * 12 + Number(draftWindow.startMonthIndex);
      const endKey = Number(endYear) * 12 + Number(endMonthIndex);
      if (endKey < startKey) {
        window.alert('End date must be on or after the start date.');
        return;
      }
    }

    setContributionWindows((list) => [
      ...list,
      {
        id: `${Date.now()}-${Math.random()}`,
        name: draftWindow.name.trim() || 'Monthly contribution',
        amount: String(amount),
        startYear: draftWindow.startYear,
        startMonthIndex: draftWindow.startMonthIndex,
        endYear: hasEnd ? String(endYear) : '',
        endMonthIndex: hasEnd ? String(endMonthIndex) : '',
      },
    ]);
    setDraftWindow((d) => ({
      ...d,
      name: '',
      amount: '',
      endYear: '',
      endMonthIndex: '',
    }));
  };

  return (
    <div>
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>Saved scenarios</h3>
        <p style={{ color: TavariStyles.colors.gray600, marginTop: 0 }}>
          Save the full projection setup (price, dividend, shares, monthly windows, one-time adds,
          DRIP, splits) so you can reload it later.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <label style={{ flex: '1 1 220px' }}>
            <span style={labelStyle}>Saved scenario</span>
            <select
              style={{ ...inputStyle, maxWidth: '100%' }}
              value={selectedScenarioId}
              onChange={(e) => setSelectedScenarioId(e.target.value)}
              disabled={scenariosLoading}
            >
              <option value="">Select…</option>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" style={btnPrimary} onClick={handleLoadScenario}>
            Load
          </button>
          <button type="button" style={btnPrimary} onClick={() => handleSaveScenario()}>
            Save as new…
          </button>
          <button
            type="button"
            style={btnGhost}
            onClick={() => handleSaveScenario({ overwrite: true })}
            disabled={!selectedScenarioId}
          >
            Overwrite selected
          </button>
          <button
            type="button"
            style={btnGhost}
            onClick={handleDeleteScenario}
            disabled={!selectedScenarioId}
          >
            Delete
          </button>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>Projection (Networth model)</h3>
        <p style={{ color: TavariStyles.colors.gray600, marginTop: 0 }}>
          Frozen snapshot price and monthly dividend — same approach as your spreadsheet. Each month
          collect dividend, optionally add cash (monthly or one-time), buy more shares at that frozen
          price (DRIP), repeat.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 12,
            marginBottom: 8,
          }}
        >
          {portfolios.length > 0 && (
            <label>
              <span style={labelStyle}>Seed from person</span>
              <select
                style={{ ...inputStyle, maxWidth: '100%' }}
                value={portfolioId}
                onChange={(e) => {
                  setPortfolioId(e.target.value);
                  applyHoldingSeed(e.target.value, instrumentId);
                }}
              >
                {portfolios.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span style={labelStyle}>Stock</span>
            <select
              style={{ ...inputStyle, maxWidth: '100%' }}
              value={instrumentId}
              onChange={(e) => applyHoldingSeed(portfolioId, e.target.value)}
            >
              {instruments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.ticker}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span style={labelStyle}>Snapshot price</span>
            <input
              style={{ ...inputStyle, maxWidth: '100%' }}
              type="number"
              step="any"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
          <label>
            <span style={labelStyle}>Monthly dividend / share</span>
            <input
              style={{ ...inputStyle, maxWidth: '100%' }}
              type="number"
              step="any"
              value={monthlyDividend}
              onChange={(e) => setMonthlyDividend(e.target.value)}
            />
          </label>
          <label>
            <span style={labelStyle}>Starting shares</span>
            <input
              style={{ ...inputStyle, maxWidth: '100%' }}
              type="number"
              step="any"
              value={startingShares}
              onChange={(e) => setStartingShares(e.target.value)}
            />
          </label>
          <label>
            <span style={labelStyle}>Start year</span>
            <input
              style={{ ...inputStyle, maxWidth: '100%' }}
              type="number"
              value={startYear}
              onChange={(e) => setStartYear(e.target.value)}
            />
          </label>
          <label>
            <span style={labelStyle}>Start month</span>
            <select
              style={{ ...inputStyle, maxWidth: '100%' }}
              value={startMonthIndex}
              onChange={(e) => setStartMonthIndex(e.target.value)}
            >
              {MONTH_NAMES.map((name, idx) => (
                <option key={name} value={idx}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span style={labelStyle}>Years to project</span>
            <input
              style={{ ...inputStyle, maxWidth: '100%' }}
              type="number"
              min={1}
              max={50}
              value={years}
              onChange={(e) => setYears(e.target.value)}
            />
          </label>
          <label>
            <span style={labelStyle}>Starting age (optional)</span>
            <input
              style={{ ...inputStyle, maxWidth: '100%' }}
              type="number"
              step="any"
              value={startingAge}
              onChange={(e) => setStartingAge(e.target.value)}
            />
          </label>
          <label>
            <span style={labelStyle}>Splits / year</span>
            <select
              style={{ ...inputStyle, maxWidth: '100%' }}
              value={splitsPerYear}
              onChange={(e) => setSplitsPerYear(e.target.value)}
            >
              <option value="0">None</option>
              <option value="1">1 (+10% shares/yr)</option>
              <option value="2">2 (+10% ×2 /yr)</option>
            </select>
          </label>
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 8 }}>
            <TavariCheckbox
              id="div-projection-drip"
              checked={dripEnabled}
              onChange={(next) => setDripEnabled(!!next)}
              label="DRIP on"
            />
          </div>
        </div>
        {error && (
          <p style={{ color: TavariStyles.colors.danger || '#b91c1c', marginBottom: 0 }}>{error}</p>
        )}
      </div>

      <div
        style={{
          ...cardStyle,
          border: `2px solid ${TavariStyles.colors.primary || '#0d9488'}`,
        }}
      >
        <h3 style={{ marginTop: 0 }}>Monthly contribution windows</h3>
        <p style={{ color: TavariStyles.colors.gray600, marginTop: 0 }}>
          Use this for recurring cash (not the one-time section below). Example: Parents $80 every
          month from Jan 2027 through Dec 2035. Leave end year blank to keep adding for the rest of
          the projection.
        </p>
        <form
          onSubmit={addContributionWindow}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 12,
            alignItems: 'end',
            marginBottom: 12,
          }}
        >
          <label>
            <span style={labelStyle}>Label</span>
            <input
              style={{ ...inputStyle, maxWidth: '100%' }}
              type="text"
              value={draftWindow.name}
              onChange={(e) => setDraftWindow((d) => ({ ...d, name: e.target.value }))}
              placeholder="Parents / George"
            />
          </label>
          <label>
            <span style={labelStyle}>$/month</span>
            <input
              style={{ ...inputStyle, maxWidth: '100%' }}
              type="number"
              step="any"
              value={draftWindow.amount}
              onChange={(e) => setDraftWindow((d) => ({ ...d, amount: e.target.value }))}
              required
            />
          </label>
          <label>
            <span style={labelStyle}>Start year</span>
            <input
              style={{ ...inputStyle, maxWidth: '100%' }}
              type="number"
              value={draftWindow.startYear}
              onChange={(e) => setDraftWindow((d) => ({ ...d, startYear: e.target.value }))}
              required
            />
          </label>
          <label>
            <span style={labelStyle}>Start month</span>
            <select
              style={{ ...inputStyle, maxWidth: '100%' }}
              value={draftWindow.startMonthIndex}
              onChange={(e) => setDraftWindow((d) => ({ ...d, startMonthIndex: e.target.value }))}
            >
              {MONTH_NAMES.map((name, idx) => (
                <option key={name} value={idx}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span style={labelStyle}>End year (optional)</span>
            <input
              style={{ ...inputStyle, maxWidth: '100%' }}
              type="number"
              value={draftWindow.endYear}
              onChange={(e) => {
                const endYear = e.target.value;
                setDraftWindow((d) => ({
                  ...d,
                  endYear,
                  endMonthIndex:
                    endYear === ''
                      ? ''
                      : d.endMonthIndex === ''
                        ? '11'
                        : d.endMonthIndex,
                }));
              }}
              placeholder="Ongoing"
            />
          </label>
          <label>
            <span style={labelStyle}>End month</span>
            <select
              style={{ ...inputStyle, maxWidth: '100%' }}
              value={draftWindow.endMonthIndex}
              onChange={(e) => setDraftWindow((d) => ({ ...d, endMonthIndex: e.target.value }))}
              disabled={draftWindow.endYear === ''}
            >
              <option value="">—</option>
              {MONTH_NAMES.map((name, idx) => (
                <option key={name} value={idx}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <button type="submit" style={{ ...btnPrimary, width: '100%', maxWidth: 220 }}>
              Add monthly window
            </button>
          </div>
        </form>

        {contributionWindows.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: TavariStyles.colors.gray500 }}>
            No monthly windows yet — fill $/month + start date, then click{' '}
            <strong>Add monthly window</strong>.
          </p>
        ) : (
          <div style={{ ...tableWrap, maxHeight: 220, marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thTd}>Label</th>
                  <th style={thTd}>$/mo</th>
                  <th style={thTd}>Start</th>
                  <th style={thTd}>End</th>
                  <th style={thTd} />
                </tr>
              </thead>
              <tbody>
                {contributionWindows.map((w) => (
                  <tr key={w.id}>
                    <td style={thTd}>{w.name}</td>
                    <td style={thTd}>{formatCad(Number(w.amount))}</td>
                    <td style={thTd}>
                      {MONTH_NAMES[Number(w.startMonthIndex)]} {w.startYear}
                    </td>
                    <td style={thTd}>
                      {w.endYear === '' || w.endYear == null
                        ? 'Ongoing'
                        : `${MONTH_NAMES[Number(w.endMonthIndex)]} ${w.endYear}`}
                    </td>
                    <td style={thTd}>
                      <button
                        type="button"
                        style={{ ...btnGhost, padding: '4px 8px' }}
                        onClick={() =>
                          setContributionWindows((list) => list.filter((x) => x.id !== w.id))
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>One-time cash adds (lump sum)</h3>
        <p style={{ color: TavariStyles.colors.gray600, marginTop: 0 }}>
          Lump sums (refinance, bonus, gift, etc.) invested in that month at the frozen snapshot
          price.
        </p>
        <form
          onSubmit={addOneTime}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
        >
          <label>
            <span style={labelStyle}>Year</span>
            <input
              style={inputStyle}
              type="number"
              value={draftOneTime.year}
              onChange={(e) => setDraftOneTime((d) => ({ ...d, year: e.target.value }))}
              required
            />
          </label>
          <label>
            <span style={labelStyle}>Month</span>
            <select
              style={inputStyle}
              value={draftOneTime.monthIndex}
              onChange={(e) => setDraftOneTime((d) => ({ ...d, monthIndex: e.target.value }))}
            >
              {MONTH_NAMES.map((name, idx) => (
                <option key={name} value={idx}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span style={labelStyle}>Amount ($)</span>
            <input
              style={inputStyle}
              type="number"
              step="any"
              value={draftOneTime.amount}
              onChange={(e) => setDraftOneTime((d) => ({ ...d, amount: e.target.value }))}
              required
            />
          </label>
          <label>
            <span style={labelStyle}>Note (optional)</span>
            <input
              style={{ ...inputStyle, maxWidth: 220 }}
              type="text"
              value={draftOneTime.note}
              onChange={(e) => setDraftOneTime((d) => ({ ...d, note: e.target.value }))}
              placeholder="e.g. house refinance"
            />
          </label>
          <button type="submit" style={btnPrimary}>
            Add one-time
          </button>
        </form>

        {oneTimeAdds.length > 0 && (
          <div style={{ ...tableWrap, maxHeight: 220, marginTop: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thTd}>Year</th>
                  <th style={thTd}>Month</th>
                  <th style={thTd}>Amount</th>
                  <th style={thTd}>Note</th>
                  <th style={thTd} />
                </tr>
              </thead>
              <tbody>
                {oneTimeAdds.map((a) => (
                  <tr key={a.id}>
                    <td style={thTd}>{a.year}</td>
                    <td style={thTd}>{MONTH_NAMES[Number(a.monthIndex)] || a.monthIndex}</td>
                    <td style={thTd}>{formatCad(Number(a.amount))}</td>
                    <td style={thTd}>{a.note || '—'}</td>
                    <td style={thTd}>
                      <button
                        type="button"
                        style={{ ...btnGhost, padding: '4px 8px' }}
                        onClick={() =>
                          setOneTimeAdds((list) => list.filter((x) => x.id !== a.id))
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {projection?.summary && (
        <div
          style={{
            ...cardStyle,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 20,
          }}
        >
          <div>
            <div style={{ fontSize: 13, color: TavariStyles.colors.gray500 }}>
              {selectedTicker} now
            </div>
            <div style={{ fontWeight: 700 }}>
              {formatCad(projection.summary.startMonthlyIncome)}/mo
            </div>
            <div style={{ fontSize: 13 }}>{formatCad(projection.summary.startWorth)} value</div>
          </div>
          {[
            ['5 years', projection.summary.y5],
            ['10 years', projection.summary.y10],
            ['15 years', projection.summary.y15],
            ['20 years', projection.summary.y20],
          ].map(([label, row]) =>
            row ? (
              <div key={label}>
                <div style={{ fontSize: 13, color: TavariStyles.colors.gray500 }}>{label}</div>
                <div style={{ fontWeight: 700 }}>{formatCad(row.dividendCollected)}/mo</div>
                <div style={{ fontSize: 13 }}>{formatCad(row.worth)} value</div>
              </div>
            ) : null
          )}
        </div>
      )}

      {projection?.rows?.length > 0 && (
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Month-by-month</h3>
          <div style={tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thTd}>Year</th>
                  <th style={thTd}>Age</th>
                  <th style={thTd}>Month</th>
                  <th style={thTd}>Div / share</th>
                  <th style={thTd}>Shares owned</th>
                  <th style={thTd}>Dividend collected</th>
                  <th style={thTd}>Monthly adds</th>
                  <th style={thTd}>One-time</th>
                  <th style={thTd}>Worth</th>
                </tr>
              </thead>
              <tbody>
                {projection.rows.map((row, idx) => (
                  <tr key={`${row.year}-${row.monthIndex}-${idx}`}>
                    <td style={thTd}>{row.displayYear != null ? row.displayYear : ''}</td>
                    <td style={thTd}>{row.age != null ? row.age : ''}</td>
                    <td style={thTd}>{row.monthName}</td>
                    <td style={thTd}>{Number(row.dividendPerShare).toFixed(4)}</td>
                    <td style={thTd}>
                      {row.shares.toLocaleString('en-CA', { maximumFractionDigits: 2 })}
                    </td>
                    <td style={thTd}>{formatCad(row.dividendCollected)}</td>
                    <td style={thTd}>
                      {row.contribution1
                        ? (
                            <span
                              title={(row.contributionWindowsApplied || [])
                                .map((a) => `${a.name}: ${a.amount}`)
                                .join(', ')}
                            >
                              {formatCad(row.contribution1)}
                            </span>
                          )
                        : '—'}
                    </td>
                    <td style={thTd}>
                      {row.oneTime ? formatCad(row.oneTime) : '—'}
                    </td>
                    <td style={thTd}>{formatCad(row.worth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
