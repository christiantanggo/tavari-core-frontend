import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  encryptSecret,
  hintFromSecret,
  decryptSecret,
} from "../_shared/cloverBusinessCredentials.ts";
import {
  businessPatchFromCloverProfile,
  fetchCloverMerchantProfile,
} from "../_shared/cloverWaiverMerchantApi.ts";
import {
  fetchCloverEmployees,
  isPrivilegedCloverRole,
  mapCloverRoleToTavari,
  placeholderEmailForCloverEmployee,
  pushCloverEmployeePin,
} from "../_shared/cloverWaiverEmployeeApi.ts";
import bcrypt from "npm:bcryptjs@3.0.2";
import {
  buildCloverWaiverAuthorizeUrl,
  cloverWaiverOAuthRedirectUri,
  exchangeCloverWaiverOAuthCode,
  expiresAtFromUnix,
  refreshCloverWaiverOAuthToken,
} from "../_shared/cloverWaiverOAuth.ts";
import { isAccessTokenExpiringSoon } from "../_shared/cloverOAuth.ts";
import {
  fetchCloverAppBillingInfo,
  resolveSubscriptionStatusFromBilling,
} from "../_shared/cloverWaiverBillingApi.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-clover-auth",
  "Access-Control-Allow-Methods": "POST, GET, HEAD, OPTIONS",
};

const WAIVER_MODULE_KEY = "waivers";
const CLOVER_WAIVER_SUBSCRIPTION_KEY = "clover_waiver_app";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status: number) {
  return json({ error: message }, status);
}

function parseBool(value: unknown, fallback = false): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

function parseSecret(value: unknown): string {
  return value != null ? String(value).trim() : "";
}

function parseMerchantId(value: unknown): string {
  return value != null ? String(value).trim() : "";
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function placeholderEmailForMerchant(merchantId: string): string {
  return `clover-${merchantId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32)}@install.clover-waivers.tavarios.ca`;
}

async function createSessionForEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<{ access_token: string; refresh_token: string } | null> {
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    console.error("[clover-waiver-app] generateLink failed:", linkError?.message);
    return null;
  }

  const { data: verifyData, error: verifyError } = await admin.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "email",
  });

  if (verifyError || !verifyData?.session) {
    console.error("[clover-waiver-app] verifyOtp failed:", verifyError?.message);
    return null;
  }

  return {
    access_token: verifyData.session.access_token,
    refresh_token: verifyData.session.refresh_token,
  };
}

async function ensureCloverEmployeeLink(
  admin: ReturnType<typeof createClient>,
  params: {
    businessId: string;
    cloverEmployeeId: string;
    userId?: string | null;
    cloverRole?: string | null;
    employeeName?: string | null;
    employeeEmail?: string | null;
  },
) {
  await admin.from("business_clover_employee_links").upsert(
    {
      business_id: params.businessId,
      clover_employee_id: params.cloverEmployeeId,
      user_id: params.userId ?? null,
      clover_role: params.cloverRole ?? null,
      employee_name: params.employeeName ?? null,
      employee_email: params.employeeEmail ?? null,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "business_id,clover_employee_id" },
  );
}

async function ensureStaffMembership(
  admin: ReturnType<typeof createClient>,
  userId: string,
  businessId: string,
  role: string,
) {
  const { data: bu } = await admin
    .from("business_users")
    .select("user_id, role")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!bu) {
    await admin.from("business_users").insert({
      business_id: businessId,
      user_id: userId,
      role,
      employment_status: "active",
    });
  } else if (bu.role !== role && role === "owner") {
    await admin
      .from("business_users")
      .update({ role, employment_status: "active" })
      .eq("business_id", businessId)
      .eq("user_id", userId);
  }

  const { data: ur } = await admin
    .from("user_roles")
    .select("id")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!ur) {
    await admin.from("user_roles").insert({
      business_id: businessId,
      user_id: userId,
      role,
      active: true,
      custom_permissions: {},
    });
  } else {
    await admin
      .from("user_roles")
      .update({ role, active: true })
      .eq("business_id", businessId)
      .eq("user_id", userId);
  }
}

function userHasPin(pin: unknown): boolean {
  return pin != null && String(pin).trim().length > 0;
}

async function resolveCloverEmployeeIdForUser(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  userId: string,
): Promise<string | null> {
  const { data: link } = await admin
    .from("business_clover_employee_links")
    .select("clover_employee_id")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();

  if (link?.clover_employee_id) return String(link.clover_employee_id);

  const { data: cred } = await admin
    .from("business_clover_waiver_credentials")
    .select("clover_employee_id_last_launch")
    .eq("business_id", businessId)
    .maybeSingle();

  return cred?.clover_employee_id_last_launch
    ? String(cred.clover_employee_id_last_launch)
    : null;
}

async function authenticateRequired(req: Request) {
  const user = await authenticateOptional(req);
  if (!user) return { error: jsonError("Unauthorized", 401) };
  return { user };
}

async function assertBusinessMembership(
  admin: ReturnType<typeof createClient>,
  userId: string,
  businessId: string,
) {
  const { data: membership } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("business_id", businessId)
    .eq("active", true)
    .maybeSingle();

  if (!membership?.role) {
    return { error: jsonError("Forbidden for this business", 403) };
  }

  return { role: String(membership.role) };
}

async function applySubscriptionStatusToBusiness(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  subscriptionStatus: "active" | "pending",
  sandbox: boolean,
) {
  await admin
    .from("business_clover_waiver_credentials")
    .update({
      subscription_status: subscriptionStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("business_id", businessId);

  if (subscriptionStatus === "active") {
    await ensureSubscriptionRow(admin, businessId, "active", sandbox);
    await ensureWaiverModuleEnabled(admin, businessId);
  } else {
    await ensureSubscriptionRow(admin, businessId, "pending", sandbox);
  }
}

async function syncSubscriptionFromCloverBilling(
  admin: ReturnType<typeof createClient>,
  businessId: string,
): Promise<"active" | "pending" | null> {
  const loaded = await loadBusinessCredentials(admin, businessId);
  if ("error" in loaded && loaded.error) return null;

  const { cred, accessToken } = loaded;
  const sandbox = cred.sandbox === true;
  if (sandbox) {
    await applySubscriptionStatusToBusiness(admin, businessId, "active", true);
    return "active";
  }

  const billing = await fetchCloverAppBillingInfo({
    merchantId: String(cred.merchant_id),
    accessToken,
    sandbox,
  });
  const next = resolveSubscriptionStatusFromBilling(billing, sandbox);
  await applySubscriptionStatusToBusiness(admin, businessId, next, sandbox);
  return next;
}

function verifyWaiverAppWebhook(req: Request): boolean {
  const expected = (Deno.env.get("CLOVER_WAIVER_WEBHOOK_AUTH_CODE") || "").trim();
  if (!expected) return true;

  const header =
    req.headers.get("X-Clover-Auth") ||
    req.headers.get("x-clover-auth") ||
    "";

  return header.trim() === expected;
}

function webhookOk(message = "OK") {
  return new Response(message, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/plain" },
  });
}

async function handleCloverAppWebhook(
  admin: ReturnType<typeof createClient>,
  req: Request,
  body: Record<string, unknown>,
) {
  if (body.verificationCode) {
    const code = String(body.verificationCode).trim();
    console.log("[clover-waiver-app webhook] VERIFICATION CODE (paste in Clover):", code);
    try {
      await admin.from("clover_waiver_webhook_debug").upsert(
        {
          id: "latest",
          verification_code: code,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
    } catch (e) {
      console.warn("[clover-waiver-app webhook] could not persist verification code:", e);
    }
    return new Response(code, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  }

  if (!verifyWaiverAppWebhook(req)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  }

  const merchants = body.merchants;
  if (!merchants || typeof merchants !== "object") {
    return webhookOk();
  }

  for (const [merchantId, updates] of Object.entries(merchants as Record<string, unknown>)) {
    if (!Array.isArray(updates)) continue;

    for (const update of updates) {
      if (!update || typeof update !== "object") continue;
      const row = update as Record<string, unknown>;
      const objectId = String(row.objectId || "").trim();
      if (!objectId.startsWith("A:")) continue;

      const updateType = String(row.type || "UPDATE").trim().toUpperCase();
      const { data: cred } = await admin
        .from("business_clover_waiver_credentials")
        .select("business_id, sandbox")
        .eq("merchant_id", merchantId)
        .maybeSingle();

      if (!cred?.business_id) continue;

      const businessId = String(cred.business_id);
      const sandbox = cred.sandbox === true;

      if (updateType === "DELETE") {
        await applySubscriptionStatusToBusiness(admin, businessId, "pending", sandbox);
        continue;
      }

      await syncSubscriptionFromCloverBilling(admin, businessId);
    }
  }

  return webhookOk();
}

async function assertBusinessElevatedAccess(
  admin: ReturnType<typeof createClient>,
  userId: string,
  businessId: string,
) {
  const { data: membership } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("business_id", businessId)
    .eq("active", true)
    .maybeSingle();

  const role = String(membership?.role || "");
  if (!["owner", "manager", "admin"].includes(role)) {
    return { error: jsonError("Forbidden for this business", 403) };
  }

  return { role };
}

async function loadBusinessCredentials(
  admin: ReturnType<typeof createClient>,
  businessId: string,
) {
  const { data: cred, error: credErr } = await admin
    .from("business_clover_waiver_credentials")
    .select(
      "business_id, merchant_id, sandbox, oauth_access_token_encrypted, oauth_refresh_token_encrypted, access_token_expires_at",
    )
    .eq("business_id", businessId)
    .maybeSingle();

  if (credErr || !cred?.merchant_id) {
    return { error: jsonError("Clover credentials not found for this business.", 404) };
  }

  const accessToken = await resolveWaiverAccessToken(admin, cred);
  if (!accessToken) {
    return { error: jsonError("Could not resolve Clover access token. Reconnect from Clover.", 400) };
  }

  return { cred, accessToken };
}

async function ensureUsersRow(
  admin: ReturnType<typeof createClient>,
  userId: string,
  email: string,
  fullName: string,
) {
  const { data: existing } = await admin.from("users").select("id").eq("id", userId).maybeSingle();
  if (existing?.id) return;

  await admin.from("users").insert({
    id: userId,
    email,
    full_name: fullName,
    status: "active",
    roles: ["owner"],
  });
}

async function ensureOwnerMembership(
  admin: ReturnType<typeof createClient>,
  userId: string,
  businessId: string,
) {
  const { data: bu } = await admin
    .from("business_users")
    .select("user_id")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!bu) {
    await admin.from("business_users").insert({
      business_id: businessId,
      user_id: userId,
      role: "owner",
      employment_status: "active",
    });
  }

  const { data: ur } = await admin
    .from("user_roles")
    .select("id")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!ur) {
    await admin.from("user_roles").insert({
      business_id: businessId,
      user_id: userId,
      role: "owner",
      active: true,
      custom_permissions: {},
    });
  }
}

async function ensureDefaultWaiverSettings(
  admin: ReturnType<typeof createClient>,
  businessId: string,
) {
  const defaults: Record<string, unknown> = {
    default_expiry_days: 365,
    minor_age_threshold: 18,
    expiry_warning_days: 30,
    require_digital_signature: true,
    require_guardian_signature: false,
    auto_expire: false,
  };

  for (const [settingKey, settingValue] of Object.entries(defaults)) {
    const { data: existing } = await admin
      .from("waiver_settings")
      .select("id")
      .eq("business_id", businessId)
      .eq("setting_key", settingKey)
      .is("template_id", null)
      .eq("is_global", true)
      .maybeSingle();

    if (existing?.id) continue;

    await admin.from("waiver_settings").insert({
      business_id: businessId,
      setting_key: settingKey,
      setting_value: settingValue,
      is_global: true,
      template_id: null,
    });
  }
}

async function resolveWaiverAccessToken(
  admin: ReturnType<typeof createClient>,
  cred: Record<string, unknown>,
): Promise<string | null> {
  const encrypted = cred.oauth_access_token_encrypted;
  if (!encrypted || typeof encrypted !== "string") return null;

  let accessToken = (await decryptSecret(encrypted)).trim();
  if (!accessToken) return null;

  const sandbox = cred.sandbox === true;
  const expiresAt = typeof cred.access_token_expires_at === "string"
    ? cred.access_token_expires_at
    : null;

  if (!isAccessTokenExpiringSoon(expiresAt)) {
    return accessToken;
  }

  const refreshEncrypted = cred.oauth_refresh_token_encrypted;
  if (!refreshEncrypted || typeof refreshEncrypted !== "string") {
    return accessToken;
  }

  const refreshToken = (await decryptSecret(refreshEncrypted)).trim();
  if (!refreshToken) return accessToken;

  const refreshed = await refreshCloverWaiverOAuthToken({ refreshToken, sandbox });
  if (!refreshed?.access_token) return accessToken;

  accessToken = refreshed.access_token;
  await admin
    .from("business_clover_waiver_credentials")
    .update({
      oauth_access_token_encrypted: await encryptSecret(accessToken),
      oauth_refresh_token_encrypted: refreshed.refresh_token
        ? await encryptSecret(refreshed.refresh_token)
        : refreshEncrypted,
      access_token_expires_at: expiresAtFromUnix(refreshed.access_token_expiration),
      refresh_token_expires_at: expiresAtFromUnix(refreshed.refresh_token_expiration),
      api_token_hint: hintFromSecret(accessToken),
      updated_at: new Date().toISOString(),
    })
    .eq("business_id", cred.business_id);

  return accessToken;
}

async function applyCloverProfileToBusiness(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  profile: Awaited<ReturnType<typeof fetchCloverMerchantProfile>>,
) {
  if (!profile) return;

  const patch = businessPatchFromCloverProfile(profile);
  await admin
    .from("businesses")
    .update({ ...patch, platform: "clover" })
    .eq("id", businessId);
}

async function ensureWaiverModuleEnabled(
  admin: ReturnType<typeof createClient>,
  businessId: string,
) {
  const { data: existing } = await admin
    .from("business_module_usage")
    .select("business_id")
    .eq("business_id", businessId)
    .eq("module_key", WAIVER_MODULE_KEY)
    .maybeSingle();

  if (existing?.business_id) {
    await admin
      .from("business_module_usage")
      .update({ enabled: true, updated_at: new Date().toISOString() })
      .eq("business_id", businessId)
      .eq("module_key", WAIVER_MODULE_KEY);
    return;
  }

  await admin.from("business_module_usage").insert({
    business_id: businessId,
    module_key: WAIVER_MODULE_KEY,
    enabled: true,
  });
}

async function ensureSubscriptionRow(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  subscriptionStatus: string,
  sandbox: boolean,
) {
  const status = subscriptionStatus === "active" ? "active" : "pending";
  const price = sandbox ? 0 : 49;

  await admin.from("business_subscriptions").upsert(
    {
      business_id: businessId,
      subscription_type: "module",
      subscription_key: CLOVER_WAIVER_SUBSCRIPTION_KEY,
      tier_key: "starter",
      status,
      billing_cycle: "monthly",
      price,
      currency: "CAD",
      auto_renew: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "business_id,subscription_type,subscription_key" },
  );
}

async function findOrCreateAuthUser(
  admin: ReturnType<typeof createClient>,
  email: string,
  fullName: string,
): Promise<{ userId: string; created: boolean } | null> {
  const { data: existingData, error: existingError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });

  if (!existingError && existingData?.users?.length) {
    const match = existingData.users.find(
      (u) => String(u.email || "").toLowerCase() === email.toLowerCase(),
    );
    if (match?.id) return { userId: match.id, created: false };
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: fullName, source: "clover_waiver_app" },
  });

  if (createError) {
    const msg = String(createError.message || "").toLowerCase();
    if (msg.includes("already") || msg.includes("registered")) {
      const retry = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const match = retry.data?.users?.find(
        (u) => String(u.email || "").toLowerCase() === email.toLowerCase(),
      );
      if (match?.id) return { userId: match.id, created: false };
    }
    console.error("[clover-waiver-app] createUser failed:", createError.message);
    return null;
  }

  if (!created.user?.id) return null;
  return { userId: created.user.id, created: true };
}

async function handleConnectUrl(body: Record<string, unknown>) {
  const merchantId = parseMerchantId(body.merchantId ?? body.merchant_id);
  const sandbox = parseBool(body.sandbox, false);

  if (!merchantId) return jsonError("merchantId is required", 400);

  const authorizeUrl = buildCloverWaiverAuthorizeUrl({ merchantId, sandbox });
  if (!authorizeUrl) {
    return jsonError(
      "Clover waiver app credentials are not configured (CLOVER_WAIVER_APP_ID / CLOVER_WAIVER_APP_SECRET).",
      500,
    );
  }

  return json({
    ok: true,
    authorizeUrl,
    redirectUri: cloverWaiverOAuthRedirectUri(sandbox),
  });
}

async function handleExchange(
  admin: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const code = parseSecret(body.code ?? body.oauthCode);
  const merchantId = parseMerchantId(body.merchantId ?? body.merchant_id);
  const employeeId = parseSecret(body.employeeId ?? body.employee_id);
  const sandbox = parseBool(body.sandbox, false);

  if (!code) return jsonError("OAuth code is required", 400);
  if (!merchantId) return jsonError("merchantId is required", 400);

  const { tokens, errorDetail } = await exchangeCloverWaiverOAuthCode({ code, sandbox });
  if (!tokens?.access_token) {
    return jsonError(
      errorDetail
        ? `Clover OAuth token exchange failed: ${errorDetail}`
        : "Clover OAuth token exchange failed.",
      400,
    );
  }

  const profile = await fetchCloverMerchantProfile({
    merchantId,
    accessToken: tokens.access_token,
    sandbox,
  });

  let ownerEmail = profile?.email && isValidEmail(profile.email)
    ? profile.email.toLowerCase()
    : placeholderEmailForMerchant(merchantId);
  const businessName = profile?.name || `Clover Business ${merchantId.slice(0, 8)}`;

  const { data: existingCred } = await admin
    .from("business_clover_waiver_credentials")
    .select("business_id, subscription_status, owner_email")
    .eq("merchant_id", merchantId)
    .maybeSingle();

  let businessId = existingCred?.business_id as string | undefined;
  let subscriptionStatus = String(existingCred?.subscription_status || "pending");

  if (existingCred?.owner_email && isValidEmail(String(existingCred.owner_email))) {
    ownerEmail = String(existingCred.owner_email).toLowerCase();
  }

  const authUser = await findOrCreateAuthUser(admin, ownerEmail, businessName);
  if (!authUser) return jsonError("Could not provision account for this merchant.", 500);

  await ensureUsersRow(admin, authUser.userId, ownerEmail, businessName);

  if (!businessId) {
    const insertPatch = profile
      ? businessPatchFromCloverProfile(profile)
      : {
        name: businessName,
        timezone: "America/Toronto",
        business_email: ownerEmail,
      };

    const { data: business, error: bizErr } = await admin
      .from("businesses")
      .insert({
        ...insertPatch,
        platform: "clover",
        created_by: authUser.userId,
      })
      .select("id")
      .single();

    if (bizErr || !business?.id) {
      console.error("[clover-waiver-app] business insert:", bizErr?.message);
      return jsonError("Failed to create business.", 500);
    }
    businessId = business.id;
  } else if (profile) {
    await applyCloverProfileToBusiness(admin, businessId, profile);
  }

  await ensureOwnerMembership(admin, authUser.userId, businessId);
  await ensureWaiverModuleEnabled(admin, businessId);
  await ensureDefaultWaiverSettings(admin, businessId);

  if (sandbox) {
    subscriptionStatus = "active";
  } else {
    const billing = await fetchCloverAppBillingInfo({
      merchantId,
      accessToken: tokens.access_token,
      sandbox,
    });
    subscriptionStatus = resolveSubscriptionStatusFromBilling(billing, sandbox);
  }

  if (subscriptionStatus === "active") {
    await ensureSubscriptionRow(admin, businessId, "active", sandbox);
  } else {
    await ensureSubscriptionRow(admin, businessId, "pending", sandbox);
  }

  const credRow = {
    business_id: businessId,
    merchant_id: merchantId,
    sandbox,
    owner_email: ownerEmail,
    api_token_hint: hintFromSecret(tokens.access_token),
    oauth_access_token_encrypted: await encryptSecret(tokens.access_token),
    oauth_refresh_token_encrypted: tokens.refresh_token
      ? await encryptSecret(tokens.refresh_token)
      : null,
    access_token_expires_at: expiresAtFromUnix(tokens.access_token_expiration),
    refresh_token_expires_at: expiresAtFromUnix(tokens.refresh_token_expiration),
    subscription_status: subscriptionStatus,
    clover_employee_id_last_launch: employeeId || null,
    updated_at: new Date().toISOString(),
  };

  const { error: credErr } = await admin
    .from("business_clover_waiver_credentials")
    .upsert(credRow, { onConflict: "business_id" });

  if (credErr) {
    console.error("[clover-waiver-app] credentials upsert:", credErr.message);
    return jsonError(credErr.message, 500);
  }

  if (employeeId) {
    await ensureCloverEmployeeLink(admin, {
      businessId,
      cloverEmployeeId: employeeId,
      userId: authUser.userId,
      cloverRole: "OWNER",
      employeeName: businessName,
      employeeEmail: ownerEmail,
    });
  }

  const { data: userRow } = await admin
    .from("users")
    .select("pin")
    .eq("id", authUser.userId)
    .maybeSingle();

  const session = await createSessionForEmail(admin, ownerEmail);
  if (!session) return jsonError("Could not establish session.", 500);

  return json({
    ok: true,
    businessId,
    merchantId,
    subscriptionStatus,
    sandbox,
    session,
    businessName,
    ownerEmail,
    isNewBusiness: !existingCred,
    isNewUser: authUser.created,
    needsPinSetup: !userHasPin(userRow?.pin),
  });
}

async function handleStatus(
  admin: ReturnType<typeof createClient>,
  userId: string | null,
  body: Record<string, unknown>,
) {
  const merchantId = parseMerchantId(body.merchantId ?? body.merchant_id);
  const businessId = parseSecret(body.businessId ?? body.business_id);
  const syncBilling = parseBool(body.syncBilling ?? body.sync_billing, true);

  let row: Record<string, unknown> | null = null;

  if (merchantId) {
    const { data } = await admin
      .from("business_clover_waiver_credentials")
      .select("business_id, merchant_id, subscription_status, sandbox, owner_email")
      .eq("merchant_id", merchantId)
      .maybeSingle();
    row = data;
  } else if (businessId) {
    const { data } = await admin
      .from("business_clover_waiver_credentials")
      .select("business_id, merchant_id, subscription_status, sandbox, owner_email")
      .eq("business_id", businessId)
      .maybeSingle();
    row = data;
  }

  if (!row) return json({ configured: false });

  const bid = String(row.business_id);

  if (userId) {
    const access = await assertBusinessMembership(admin, userId, bid);
    if ("error" in access && access.error) return access.error;

    if (syncBilling) {
      const synced = await syncSubscriptionFromCloverBilling(admin, bid);
      if (synced) {
        row.subscription_status = synced;
      }
    }

    return json({
      configured: true,
      businessId: row.business_id,
      merchantId: row.merchant_id,
      subscriptionStatus: row.subscription_status,
      sandbox: row.sandbox === true,
      ownerEmail: row.owner_email,
    });
  }

  return json({
    configured: true,
    subscriptionStatus: row.subscription_status,
    hasActiveSubscription: row.subscription_status === "active" || row.sandbox === true,
    sandbox: row.sandbox === true,
  });
}

async function handleLinkTavariAccount(
  admin: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const merchantId = parseMerchantId(body.merchantId ?? body.merchant_id);
  const targetBusinessId = parseSecret(body.businessId ?? body.business_id);

  if (!merchantId) return jsonError("merchantId is required", 400);
  if (!targetBusinessId) return jsonError("businessId is required", 400);

  const { data: membership } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("business_id", targetBusinessId)
    .eq("active", true)
    .maybeSingle();

  if (!membership?.role || !["owner", "manager", "admin"].includes(String(membership.role))) {
    return jsonError("Forbidden for this business", 403);
  }

  const { data: cred } = await admin
    .from("business_clover_waiver_credentials")
    .select("business_id")
    .eq("merchant_id", merchantId)
    .maybeSingle();

  if (cred?.business_id && cred.business_id !== targetBusinessId) {
    return jsonError("This Clover merchant is already linked to another Tavari business.", 409);
  }

  const { data: existingTarget } = await admin
    .from("business_clover_waiver_credentials")
    .select("merchant_id")
    .eq("business_id", targetBusinessId)
    .maybeSingle();

  if (existingTarget?.merchant_id && existingTarget.merchant_id !== merchantId) {
    return jsonError("This Tavari business is already linked to a different Clover merchant.", 409);
  }

  return json({
    ok: true,
    message: "Use OAuth exchange while signed into Tavari to complete linking.",
    merchantId,
    businessId: targetBusinessId,
  });
}

async function handleSyncBusiness(
  admin: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const businessId = parseSecret(body.businessId ?? body.business_id);
  if (!businessId) return jsonError("businessId is required", 400);

  const access = await assertBusinessElevatedAccess(admin, userId, businessId);
  if ("error" in access && access.error) return access.error;

  const loaded = await loadBusinessCredentials(admin, businessId);
  if ("error" in loaded && loaded.error) return loaded.error;
  const { cred, accessToken } = loaded;

  const profile = await fetchCloverMerchantProfile({
    merchantId: String(cred.merchant_id),
    accessToken,
    sandbox: cred.sandbox === true,
  });

  if (!profile) {
    return jsonError("Could not load business profile from Clover.", 502);
  }

  await applyCloverProfileToBusiness(admin, businessId, profile);
  await ensureDefaultWaiverSettings(admin, businessId);

  return json({
    ok: true,
    businessId,
    business: businessPatchFromCloverProfile(profile),
    merchantId: profile.merchantId,
  });
}

async function handlePinStatus(
  admin: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const businessId = parseSecret(body.businessId ?? body.business_id);
  if (!businessId) return jsonError("businessId is required", 400);

  const access = await assertBusinessMembership(admin, userId, businessId);
  if ("error" in access && access.error) return access.error;

  const { data: userRow } = await admin
    .from("users")
    .select("pin")
    .eq("id", userId)
    .maybeSingle();

  const cloverEmployeeId = await resolveCloverEmployeeIdForUser(admin, businessId, userId);

  return json({
    ok: true,
    hasPin: userHasPin(userRow?.pin),
    needsPinSetup: !userHasPin(userRow?.pin),
    cloverEmployeeLinked: !!cloverEmployeeId,
    cloverEmployeeId,
  });
}

async function pinMatchesStored(inputPin: string, storedPin: unknown): Promise<boolean> {
  const candidate = String(storedPin || "");
  if (!candidate) return false;
  if (candidate.startsWith("$2a$") || candidate.startsWith("$2b$") || candidate.startsWith("$2y$")) {
    try {
      return await bcrypt.compare(inputPin, candidate);
    } catch {
      return false;
    }
  }
  return String(inputPin) === candidate;
}

async function handleSetupPin(
  admin: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const businessId = parseSecret(body.businessId ?? body.business_id);
  const pin = parseSecret(body.pin);
  const currentPin = parseSecret(body.currentPin ?? body.current_pin);
  const mode = parseSecret(body.mode).toLowerCase() || "setup";

  if (!businessId) return jsonError("businessId is required", 400);
  if (!/^\d{4}$/.test(pin)) return jsonError("PIN must be exactly 4 digits.", 400);

  const access = await assertBusinessElevatedAccess(admin, userId, businessId);
  if ("error" in access && access.error) return access.error;

  const { data: userRow, error: userErr } = await admin
    .from("users")
    .select("pin, email, full_name")
    .eq("id", userId)
    .maybeSingle();

  if (userErr || !userRow) return jsonError("User profile not found.", 404);

  const hasExistingPin = userHasPin(userRow.pin);

  if (mode === "setup" && hasExistingPin) {
    return jsonError("PIN is already configured. Use change mode instead.", 409);
  }

  if (mode === "change") {
    if (!hasExistingPin) {
      return jsonError("No PIN configured yet. Use setup mode first.", 400);
    }
    if (!currentPin) return jsonError("Current PIN is required.", 400);
    const currentOk = await pinMatchesStored(currentPin, userRow.pin);
    if (!currentOk) return jsonError("Current PIN is incorrect.", 403);
    if (currentPin === pin) return jsonError("New PIN must be different from current PIN.", 400);
  }

  if (mode === "owner_reset") {
    if (access.role !== "owner") {
      return jsonError("Only business owners can reset PIN without the current PIN.", 403);
    }
  }

  const result = await applyPinForUser(admin, userId, businessId, pin);
  if ("error" in result && result.error) return result.error;

  return json({
    ok: true,
    hasPin: true,
    needsPinSetup: false,
    cloverPinPushed: result.cloverPinPushed,
    cloverPinError: result.cloverPinError,
  });
}

async function applyPinForUser(
  admin: ReturnType<typeof createClient>,
  userId: string,
  businessId: string,
  pin: string,
) {
  const hashedPin = await bcrypt.hash(pin, 10);
  const { error: updateErr } = await admin
    .from("users")
    .update({ pin: hashedPin, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (updateErr) return { error: jsonError(updateErr.message, 500) };

  let cloverPinPushed = false;
  let cloverPinError: string | null = null;

  const cloverEmployeeId = await resolveCloverEmployeeIdForUser(admin, businessId, userId);
  if (cloverEmployeeId) {
    const loaded = await loadBusinessCredentials(admin, businessId);
    if ("cred" in loaded && loaded.cred && loaded.accessToken) {
      try {
        await pushCloverEmployeePin({
          merchantId: String(loaded.cred.merchant_id),
          employeeId: cloverEmployeeId,
          accessToken: loaded.accessToken,
          sandbox: loaded.cred.sandbox === true,
          pin,
        });
        cloverPinPushed = true;
      } catch (err) {
        cloverPinError = err instanceof Error ? err.message : String(err);
        console.warn("[clover-waiver-app] push PIN to Clover failed:", cloverPinError);
      }
    }
  }

  return { cloverPinPushed, cloverPinError };
}

async function clearPinForUser(
  admin: ReturnType<typeof createClient>,
  userId: string,
) {
  const { error: updateErr } = await admin
    .from("users")
    .update({ pin: null, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (updateErr) return { error: jsonError(updateErr.message, 500) };
  return { ok: true };
}

async function getBusinessStaffPinRows(
  admin: ReturnType<typeof createClient>,
  businessId: string,
) {
  const { data: roles, error: rolesErr } = await admin
    .from("user_roles")
    .select("user_id, role")
    .eq("business_id", businessId)
    .eq("active", true)
    .in("role", ["owner", "manager", "admin"]);

  if (rolesErr) throw new Error(rolesErr.message);

  const roleRows = roles || [];
  const userIds = [...new Set(roleRows.map((row) => String(row.user_id)).filter(Boolean))];
  if (userIds.length === 0) return [];

  const { data: users, error: usersErr } = await admin
    .from("users")
    .select("id, full_name, email, pin")
    .in("id", userIds);

  if (usersErr) throw new Error(usersErr.message);

  const { data: links } = await admin
    .from("business_clover_employee_links")
    .select("user_id, clover_employee_id, clover_role")
    .eq("business_id", businessId)
    .in("user_id", userIds);

  const linkByUser = new Map(
    (links || []).map((link) => [String(link.user_id), link]),
  );
  const roleByUser = new Map(
    roleRows.map((row) => [String(row.user_id), String(row.role)]),
  );

  return userIds.map((userId) => {
    const user = (users || []).find((row) => String(row.id) === userId);
    const link = linkByUser.get(userId);
    return {
      userId,
      fullName: user?.full_name || link?.employee_name || "Staff member",
      email: user?.email || null,
      role: roleByUser.get(userId) || "manager",
      hasPin: userHasPin(user?.pin),
      cloverEmployeeId: link?.clover_employee_id ? String(link.clover_employee_id) : null,
      cloverRole: link?.clover_role ? String(link.clover_role) : null,
    };
  }).sort((a, b) => {
    const rank = (role: string) => (role === "owner" ? 0 : role === "admin" ? 1 : 2);
    const diff = rank(a.role) - rank(b.role);
    if (diff !== 0) return diff;
    return a.fullName.localeCompare(b.fullName);
  });
}

async function assertCanManageTargetPin(
  admin: ReturnType<typeof createClient>,
  actorUserId: string,
  actorRole: string,
  businessId: string,
  targetUserId: string,
  managerPin: string,
) {
  if (actorUserId === targetUserId) {
    return jsonError("Use the form above to change your own PIN.", 400);
  }

  const { data: targetRoleRow } = await admin
    .from("user_roles")
    .select("role")
    .eq("business_id", businessId)
    .eq("user_id", targetUserId)
    .eq("active", true)
    .maybeSingle();

  const targetRole = String(targetRoleRow?.role || "");
  if (!["owner", "manager", "admin"].includes(targetRole)) {
    return jsonError("Target user is not a manager-level staff member at this business.", 404);
  }

  if (targetRole === "owner" && actorRole !== "owner") {
    return jsonError("Only owners can change another owner's PIN.", 403);
  }

  if (actorRole !== "owner") {
    if (!managerPin) {
      return jsonError("Your PIN is required to manage other staff PINs.", 400);
    }

    const { data: actorRow } = await admin
      .from("users")
      .select("pin")
      .eq("id", actorUserId)
      .maybeSingle();

    if (!userHasPin(actorRow?.pin)) {
      return jsonError("Set your own PIN before managing other staff PINs.", 400);
    }

    const ok = await pinMatchesStored(managerPin, actorRow?.pin);
    if (!ok) return jsonError("Your PIN is incorrect.", 403);
  }

  return null;
}

async function handleListStaffPins(
  admin: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const businessId = parseSecret(body.businessId ?? body.business_id);
  if (!businessId) return jsonError("businessId is required", 400);

  const access = await assertBusinessElevatedAccess(admin, userId, businessId);
  if ("error" in access && access.error) return access.error;

  try {
    const staff = await getBusinessStaffPinRows(admin, businessId);
    return json({ ok: true, businessId, staff });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(message, 500);
  }
}

async function handleSetEmployeePin(
  admin: ReturnType<typeof createClient>,
  actorUserId: string,
  body: Record<string, unknown>,
) {
  const businessId = parseSecret(body.businessId ?? body.business_id);
  const targetUserId = parseSecret(body.targetUserId ?? body.target_user_id ?? body.userId ?? body.user_id);
  const pin = parseSecret(body.pin);
  const managerPin = parseSecret(body.managerPin ?? body.manager_pin);
  const mode = parseSecret(body.mode).toLowerCase() || "set";

  if (!businessId) return jsonError("businessId is required", 400);
  if (!targetUserId) return jsonError("targetUserId is required", 400);
  if (mode !== "set" && mode !== "clear") return jsonError("mode must be set or clear", 400);

  const access = await assertBusinessElevatedAccess(admin, actorUserId, businessId);
  if ("error" in access && access.error) return access.error;

  const guard = await assertCanManageTargetPin(
    admin,
    actorUserId,
    access.role || "manager",
    businessId,
    targetUserId,
    managerPin,
  );
  if (guard) return guard;

  if (mode === "set") {
    if (!/^\d{4}$/.test(pin)) return jsonError("PIN must be exactly 4 digits.", 400);
    const result = await applyPinForUser(admin, targetUserId, businessId, pin);
    if ("error" in result && result.error) return result.error;
    return json({
      ok: true,
      userId: targetUserId,
      hasPin: true,
      cloverPinPushed: result.cloverPinPushed,
      cloverPinError: result.cloverPinError,
    });
  }

  const result = await clearPinForUser(admin, targetUserId);
  if ("error" in result && result.error) return result.error;

  return json({
    ok: true,
    userId: targetUserId,
    hasPin: false,
    note: "PIN removed in Tavari. Clover register PIN is unchanged until a new PIN is saved.",
  });
}

async function handleProvisionPin(
  admin: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const secret = parseSecret(body.activationSecret ?? body.secret);
  const expected = (Deno.env.get("CLOVER_WAIVER_ACTIVATION_SECRET") || "").trim();
  if (!expected || secret !== expected) {
    return jsonError("Forbidden", 403);
  }

  const businessId = parseSecret(body.businessId ?? body.business_id);
  const userId = parseSecret(body.userId ?? body.user_id);
  const pin = parseSecret(body.pin);

  if (!businessId) return jsonError("businessId is required", 400);
  if (!userId) return jsonError("userId is required", 400);
  if (!/^\d{4}$/.test(pin)) return jsonError("PIN must be exactly 4 digits.", 400);

  const result = await applyPinForUser(admin, userId, businessId, pin);
  if ("error" in result && result.error) return result.error;

  const cloverEmployeeId = parseSecret(body.cloverEmployeeId ?? body.clover_employee_id);
  if (cloverEmployeeId) {
    await ensureCloverEmployeeLink(admin, {
      businessId,
      cloverEmployeeId,
      userId,
      cloverRole: "OWNER",
      employeeName: parseSecret(body.employeeName ?? body.employee_name) || null,
      employeeEmail: parseSecret(body.employeeEmail ?? body.employee_email) || null,
    });
  }

  return json({
    ok: true,
    hasPin: true,
    cloverPinPushed: result.cloverPinPushed,
    cloverPinError: result.cloverPinError,
  });
}

async function handleSyncEmployees(
  admin: ReturnType<typeof createClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const businessId = parseSecret(body.businessId ?? body.business_id);
  if (!businessId) return jsonError("businessId is required", 400);

  const access = await assertBusinessElevatedAccess(admin, userId, businessId);
  if ("error" in access && access.error) return access.error;

  const loaded = await loadBusinessCredentials(admin, businessId);
  if ("error" in loaded && loaded.error) return loaded.error;
  const { cred, accessToken } = loaded;

  const merchantId = String(cred.merchant_id);
  const employees = await fetchCloverEmployees({
    merchantId,
    accessToken,
    sandbox: cred.sandbox === true,
  });

  let linked = 0;
  let createdUsers = 0;
  let updatedLinks = 0;
  let skippedNonPrivileged = 0;

  for (const employee of employees) {
    const tavariRole = mapCloverRoleToTavari(employee.role, employee.isOwner);
    const privileged = isPrivilegedCloverRole(employee.role, employee.isOwner);

    if (!privileged) {
      await ensureCloverEmployeeLink(admin, {
        businessId,
        cloverEmployeeId: employee.id,
        userId: null,
        cloverRole: employee.role,
        employeeName: employee.name,
        employeeEmail: employee.email,
      });
      linked += 1;
      skippedNonPrivileged += 1;
      continue;
    }

    const email = employee.email && isValidEmail(employee.email)
      ? employee.email.toLowerCase()
      : placeholderEmailForCloverEmployee(merchantId, employee.id);

    const authUser = await findOrCreateAuthUser(admin, email, employee.name);
    if (!authUser) {
      skippedNonPrivileged += 1;
      continue;
    }

    const { data: existingUser } = await admin
      .from("users")
      .select("id")
      .eq("id", authUser.userId)
      .maybeSingle();

    if (!existingUser?.id) {
      await admin.from("users").insert({
        id: authUser.userId,
        email,
        full_name: employee.name,
        status: "active",
        roles: [tavariRole],
      });
      createdUsers += 1;
    } else {
      await admin
        .from("users")
        .update({
          full_name: employee.name,
          email,
          updated_at: new Date().toISOString(),
        })
        .eq("id", authUser.userId);
    }

    await ensureStaffMembership(admin, authUser.userId, businessId, tavariRole);
    await ensureCloverEmployeeLink(admin, {
      businessId,
      cloverEmployeeId: employee.id,
      userId: authUser.userId,
      cloverRole: employee.role,
      employeeName: employee.name,
      employeeEmail: employee.email,
    });

    linked += 1;
    updatedLinks += 1;
  }

  return json({
    ok: true,
    businessId,
    merchantId,
    totalCloverEmployees: employees.length,
    linked,
    createdUsers,
    updatedLinks,
    skippedNonPrivileged,
    note:
      "Clover does not return employee PINs via API. Set or change PINs in Tavari Security to keep Clover register PINs in sync.",
  });
}

async function authenticateOptional(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return null;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  return user;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method === "GET" || req.method === "HEAD") return webhookOk();

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const bodyText = await req.text();
  let body: Record<string, unknown> = {};
  if (bodyText.trim()) {
    try {
      body = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      return jsonError("Invalid JSON body", 400);
    }
  }

  if (body.verificationCode || (body.merchants && !body.action)) {
    return handleCloverAppWebhook(admin, req, body);
  }

  if (req.method !== "POST") return jsonError("Method not allowed", 405);

  const action = String(body.action || "status").trim().toLowerCase();

  if (action === "connecturl" || action === "connect_url") {
    return handleConnectUrl(body);
  }

  if (action === "exchange" || action === "exchange_code") {
    return handleExchange(admin, body);
  }

  if (action === "status" || action === "get") {
    const user = await authenticateOptional(req);
    return handleStatus(admin, user?.id ?? null, body);
  }

  if (action === "syncbusiness" || action === "sync_business" || action === "sync_from_clover") {
    const auth = await authenticateRequired(req);
    if ("error" in auth && auth.error) return auth.error;
    return handleSyncBusiness(admin, auth.user!.id, body);
  }

  if (action === "pinstatus" || action === "pin_status") {
    const auth = await authenticateRequired(req);
    if ("error" in auth && auth.error) return auth.error;
    return handlePinStatus(admin, auth.user!.id, body);
  }

  if (action === "setuppin" || action === "setup_pin" || action === "set_pin") {
    const auth = await authenticateRequired(req);
    if ("error" in auth && auth.error) return auth.error;
    return handleSetupPin(admin, auth.user!.id, body);
  }

  if (action === "liststaffpins" || action === "list_staff_pins") {
    const auth = await authenticateRequired(req);
    if ("error" in auth && auth.error) return auth.error;
    return handleListStaffPins(admin, auth.user!.id, body);
  }

  if (action === "setemployeepin" || action === "set_employee_pin" || action === "staffpin") {
    const auth = await authenticateRequired(req);
    if ("error" in auth && auth.error) return auth.error;
    return handleSetEmployeePin(admin, auth.user!.id, body);
  }

  if (action === "provisionpin" || action === "provision_pin") {
    return handleProvisionPin(admin, body);
  }

  if (action === "syncemployees" || action === "sync_employees" || action === "sync_staff") {
    const auth = await authenticateRequired(req);
    if ("error" in auth && auth.error) return auth.error;
    return handleSyncEmployees(admin, auth.user!.id, body);
  }

  if (action === "link" || action === "link_account") {
    const user = await authenticateOptional(req);
    if (!user) return jsonError("Unauthorized", 401);
    return handleLinkTavariAccount(admin, user.id, body);
  }

  if (action === "activate" || action === "activate_subscription") {
    return handleActivateSubscription(admin, body);
  }

  return jsonError("Unknown action", 400);
});

async function handleActivateSubscription(
  admin: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const secret = parseSecret(body.activationSecret ?? body.secret);
  const expected = (Deno.env.get("CLOVER_WAIVER_ACTIVATION_SECRET") || "").trim();
  if (!expected || secret !== expected) {
    return jsonError("Forbidden", 403);
  }

  const businessId = parseSecret(body.businessId ?? body.business_id);
  const merchantId = parseMerchantId(body.merchantId ?? body.merchant_id);
  if (!businessId && !merchantId) {
    return jsonError("businessId or merchantId is required", 400);
  }

  let bid = businessId;
  if (!bid && merchantId) {
    const { data: cred } = await admin
      .from("business_clover_waiver_credentials")
      .select("business_id")
      .eq("merchant_id", merchantId)
      .maybeSingle();
    bid = cred?.business_id ? String(cred.business_id) : "";
  }

  if (!bid) return jsonError("Install not found", 404);

  await applySubscriptionStatusToBusiness(admin, bid, "active", false);

  return json({ ok: true, businessId: bid, subscriptionStatus: "active" });
}
