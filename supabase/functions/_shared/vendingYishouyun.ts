import CryptoJS from "https://esm.sh/crypto-js@4.2.0";

export type VendingCredentials = {
  mchNo: string;
  apiKey: string;
  baseUrl: string;
  terminalBaseUrl: string;
  terminalPwd: string;
};

export async function getVendingCredentials(): Promise<VendingCredentials> {
  const mchNo = Deno.env.get("VENDING_MCH_NO");
  const apiKey = Deno.env.get("VENDING_API_KEY");
  const baseUrl = Deno.env.get("VENDING_API_BASE_URL") || "https://yun.yishouyun.cn/app/api";
  const terminalBaseUrl =
    Deno.env.get("VENDING_TERMINAL_BASE_URL") || "https://yun.yishouyun.cn/api/terminal";
  const terminalPwd =
    Deno.env.get("VENDING_TERMINAL_PWD") ||
    Deno.env.get("VENDING_MCH_PWD") ||
    "";

  if (!mchNo || !apiKey) {
    throw new Error("Vending machine API credentials not configured");
  }

  return { mchNo, apiKey, baseUrl, terminalBaseUrl, terminalPwd };
}

export function generateSignature(params: Record<string, unknown>, apiKey: string): string {
  const paramsToSign: Record<string, unknown> = { ...params };
  delete paramsToSign.sign;
  delete paramsToSign.key;

  const sortedKeys = Object.keys(paramsToSign).sort();
  const string1 = sortedKeys.map((key) => `${key}=${paramsToSign[key]}`).join("&");
  const string2 = `${string1}&key=${apiKey}`;
  return CryptoJS.MD5(string2).toString().toLowerCase();
}

export async function makeVendingAPIRequest(
  endpoint: string,
  method: string,
  params: Record<string, unknown>,
  credentials: Pick<VendingCredentials, "mchNo" | "apiKey" | "baseUrl">,
  timeoutMs = 12000,
): Promise<Record<string, unknown>> {
  const url = `${credentials.baseUrl}${endpoint}`;
  const requestParams: Record<string, unknown> = {
    mch_no: credentials.mchNo,
    ...params,
  };
  requestParams.sign = generateSignature(requestParams, credentials.apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const config: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
  };

  try {
    if (method === "GET") {
      const queryParams = new URLSearchParams(
        Object.entries(requestParams).reduce((acc, [key, value]) => {
          acc[key] = String(value);
          return acc;
        }, {} as Record<string, string>),
      );
      const response = await fetch(`${url}?${queryParams}`, config);
      return await response.json();
    }

    config.body = JSON.stringify(requestParams);
    const response = await fetch(url, config);
    return await response.json();
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(`Vendor API timed out after ${timeoutMs}ms (${endpoint})`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function pickGoodsId(row: Record<string, unknown> | null | undefined): string {
  if (!row || typeof row !== "object") return "";
  const direct =
    row.goodsId ??
    row.goods_id ??
    row.goodsID ??
    row.goods_index_goodsid ??
    row.goodsid ??
    row.product_id;
  if (direct != null && String(direct).trim() !== "") return String(direct).trim();
  for (const k of Object.keys(row)) {
    if (/goodsid/i.test(k)) {
      const v = row[k];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
  }
  return "";
}

export function flattenTerminalGoodsItems(payload: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const data = payload?.data;
  if (!Array.isArray(data)) return out;
  for (const cat of data) {
    if (!cat || typeof cat !== "object") continue;
    const items = (cat as Record<string, unknown>).items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (item && typeof item === "object") out.push(item as Record<string, unknown>);
    }
  }
  return out;
}

export function matchTerminalGoodsId(
  items: Record<string, unknown>[],
  opts: { goodsSn?: string; goodsName?: string },
): string {
  const sn = String(opts.goodsSn ?? "").trim().toLowerCase();
  const name = String(opts.goodsName ?? "").trim().toLowerCase();

  if (sn) {
    for (const item of items) {
      const candidates = [
        item.goods_sn,
        item.goodsSn,
        item.bar_code,
        item.barCode,
        item.sku,
      ];
      for (const c of candidates) {
        if (c != null && String(c).trim().toLowerCase() === sn) {
          const gid = pickGoodsId(item);
          if (gid) return gid;
        }
      }
    }
  }

  if (name) {
    for (const item of items) {
      const n = String(item.goods_name ?? item.goodsName ?? "").trim().toLowerCase();
      if (n && n === name) {
        const gid = pickGoodsId(item);
        if (gid) return gid;
      }
    }
    for (const item of items) {
      const n = String(item.goods_name ?? item.goodsName ?? "").trim().toLowerCase();
      if (n && (n.includes(name) || name.includes(n))) {
        const gid = pickGoodsId(item);
        if (gid) return gid;
      }
    }
  }

  return "";
}

export async function resolveDevNo(
  deviceId: string,
  credentials: Pick<VendingCredentials, "mchNo" | "apiKey" | "baseUrl">,
): Promise<string> {
  const detail = await makeVendingAPIRequest(
    "/device_detail",
    "POST",
    { device_id: deviceId },
    credentials,
  );
  const data = (detail?.data ?? detail) as Record<string, unknown>;
  const devNo = data?.dev_no ?? data?.devNo;
  return devNo != null ? String(devNo).trim() : "";
}

export async function terminalBind(
  devNo: string,
  credentials: VendingCredentials,
): Promise<{ token: string; raw: Record<string, unknown> }> {
  const account = credentials.mchNo;
  const pwd = credentials.terminalPwd;
  if (!devNo) throw new Error("dev_no is required for terminal bind");
  if (!pwd) throw new Error("VENDING_TERMINAL_PWD (or VENDING_MCH_PWD) is not configured");

  const attempts: Record<string, unknown>[] = [
    { account, pwd, dev_no: devNo },
    { account, pwd, devNo },
    { mch_no: account, pwd, dev_no: devNo },
  ];

  let last: Record<string, unknown> = {};
  for (const body of attempts) {
    const response = await fetch(`${credentials.terminalBaseUrl}/bind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    last = await response.json();
    const token = last?.token ?? last?.data?.token;
    if (token) return { token: String(token), raw: last };
    const code = last?.code ?? last?.err;
    if (code === 0 && token) return { token: String(token), raw: last };
  }

  const msg = String(last?.msg ?? last?.message ?? "Terminal bind failed");
  throw new Error(msg);
}

export async function terminalGetGoodsData(
  token: string,
  credentials: Pick<VendingCredentials, "terminalBaseUrl">,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${credentials.terminalBaseUrl}/get_goods_data`, {
    headers: { token },
  });
  return await response.json();
}

const TERMINAL_STOCK_ENDPOINTS = [
  "get_stock_data",
  "get_cargo_data",
  "get_dev_stock",
  "get_stock_list",
];

export async function terminalGetStockData(
  token: string,
  credentials: Pick<VendingCredentials, "terminalBaseUrl">,
): Promise<{ payload: Record<string, unknown>; endpoint: string } | null> {
  for (const endpoint of TERMINAL_STOCK_ENDPOINTS) {
    try {
      const response = await fetch(`${credentials.terminalBaseUrl}/${endpoint}`, {
        headers: { token },
      });
      const payload = await response.json();
      const code = payload?.code ?? payload?.err;
      if (code === 9000) continue;
      if (code === 0 || code === "0" || payload?.data != null) {
        return { payload, endpoint };
      }
    } catch {
      /* try next endpoint */
    }
  }
  return null;
}

export function looksLikeInventorySlotRow(o: Record<string, unknown>): boolean {
  if (!o || typeof o !== "object") return false;
  if (Object.keys(o).some((k) => /goodsid/i.test(k))) return true;
  return (
    "goods_id" in o ||
    "goodsId" in o ||
    "row" in o ||
    "col" in o ||
    "num" in o ||
    "sev_no" in o ||
    "sevNo" in o
  );
}

function parseMaybeInventoryRows(value: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value == null) return null;
  if (typeof value === "string") {
    const t = value.trim();
    if (!t.startsWith("[") && !t.startsWith("{")) return null;
    try {
      const p = JSON.parse(t);
      if (Array.isArray(p)) return p;
      if (p && typeof p === "object") return Object.values(p as Record<string, unknown>);
    } catch {
      return null;
    }
  }
  if (typeof value === "object") {
    const vals = Object.values(value as Record<string, unknown>);
    if (vals.length && vals.every((x) => x != null && typeof x === "object" && !Array.isArray(x))) {
      return vals as Record<string, unknown>[];
    }
  }
  return null;
}

function findInventoryArrayByDeepScan(obj: unknown, depth = 0): Record<string, unknown>[] {
  if (!obj || typeof obj !== "object" || depth > 10) return [];
  if (Array.isArray(obj)) {
    if (obj.length && looksLikeInventorySlotRow(obj[0] as Record<string, unknown>)) {
      return obj as Record<string, unknown>[];
    }
    return [];
  }
  const skipKeys = new Set(["sign", "mch_no", "msg", "err"]);
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (skipKeys.has(key)) continue;
    const v = (obj as Record<string, unknown>)[key];
    const parsed = parseMaybeInventoryRows(v);
    if (parsed?.length && looksLikeInventorySlotRow(parsed[0])) return parsed;
    if (v && typeof v === "object") {
      const inner = findInventoryArrayByDeepScan(v, depth + 1);
      if (inner.length > 0) return inner;
    }
  }
  return [];
}

export function extractInventoryArrayFromDeviceDetail(data: Record<string, unknown>): Record<string, unknown>[] {
  if (!data || typeof data !== "object") return [];

  const keysPriority = [
    "inventory",
    "inventory_list",
    "goods_list",
    "stock_list",
    "slot_list",
    "slots",
    "device_goods",
    "device_inventory",
    "cargo_lane",
    "cargo_lanes",
    "goods",
    "list",
    "stock",
  ];

  for (const k of keysPriority) {
    const v = data[k];
    if (Array.isArray(v) && v.length > 0) return v as Record<string, unknown>[];
    const parsed = parseMaybeInventoryRows(v);
    if (parsed?.length) return parsed;
  }

  const nested = data.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const inner = extractInventoryArrayFromDeviceDetail(nested as Record<string, unknown>);
    if (inner.length) return inner;
  }

  return findInventoryArrayByDeepScan(data);
}

export function extractInventoryFromTerminalStock(payload: Record<string, unknown>): Record<string, unknown>[] {
  const data = payload?.data ?? payload;
  if (Array.isArray(data)) {
    if (data.length && looksLikeInventorySlotRow(data[0] as Record<string, unknown>)) {
      return data as Record<string, unknown>[];
    }
  }
  if (data && typeof data === "object") {
    const fromDetail = extractInventoryArrayFromDeviceDetail(data as Record<string, unknown>);
    if (fromDetail.length) return fromDetail;
  }
  return findInventoryArrayByDeepScan(payload);
}

export function normalizeSlotRow(row: Record<string, unknown>, idx: number) {
  const sevNo = String(row.sev_no ?? row.sevNo ?? row.cabinet_no ?? "1");
  const rowN = Number(row.row ?? row.row_num ?? row.layer ?? row.r ?? 0);
  const colN = Number(row.col ?? row.col_num ?? row.column ?? row.c ?? idx);
  const goodsId = pickGoodsId(row);
  return {
    key: `${sevNo}-${rowN}-${colN}`,
    sevNo,
    row: rowN,
    col: colN,
    goodsId,
    goodsName: String(row.goods_name ?? row.goodsName ?? row.name ?? ""),
    num: row.num != null ? Number(row.num) : 0,
    maxNum: row.max_num != null ? Number(row.max_num) : row.maxNum != null ? Number(row.maxNum) : 0,
    picUrl: String(row.pic_url ?? row.picUrl ?? ""),
    price: row.price != null ? Number(row.price) : undefined,
    source: "vendor" as const,
  };
}

export type NormalizedSlot = ReturnType<typeof normalizeSlotRow> & { source: "vendor" | "tavari" };

export function mergeSlotRows(
  vendorRows: ReturnType<typeof normalizeSlotRow>[],
  tavariRows: Array<{
    sev_no: string;
    row_num: number;
    col_num: number;
    manufacturer_goods_id: string;
    num: number;
    max_num: number;
    goods_name?: string;
    price?: number;
    pic_url?: string;
  }>,
): NormalizedSlot[] {
  const map = new Map<string, NormalizedSlot>();

  for (const row of tavariRows) {
    const key = `${row.sev_no}-${row.row_num}-${row.col_num}`;
    map.set(key, {
      key,
      sevNo: row.sev_no,
      row: row.row_num,
      col: row.col_num,
      goodsId: row.manufacturer_goods_id,
      goodsName: row.goods_name ?? "",
      num: row.num ?? 0,
      maxNum: row.max_num ?? 0,
      picUrl: row.pic_url ?? "",
      price: row.price,
      source: "tavari",
    });
  }

  for (const row of vendorRows) {
    const existing = map.get(row.key);
    if (existing) {
      map.set(row.key, {
        ...existing,
        goodsId: row.goodsId || existing.goodsId,
        goodsName: row.goodsName || existing.goodsName,
        num: row.num ?? existing.num,
        maxNum: row.maxNum ?? existing.maxNum,
        picUrl: row.picUrl || existing.picUrl,
        price: row.price ?? existing.price,
        source: "vendor",
      });
    } else {
      map.set(row.key, { ...row, source: "vendor" });
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const sev = a.sevNo.localeCompare(b.sevNo);
    if (sev !== 0) return sev;
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });
}

/** Aggregate slot rows into kiosk product cards (one per goods_id). */
export function aggregateProductsFromSlots(slots: NormalizedSlot[]) {
  const byGoods = new Map<string, {
    goodsId: string;
    goodsName: string;
    picUrl: string;
    price: number;
    num: number;
    maxNum: number;
    slots: NormalizedSlot[];
  }>();

  for (const slot of slots) {
    if (!slot.goodsId) continue;
    const existing = byGoods.get(slot.goodsId);
    if (!existing) {
      byGoods.set(slot.goodsId, {
        goodsId: slot.goodsId,
        goodsName: slot.goodsName || `Product ${slot.goodsId}`,
        picUrl: slot.picUrl || "",
        price: slot.price ?? 0,
        num: slot.num ?? 0,
        maxNum: slot.maxNum ?? 0,
        slots: [slot],
      });
    } else {
      existing.num += slot.num ?? 0;
      existing.maxNum += slot.maxNum ?? 0;
      if (!existing.goodsName && slot.goodsName) existing.goodsName = slot.goodsName;
      if (!existing.picUrl && slot.picUrl) existing.picUrl = slot.picUrl;
      if (!existing.price && slot.price) existing.price = slot.price;
      existing.slots.push(slot);
    }
  }

  return Array.from(byGoods.values());
}

/** Vendor payloads use booleans, 1/0, or alternate keys for online state. */
export function parseVendorOnlineFlag(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const row = data as Record<string, unknown>;
  const v = row.is_online ?? row.isOnline ?? row.online ?? row.dev_online ?? row.status;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes" || s === "online") return true;
    if (s === "0" || s === "false" || s === "no" || s === "offline" || s === "") return false;
  }
  return Boolean(v);
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
