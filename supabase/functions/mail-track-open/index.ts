import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getMailTokenSigningSecret,
  verifySignedMailToken,
} from "../_shared/mailTokenSecurity.ts";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = Deno.env.toObject();
const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

const transparentGifBytes = Uint8Array.from(
  atob("R0lGODlhAQABAPAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="),
  (char) => char.charCodeAt(0),
);

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return new Response("Missing token", { status: 400 });
    }

    const payload = await verifySignedMailToken(token, getMailTokenSigningSecret());
    const now = new Date().toISOString();
    if (payload.kind !== "mail_tracking" || payload.eventType !== "open") {
      throw new Error("Invalid tracking token");
    }
    const campaignId = String(payload.campaignId || "");
    const contactId = payload.contactId ? String(payload.contactId) : null;
    const businessId = String(payload.businessId || "");
    const blockId = String(payload.blockId || "email_open");

    let firstOpen = true;

    if (campaignId && contactId) {
      const { data: updatedRows, error: updateError } = await supabase
        .from("mail_campaign_sends")
        .update({ opened_at: now })
        .eq("campaign_id", campaignId)
        .eq("contact_id", contactId)
        .is("opened_at", null)
        .select("campaign_id");

      if (updateError) {
        console.error("mail-track-open send update failed:", updateError);
        firstOpen = true;
      } else {
        firstOpen = !!(updatedRows && updatedRows.length > 0);
      }
    }

    if (firstOpen) {
      const { error: analyticsError } = await supabase.from("mail_content_analytics").insert({
        id: `open_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        campaign_id: campaignId || null,
        contact_id: contactId,
        block_id: blockId,
        event_type: "view",
        event_data: {
          business_id: businessId,
          event_type: "open",
          user_agent: req.headers.get("user-agent"),
          ip_address: req.headers.get("x-forwarded-for"),
          tracked_at: now,
        },
      });

      if (analyticsError) {
        console.error("mail-track-open analytics insert failed:", analyticsError);
      }
    }

    return new Response(transparentGifBytes, {
      status: 200,
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    });
  } catch (error) {
    console.error("mail-track-open failed:", error);
    return new Response(transparentGifBytes, {
      status: 200,
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "no-store",
      },
    });
  }
});
