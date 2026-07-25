/**
 * Atomic-ish employee onboarding: creates Auth user + public.users + business_users (or links existing profile).
 * Rollback: removes auth + DB rows if any step after Auth create fails.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ELEVATED = new Set(["owner", "manager", "admin"]);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resolveActorIds(
  admin: ReturnType<typeof createClient>,
  authUserId: string,
  jwtEmail: string | undefined,
): Promise<string[]> {
  const ids = new Set<string>([authUserId]);
  if (jwtEmail) {
    const { data: row } = await admin.from("users").select("id").eq("email", jwtEmail.toLowerCase().trim()).maybeSingle();
    if (row?.id) ids.add(row.id);
  }
  return [...ids];
}

async function assertCanManageBusiness(
  admin: ReturnType<typeof createClient>,
  actorIds: string[],
  businessId: string,
): Promise<void> {
  for (const uid of actorIds) {
    const { data: bu } = await admin.from("business_users").select("role").eq("business_id", businessId).eq("user_id", uid).maybeSingle();
    if (bu?.role && ELEVATED.has(bu.role)) return;
    const { data: ur } = await admin.from("user_roles").select("role").eq("business_id", businessId).eq("user_id", uid).eq("active", true).maybeSingle();
    if (ur?.role && ELEVATED.has(ur.role)) return;
  }
  throw new Error("Not authorized to add employees for this business.");
}

async function rollbackNewUser(admin: ReturnType<typeof createClient>, userId: string) {
  try {
    await admin.from("user_roles").delete().eq("user_id", userId);
  } catch (_) {
    /* ignore */
  }
  try {
    await admin.from("business_users").delete().eq("user_id", userId);
  } catch (_) {
    /* ignore */
  }
  try {
    await admin.from("users").delete().eq("id", userId);
  } catch (_) {
    /* ignore */
  }
  try {
    await admin.auth.admin.deleteUser(userId);
  } catch (_) {
    /* ignore */
  }
}

type Profile = {
  email: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  phone?: string;
  hashed_password?: string;
  pin?: string;
  position?: string;
  department?: string;
  hire_date?: string | null;
  wage?: string | number | null;
  claim_code?: string | number;
  employment_status?: string;
  status?: string;
  roles?: string[];
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: "Server misconfigured." }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "Missing or invalid Authorization header." }, 401);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user?.id) {
    return json({ ok: false, error: "Invalid or expired session." }, 401);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const businessId = String(body.business_id || "").trim();
  const role = String(body.role || "employee").trim() || "employee";
  const authPassword = typeof body.auth_password === "string" ? body.auth_password : "";
  const profile = (body.profile || {}) as Profile;

  if (!businessId) {
    return json({ ok: false, error: "business_id is required." }, 400);
  }

  const email = String(profile.email || "").toLowerCase().trim();
  if (!email) {
    return json({ ok: false, error: "profile.email is required." }, 400);
  }

  try {
    const actorIds = await resolveActorIds(admin, userData.user.id, userData.user.email ?? undefined);
    await assertCanManageBusiness(admin, actorIds, businessId);

    const { data: existingUser, error: exErr } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    if (exErr) throw exErr;

    if (existingUser?.id) {
      const { data: buRow, error: buErr } = await admin.from("business_users").select("id").eq("business_id", businessId).eq(
        "user_id",
        existingUser.id,
      ).maybeSingle();
      if (buErr) throw buErr;
      if (buRow) {
        return json({ ok: false, error: "This person is already on your team for this business." }, 200);
      }

      const fullName = String(profile.full_name || `${profile.first_name || ""} ${profile.last_name || ""}`.trim()).trim();
      if (!fullName) {
        return json({ ok: false, error: "profile.full_name (or first + last name) is required." }, 400);
      }

      const { error: upErr } = await admin.from("users").update({
        full_name: fullName,
        first_name: profile.first_name?.trim() || null,
        last_name: profile.last_name?.trim() || null,
        phone: profile.phone?.trim() || null,
        pin: profile.pin || null,
        hashed_password: profile.hashed_password || null,
        position: profile.position?.trim() || null,
        department: profile.department?.trim() || null,
        hire_date: profile.hire_date || null,
        wage: profile.wage === "" || profile.wage == null ? null : Number(profile.wage),
        claim_code: profile.claim_code != null ? Number(profile.claim_code) : 1,
        employment_status: profile.employment_status || "active",
        status: profile.status || "active",
        roles: Array.isArray(profile.roles) && profile.roles.length ? profile.roles : ["employee"],
      }).eq("id", existingUser.id);
      if (upErr) throw upErr;

      const { error: insBu } = await admin.from("business_users").insert({
        user_id: existingUser.id,
        business_id: businessId,
        role,
      });
      if (insBu) throw insBu;

      return json({ ok: true, user_id: existingUser.id, linked: true });
    }

    if (!authPassword || authPassword.length < 10) {
      return json({ ok: false, error: "auth_password is required for new employees (min 10 characters)." }, 400);
    }

    const fullName = String(profile.full_name || `${profile.first_name || ""} ${profile.last_name || ""}`.trim()).trim();
    if (!fullName) {
      return json({ ok: false, error: "profile.full_name (or first + last name) is required." }, 400);
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: authPassword,
      email_confirm: true,
    });
    if (createErr) throw createErr;
    const newId = created.user?.id;
    if (!newId) throw new Error("Auth user creation returned no id.");

    try {
      const { error: insUser } = await admin.from("users").insert({
        id: newId,
        email,
        full_name: fullName,
        first_name: profile.first_name?.trim() || null,
        last_name: profile.last_name?.trim() || null,
        phone: profile.phone?.trim() || null,
        pin: profile.pin || null,
        hashed_password: profile.hashed_password || null,
        position: profile.position?.trim() || null,
        department: profile.department?.trim() || null,
        hire_date: profile.hire_date || null,
        wage: profile.wage === "" || profile.wage == null ? null : Number(profile.wage),
        claim_code: profile.claim_code != null ? Number(profile.claim_code) : 1,
        employment_status: profile.employment_status || "active",
        status: profile.status || "active",
        roles: Array.isArray(profile.roles) && profile.roles.length ? profile.roles : ["employee"],
      });
      if (insUser) throw insUser;

      const { error: insBu } = await admin.from("business_users").insert({
        user_id: newId,
        business_id: businessId,
        role,
      });
      if (insBu) throw insBu;

      return json({ ok: true, user_id: newId, linked: false });
    } catch (e) {
      await rollbackNewUser(admin, newId);
      throw e;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[create-employee-for-business]", e);
    return json({ ok: false, error: msg || "Employee creation failed." }, 200);
  }
});
