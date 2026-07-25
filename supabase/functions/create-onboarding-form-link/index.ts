import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callFinix, handleOptions, jsonHeaders } from "../_shared/finixClient.ts";

interface GenerateLinkRequest {
  formId?: string;
  returnUrl?: string | null;
  cancelUrl?: string | null;
}

serve(async (req: Request): Promise<Response> => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  try {
    const body = (await req.json()) as GenerateLinkRequest;

    if (!body.formId) {
      return new Response(JSON.stringify({ error: "formId is required" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const payload = {
      type: "MERCHANT",
      returnUrl: body.returnUrl || Deno.env.get("FINIX_ONBOARDING_RETURN_URL") || "https://app.tavari.ca/tavari-pay/onboarding/success",
      cancelUrl: body.cancelUrl || Deno.env.get("FINIX_ONBOARDING_CANCEL_URL") || "https://app.tavari.ca/tavari-pay/onboarding/cancelled",
    };

    const link = await callFinix<{ linkUrl?: string; url?: string; expiresAt?: string }>({
      path: `/applications/${body.formId}/onboarding_links`,
      method: "POST",
      body: payload,
    });

    const linkUrl = link.linkUrl || link.url;

    if (!linkUrl) {
      throw new Error("Finix did not return a new onboarding link");
    }

    return new Response(JSON.stringify({
      formId: body.formId,
      linkUrl,
      expiresAt: link.expiresAt || null,
    }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error("🔥 create-onboarding-form-link error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message || "Unexpected error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});



