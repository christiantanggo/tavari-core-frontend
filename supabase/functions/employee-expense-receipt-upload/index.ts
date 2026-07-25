// Employee app: managers/admins/owners upload receipts into the accounting expense queue.
// POST body:
//   { action: 'check_access', business_id? }
//   { action: 'upload', business_id, filename, content_type?, file_base64, extract?: boolean }
// Deploy: npx supabase functions deploy employee-expense-receipt-upload --no-verify-jwt --use-api

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const EXPENSE_INVOICES_BUCKET = 'expense-invoices';
const MAX_BYTES = 10 * 1024 * 1024;
const MANAGER_ROLES = new Set(['owner', 'manager', 'admin']);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user?.email) return json({ error: 'Invalid user token' }, 401);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || 'upload').trim();
    const access = await resolveManagerAccess(admin, authData.user.email, stringOrNull(body.business_id));

    if (action === 'check_access') {
      return json({
        ok: true,
        allowed: access.allowed,
        business_id: access.businessId,
        business_name: access.businessName,
        role: access.role,
      });
    }

    if (action === 'upload') {
      if (!access.allowed || !access.businessId) {
        return json({ error: 'Only managers, admins, or owners can upload expense receipts for this business.' }, 403);
      }

      const filename = String(body.filename || 'receipt.jpg').replace(/[^a-zA-Z0-9._-]/g, '_') || 'receipt.jpg';
      const contentType = normalizeContentType(body.content_type, filename);
      if (!contentType) {
        return json({ error: 'Only PDF or image receipts are allowed (PDF, JPG, PNG, WEBP).' }, 400);
      }

      const fileBase64 = String(body.file_base64 || '').replace(/^data:[^;]+;base64,/, '').trim();
      if (!fileBase64) return json({ error: 'Missing receipt file data' }, 400);

      let bytes: Uint8Array;
      try {
        const binary = atob(fileBase64);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      } catch {
        return json({ error: 'Invalid receipt file encoding' }, 400);
      }
      if (bytes.byteLength === 0) return json({ error: 'Receipt file is empty' }, 400);
      if (bytes.byteLength > MAX_BYTES) return json({ error: 'Receipt is too large (max 10 MB)' }, 400);

      const path = `${access.businessId}/${crypto.randomUUID()}/${filename}`;
      const { error: upErr } = await admin.storage
        .from(EXPENSE_INVOICES_BUCKET)
        .upload(path, bytes, { contentType, upsert: false });
      if (upErr) return json({ error: upErr.message || 'Failed to upload receipt' }, 500);

      const { data: draft, error: insErr } = await admin
        .from('accounting_draft_expenses')
        .insert({
          business_id: access.businessId,
          source: 'manual',
          vendor_name_display: null,
          transaction_date: null,
          total_amount: 0,
          tax_amount: 0,
          subtotal: 0,
          hst_treatment: 'recoverable',
          status: 'draft',
          invoice_file_path: path,
          invoice_currency: 'CAD',
          document_type: 'invoice',
        })
        .select('id, invoice_file_path, status, created_at')
        .single();
      if (insErr || !draft?.id) {
        await admin.storage.from(EXPENSE_INVOICES_BUCKET).remove([path]).catch(() => {});
        return json({ error: insErr?.message || 'Failed to create expense draft' }, 500);
      }

      let extraction: Record<string, unknown> | null = null;
      const shouldExtract = body.extract !== false;
      if (shouldExtract) {
        try {
          const extractRes = await fetch(`${SUPABASE_URL}/functions/v1/accounting-extract-draft-expense`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ draft_id: draft.id }),
          });
          const extractBody = await extractRes.json().catch(() => ({}));
          extraction = {
            ok: extractRes.ok && !extractBody?.error,
            error: extractBody?.error || null,
            code: extractBody?.code || null,
          };
        } catch (extractErr) {
          extraction = {
            ok: false,
            error: extractErr instanceof Error ? extractErr.message : 'Extraction failed',
          };
        }
      }

      return json({
        ok: true,
        draft,
        business_id: access.businessId,
        extraction,
      });
    }

    return json({ error: 'Invalid action' }, 400);
  } catch (error) {
    console.error('[employee-expense-receipt-upload] error', error);
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500);
  }
});

async function resolveManagerAccess(
  admin: ReturnType<typeof createClient>,
  email: string,
  preferredBusinessId: string | null,
) {
  const normalizedEmail = email.toLowerCase().trim();
  const { data: user, error: userError } = await admin
    .from('users')
    .select('id, email')
    .eq('email', normalizedEmail)
    .maybeSingle();
  if (userError || !user?.id) {
    return { allowed: false, businessId: null, businessName: null, role: null };
  }

  const { data: memberships, error: membershipError } = await admin
    .from('business_users')
    .select('business_id, role, businesses:business_id(id, name)')
    .eq('user_id', user.id)
    .limit(50);
  if (membershipError || !memberships?.length) {
    return { allowed: false, businessId: null, businessName: null, role: null };
  }

  const selected =
    (preferredBusinessId
      ? memberships.find((row) => String(row.business_id) === String(preferredBusinessId))
      : null) || memberships[0];

  const buRole = String(selected?.role || '').toLowerCase();
  let role = buRole;

  const { data: userRoles } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('business_id', selected.business_id)
    .eq('active', true)
    .limit(1);
  const urRole = String(userRoles?.[0]?.role || '').toLowerCase();
  if (MANAGER_ROLES.has(urRole)) role = urRole;

  const allowed = MANAGER_ROLES.has(buRole) || MANAGER_ROLES.has(urRole);
  const business = selected?.businesses as { id?: string; name?: string } | null;
  return {
    allowed,
    businessId: selected?.business_id || null,
    businessName: business?.name || null,
    role: role || null,
  };
}

function normalizeContentType(raw: unknown, filename: string): string | null {
  const type = String(raw || '').toLowerCase().split(';')[0].trim();
  const name = String(filename || '').toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'application/pdf';
  if (type === 'image/jpeg' || type === 'image/jpg' || /\.jpe?g$/.test(name)) return 'image/jpeg';
  if (type === 'image/png' || name.endsWith('.png')) return 'image/png';
  if (type === 'image/webp' || name.endsWith('.webp')) return 'image/webp';
  return null;
}

function stringOrNull(value: unknown) {
  const text = String(value || '').trim();
  return text || null;
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
