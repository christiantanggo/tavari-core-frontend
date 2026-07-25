// Email open / pay-link click tracking — returns 1x1 transparent GIF.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GIF = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (c) => c.charCodeAt(0),
);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }

  try {
    const url = new URL(req.url);
    const token = String(url.searchParams.get("token") ?? "").trim();
    const event = String(url.searchParams.get("event") ?? "open").trim().toLowerCase();

    if (token) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const patch: Record<string, string> = { updated_at: new Date().toISOString() };
      if (event === "click") patch.pay_link_clicked_at = new Date().toISOString();
      else patch.email_opened_at = new Date().toISOString();

      await supabase
        .from("tavari_invoices")
        .update(patch)
        .eq("email_tracking_token", token);
    }
  } catch (e) {
    console.warn("[invoice-track]", e);
  }

  return new Response(GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
});
