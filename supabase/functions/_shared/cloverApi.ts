import dayjs from "https://esm.sh/dayjs@1.11.10";
import timezone from "https://esm.sh/dayjs@1.11.10/plugin/timezone";
import utc from "https://esm.sh/dayjs@1.11.10/plugin/utc";
import type { CloverCredentials } from "./cloverBusinessCredentials.ts";

dayjs.extend(utc);
dayjs.extend(timezone);

const SANDBOX_API = "https://apisandbox.dev.clover.com";
const PRODUCTION_API = "https://api.clover.com";

export type CloverPaymentDetails = {
  paymentId: string;
  amount: number | null;
  result: string | null;
  status: string;
  transactionKind: string;
  orderId: string | null;
  employeeId: string | null;
  createdTime: string | null;
  modifiedTime: string | null;
  note: string | null;
  raw: Record<string, unknown>;
};

function apiBaseUrl(sandbox: boolean): string {
  return sandbox ? SANDBOX_API : PRODUCTION_API;
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function centsToDollars(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n) / 100;
}

function msToIso(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
}

export function defaultSyncDateInTimeZone(timeZone: string): string {
  return dayjs().tz(timeZone).format("YYYY-MM-DD");
}

function dayStartMs(syncDate: string, timeZone: string): number {
  return dayjs.tz(`${syncDate}T00:00:00`, timeZone).valueOf();
}

function dayEndMs(syncDate: string, timeZone: string): number {
  return dayjs.tz(`${syncDate}T23:59:59.999`, timeZone).valueOf();
}

function buildCreatedTimeRangeQuery(startMs: number, endMs: number, limit: number, offset: number): string {
  const params = new URLSearchParams();
  params.append("filter", `createdTime>=${startMs}`);
  params.append("filter", `createdTime<=${endMs}`);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return params.toString();
}

export function statusFromCloverPayment(result: string | null, amount: number | null): string {
  const r = String(result || "").toUpperCase();
  if (r === "SUCCESS") return "approved";
  if (r === "FAIL" || r === "FAILED") return "declined";
  if (r === "AUTH") return "authorized";
  if (amount != null && amount < 0) return "refunded";
  return "received";
}

export function transactionKindFromPayment(amount: number | null, result: string | null): string {
  if (amount != null && amount < 0) return "refund";
  const r = String(result || "").toUpperCase();
  if (r === "VOID") return "void";
  return "sale";
}

function mapPayment(raw: Record<string, unknown>): CloverPaymentDetails | null {
  const paymentId = asString(raw.id);
  if (!paymentId) return null;

  const amount = centsToDollars(raw.amount);
  const result = asString(raw.result);
  const createdTime = msToIso(raw.createdTime);
  const modifiedTime = msToIso(raw.modifiedTime);

  return {
    paymentId,
    amount,
    result,
    status: statusFromCloverPayment(result, amount),
    transactionKind: transactionKindFromPayment(amount, result),
    orderId: asString((raw.order as Record<string, unknown> | undefined)?.id ?? raw.order),
    employeeId: asString((raw.employee as Record<string, unknown> | undefined)?.id ?? raw.employee),
    createdTime,
    modifiedTime,
    note: asString(raw.note),
    raw,
  };
}

export function isPaymentOnSyncDate(
  details: CloverPaymentDetails,
  syncDate: string,
  timeZone: string,
): boolean {
  const ts = details.createdTime || details.modifiedTime;
  if (!ts) return false;
  return dayjs(ts).tz(timeZone).format("YYYY-MM-DD") === syncDate;
}

async function cloverGet(
  creds: CloverCredentials,
  path: string,
  query = "",
): Promise<Record<string, unknown> | null> {
  const extra = query
    ? path.includes("?")
      ? `&${query.replace(/^\?/, "")}`
      : `?${query.replace(/^\?/, "")}`
    : "";
  const url = `${apiBaseUrl(creds.sandbox)}/v3/merchants/${encodeURIComponent(creds.merchantId)}${path}${extra}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${creds.apiToken}`,
    },
  });

  if (!response.ok) {
    console.error("[clover api] GET failed:", path, response.status, await response.text());
    return null;
  }

  return (await response.json()) as Record<string, unknown>;
}

export async function fetchCloverPaymentDetails(
  creds: CloverCredentials,
  paymentId: string,
): Promise<CloverPaymentDetails | null> {
  const json = await cloverGet(
    creds,
    `/payments/${encodeURIComponent(paymentId)}`,
    "expand=tender,cardTransaction",
  );
  if (!json) return null;
  return mapPayment(json);
}

export async function collectPaymentsForSyncDate(
  creds: CloverCredentials,
  syncDate: string,
  timeZone = "America/Toronto",
): Promise<CloverPaymentDetails[]> {
  // Clover returns newest-first and caps open-ended createdTime filters to ~90 days,
  // so historical backfills must bound the window to the target calendar day.
  const startMs = dayStartMs(syncDate, timeZone);
  const endMs = dayEndMs(syncDate, timeZone);
  const out: CloverPaymentDetails[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const query = buildCreatedTimeRangeQuery(startMs, endMs, limit, offset);
    const json = await cloverGet(
      creds,
      `/payments?${query}`,
      "expand=tender,cardTransaction",
    );
    if (!json) break;

    const elements = Array.isArray(json.elements) ? json.elements : [];
    if (elements.length === 0) break;

    for (const row of elements) {
      if (typeof row !== "object" || row === null) continue;
      const mapped = mapPayment(row as Record<string, unknown>);
      if (!mapped) continue;
      if (isPaymentOnSyncDate(mapped, syncDate, timeZone)) {
        out.push(mapped);
      }
    }

    if (elements.length < limit) break;
    offset += limit;
    if (offset > 5000) break;
  }

  return out;
}

export type CloverTenderInfo = { label: string; labelKey: string };

export async function fetchCloverTenders(
  creds: CloverCredentials,
): Promise<Record<string, CloverTenderInfo>> {
  const map: Record<string, CloverTenderInfo> = {};
  let offset = 0;
  const limit = 100;

  while (true) {
    const json = await cloverGet(creds, `/tenders?limit=${limit}&offset=${offset}`);
    if (!json) break;

    const elements = Array.isArray(json.elements) ? json.elements : [];
    if (elements.length === 0) break;

    for (const row of elements) {
      if (typeof row !== "object" || row === null) continue;
      const raw = row as Record<string, unknown>;
      const id = asString(raw.id);
      if (!id) continue;
      map[id] = {
        label: asString(raw.label) || id,
        labelKey: asString(raw.labelKey) || "",
      };
    }

    if (elements.length < limit) break;
    offset += limit;
    if (offset > 500) break;
  }

  return map;
}