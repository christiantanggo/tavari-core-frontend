export type CloverEmployeeRecord = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  isOwner: boolean;
  deletedTime: number | null;
};

function apiBaseUrl(sandbox: boolean): string {
  return sandbox ? "https://apisandbox.dev.clover.com" : "https://api.clover.com";
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

export function mapCloverRoleToTavari(role: string, isOwner: boolean): string {
  if (isOwner || String(role || "").toUpperCase() === "OWNER") return "owner";
  const normalized = String(role || "").toUpperCase();
  if (normalized === "ADMIN") return "admin";
  if (normalized === "MANAGER") return "manager";
  return "employee";
}

export function isPrivilegedCloverRole(role: string, isOwner: boolean): boolean {
  const mapped = mapCloverRoleToTavari(role, isOwner);
  return mapped === "owner" || mapped === "admin" || mapped === "manager";
}

function parseEmployee(raw: Record<string, unknown>): CloverEmployeeRecord | null {
  const id = asString(raw.id);
  if (!id) return null;

  const deletedTime = typeof raw.deletedTime === "number" ? raw.deletedTime : null;
  if (deletedTime != null && deletedTime > 0) return null;

  return {
    id,
    name: asString(raw.name) || "Clover Employee",
    email: asString(raw.email),
    role: asString(raw.role) || "EMPLOYEE",
    isOwner: raw.isOwner === true,
    deletedTime,
  };
}

export async function fetchCloverEmployees(params: {
  merchantId: string;
  accessToken: string;
  sandbox: boolean;
}): Promise<CloverEmployeeRecord[]> {
  const base = apiBaseUrl(params.sandbox);
  const employees: CloverEmployeeRecord[] = [];
  let offset = 0;
  const limit = 100;

  for (let page = 0; page < 20; page += 1) {
    const url =
      `${base}/v3/merchants/${encodeURIComponent(params.merchantId)}/employees?limit=${limit}&offset=${offset}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${params.accessToken}`,
      },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Clover employees request failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    }

    const payload = await response.json();
    const elements = Array.isArray(payload?.elements) ? payload.elements : [];
    if (elements.length === 0) break;

    for (const element of elements) {
      if (!element || typeof element !== "object") continue;
      const parsed = parseEmployee(element as Record<string, unknown>);
      if (parsed) employees.push(parsed);
    }

    if (elements.length < limit) break;
    offset += limit;
  }

  return employees;
}

export async function pushCloverEmployeePin(params: {
  merchantId: string;
  employeeId: string;
  accessToken: string;
  sandbox: boolean;
  pin: string;
}): Promise<void> {
  const pin = String(params.pin || "").trim();
  if (!/^\d{4}$/.test(pin)) {
    throw new Error("PIN must be exactly 4 digits.");
  }

  const base = apiBaseUrl(params.sandbox);
  const url =
    `${base}/v3/merchants/${encodeURIComponent(params.merchantId)}/employees/${encodeURIComponent(params.employeeId)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify({ unhashedPin: pin }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Clover PIN update failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }
}

export function placeholderEmailForCloverEmployee(merchantId: string, employeeId: string): string {
  const merchantPart = merchantId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
  const employeePart = employeeId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
  return `clover-${merchantPart}-${employeePart}@staff.clover-waivers.tavarios.ca`;
}
