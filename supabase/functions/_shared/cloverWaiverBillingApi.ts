import { cloverWaiverOAuthEnv } from "./cloverWaiverOAuth.ts";

export type CloverAppBillingInfo = {
  status: string | null;
  isInTrial: boolean;
  appSubscriptionActive: boolean;
  raw: Record<string, unknown>;
};

function apiBaseUrl(sandbox: boolean): string {
  return sandbox ? "https://apisandbox.dev.clover.com" : "https://api.clover.com";
}

export async function fetchCloverAppBillingInfo(params: {
  merchantId: string;
  accessToken: string;
  sandbox: boolean;
}): Promise<CloverAppBillingInfo | null> {
  const env = cloverWaiverOAuthEnv(params.sandbox);
  if (!env?.appId) {
    console.warn("[clover waiver billing] app id not configured");
    return null;
  }

  const url =
    `${apiBaseUrl(params.sandbox)}/v3/apps/${encodeURIComponent(env.appId)}/merchants/${encodeURIComponent(params.merchantId)}/billing_info`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${params.accessToken}`,
    },
  });

  if (!response.ok) {
    console.error(
      "[clover waiver billing] billing_info failed:",
      response.status,
      await response.text(),
    );
    return null;
  }

  const raw = (await response.json()) as Record<string, unknown>;
  const appSubscription = raw.appSubscription as Record<string, unknown> | undefined;

  return {
    status: raw.status != null ? String(raw.status) : null,
    isInTrial: raw.isInTrial === true,
    appSubscriptionActive: appSubscription?.active === true,
    raw,
  };
}

/** Whether the merchant should have waiver app access (paid, trial, or sandbox). */
export function resolveSubscriptionStatusFromBilling(
  billing: CloverAppBillingInfo | null,
  sandbox: boolean,
): "active" | "pending" {
  if (sandbox) return "active";
  if (!billing) return "pending";

  const status = String(billing.status || "").toUpperCase();
  if (status === "ACTIVE") return "active";
  if (billing.isInTrial) return "active";
  if (
    billing.appSubscriptionActive &&
    status !== "INACTIVE" &&
    status !== "SUPPRESSED"
  ) {
    return "active";
  }

  return "pending";
}
