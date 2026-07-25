import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getHelcimCredentialsForBusiness } from "../_shared/helcimBusinessCredentials.ts";

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    if (req.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
      });
    }

    // ✅ Only parse JSON once
    let body;
    try {
      body = await req.json();
      console.log("🪵 Parsed body received:", JSON.stringify(body));
    } catch (err) {
      console.error("💥 JSON parse error:", err.message);
      return new Response(JSON.stringify({ error: "Invalid JSON received" }), {
        status: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
      });
    }

    const { saleId, businessId } = body;

    if (!saleId || !businessId) {
      return new Response("Missing saleId or businessId", {
        status: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
      });
    }

    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const helcimCreds = await getHelcimCredentialsForBusiness(supabaseService, String(businessId));
    const HELCIM_API_TOKEN = helcimCreds?.apiToken;
    if (!HELCIM_API_TOKEN) {
      return new Response(
        JSON.stringify({
          error:
            "Helcim is not configured for this business. Save the Helcim API token under POS → Settings → Payments.",
        }),
        {
          status: 500,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
          },
        },
      );
    }

    const invoiceNumber = `SALE-${saleId}`;

    // Prefer v2 search; fallback to v1 if needed.
    let helcimResponse = await fetch("https://api.helcim.com/v2/transaction/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "accept": "application/json",
        "api-token": HELCIM_API_TOKEN,
      },
      body: JSON.stringify({ invoiceNumber }),
    });

    if (!helcimResponse.ok && helcimResponse.status === 404) {
      helcimResponse = await fetch("https://api.helcim.com/v1/transaction/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "accept": "application/json" },
        body: JSON.stringify({
          token: HELCIM_API_TOKEN,
          search: { invoiceNumber },
        }),
      });
    }

    const responseText = await helcimResponse.text();

    let helcimData;
    try {
      helcimData = JSON.parse(responseText);
    } catch (jsonErr) {
      console.error("💥 Helcim returned invalid JSON:", responseText);
      return new Response(JSON.stringify({ error: "Helcim returned non-JSON response" }), {
        status: 502,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const transactions = helcimData.response?.transactions ||
      helcimData.transactions ||
      helcimData.data?.transactions ||
      (Array.isArray(helcimData) ? helcimData : []);

    const approved = transactions.find((t: any) => {
      const txInvoice = t.invoiceNumber || t.invoice?.number;
      const matchesInvoice = txInvoice === invoiceNumber;
      const result = (t.result || t.status || "").toString().toUpperCase();
      return matchesInvoice && result.includes("APPROVED");
    });

    return new Response(JSON.stringify({
      approved: !!approved,
      invoiceNumber,
      transactionId: approved?.transactionId || approved?.id || null,
      approvalCode: approved?.approvalCode || approved?.authCode || approved?.approval || null,
      transaction: approved || null
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });

  } catch (err) {
    console.error("🔥 Function error:", err);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
});
