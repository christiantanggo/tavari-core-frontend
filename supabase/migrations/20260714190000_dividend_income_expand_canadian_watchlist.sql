-- Expand Dividend Income watchlist beyond Quadravest (Brompton Class A peers + related ETFs)

INSERT INTO public.div_instruments (
  business_id, ticker, yahoo_symbol, name, provider, fund_type,
  expected_monthly_dividend, last_price, pays_monthly, variable_distribution,
  stable_months, active, notes, disqualified_reason
)
SELECT
  b.id,
  v.ticker,
  v.yahoo_symbol,
  v.name,
  v.provider,
  v.fund_type,
  v.expected_monthly_dividend,
  v.last_price,
  v.pays_monthly,
  v.variable_distribution,
  v.stable_months,
  true,
  v.notes,
  v.disqualified_reason
FROM public.businesses b
CROSS JOIN (
  VALUES
    ('LBS', 'LBS.TO', 'Life & Banc Split Corp.', 'Brompton', 'split_share', 0.10::numeric, 13.44::numeric, true, false, 36, 'Class A monthly target $0.10', NULL::text),
    ('SBC', 'SBC.TO', 'Brompton Split Banc Corp.', 'Brompton', 'split_share', 0.10, 16.59, true, false, 36, 'Class A monthly target $0.10', NULL),
    ('LCS', 'LCS.TO', 'Brompton Lifeco Split Corp.', 'Brompton', 'split_share', 0.075, 11.54, true, false, 36, 'Class A monthly target $0.075', NULL),
    ('DGS', 'DGS.TO', 'Dividend Growth Split Corp.', 'Brompton', 'split_share', 0.10, 8.77, true, false, 36, 'Class A monthly target $0.10', NULL),
    ('GDV', 'GDV.TO', 'Global Dividend Growth Split Corp.', 'Brompton', 'split_share', 0.10, 12.13, true, false, 36, 'Class A monthly target $0.10', NULL),
    ('PWI', 'PWI.TO', 'Power & Infrastructure Split Corp.', 'Brompton', 'split_share', 0.10, 12.65, true, false, 24, 'Class A monthly target $0.10', NULL),
    ('ESP', 'ESP.TO', 'Brompton Energy Split Corp.', 'Brompton', 'split_share', 0.10, 7.51, true, false, 24, 'Class A monthly; energy / NAV unit rule risk', NULL),
    ('CLSA', 'CLSA.TO', 'Brompton Split Corp. Enhanced Equity Income ETF', 'Brompton', 'etf', 0.18, 18.33, true, false, 15, 'Basket of Class A split shares; inception Mar 2025', 'Stable only ~15 months (need 24+)'),
    ('SPLT', 'SPLT.TO', 'Brompton Split Corp. Preferred Share ETF', 'Brompton', 'etf', NULL, NULL, true, false, 12, 'Preferred-share ETF (bond-like vs Class A)', 'Confirm fixed monthly amount; preferred risk profile'),
    ('PREF', 'PREF.TO', 'Quadravest Preferred Split Share ETF', 'Quadravest', 'etf', NULL, NULL, true, false, 12, 'Preferred split-share ETF', 'Confirm distribution stability; preferred not Class A')
) AS v(ticker, yahoo_symbol, name, provider, fund_type, expected_monthly_dividend, last_price, pays_monthly, variable_distribution, stable_months, notes, disqualified_reason)
WHERE lower(trim(b.name)) = lower('Christian Fournier')
ON CONFLICT (business_id, ticker) DO UPDATE SET
  yahoo_symbol = EXCLUDED.yahoo_symbol,
  name = EXCLUDED.name,
  provider = EXCLUDED.provider,
  fund_type = EXCLUDED.fund_type,
  expected_monthly_dividend = COALESCE(EXCLUDED.expected_monthly_dividend, public.div_instruments.expected_monthly_dividend),
  last_price = COALESCE(EXCLUDED.last_price, public.div_instruments.last_price),
  pays_monthly = EXCLUDED.pays_monthly,
  stable_months = EXCLUDED.stable_months,
  notes = EXCLUDED.notes,
  disqualified_reason = EXCLUDED.disqualified_reason,
  updated_at = now();
