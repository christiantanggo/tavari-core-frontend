# T4 System – Tables and Rows Used for Federal Tax

This document describes exactly which database tables and columns the T4 report uses for **federal tax** (and additional federal tax).

---

## 1. T4 summary (Box 22 “Income tax deducted”)

Federal tax in the **T4 summary** (Box 22, etc.) comes from the **YTD calculation** (`useYTDCalculations.calculateEmployeeYTD`), not directly from the breakdown table.

### Tables and columns

| Table                | Rows used | Columns used for federal tax |
|----------------------|-----------|------------------------------|
| **hrpayroll_ytd_data** | One row per employee per tax year: `business_id`, `user_id`, `tax_year` (current year). | `federal_tax`, `additional_tax` (stored YTD totals used as base when “stored YTD” is used). |
| **hrpayroll_entries** | **Regular entries:** `user_id` = employee, `payroll_run_id` in the set of run IDs from `hrpayroll_runs`, joined to **hrpayroll_runs** with `pay_period_end` **after** `queryFromDate` and **≤** report end date. | `federal_tax`, `additional_tax` (summed for each entry in range). |
| **hrpayroll_entries** | **Migration entries:** `user_id` = employee, `business_id` = business, `is_migration_entry` = true, `payroll_run_id` is null; filtered by date (tax year or since last YTD update). | `federal_tax`, `additional_tax` (summed). |
| **hrpayroll_runs**    | Used only in the join for the regular-entries query (inner join on run; filter by `pay_period_end` and `business_id`). | No federal tax column; used only for date filtering. |

### How it’s combined

- **Base:** Either the row from `hrpayroll_ytd_data` for that `user_id` / `business_id` / `tax_year` (its `federal_tax` and `additional_tax`) or zeros if there is no stored YTD or it’s treated as incomplete.
- **Add:** For every **hrpayroll_entries** row in scope (regular + migration), `entry.federal_tax` and `entry.additional_tax` are added to the running totals.
- **Box 22** = YTD `federal_tax` + YTD `provincial_tax` + YTD `additional_tax`.

So for the T4 summary, federal tax is the sum of:

- `hrpayroll_ytd_data.federal_tax` (when used as base), plus  
- `hrpayroll_entries.federal_tax` for every entry included in the YTD calculation (regular + migration).  
Additional federal is the same but with `additional_tax`.

---

## 2. T4 pay-period breakdown table (per-period Federal / Additional columns)

The **per-period** federal and additional tax in the breakdown table are built in **EETRT-DataHook.js** from entries loaded for the selected employee.

### Tables and columns

| Table                 | Rows used | Columns used for federal tax |
|-----------------------|-----------|------------------------------|
| **hrpayroll_runs**    | Runs with `business_id` = business and `pay_date` ≥ 15 months ago; ordered by `pay_date` desc. | No federal tax; used for `pay_period_start`, `pay_period_end`, `pay_date` and to filter entries. |
| **hrpayroll_entries** | Rows where `user_id` = employee and `payroll_run_id` is in the list of run IDs from above; **excluding** `is_migration_entry` = true. | `federal_tax`, `additional_tax` (and `id`, `user_id`, `payroll_run_id` for grouping/dedup). |
| **hrpayroll_entries** | Migration rows: `user_id` = employee, `business_id` = business, `is_migration_entry` = true, `payroll_run_id` is null, `pay_date` ≥ 15 months ago. | `federal_tax`, `additional_tax` (and period dates from entry or payload). |
| **hrpayroll_ytd_data**| One row per employee for current tax year (same as above). | Used **only** to build **synthetic** periods when there are fewer than 53 real entries: `federal_tax` is spread as `federal_tax / periodsNeeded` per synthetic period. |

### How rows are selected for the breakdown

1. **Scope:** Only entries whose pay period overlaps the report date range (for T4) or last 53 periods (for ROE) are kept (`periodEntries`).
2. **Grouping:** Entries are grouped by **run** (`run_<payroll_run_id>`) or by **period end** for migration (`end_<YYYY-MM-DD>`).
3. **One group per period end:** If the same period end has both a run group and a migration/synthetic group, the **run** is kept. If two **runs** share the same period end, the run whose entries sum to the **higher** total `federal_tax` is kept (and synthetic is never preferred over a real run).
4. **One entry per employee per group:** Within each group, only one row per `user_id` is used; the row with the **smallest** `id` is kept (primary payroll row).
5. **Breakdown values:** For each kept group, the breakdown’s **Federal Tax** = sum of `federal_tax` over the kept entries; **Additional Tax** = sum of `additional_tax` over the kept entries.

So for the breakdown, federal tax for a given period is the `federal_tax` (and `additional_tax`) from the **hrpayroll_entries** rows that survive the above grouping and per-user dedupe.

---

## 3. Summary

| Use case | Federal tax source |
|----------|---------------------|
| **T4 Box 22 (summary)** | `hrpayroll_ytd_data.federal_tax` (base) + sum of `hrpayroll_entries.federal_tax` for all YTD-in-scope entries (regular + migration). Same idea for `additional_tax`. |
| **T4 breakdown (per period)** | For each period, one or more **hrpayroll_entries** rows (after run/migration/synthetic and per-user dedupe); column used is **hrpayroll_entries.federal_tax** (and **hrpayroll_entries.additional_tax**). |
| **Synthetic periods** | If fewer than 53 real periods, extra periods are filled from **hrpayroll_ytd_data**: federal per period = `federal_tax / periodsNeeded` (no direct row; derived from the one YTD row per employee/year). |

**Relevant columns:**

- **hrpayroll_entries:** `id`, `user_id`, `payroll_run_id`, `federal_tax`, `additional_tax`, `is_migration_entry`, `business_id`, `pay_date` / period dates.
- **hrpayroll_ytd_data:** `user_id`, `business_id`, `tax_year`, `federal_tax`, `additional_tax`, `last_updated`, `last_payroll_run_id`.
- **hrpayroll_runs:** `id`, `pay_date`, `pay_period_start`, `pay_period_end`, `business_id` (used for joins and filtering only).

If the T4 shows the wrong federal tax for a period, the discrepancy is between:

- Which **hrpayroll_entries** row(s) are chosen for that period in the breakdown (and for YTD), and  
- Which row the pay statement uses for that same period (same run/entry should give the same `federal_tax` / `additional_tax`).

Checking for duplicate entries (same `user_id`, same `payroll_run_id`), which run is kept when two runs share a period end, and that the correct run is in the 15‑month window will show why numbers differ.
