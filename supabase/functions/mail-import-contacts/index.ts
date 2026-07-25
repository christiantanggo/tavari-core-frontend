import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_CONTACTS_PER_REQUEST = 2000;

type ImportContact = {
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  tags?: string[];
  source?: string;
  marketing_status?: string;
  subscribed_lists?: string;
  blocklisted_lists?: string;
};

type ImportPayload = {
  businessId?: string;
  contacts?: ImportContact[];
  consentConfirmed?: boolean;
  source?: string;
  consentMethod?: string;
  consentTimestamp?: string;
  consentText?: string | null;
  importMode?: string;
  overrideExistingUnsubscribed?: boolean;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePhone(raw: unknown) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 11)}`;
  }
  return String(raw || "").trim() || null;
}

function normalizeTags(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((tag) => String(tag || "").trim()).filter(Boolean))];
}

function normalizeContact(row: ImportContact, fallbackSource: string) {
  const email = String(row?.email || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }

  return {
    email,
    first_name: String(row?.first_name || "").trim() || null,
    last_name: String(row?.last_name || "").trim() || null,
    phone: normalizePhone(row?.phone),
    tags: normalizeTags(row?.tags),
    source: String(row?.source || fallbackSource || "csv_import").trim() || "csv_import",
    marketing_status: normalizeMarketingStatus(row),
  };
}

function hasEmailMarketingToken(raw: unknown) {
  return String(raw || "").toLowerCase().includes("email_marketing");
}

function normalizeMarketingStatus(row: ImportContact) {
  const explicit = String(row?.marketing_status || "").trim().toLowerCase();
  if (["yes", "y", "true", "1", "subscribed", "subscribe", "opt_in", "opt-in", "email_marketing"].includes(explicit)) {
    return "subscribed";
  }
  if (["no", "n", "false", "0", "unsubscribed", "unsubscribe", "opt_out", "opt-out", "blocked", "blocklisted"].includes(explicit)) {
    return "unsubscribed";
  }

  if (hasEmailMarketingToken(row?.blocklisted_lists)) return "unsubscribed";
  if (hasEmailMarketingToken(row?.subscribed_lists)) return "subscribed";
  return "unknown";
}

function normalizeConsentMethod(raw: unknown) {
  const value = String(raw || "").trim().toLowerCase();
  return value === "implied" ? "implied" : "express";
}

function normalizeConsentTimestamp(raw: unknown) {
  const value = String(raw || "").trim();
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

async function processMarketingStatusImport({
  supabase,
  businessId,
  contacts,
  importSource,
  consentMethod,
  consentTimestamp,
  consentText,
  overrideExistingUnsubscribed,
}: {
  supabase: ReturnType<typeof createClient>;
  businessId: string;
  contacts: Array<{
    email: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    tags: string[];
    source: string;
    marketing_status: string;
  }>;
  importSource: string;
  consentMethod: string;
  consentTimestamp: string;
  consentText: string | null;
  overrideExistingUnsubscribed: boolean;
}) {
  const dedupedContacts = [...new Map(contacts.map((row) => [row.email, row])).values()];
  const emails = dedupedContacts.map((row) => row.email);
  const nowIso = new Date().toISOString();

  const { data: existingRows, error: existingError } = await supabase
    .from("mail_contacts")
    .select("id, email, first_name, last_name, phone, tags, subscribed, source, consent_method, consent_timestamp")
    .eq("business_id", businessId)
    .in("email", emails);

  if (existingError) throw existingError;

  const existingMap = new Map<string, Record<string, unknown>>();
  for (const row of existingRows || []) {
    existingMap.set(String(row.email || "").toLowerCase(), row);
  }

  const newRows = dedupedContacts
    .filter((row) => !existingMap.has(row.email) && row.marketing_status !== "unknown")
    .map((row) => ({
      business_id: businessId,
      email: row.email,
      first_name: row.first_name,
      last_name: row.last_name,
      phone: row.phone,
      tags: row.tags,
      source: row.source,
      subscribed: row.marketing_status === "subscribed",
      unsubscribed_at: row.marketing_status === "unsubscribed" ? nowIso : null,
      consent_method: row.marketing_status === "subscribed" ? consentMethod : null,
      consent_source: importSource,
      consent_timestamp: row.marketing_status === "subscribed" ? consentTimestamp : null,
      consent_text: row.marketing_status === "subscribed" ? consentText : null,
    }));

  const consentLogRows: Array<Record<string, unknown>> = [];
  const unsubscribeRows: Array<Record<string, unknown>> = [];
  const resubscribedEmails: string[] = [];
  let insertedCount = 0;
  let updatedCount = 0;
  let subscribedCount = 0;
  let unsubscribedCount = 0;
  let preservedUnsubscribedCount = 0;
  let skippedStatusCount = 0;

  if (newRows.length > 0) {
    const { data: insertedRows, error: insertError } = await supabase
      .from("mail_contacts")
      .insert(newRows)
      .select("id, email, subscribed");

    if (insertError) throw insertError;

    insertedCount = insertedRows?.length || 0;
    for (const insertedRow of insertedRows || []) {
      const isSubscribed = insertedRow.subscribed === true;
      if (isSubscribed) {
        subscribedCount += 1;
        resubscribedEmails.push(String(insertedRow.email || "").toLowerCase());
      } else {
        unsubscribedCount += 1;
        unsubscribeRows.push({
          business_id: businessId,
          email: insertedRow.email,
          contact_id: insertedRow.id,
          unsubscribed_at: nowIso,
          source: importSource,
        });
      }

      consentLogRows.push({
        business_id: businessId,
        contact_id: insertedRow.id,
        email_address: insertedRow.email,
        action: isSubscribed ? "subscribe_import" : "unsubscribe_import",
        consent_source: importSource,
        consent_method: isSubscribed ? consentMethod : "external_blocklist",
        consent_text: isSubscribed ? consentText : "Email marketing blocked in imported consent status file.",
        additional_data: {
          import_source: importSource,
          imported_via: "mail-import-contacts",
          import_mode: "marketing_status_sync",
          imported_status: isSubscribed ? "subscribed" : "unsubscribed",
        },
      });
    }
  }

  for (const row of dedupedContacts) {
    const existing = existingMap.get(row.email);
    if (!existing?.id) {
      if (row.marketing_status === "unknown") skippedStatusCount += 1;
      continue;
    }

    const mergedTags = [...new Set([...(Array.isArray(existing.tags) ? existing.tags.map((tag) => String(tag)) : []), ...row.tags])];
    const updates: Record<string, unknown> = {
      updated_at: nowIso,
    };

    if (!existing.first_name && row.first_name) updates.first_name = row.first_name;
    if (!existing.last_name && row.last_name) updates.last_name = row.last_name;
    if (!existing.phone && row.phone) updates.phone = row.phone;
    if (mergedTags.length > 0) updates.tags = mergedTags;
    if (!existing.source && row.source) updates.source = row.source;

    let consentAction: string | null = null;
    let nextStatus = row.marketing_status;

    if (row.marketing_status === "subscribed") {
      if (existing.subscribed === false && !overrideExistingUnsubscribed) {
        preservedUnsubscribedCount += 1;
        nextStatus = "preserved_unsubscribed";
      } else {
        updates.subscribed = true;
        updates.unsubscribed_at = null;
        updates.consent_method = consentMethod;
        updates.consent_source = importSource;
        updates.consent_timestamp = consentTimestamp;
        updates.consent_text = consentText;
        consentAction = existing.subscribed === false ? "resubscribe" : "subscribe_import";
        resubscribedEmails.push(row.email);
        subscribedCount += 1;
      }
    } else if (row.marketing_status === "unsubscribed") {
      updates.subscribed = false;
      updates.unsubscribed_at = nowIso;
      consentAction = "unsubscribe_import";
      unsubscribeRows.push({
        business_id: businessId,
        email: row.email,
        contact_id: String(existing.id),
        unsubscribed_at: nowIso,
        source: importSource,
      });
      unsubscribedCount += 1;
    } else {
      skippedStatusCount += 1;
    }

    if (Object.keys(updates).length > 1) {
      const { error: updateError } = await supabase
        .from("mail_contacts")
        .update(updates)
        .eq("id", String(existing.id))
        .eq("business_id", businessId);

      if (updateError) throw updateError;
      updatedCount += 1;
    }

    if (consentAction) {
      consentLogRows.push({
        business_id: businessId,
        contact_id: String(existing.id),
        email_address: row.email,
        action: consentAction,
        consent_source: importSource,
        consent_method: row.marketing_status === "subscribed" ? consentMethod : "external_blocklist",
        consent_text: row.marketing_status === "subscribed" ? consentText : "Email marketing blocked in imported consent status file.",
        additional_data: {
          import_source: importSource,
          imported_via: "mail-import-contacts",
          import_mode: "marketing_status_sync",
          imported_status: nextStatus,
          override_existing_unsubscribed: overrideExistingUnsubscribed,
          existing_contact: true,
        },
      });
    }
  }

  const uniqueResubscribedEmails = [...new Set(resubscribedEmails.filter(Boolean))];
  if (uniqueResubscribedEmails.length > 0) {
    const { error: deleteError } = await supabase
      .from("mail_unsubscribes")
      .delete()
      .eq("business_id", businessId)
      .in("email", uniqueResubscribedEmails);

    if (deleteError) throw deleteError;
  }

  if (unsubscribeRows.length > 0) {
    const { error: unsubscribeError } = await supabase
      .from("mail_unsubscribes")
      .upsert(unsubscribeRows, { onConflict: "business_id,email" });

    if (unsubscribeError) throw unsubscribeError;
  }

  if (consentLogRows.length > 0) {
    const { error: consentLogError } = await supabase
      .from("mail_consent_log")
      .insert(consentLogRows);

    if (consentLogError) throw consentLogError;
  }

  return {
    deduped: dedupedContacts.length,
    inserted: insertedCount,
    duplicates: dedupedContacts.length - insertedCount,
    updated: updatedCount,
    subscribed: subscribedCount,
    unsubscribed: unsubscribedCount,
    preserved_unsubscribed: preservedUnsubscribedCount,
    skipped_status: skippedStatusCount,
  };
}

async function authorizeImport(req: Request, businessId: string) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return null;
  }

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
  } = await supabaseUser.auth.getUser();

  if (!user?.id) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const [{ data: businessMembership }, { data: roleMembership }] = await Promise.all([
    supabaseUser
      .from("business_users")
      .select("business_id")
      .eq("business_id", businessId)
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle(),
    supabaseUser
      .from("user_roles")
      .select("business_id")
      .eq("business_id", businessId)
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle(),
  ]);

  if (!businessMembership && !roleMembership) {
    return jsonResponse({ error: "Access denied to this business" }, 403);
  }

  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as ImportPayload;
    const businessId = String(body.businessId || "").trim();
    const consentConfirmed = body.consentConfirmed === true;
    const importSource = String(body.source || "csv_import").trim() || "csv_import";
    const consentMethod = normalizeConsentMethod(body.consentMethod);
    const consentTimestamp = normalizeConsentTimestamp(body.consentTimestamp);
    const consentText = body.consentText ? String(body.consentText) : null;
    const importMode = String(body.importMode || "contacts").trim();
    const overrideExistingUnsubscribed = body.overrideExistingUnsubscribed === true;

    if (!businessId) {
      return jsonResponse({ error: "businessId is required" }, 400);
    }

    const authError = await authorizeImport(req, businessId);
    if (authError) {
      return authError;
    }

    if (!consentConfirmed) {
      return jsonResponse({ error: "Marketing consent confirmation is required before import" }, 400);
    }

    if (!Array.isArray(body.contacts) || body.contacts.length === 0) {
      return jsonResponse({ error: "contacts array is required" }, 400);
    }

    if (body.contacts.length > MAX_CONTACTS_PER_REQUEST) {
      return jsonResponse({
        error: `Maximum ${MAX_CONTACTS_PER_REQUEST} contacts per request`,
      }, 400);
    }

    const normalizedContacts = body.contacts
      .map((row) => normalizeContact(row, importSource))
      .filter(Boolean) as Array<{
        email: string;
        first_name: string | null;
        last_name: string | null;
        phone: string | null;
        tags: string[];
        source: string;
      }>;

    if (normalizedContacts.length === 0) {
      return jsonResponse({ error: "No valid contacts to import" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (importMode === "marketing_status_sync") {
      const results = await processMarketingStatusImport({
        supabase,
        businessId,
        contacts: normalizedContacts,
        importSource,
        consentMethod,
        consentTimestamp,
        consentText,
        overrideExistingUnsubscribed,
      });

      return jsonResponse({
        ok: true,
        import_mode: importMode,
        received: body.contacts.length,
        valid: normalizedContacts.length,
        ...results,
      });
    }

    const dedupedContacts = [...new Map(normalizedContacts.map((row) => [row.email, row])).values()];
    const emails = dedupedContacts.map((row) => row.email);

    const { data: existingRows, error: existingError } = await supabase
      .from("mail_contacts")
      .select("id, email, first_name, last_name, phone, tags, subscribed, source, consent_method, consent_timestamp")
      .eq("business_id", businessId)
      .in("email", emails);

    if (existingError) throw existingError;

    const existingMap = new Map<string, Record<string, unknown>>();
    for (const row of existingRows || []) {
      existingMap.set(String(row.email || "").toLowerCase(), row);
    }

    const newRows = dedupedContacts
      .filter((row) => !existingMap.has(row.email))
      .map((row) => ({
        business_id: businessId,
        email: row.email,
        first_name: row.first_name,
        last_name: row.last_name,
        phone: row.phone,
        tags: row.tags,
        source: row.source,
        subscribed: true,
        consent_method: consentMethod,
        consent_source: importSource,
        consent_timestamp: consentTimestamp,
      }));

    const consentLogRows: Array<Record<string, unknown>> = [];

    if (newRows.length > 0) {
      const { data: insertedRows, error: insertError } = await supabase
        .from("mail_contacts")
        .insert(newRows)
        .select("id, email");

      if (insertError) throw insertError;

      for (const insertedRow of insertedRows || []) {
        consentLogRows.push({
          business_id: businessId,
          contact_id: insertedRow.id,
          email_address: insertedRow.email,
          action: "subscribe_import",
          consent_source: importSource,
          consent_method: consentMethod,
          consent_text: consentText,
          additional_data: {
            import_source: importSource,
            imported_via: "mail-import-contacts",
          },
        });
      }
    }

    let updatedCount = 0;
    for (const row of dedupedContacts) {
      const existing = existingMap.get(row.email);
      if (!existing?.id) continue;

      const mergedTags = [...new Set([...(Array.isArray(existing.tags) ? existing.tags.map((tag) => String(tag)) : []), ...row.tags])];
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (!existing.first_name && row.first_name) updates.first_name = row.first_name;
      if (!existing.last_name && row.last_name) updates.last_name = row.last_name;
      if (!existing.phone && row.phone) updates.phone = row.phone;
      if (mergedTags.length > 0) updates.tags = mergedTags;
      if (!existing.source && row.source) updates.source = row.source;
      if (!existing.consent_method) updates.consent_method = consentMethod;
      if (!existing.consent_timestamp) updates.consent_timestamp = consentTimestamp;
      if (!(existing as Record<string, unknown>).consent_source) updates.consent_source = importSource;

      if (Object.keys(updates).length === 1) continue;

      const { error: updateError } = await supabase
        .from("mail_contacts")
        .update(updates)
        .eq("id", String(existing.id));

      if (updateError) throw updateError;
      updatedCount += 1;

      if (!existing.consent_method || !existing.consent_timestamp) {
        consentLogRows.push({
          business_id: businessId,
          contact_id: String(existing.id),
          email_address: row.email,
          action: "subscribe_import",
          consent_source: importSource,
          consent_method: consentMethod,
          consent_text: consentText,
          additional_data: {
            import_source: importSource,
            imported_via: "mail-import-contacts",
            existing_contact: true,
          },
        });
      }
    }

    if (consentLogRows.length > 0) {
      const { error: consentLogError } = await supabase
        .from("mail_consent_log")
        .insert(consentLogRows);

      if (consentLogError) throw consentLogError;
    }

    return jsonResponse({
      ok: true,
      received: body.contacts.length,
      valid: normalizedContacts.length,
      deduped: dedupedContacts.length,
      inserted: newRows.length,
      duplicates: dedupedContacts.length - newRows.length,
      updated: updatedCount,
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
