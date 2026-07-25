import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callFinix, corsHeaders, handleOptions, jsonHeaders } from "../_shared/finixClient.ts";

interface GetStatusRequest {
  formId?: string;
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
    const body = (await req.json()) as GetStatusRequest;

    if (!body.formId) {
      return new Response(JSON.stringify({ error: "formId is required" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const application = await callFinix<{ id: string; status?: string; identity?: string; identityId?: string; merchant?: string; merchantId?: string }>({
      path: `/applications/${body.formId}`,
      method: "GET",
    });

    const statusResponse = {
      formId: application.id,
      status: application.status || "UNKNOWN",
      identityId: application.identity || application.identityId || null,
      merchantId: application.merchant || application.merchantId || null,
    };

    return new Response(JSON.stringify(statusResponse), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error("🔥 get-onboarding-status error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message || "Unexpected error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});



