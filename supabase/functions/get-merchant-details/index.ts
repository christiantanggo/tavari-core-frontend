import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callFinix, handleOptions, jsonHeaders } from "../_shared/finixClient.ts";

interface MerchantDetailsRequest {
  merchantId?: string;
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
    const body = (await req.json()) as MerchantDetailsRequest;

    if (!body.merchantId) {
      return new Response(JSON.stringify({ error: "merchantId is required" }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const merchant = await callFinix<Record<string, unknown>>({
      path: `/merchants/${body.merchantId}`,
      method: "GET",
    });

    const settlement = await callFinix<Record<string, unknown>>({
      path: `/merchants/${body.merchantId}/settlements`,
      method: "GET",
    }).catch((error) => {
      console.warn('⚠️ Failed to retrieve merchant settlements:', error);
      return null;
    });

    const processing = await callFinix<Record<string, unknown>>({
      path: `/merchants/${body.merchantId}/processing_information`,
      method: "GET",
    }).catch((error) => {
      console.warn('⚠️ Failed to retrieve processing information:', error);
      return null;
    });

    const responseBody = {
      merchantId: body.merchantId,
      merchant,
      settlement,
      processing,
      onboardingState: (merchant as { onboardingState?: string })?.onboardingState || null,
      processingEnabled: Boolean((processing as { enabled?: boolean })?.enabled),
      settlementEnabled: Boolean((settlement as { enabled?: boolean })?.enabled),
      processor: (merchant as { processor?: string })?.processor || null,
    };

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error("🔥 get-merchant-details error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message || "Unexpected error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});



