-- Add remaining Canadian Class A peers + Wealthsimple-tradable US monthly CEFs.
-- PDV is variable (10% of VWAP), same rule family as BK.
-- US names are managed-distribution CEFs (closest US analogue to fixed monthly Class A), not true split corps.

INSERT INTO public.div_instruments (
  business_id, ticker, yahoo_symbol, name, provider, fund_type, currency,
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
  v.currency,
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
    -- Canadian fill-ins
    (
      'LFE', 'LFE.TO', 'Canadian Life Companies Split Corp.', 'Quadravest', 'split_share', 'CAD',
      0.10::numeric, 9.33::numeric, true, false, 22,
      'Class A monthly target $0.10; peer to LCS',
      'Multiple Class A gaps/skips in 2020–2024 public history (not a clean 24/36 streak)'::text
    ),
    (
      'ENS', 'ENS.TO', 'E Split Corp.', 'Middlefield', 'split_share', 'CAD',
      0.14, 19.16, true, false, 36,
      'Class A monthly (raised to $0.14 in 2026). Single-name Enbridge concentration.',
      NULL
    ),
    (
      'PDV', 'PDV.TO', 'Prime Dividend Corp.', 'Quadravest', 'split_share', 'CAD',
      NULL, 15.90, true, true, 0,
      'Class A monthly but amount = 10% annualized of prior-month VWAP (price-tied).',
      'Variable distributions (tied to share price VWAP formula)'
    ),

    -- US monthly CEFs (NYSE) — typically tradable on Wealthsimple Trade as US stocks
    (
      'DNP', 'DNP', 'DNP Select Income Fund', 'Duff & Phelps / Virtus', 'cef', 'USD',
      0.065, 11.03, true, false, 36,
      'Managed monthly $0.065 for decades (utilities). Closest US peer to fixed monthly income. May include ROC.',
      NULL
    ),
    (
      'UTG', 'UTG', 'Reaves Utility Income Fund', 'Reaves', 'cef', 'USD',
      0.21, 40.75, true, false, 36,
      'Monthly managed distribution (utilities). Long no-cut reputation. May include ROC.',
      NULL
    ),
    (
      'UTF', 'UTF', 'Cohen & Steers Infrastructure Fund', 'Cohen & Steers', 'cef', 'USD',
      0.165, 27.71, true, false, 36,
      'Monthly managed distribution (infrastructure). May include ROC / capital gains.',
      NULL
    ),
    (
      'RNP', 'RNP', 'Cohen & Steers REIT and Preferred Income Fund', 'Cohen & Steers', 'cef', 'USD',
      0.136, 20.57, true, false, 36,
      'Monthly managed distribution (REIT + preferred). May include ROC.',
      NULL
    )
) AS v(
  ticker, yahoo_symbol, name, provider, fund_type, currency,
  expected_monthly_dividend, last_price, pays_monthly, variable_distribution,
  stable_months, notes, disqualified_reason
)
WHERE lower(trim(b.name)) = lower('Christian Fournier')
ON CONFLICT (business_id, ticker) DO UPDATE SET
  yahoo_symbol = EXCLUDED.yahoo_symbol,
  name = EXCLUDED.name,
  provider = EXCLUDED.provider,
  fund_type = EXCLUDED.fund_type,
  currency = EXCLUDED.currency,
  expected_monthly_dividend = COALESCE(EXCLUDED.expected_monthly_dividend, public.div_instruments.expected_monthly_dividend),
  last_price = COALESCE(EXCLUDED.last_price, public.div_instruments.last_price),
  pays_monthly = EXCLUDED.pays_monthly,
  variable_distribution = EXCLUDED.variable_distribution,
  stable_months = EXCLUDED.stable_months,
  notes = EXCLUDED.notes,
  disqualified_reason = EXCLUDED.disqualified_reason,
  updated_at = now();
