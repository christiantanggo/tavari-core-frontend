import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getMailTokenSigningSecret,
  verifySignedMailToken,
} from "../_shared/mailTokenSecurity.ts";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = Deno.env.toObject();
const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return new Response("Missing token", { status: 400 });
    }

    const payload = await verifySignedMailToken(token, getMailTokenSigningSecret());
    const now = new Date().toISOString();
    if (payload.kind !== "mail_tracking" || payload.eventType !== "click") {
      throw new Error("Invalid tracking token");
    }
    const campaignId = String(payload.campaignId || "");
    const contactId = payload.contactId ? String(payload.contactId) : null;
    const businessId = String(payload.businessId || "");
    const blockId = String(payload.blockId || "link_click");
    const targetUrl = String(payload.targetUrl || "");

    if (!/^https?:\/\//i.test(targetUrl)) {
      return new Response("Invalid target URL", { status: 400 });
    }

    let firstClick = true;

    if (campaignId && contactId) {
      const { data: updatedRows, error: updateError } = await supabase
        .from("mail_campaign_sends")
        .update({ clicked_at: now })
        .eq("campaign_id", campaignId)
        .eq("contact_id", contactId)
        .is("clicked_at", null)
        .select("campaign_id");

      if (updateError) {
        console.error("mail-track-click send update failed:", updateError);
        firstClick = true;
      } else {
        firstClick = !!(updatedRows && updatedRows.length > 0);
      }
    }

    if (firstClick) {
      await supabase.from("mail_content_analytics").insert({
        id: `click_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        campaign_id: campaignId || null,
        contact_id: contactId,
        block_id: blockId,
        event_type: "click",
        event_data: {
          business_id: businessId,
          event_type: "click",
          target_url: targetUrl,
          user_agent: req.headers.get("user-agent"),
          ip_address: req.headers.get("x-forwarded-for"),
          tracked_at: now,
        },
      });
    }

    return Response.redirect(targetUrl, 302);
  } catch (error) {
    console.error("mail-track-click failed:", error);
    return new Response("Tracking failed", { status: 500 });
  }
});
