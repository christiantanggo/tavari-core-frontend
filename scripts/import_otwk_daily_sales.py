#!/usr/bin/env python3
"""Import OTWK Daily Sales.xlsx -> manual cash, labor, and historical channel sales."""

from __future__ import annotations

import json
import math
import sys
import urllib.error
import urllib.request
from datetime import date, datetime
from pathlib import Path

import openpyxl

BUSINESS_ID = "cb982fca-cf7a-4f59-b9c7-55ca0364eddc"
EXCEL_PATH = Path(
    r"C:\Users\chris\OneDrive\Desktop\One Drive\OneDrive\! OTWK\Daily Sales.xlsx"
)
SHEET_NAME = "OTWK - Sales All Time"
BATCH_SIZE = 100
NOTES = "Imported from Daily Sales.xlsx (OTWK - Sales All Time)"


def load_env() -> dict[str, str]:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    env: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


def parse_date(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def to_number(value) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, str) and value.strip().startswith("#"):
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(num):
        return None
    return round(num, 2)


def read_excel_rows() -> tuple[list[dict], list[dict], list[dict]]:
    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True, read_only=True)
    ws = wb[SHEET_NAME]

    cash_rows: list[dict] = []
    labor_rows: list[dict] = []
    channel_rows: list[dict] = []

    for row in ws.iter_rows(min_row=28, values_only=True):
        if not row or len(row) < 2:
            continue
        sales_date = parse_date(row[1])
        if sales_date is None:
            continue

        date_key = sales_date.isoformat()
        clover = to_number(row[2] if len(row) > 2 else None)
        authorize = to_number(row[3] if len(row) > 3 else None)
        additional_cash = to_number(row[4] if len(row) > 4 else None)
        labor = to_number(row[6] if len(row) > 6 else None)

        if clover is not None or authorize is not None:
            channel_rows.append(
                {
                    "business_id": BUSINESS_ID,
                    "sales_date": date_key,
                    "clover": clover,
                    "authorize_net": authorize,
                    "notes": NOTES,
                }
            )

        if additional_cash is not None:
            cash_rows.append(
                {
                    "business_id": BUSINESS_ID,
                    "sales_date": date_key,
                    "cash_collected": additional_cash,
                    "notes": NOTES,
                }
            )

        if labor is not None:
            labor_rows.append(
                {
                    "business_id": BUSINESS_ID,
                    "sales_date": date_key,
                    "labor_dollars": labor,
                    "notes": NOTES,
                }
            )

    wb.close()
    return cash_rows, labor_rows, channel_rows


def postgrest_upsert(base_url: str, service_key: str, table: str, rows: list[dict]) -> None:
    if not rows:
        return

    url = f"{base_url.rstrip('/')}/rest/v1/{table}?on_conflict=business_id,sales_date"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        req = urllib.request.Request(
            url,
            data=json.dumps(batch).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                if resp.status not in (200, 201, 204):
                    raise RuntimeError(f"Unexpected status {resp.status} for {table}")
        except urllib.error.HTTPError as err:
            body = err.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"{table} upsert failed ({err.code}): {body}") from err

        print(f"  {table}: {min(i + len(batch), len(rows))}/{len(rows)}")


def main() -> int:
    if not EXCEL_PATH.exists():
        print(f"Excel file not found: {EXCEL_PATH}", file=sys.stderr)
        return 1

    env = load_env()
    base_url = env.get("VITE_SUPABASE_URL") or env.get("SUPABASE_URL")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base_url or not service_key:
        print("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env", file=sys.stderr)
        return 1

    print(f"Reading {EXCEL_PATH} [{SHEET_NAME}]...")
    cash_rows, labor_rows, channel_rows = read_excel_rows()
    print(
        f"Parsed {len(channel_rows)} channel row(s), {len(cash_rows)} cash row(s), "
        f"{len(labor_rows)} labor row(s)"
    )

    if channel_rows:
        print("Upserting daily_sales_excel_channels...")
        postgrest_upsert(base_url, service_key, "daily_sales_excel_channels", channel_rows)

    if cash_rows:
        print("Upserting daily_sales_manual_cash...")
        postgrest_upsert(base_url, service_key, "daily_sales_manual_cash", cash_rows)

    if labor_rows:
        print("Upserting daily_sales_manual_labor...")
        postgrest_upsert(base_url, service_key, "daily_sales_manual_labor", labor_rows)

    print("Import complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
