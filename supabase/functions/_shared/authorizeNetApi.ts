import type { AuthorizeNetCredentials } from "./authorizeNetBusinessCredentials.ts";

const PRODUCTION_API = "https://api.authorize.net/xml/v1/request.api";
const SANDBOX_API = "https://apitest.authorize.net/xml/v1/request.api";

export type AuthorizeNetTransactionDetails = {
  transId: string;
  transactionType?: string | null;
  transactionStatus?: string | null;
  settleAmount?: number | null;
  authAmount?: number | null;
  authCode?: string | null;
  responseCode?: number | null;
  invoiceNumber?: string | null;
  description?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  cardLastFour?: string | null;
  cardType?: string | null;
  submitTimeUTC?: string | null;
  submitTimeLocal?: string | null;
  raw: Record<string, unknown>;
};

export type AuthorizeNetTransactionSummary = {
  transId: string;
  submitTimeUTC?: string | null;
  submitTimeLocal?: string | null;
  transactionStatus?: string | null;
  settleAmount?: number | null;
  accountType?: string | null;
};

function apiBaseUrl(sandbox: boolean): string {
  return sandbox ? SANDBOX_API : PRODUCTION_API;
}

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function merchantAuth(creds: AuthorizeNetCredentials) {
  return {
    name: creds.apiLoginId,
    transactionKey: creds.transactionKey,
  };
}

function isOkResponse(json: Record<string, unknown>): boolean {
  const messages = json?.messages as Record<string, unknown> | undefined;
  const resultCode = asString(messages?.resultCode);
  return !resultCode || resultCode.toLowerCase() === "ok";
}

async function anetJsonRequest(
  creds: AuthorizeNetCredentials,
  requestRootKey: string,
  innerRequest: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const payload = {
    [requestRootKey]: {
      merchantAuthentication: merchantAuth(creds),
      ...innerRequest,
    },
  };

  const response = await fetch(apiBaseUrl(creds.sandbox), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.error(`[authorize.net api] ${requestRootKey} HTTP`, response.status, await response.text());
    return null;
  }

  const json = (await response.json()) as Record<string, unknown>;
  if (!isOkResponse(json)) {
    console.error(`[authorize.net api] ${requestRootKey} failed:`, JSON.stringify(json?.messages));
    return null;
  }

  return json;
}

function mapSummary(raw: Record<string, unknown>): AuthorizeNetTransactionSummary | null {
  const transId = asString(raw.transId ?? raw.trans_id);
  if (!transId) return null;
  return {
    transId,
    submitTimeUTC: asString(raw.submitTimeUTC ?? raw.submitTimeUtc),
    submitTimeLocal: asString(raw.submitTimeLocal),
    transactionStatus: asString(raw.transactionStatus),
    settleAmount: asNumber(raw.settleAmount),
    accountType: asString(raw.accountType),
  };
}

function extractTransactionSummaries(json: Record<string, unknown>): AuthorizeNetTransactionSummary[] {
  const direct = json?.transactions;
  if (Array.isArray(direct)) {
    return direct
      .map((row) => (typeof row === "object" && row !== null ? mapSummary(row as Record<string, unknown>) : null))
      .filter((row): row is AuthorizeNetTransactionSummary => !!row);
  }

  const nested = (json?.transactionList as Record<string, unknown> | undefined)?.transaction;
  if (Array.isArray(nested)) {
    return nested
      .map((row) => (typeof row === "object" && row !== null ? mapSummary(row as Record<string, unknown>) : null))
      .filter((row): row is AuthorizeNetTransactionSummary => !!row);
  }

  if (nested && typeof nested === "object") {
    const one = mapSummary(nested as Record<string, unknown>);
    return one ? [one] : [];
  }

  return [];
}

export async function fetchUnsettledTransactionSummaries(
  creds: AuthorizeNetCredentials,
): Promise<AuthorizeNetTransactionSummary[]> {
  const all: AuthorizeNetTransactionSummary[] = [];
  const pageSize = 100;
  let offset = 1;

  for (;;) {
    const json = await anetJsonRequest(creds, "getUnsettledTransactionListRequest", {
      status: "any",
      sorting: { orderBy: "submitTimeUTC", orderDescending: true },
      paging: { limit: String(pageSize), offset: String(offset) },
    });
    if (!json) break;

    const responseKey = Object.keys(json).find((k) =>
      k.toLowerCase().includes("getunsettledtransactionlistresponse")
    );
    const responseBody = (responseKey ? json[responseKey] : json) as Record<string, unknown>;
    const page = extractTransactionSummaries(responseBody);
    if (page.length === 0) break;

    all.push(...page);
    if (page.length < pageSize || all.length >= 1000) break;
    offset += pageSize;
  }

  return all;
}

export async function fetchSettledBatchIdsForDate(
  creds: AuthorizeNetCredentials,
  syncDate: string,
): Promise<string[]> {
  const json = await anetJsonRequest(creds, "getSettledBatchListRequest", {
    firstSettlementDate: `${syncDate}T00:00:00`,
    lastSettlementDate: `${syncDate}T23:59:59`,
  });
  if (!json) return [];

  const responseKey = Object.keys(json).find((k) => k.toLowerCase().includes("getsettledbatchlistresponse"));
  const responseBody = (responseKey ? json[responseKey] : json) as Record<string, unknown>;
  const batchList = responseBody?.batchList as Record<string, unknown> | unknown[] | undefined;
  const batches = Array.isArray(batchList)
    ? batchList
    : (batchList as Record<string, unknown> | undefined)?.batch;
  const list = Array.isArray(batches) ? batches : batches ? [batches] : [];

  return list
    .map((b) => (typeof b === "object" && b !== null ? asString((b as Record<string, unknown>).batchId) : null))
    .filter((id): id is string => !!id);
}

export async function fetchBatchTransactionSummaries(
  creds: AuthorizeNetCredentials,
  batchId: string,
): Promise<AuthorizeNetTransactionSummary[]> {
  const all: AuthorizeNetTransactionSummary[] = [];
  const pageSize = 100;
  let offset = 1;

  for (;;) {
    const json = await anetJsonRequest(creds, "getTransactionListRequest", {
      batchId,
      sorting: { orderBy: "submitTimeUTC", orderDescending: true },
      paging: { limit: String(pageSize), offset: String(offset) },
    });
    if (!json) break;

    const responseKey = Object.keys(json).find((k) => k.toLowerCase().includes("gettransactionlistresponse"));
    const responseBody = (responseKey ? json[responseKey] : json) as Record<string, unknown>;
    const page = extractTransactionSummaries(responseBody);
    if (page.length === 0) break;

    all.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}

function pickTransactionNode(json: Record<string, unknown>): Record<string, unknown> | null {
  const details = json?.transaction as Record<string, unknown> | undefined;
  if (details && typeof details === "object") return details;
  const tx = json?.trans as Record<string, unknown> | undefined;
  if (tx && typeof tx === "object") return tx;
  return null;
}

export async function fetchAuthorizeNetTransactionDetails(
  creds: AuthorizeNetCredentials,
  transId: string,
): Promise<AuthorizeNetTransactionDetails | null> {
  const tid = String(transId || "").trim();
  if (!tid) return null;

  const json = await anetJsonRequest(creds, "getTransactionDetailsRequest", { transId: tid });
  if (!json) return null;

  const responseKey = Object.keys(json).find((k) => k.toLowerCase().includes("gettransactiondetailsresponse"));
  const responseBody = (responseKey ? json[responseKey] : json) as Record<string, unknown>;
  const tx = pickTransactionNode(responseBody);
  if (!tx) return null;

  const payment = tx.payment as Record<string, unknown> | undefined;
  const creditCard = payment?.creditCard as Record<string, unknown> | undefined;
  const customer = tx.customer as Record<string, unknown> | undefined;
  const billTo = tx.billTo as Record<string, unknown> | undefined;
  const order = tx.order as Record<string, unknown> | undefined;

  const firstName = asString(billTo?.firstName);
  const lastName = asString(billTo?.lastName);
  const customerName = [firstName, lastName].filter(Boolean).join(" ").trim() || null;

  return {
    transId: asString(tx.transId) || tid,
    transactionType: asString(tx.transactionType),
    transactionStatus: asString(tx.transactionStatus),
    settleAmount: asNumber(tx.settleAmount),
    authAmount: asNumber(tx.authAmount),
    authCode: asString(tx.authCode),
    responseCode: asNumber(tx.responseCode),
    invoiceNumber: asString(order?.invoiceNumber),
    description: asString(order?.description),
    customerEmail: asString(customer?.email),
    customerName,
    cardLastFour: asString(creditCard?.cardNumber)?.slice(-4) || null,
    cardType: asString(creditCard?.cardType),
    submitTimeUTC: asString(tx.submitTimeUTC),
    submitTimeLocal: asString(tx.submitTimeLocal),
    raw: json,
  };
}

/** True when submit time falls on syncDate (YYYY-MM-DD), using local then UTC timestamp. */
export function isTransactionOnSyncDate(
  summary: Pick<AuthorizeNetTransactionSummary, "submitTimeLocal" | "submitTimeUTC">,
  syncDate: string,
): boolean {
  const local = asString(summary.submitTimeLocal);
  if (local && local.startsWith(syncDate)) return true;
  const utc = asString(summary.submitTimeUTC);
  if (utc && utc.startsWith(syncDate)) return true;
  return false;
}

export function isDetailsOnSyncDate(
  details: Pick<AuthorizeNetTransactionDetails, "submitTimeLocal" | "submitTimeUTC">,
  syncDate: string,
): boolean {
  return isTransactionOnSyncDate(details, syncDate);
}

export function defaultSyncDateInTimeZone(timeZone = "America/Toronto"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return y && m && d ? `${y}-${m}-${d}` : new Date().toISOString().slice(0, 10);
}

export function transactionKindFromType(transactionType: string | null | undefined): string {
  const t = String(transactionType || "").toLowerCase();
  if (t.includes("refund")) return "refund";
  if (t.includes("void")) return "void";
  if (t.includes("authcapture") || t.includes("capture")) return "sale";
  if (t.includes("authorization") || t.includes("authonly")) return "authorization";
  return "other";
}

export async function collectTransactionsForSyncDate(
  creds: AuthorizeNetCredentials,
  syncDate: string,
): Promise<AuthorizeNetTransactionSummary[]> {
  const byId = new Map<string, AuthorizeNetTransactionSummary>();
  const today = defaultSyncDateInTimeZone("America/Toronto");

  if (syncDate >= today) {
    const unsettled = await fetchUnsettledTransactionSummaries(creds);
    for (const row of unsettled) {
      if (isTransactionOnSyncDate(row, syncDate)) byId.set(row.transId, row);
    }
  }

  const batchIds = await fetchSettledBatchIdsForDate(creds, syncDate);
  for (const batchId of batchIds) {
    const batchRows = await fetchBatchTransactionSummaries(creds, batchId);
    for (const row of batchRows) {
      // Settlement batch date drives inclusion — matches Authorize.net settlement reports.
      byId.set(row.transId, row);
    }
  }

  return [...byId.values()];
}
