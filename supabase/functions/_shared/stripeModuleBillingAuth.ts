import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export function getServiceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Service role bearer, or active Tavari employee JWT. */
export async function authorizeStripeModuleAdmin(req: Request): Promise<boolean> {
  const authHeader = (req.headers.get("Authorization") || "").trim();
  if (!authHeader) return false;
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return true;

  const admin = getServiceClient();
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user?.id) return false;

  const { data: te } = await admin
    .from("tavari_employees")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  return Boolean(te?.id);
}

/** Service role bearer, or dashboard manager/owner for the given business_id. */
export async function authorizeBusinessBillingWrite(
  req: Request,
  businessId: string,
): Promise<boolean> {
  const authHeader = (req.headers.get("Authorization") || "").trim();
  if (!authHeader) return false;
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return true;

  const admin = getServiceClient();
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user?.id) return false;

  const { data: te } = await admin
    .from("tavari_employees")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (te?.id) return true;

  const { data: role } = await admin
    .from("user_roles")
    .select("id")
    .eq("business_id", businessId)
    .eq("user_id", user.id)
    .eq("active", true)
    .in("role", ["owner", "admin", "manager"])
    .maybeSingle();

  return Boolean(role?.id);
}
