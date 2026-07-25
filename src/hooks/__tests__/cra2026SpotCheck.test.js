/**
 * CRA 2026 spot checks: published constants in repo + CPP/EI formula parity
 * (same rules as useCanadianTaxCalculations for employee premiums).
 * Reference: CRA Payroll Deductions Formulas (T4127), 122nd edition, effective 2026-01-01.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Published 2026 employee EI / CPP figures used in T4127 Table 8.3–8.7 (must match hook). */
const CRA_2026 = {
  ei: { rate: 0.0163, max_insurable: 68900, max_annual_premium: 1123.07 },
  cpp: {
    basic_exemption: 3500,
    total_rate: 0.0595,
    ympe: 74600,
    yampe: 85000,
    cpp2_rate: 0.04,
    max_cpp1_employee: 4230.45,
    max_cpp2_employee: 416.0,
  },
};

function eiPremiumForPeriod(insurable, yearToDateEI = 0) {
  const raw = insurable * CRA_2026.ei.rate;
  const premiumForPeriod = Math.round(raw * 100) / 100;
  const remainingMax = Math.max(0, CRA_2026.ei.max_annual_premium - yearToDateEI);
  return Math.min(premiumForPeriod, remainingMax);
}

function cppContributionsForPeriod(pensionable, yearToDateCPP = 0, payPeriods = 52, ytdPensionable = 0, yearToDateCPP2 = 0) {
  const cpp = CRA_2026.cpp;
  const basicExemptionPeriod = cpp.basic_exemption / payPeriods;
  const pensionableForPeriod = Math.max(0, pensionable - basicExemptionPeriod);
  const periodContribution = pensionableForPeriod * cpp.total_rate;
  const remainingBaseMax = Math.max(0, cpp.max_cpp1_employee - yearToDateCPP);
  const baseContribution = Math.min(periodContribution, remainingBaseMax);

  const ympe = cpp.ympe;
  const yampe = cpp.yampe;
  const cpp2Rate = cpp.cpp2_rate;
  const maxCPP2 = cpp.max_cpp2_employee;

  const cumulativePensionable = ytdPensionable + pensionable;
  const cpp2Cap = Math.min(cumulativePensionable, yampe);
  const cumulativeCPP2Pensionable = Math.max(0, cpp2Cap - ympe);
  const previousCPP2Pensionable = Math.max(0, Math.min(ytdPensionable, yampe) - ympe);
  const cpp2PensionableForPeriod = Math.max(0, cumulativeCPP2Pensionable - previousCPP2Pensionable);
  const periodCPP2 = cpp2PensionableForPeriod * cpp2Rate;
  const remainingCPP2Max = Math.max(0, maxCPP2 - yearToDateCPP2);
  const cpp2Contribution = Math.round(Math.min(periodCPP2, remainingCPP2Max) * 100) / 100;

  return {
    base_contribution: baseContribution,
    cpp2_contribution: cpp2Contribution,
    total_contribution: baseContribution + cpp2Contribution,
  };
}

describe('CRA 2026 constants in useCanadianTaxCalculations.js', () => {
  const hookPath = join(__dirname, '..', 'useCanadianTaxCalculations.js');
  const hookSrc = readFileSync(hookPath, 'utf8');

  test('2026 EI employee rate and annual max premium appear in CRA_2026_RATES block', () => {
    expect(hookSrc).toContain('const CRA_2026_RATES');
    expect(hookSrc).toMatch(/rate:\s*0\.0163,\s*\/\/\s*Employee EI rate for 2026/);
    expect(hookSrc).toMatch(/max_annual_premium:\s*1123\.07/);
    expect(hookSrc).toMatch(/max_insurable_earnings:\s*68900/);
  });

  test('2026 CPP YMPE, YAMPE, employee max CPP1 and CPP2', () => {
    expect(hookSrc).toMatch(/max_pensionable_earnings:\s*74600/);
    expect(hookSrc).toMatch(/yampe:\s*85000/);
    expect(hookSrc).toMatch(/max_total_contribution:\s*4230\.45/);
    expect(hookSrc).toMatch(/max_cpp2_contribution:\s*416\.00/);
  });
});

describe('CRA 2026 EI formula parity', () => {
  test('weekly $1,000 insurable, YTD 0', () => {
    expect(eiPremiumForPeriod(1000, 0)).toBe(16.3);
  });

  test('respects annual maximum', () => {
    const almost = CRA_2026.ei.max_annual_premium - 0.5;
    expect(eiPremiumForPeriod(1000, almost)).toBeCloseTo(0.5, 2);
    expect(eiPremiumForPeriod(1000, CRA_2026.ei.max_annual_premium)).toBe(0);
  });
});

describe('CRA 2026 CPP + CPP2 formula parity', () => {
  test('weekly $1,200 pensionable, YTD 0 (CPP1 only)', () => {
    const r = cppContributionsForPeriod(1200, 0, 52, 0, 0);
    const basicEx = CRA_2026.cpp.basic_exemption / 52;
    const expectedBase = (1200 - basicEx) * CRA_2026.cpp.total_rate;
    expect(r.base_contribution).toBeCloseTo(expectedBase, 10);
    expect(r.cpp2_contribution).toBe(0);
    expect(r.total_contribution).toBe(r.base_contribution);
  });

  test('CPP2 kicks in when YTD pensionable crosses YMPE mid-period', () => {
    const ytdPensionable = 74000;
    const pensionable = 2000;
    const r = cppContributionsForPeriod(pensionable, 4000, 52, ytdPensionable, 0);
    // $1,400 above YMPE in this slice at 4% => $56
    expect(r.cpp2_contribution).toBe(56);
    expect(r.total_contribution).toBeCloseTo(r.base_contribution + 56, 10);
  });
});
