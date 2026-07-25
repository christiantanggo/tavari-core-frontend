import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  SESClient,
  VerifyDomainIdentityCommand,
  VerifyDomainDkimCommand,
  GetIdentityDkimAttributesCommand,
  GetIdentityMailFromDomainAttributesCommand,
  GetIdentityVerificationAttributesCommand,
  SetIdentityMailFromDomainCommand
} from "@aws-sdk/client-ses";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
  AWS_REGION,
  SES_ACCESS_KEY_ID,
  SES_SECRET_ACCESS_KEY
} = Deno.env.toObject();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Supabase credentials are not configured for mail-domain-manager");
}

if (!SES_ACCESS_KEY_ID || !SES_SECRET_ACCESS_KEY) {
  throw new Error("AWS SES credentials are not configured for mail-domain-manager");
}

const region = AWS_REGION || "us-east-1";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const ses = new SESClient({
  region,
  credentials: {
    accessKeyId: SES_ACCESS_KEY_ID,
    secretAccessKey: SES_SECRET_ACCESS_KEY
  }
});

type StartPayload = {
  action: "start";
  domain: string;
  businessId: string;
};

type StatusPayload = {
  action: "status";
  domainId: string;
  domain: string;
};

type RequestPayload = StartPayload | StatusPayload;

const normalizeDomain = (domain: string) => domain.trim().toLowerCase();

const buildMailFromDomain = (domain: string) => `mail.${domain}`;

const normalizeSesStatus = (value: unknown) => {
  const status = String(value || "").trim().toLowerCase();
  if (status === "success" || status === "verified") return "verified";
  if (status === "failed") return "failed";
  return "pending";
};

const buildDnsRecords = (
  domain: string,
  identityToken?: string | null,
  dkimTokens: string[] = [],
  mailFromDomain = buildMailFromDomain(domain),
) => {
  const txtRecord = {
    type: "TXT",
    name: `_amazonses.${domain}`,
    value: identityToken
  };

  const dkimRecords = dkimTokens.map((token) => ({
    type: "CNAME",
    name: `${token}._domainkey.${domain}`,
    value: `${token}.dkim.amazonses.com`
  }));

  const mxRecord = {
    type: "MX",
    name: domain,
    value: `10 inbound-smtp.${region}.amazonaws.com`
  };

  const mailFromMxRecord = {
    type: "MX",
    name: mailFromDomain,
    value: `10 feedback-smtp.${region}.amazonses.com`
  };

  const mailFromSpfRecord = {
    type: "TXT",
    name: mailFromDomain,
    value: "v=spf1 include:amazonses.com ~all"
  };

  const dmarcRecord = {
    type: "TXT",
    name: `_dmarc.${domain}`,
    value: "v=DMARC1; p=none;"
  };

  return {
    identity: identityToken ? txtRecord : null,
    dkim: dkimRecords,
    mx: mxRecord,
    mailFrom: [mailFromMxRecord, mailFromSpfRecord],
    dmarc: dmarcRecord
  };
};

const parseDkimTokens = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((token): token is string => typeof token === 'string');
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((token): token is string => typeof token === 'string');
      }
      return [value];
    } catch {
      return [value];
    }
  }
  return [];
};

const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    };
  }

  try {
    return {
      message: JSON.stringify(error)
    };
  } catch {
    return {
      message: String(error)
    };
  }
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" }
  });

const getAuthenticatedUserId = async (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return "service_role";
  if (!SUPABASE_ANON_KEY) return null;

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false }
  });

  const {
    data: { user }
  } = await authClient.auth.getUser();

  return user?.id || null;
};

const ensureBusinessAccess = async (userId: string | null, businessId: string) => {
  if (!userId) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  if (userId === "service_role") {
    return null;
  }

  const [{ data: businessMembership }, { data: roleMembership }] = await Promise.all([
    supabase
      .from("business_users")
      .select("business_id")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("user_roles")
      .select("business_id")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle()
  ]);

  if (!businessMembership && !roleMembership) {
    return jsonResponse({ error: "Access denied to this business" }, 403);
  }

  return null;
};

const handleStartVerification = async (
  { domain, businessId }: StartPayload,
  userId: string | null
) => {
  const normalizedDomain = normalizeDomain(domain);

  if (!normalizedDomain || !businessId) {
    return jsonResponse({ error: "Domain and businessId are required" }, 400);
  }

  const accessError = await ensureBusinessAccess(userId, businessId);
  if (accessError) return accessError;

  try {
    console.log('Starting domain verification', { domain: normalizedDomain, businessId });

    const identityResult = await ses.send(
      new VerifyDomainIdentityCommand({ Domain: normalizedDomain })
    );

    const token = identityResult?.VerificationToken;

    if (!token) {
      throw new Error("Failed to retrieve identity verification token from SES");
    }

    const dkimResult = await ses.send(
      new VerifyDomainDkimCommand({ Domain: normalizedDomain })
    );

    const dkimTokens = dkimResult?.DkimTokens ?? [];
    const mailFromDomain = buildMailFromDomain(normalizedDomain);

    await ses.send(
      new SetIdentityMailFromDomainCommand({
        Identity: normalizedDomain,
        MailFromDomain: mailFromDomain,
        BehaviorOnMXFailure: "UseDefaultValue"
      })
    );

    const verificationRecords = buildDnsRecords(normalizedDomain, token, dkimTokens, mailFromDomain);

    const upsertPayload = {
      business_id: businessId,
      domain: normalizedDomain,
      verified: false,
      verification_token: token,
      dkim_tokens: dkimTokens,
      dkim_status: 'pending',
      mail_from_domain: mailFromDomain,
      mail_from_status: 'pending',
      spf_record: verificationRecords.mailFrom?.[1]?.value || null,
      dmarc_record: verificationRecords.dmarc?.value || null,
      ses_verification_status: 'pending',
      last_checked_at: new Date().toISOString(),
      verification_errors: null
    };

    const { data: domainRecord, error } = await supabase
      .from("mail_domains")
      .upsert(upsertPayload, { onConflict: "business_id,domain" })
      .select()
      .single();

    if (error) {
      console.error("Failed to upsert mail_domains record", error);
      throw new Error(`Database error: ${error.message}`);
    }

    return jsonResponse({ domain: domainRecord, verificationRecords });
  } catch (error) {
    console.error("mail-domain-manager start error", { error: serializeError(error), domain: normalizedDomain, businessId });
    return jsonResponse({
      error: serializeError(error),
      context: { domain: normalizedDomain, businessId }
    }, 500);
  }
};

const handleStatusCheck = async (
  { domain, domainId }: StatusPayload,
  userId: string | null
) => {
  const normalizedDomain = normalizeDomain(domain);

  try {
    const { data: domainRecordLookup, error: domainLookupError } = await supabase
      .from("mail_domains")
      .select("id, business_id")
      .eq("id", domainId)
      .maybeSingle();

    if (domainLookupError) {
      throw new Error(`Domain lookup failed: ${domainLookupError.message}`);
    }

    if (!domainRecordLookup?.business_id) {
      return jsonResponse({ error: "Domain not found" }, 404);
    }

    const accessError = await ensureBusinessAccess(userId, String(domainRecordLookup.business_id));
    if (accessError) return accessError;

    const statusResult = await ses.send(
      new GetIdentityVerificationAttributesCommand({ Identities: [normalizedDomain] })
    );
    const dkimResult = await ses.send(
      new GetIdentityDkimAttributesCommand({ Identities: [normalizedDomain] })
    );
    const mailFromResult = await ses.send(
      new GetIdentityMailFromDomainAttributesCommand({ Identities: [normalizedDomain] })
    );

    const attr = statusResult.VerificationAttributes?.[normalizedDomain];
    const dkimAttr = dkimResult.DkimAttributes?.[normalizedDomain];
    const mailFromAttr = mailFromResult.MailFromDomainAttributes?.[normalizedDomain];
    const verificationStatus = normalizeSesStatus(attr?.VerificationStatus);
    const dkimStatus = normalizeSesStatus(dkimAttr?.DkimVerificationStatus);
    const mailFromStatus = normalizeSesStatus(mailFromAttr?.MailFromDomainStatus);

    const updates: Record<string, unknown> = {
      ses_verification_status: verificationStatus,
      dkim_status: dkimStatus,
      mail_from_status: mailFromStatus,
      mail_from_domain: mailFromAttr?.MailFromDomain || buildMailFromDomain(normalizedDomain),
      last_checked_at: new Date().toISOString(),
      verification_errors: null
    };

    if (verificationStatus === "verified" && dkimStatus === "verified" && mailFromStatus === "verified") {
      updates.verified = true;
      updates.verified_at = new Date().toISOString();
    } else if (verificationStatus === "failed" || dkimStatus === "failed" || mailFromStatus === "failed") {
      updates.verified = false;
      updates.verified_at = null;
      updates.verification_errors = JSON.stringify({ verificationStatus, dkimStatus, mailFromStatus });
    }

    const { data: domainRecord, error } = await supabase
      .from("mail_domains")
      .update(updates)
      .eq("id", domainId)
      .select()
      .single();

    if (error) {
      console.error("Failed to update mail_domains status", error);
      throw new Error(`Database error: ${error.message}`);
    }

    const dkimTokens = parseDkimTokens(domainRecord.dkim_tokens);
    const verificationRecords = buildDnsRecords(
      domainRecord.domain,
      domainRecord.verification_token,
      dkimTokens,
      domainRecord.mail_from_domain || buildMailFromDomain(domainRecord.domain)
    );

    return jsonResponse({
      domain: domainRecord,
      verificationStatus,
      dkimStatus,
      mailFromStatus,
      verificationRecords
    });
  } catch (error) {
    console.error("mail-domain-manager status error", { error: serializeError(error), domain: normalizedDomain, domainId });
    return jsonResponse({
      error: serializeError(error),
      context: { domain: normalizedDomain, domainId }
    }, 500);
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  let payload: RequestPayload;

  try {
    payload = await req.json();
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Invalid JSON payload" }),
      { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  }

  if (!payload?.action) {
    return jsonResponse({ error: "Missing action" }, 400);
  }

  const userId = await getAuthenticatedUserId(req);

  switch (payload.action) {
    case "start":
      return handleStartVerification(payload as StartPayload, userId);
    case "status":
      return handleStatusCheck(payload as StatusPayload, userId);
    default:
      return jsonResponse({ error: "Unsupported action" }, 400);
  }
});
