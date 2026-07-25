# T4 breakdown – exact code path (what it’s doing)

## 1. Load payroll history (`loadEmployeePayrollHistory`)

- **Real entries:** `hrpayroll_entries` where `user_id` = employee, `payroll_run_id` in run IDs (runs from last 15 months). No migration.
- **Migration entries:** `hrpayroll_entries` where `user_id`, `business_id`, `is_migration_entry` = true, `payroll_run_id` null.
- **allRegularEntries** = real entries + migration entries.

**If `ytdData` exists and `allEntries.length < 53`:**

- **periodsNeeded** = `53 - allEntries.length`
- **createSyntheticPayPeriods(ytdData, periodsNeeded, allEntries, employeeId)** is called.

Inside **createSyntheticPayPeriods** (lines 375–448):

- **Averaging (the only math):**
  - `avgFederalTaxPerPeriod = parseFloat(ytdData.federal_tax || 0) / periodsNeeded` (line 401)
  - `avgProvincialTaxPerPeriod = parseFloat(ytdData.provincial_tax || 0) / periodsNeeded` (line 402)
  - Same for gross_pay, cpp, ei, etc.
- For each of `periodsNeeded` synthetic periods it creates a fake entry with:
  - **federal_tax: avgFederalTaxPerPeriod.toFixed(2)** (line 425)
  - So every synthetic row gets **YTD federal total ÷ number of synthetic periods**, not a real run amount.

- Synthetic entries are dated **backwards** from the oldest real entry’s pay date (lines 407–413).
- **allEntries** is then set to **[...syntheticEntries, ...allEntries]** (line 325), then sorted by pay_date desc. So newest = real, oldest = synthetic.

Result: **payrollHistory** = real entries + synthetic entries (synthetic have small, averaged federal_tax).

---

## 2. Build periodEntries for T4 (`calculateComprehensiveData`)

- **periodEntries** = `payrollHistory.filter(entry => period in report date range)` (lines 505–511).
- There is **no** `!entry.is_synthetic` check. So periodEntries for T4 **includes synthetic entries** that fall in the date range.

---

## 3. Build groups and breakdown

- Each entry is grouped by **periodKey**: real → `run_${payroll_run_id}`, synthetic → `end_${periodEnd}` (no run_id).
- Dedupe by period end: prefer run over migration, never prefer synthetic over run. So a synthetic row only appears when **no real run** exists for that period end.
- **payPeriodBreakdown** = up to 53 groups, each group’s row gets:
  - **federalTax** = sum of **entry.federal_tax** over the group’s entries (line 758).

So:

- **Real group:** one real entry → **federal_tax** = that row’s **raw** `hrpayroll_entries.federal_tax`. Correct.
- **Synthetic group:** one synthetic entry → **federal_tax** = **ytdData.federal_tax / periodsNeeded** (the averaged value). Wrong for a “per run” report.

---

## 4. Why only January is correct

- You have few real runs (e.g. one in January, rest of year is synthetic or missing).
- The **January** row is the only one that comes from a **real** run → it shows the real **federal_tax** from `hrpayroll_entries`. Correct.
- Every other row in the table that falls in the report range but has **no** real run is filled by a **synthetic** entry → it shows the **averaged** number (YTD ÷ periodsNeeded). So the number is **smaller** and wrong.

---

## 5. Fix (synthetic)

For the **T4** report, the breakdown must **not** use synthetic entries. When building **periodEntries** for T4, filter out synthetics so only real (and optionally migration) entries are used.

---

## 6. Root cause: draft vs finalized runs

**Pay Statements** load runs with **`.eq('status', 'finalized')`** (PayStatementsTab.jsx). So they only ever show entries from **finalized** runs — the correct federal_tax.

**T4** was loading runs with **no status filter** — so it included **draft** (and any other) runs. Entries from draft runs can have placeholder or stale federal_tax (e.g. $12.82). So the T4 was mixing:
- Rows from **finalized** runs → correct federal_tax (matches pay statement).
- Rows from **draft** runs → wrong federal_tax.

**Fix:** When loading payroll runs for the T4 data, use **`.eq('status', 'finalized')`** so the T4 uses the **same runs (and same entries)** as the pay statement. Then every breakdown row comes from a finalized run and federal_tax matches the pay statement.
