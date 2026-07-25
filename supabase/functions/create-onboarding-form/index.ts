import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callFinix, corsHeaders, handleOptions, jsonHeaders } from "../_shared/finixClient.ts";

interface BusinessData {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  postal?: string;
  country?: string;
}

interface CreateOnboardingRequest {
  businessData?: BusinessData;
  returnUrl?: string | null;
  cancelUrl?: string | null;
  businessId?: string;
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
    const body = (await req.json()) as CreateOnboardingRequest;

    const businessData = body.businessData || {};
    const fallbackName = businessData.name || "Tavari Merchant";

    // Step 1: Create an Identity in Finix
    const identityPayload = {
      entity: "BUSINESS",
      businessName: fallbackName,
      businessType: "CORPORATION",
      email: businessData.email || "support@tavari.app",
      phone: businessData.phone || "0000000000",
      businessAddress: {
        line1: businessData.address || "Unknown",
        city: businessData.city || "Toronto",
        region: businessData.state || "ON",
        postalCode: businessData.postal || "00000",
        country: businessData.country || "CAN",
      },
    };

    const identity = await callFinix<{ id: string } | { error: unknown }>({
      path: "/identities",
      method: "POST",
      body: identityPayload,
    });

    if (!("id" in identity)) {
      throw new Error("Failed to create Finix identity");
    }

    const identityId = identity.id;

    // Step 2: Create an application for the identity
    const processor = Deno.env.get("FINIX_PROCESSOR") || "DUMMY_V1";
    const applicationPayload = {
      identity: identityId,
      processor,
      applicationType: "MERCHANT",
    };

    const application = await callFinix<{ id: string; status?: string }>({
      path: "/applications",
      method: "POST",
      body: applicationPayload,
    });

    if (!("id" in application)) {
      throw new Error("Failed to create Finix application");
    }

    const applicationId = application.id;

    // Step 3: Create an onboarding link
    const onboardingPayload = {
      type: "MERCHANT",
      returnUrl: body.returnUrl || Deno.env.get("FINIX_ONBOARDING_RETURN_URL") || "https://app.tavari.ca/tavari-pay/onboarding/success",
      cancelUrl: body.cancelUrl || Deno.env.get("FINIX_ONBOARDING_CANCEL_URL") || "https://app.tavari.ca/tavari-pay/onboarding/cancelled",
    };

    const onboardingLink = await callFinix<{ linkUrl?: string; url?: string; expiresAt?: string }>({
      path: `/applications/${applicationId}/onboarding_links`,
      method: "POST",
      body: onboardingPayload,
    });

    const linkUrl = onboardingLink.linkUrl || (onboardingLink as { url?: string }).url;

    if (!linkUrl) {
      throw new Error("Finix did not return an onboarding link URL");
    }

    const responseBody = {
      formId: applicationId,
      linkUrl,
      expiresAt: onboardingLink.expiresAt || null,
      status: application.status || "IN_PROGRESS",
      identityId,
      processor,
    };

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (error) {
    console.error("🔥 create-onboarding-form error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message || "Unexpected error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});



