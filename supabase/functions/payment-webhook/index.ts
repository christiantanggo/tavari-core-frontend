// supabase/functions/payment-webhook/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { finalizePendingBooking } from "../_shared/bookingFinalization.ts";
import { finalizeKioskPendingPayment } from "../_shared/kioskHelcimFinalization.ts";
import { verifyHelcimWebhookMultiTenant } from "../_shared/helcimWebhookVerification.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, webhook-signature, webhook-id, webhook-timestamp',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req: Request) => {
  // Handle CORS preflight - Helcim will test this when saving
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }

  // Handle GET requests (Helcim might test with GET)
  if (req.method === 'GET') {
    return new Response("OK", { 
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
    });
  }

  // Handle HEAD requests (some services use HEAD for validation)
  if (req.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }

  try {
    if (req.method !== "POST") {
      // For any other method, return 200 OK to pass validation
      return new Response("OK", { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
      });
    }

    // Handle empty body or test requests from Helcim
    let body;
    let bodyText = '';
    
    try {
      bodyText = await req.text();
      
      // If body is empty, treat as validation/test request
      if (!bodyText || !bodyText.trim()) {
        console.log("[Webhook] Received empty/test request from Helcim - returning OK");
        return new Response("OK", { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
        });
      }
      
      // Try to parse as JSON
      body = JSON.parse(bodyText);
    } catch (parseError) {
      // If JSON parsing fails, might be a test request or invalid format
      console.log("[Webhook] Could not parse request body, treating as test request");
      console.log("[Webhook] Body text:", bodyText.substring(0, 200));
      
      // Return OK for any non-JSON request (Helcim validation might send non-JSON)
      return new Response("OK", { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
      });
    }

    console.log("[Webhook] FULL PAYLOAD:", JSON.stringify(body, null, 2));

    // Helcim webhook format for Card Transaction events
    // Handle multiple possible formats - check ALL possible locations
    const eventType = body?.event || body?.type || body?.eventType || body?.event_type;
    
    // Transaction ID - check multiple locations
    const transactionId = body?.transactionId || body?.transaction?.transactionId || body?.transaction_id || 
                          body?.id || body?.transaction?.id || body?.data?.transactionId || body?.data?.id;
    
    // Invoice Number - check multiple locations including invoice object (use let so we can update from API)
    let invoiceNumber = body?.invoiceNumber || body?.invoice?.number || body?.invoice_number || 
                          body?.reference || body?.invoice?.invoiceNumber || body?.data?.invoiceNumber ||
                          body?.transaction?.invoiceNumber || body?.transaction?.invoice?.number;
    
    // Status - check ALL possible locations including nested transaction/data objects (use let so we can update)
    let status = body?.status || body?.transaction?.status || body?.transaction_status ||
                   body?.result || body?.transaction?.result || body?.data?.status ||
                   body?.data?.transaction?.status || body?.paymentStatus || body?.payment_status ||
                   body?.transaction?.paymentStatus || body?.data?.result;
    
    // Amount - check multiple locations (use let so we can update from API)
    let amount = body?.amount || body?.transaction?.amount || body?.transactionAmount || 
                  body?.transaction_amount || body?.data?.amount || body?.data?.transaction?.amount;
    
    // Device Code (use let so we can update from API)
    let deviceCode = body?.deviceCode || body?.device?.code || body?.device_code || 
                       body?.data?.deviceCode || body?.transaction?.deviceCode;
    
    // Card info
    const cardType = body?.cardType || body?.card?.type || body?.card_type || 
                     body?.data?.cardType || body?.transaction?.cardType;
    const lastFour = body?.lastFour || body?.card?.lastFour || body?.card_number?.slice(-4) || 
                     body?.data?.lastFour || body?.transaction?.lastFour;
    let approvalCode = body?.approvalCode || body?.approval?.code || body?.approval_code ||
                         body?.data?.approvalCode || body?.transaction?.approvalCode;

    // Legacy format support (saleReference)
    const saleReference = body?.saleReference || body?.sale_reference || body?.data?.saleReference;

    console.log("[Webhook] Parsed:", { eventType, transactionId, invoiceNumber, status, saleReference, amount, deviceCode });

    // For cardTransaction events, Helcim only sends webhooks for completed transactions
    // The webhook itself is the confirmation - we don't need to verify via API
    // If we have transactionId but no status, assume APPROVED
    if (eventType === "cardTransaction" && transactionId && !status) {
      console.log("[Webhook] cardTransaction event received - Helcim only sends webhooks for completed transactions");
      console.log("[Webhook] Assuming APPROVED status (webhook receipt = transaction completed)");
      status = "APPROVED";
      
      // Note: invoiceNumber will be extracted from the transaction when we process it
      // If invoiceNumber is missing, we'll search for the sale by transactionId in the database
    }

    if (
      transactionId &&
      typeof invoiceNumber === "string" &&
      (invoiceNumber.startsWith("BP-") || invoiceNumber.startsWith("KK-")) &&
      !status
    ) {
      status = "APPROVED";
    }

    // If this is a test request from Helcim (no transaction data), just return OK
    if (!transactionId && !invoiceNumber && !status && !saleReference) {
      console.log("[Webhook] Test request from Helcim - returning OK");
      return new Response("OK", { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
      });
    }

    const verification = await verifyHelcimWebhookMultiTenant({
      req,
      bodyText,
      body: body as Record<string, unknown>,
      supabase,
    });
    if (!verification.ok) {
      console.error("[Webhook] Signature verification failed:", verification.error);
      return new Response(verification.error, {
        status: verification.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Customer portal (BP-* invoices): finalize before generic event-type filter.
    const bpPrefixEarly = "BP-";
    if (typeof invoiceNumber === "string" && invoiceNumber.startsWith(bpPrefixEarly)) {
      const approvedStatusesBp = ["APPROVED", "APPROVE", "SUCCESS", "SUCCESSFUL", "COMPLETED"];
      const approvedBp =
        approvedStatusesBp.some((s) =>
          status?.toUpperCase()?.includes(s) ||
          status?.toLowerCase()?.includes(s.toLowerCase())
        );
      if (!approvedBp) {
        console.log("[Webhook] BP booking not approved:", status);
        return new Response("Payment not approved", {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "text/plain" },
        });
      }
      const pendingIdBp = invoiceNumber.slice(bpPrefixEarly.length);
      const finalizedBp = await finalizePendingBooking({
        supabase,
        pendingId: pendingIdBp,
        transactionId: transactionId ? String(transactionId) : null,
        amount,
        approvalCode: approvalCode ? String(approvalCode) : null,
      });
      if (finalizedBp.ok) {
        return new Response("Booking payment completed", {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "text/plain" },
        });
      }
      if (finalizedBp.status !== 404) {
        return new Response(finalizedBp.message, {
          status: finalizedBp.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.warn("[Webhook] BP finalize 404 — falling through");
    }

    const kkPrefixEarly = "KK-";
    if (typeof invoiceNumber === "string" && invoiceNumber.startsWith(kkPrefixEarly)) {
      const approvedStatusesKk = ["APPROVED", "APPROVE", "SUCCESS", "SUCCESSFUL", "COMPLETED"];
      const approvedKk =
        approvedStatusesKk.some((s) =>
          status?.toUpperCase()?.includes(s) ||
          status?.toLowerCase()?.includes(s.toLowerCase())
        );
      if (!approvedKk) {
        console.log("[Webhook] KK kiosk not approved:", status);
        return new Response("Payment not approved", {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "text/plain" },
        });
      }
      const pendingIdKk = invoiceNumber.slice(kkPrefixEarly.length);
      const finalizedKk = await finalizeKioskPendingPayment({
        supabase,
        pendingId: pendingIdKk,
        transactionId: transactionId ? String(transactionId) : null,
        amount,
        approvalCode: approvalCode ? String(approvalCode) : null,
      });
      if (finalizedKk.ok) {
        return new Response("Kiosk payment completed", {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "text/plain" },
        });
      }
      if (finalizedKk.status !== 404) {
        return new Response(finalizedKk.message, {
          status: finalizedKk.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.warn("[Webhook] KK finalize 404 — falling through");
    }

    // Only process Card Transaction events (or legacy format)
    if (eventType && !eventType.toLowerCase().includes("transaction") &&
      !eventType.toLowerCase().includes("card") && !saleReference) {
      console.log("[Webhook] Ignoring non-transaction event:", eventType);
      return new Response("Event ignored", {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/plain" },
      });
    }

    // Handle legacy format (saleReference)
    if (saleReference) {
      const paymentStatus = body?.status || body?.paymentStatus;
      
      // Only proceed if payment was successful
      if (paymentStatus !== "APPROVED") {
        return new Response("Payment not approved", { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
        });
      }

      // Format: "BUSINESSID-123"
      const [businessId, saleId] = saleReference.split("-");

      if (!businessId || !saleId) {
        return new Response("Invalid reference format", { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { error } = await supabase
        .from("pos_sales")
        .update({ is_paid: true, updated_at: new Date().toISOString() })
        .eq("id", saleId)
        .eq("business_id", businessId);

      if (error) {
        console.error("[Webhook] Update error:", error);
        return new Response("Failed to update sale", { 
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response("Sale marked as paid", { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
      });
    }

    // New format - check if payment was successful
    const approvedStatuses = ["APPROVED", "APPROVE", "SUCCESS", "SUCCESSFUL", "COMPLETED"];
    const isApproved = approvedStatuses.some(s => 
      status?.toUpperCase().includes(s) || status?.toLowerCase().includes(s.toLowerCase())
    );

    if (!isApproved) {
      console.log("[Webhook] Payment not approved, status:", status);
      return new Response("Payment not approved", { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
      });
    }

    if (!invoiceNumber && !transactionId) {
      console.log("[Webhook] Missing invoice number and transaction ID");
      return new Response("Missing invoice number or transaction ID", { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Extract saleId from invoiceNumber (format: "SALE-{saleId}") or find by sale_number
    let saleId = null;
    let businessId = null;

    if (invoiceNumber) {
      if (invoiceNumber.startsWith("SALE-")) {
        // Try to extract UUID from "SALE-{uuid}"
        const potentialId = invoiceNumber.replace("SALE-", "");
        // Check if it's a valid UUID format
        if (potentialId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
          saleId = potentialId;
        }
      }
      
      // If no saleId yet, try to find sale by sale_number (which might match invoiceNumber)
      if (!saleId) {
        const { data: sale } = await supabase
          .from("pos_sales")
          .select("id, business_id, sale_number")
          .eq("sale_number", invoiceNumber)
          .maybeSingle();
        
        if (sale) {
          saleId = sale.id;
          businessId = sale.business_id;
          console.log(`[Webhook] Found sale by sale_number: ${saleId}`);
        }
      }
    }
    
    // If we have transactionId but no saleId yet, search for recent unpaid sales
    if (!saleId && transactionId) {
      console.log(`[Webhook] No saleId found, searching for recent unpaid sales...`);
      
      // Search for recent unpaid sales (within last 10 minutes)
      // This is a fallback - match the most recent unpaid sale
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: recentSales, error: recentError } = await supabase
        .from("pos_sales")
        .select("id, business_id, sale_number, created_at, payment_status")
        .in("payment_status", ["unpaid", "pending", "processing"])
        .gte("created_at", tenMinutesAgo)
        .order("created_at", { ascending: false })
        .limit(20);
      
      if (recentError) {
        console.error(`[Webhook] Error searching recent sales:`, recentError);
      }
      
      if (recentSales && recentSales.length > 0) {
        // Use the most recent unpaid sale
        const mostRecent = recentSales[0];
        saleId = mostRecent.id;
        businessId = mostRecent.business_id;
        invoiceNumber = mostRecent.sale_number || invoiceNumber;
        console.log(`[Webhook] Using most recent unpaid sale as fallback: ${saleId} (created: ${mostRecent.created_at})`);
      } else {
        console.log(`[Webhook] No recent unpaid sales found in last 10 minutes`);
      }
    }

    // Update sale if we found it
    if (saleId) {
      const updateData: any = {
        payment_status: "completed",
        updated_at: new Date().toISOString()
      };

      // Store Helcim fields (columns added via SQL migration)
      if (transactionId) updateData.helcim_transaction_id = String(transactionId);
      if (approvalCode) updateData.helcim_approval_code = String(approvalCode);
      if (deviceCode) updateData.helcim_device_code = String(deviceCode);

      const { error } = await supabase
        .from("pos_sales")
        .update(updateData)
        .eq("id", saleId);

      if (error) {
        console.error("[Webhook] Update error:", error);
        return new Response("Failed to update sale", { 
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Notify frontend via Supabase Realtime.
    // Broadcast to BOTH channel styles that the POS listens to:
    // - helcim-payment-{saleId}
    // - helcim-payment-SALE-{saleId}
    if (saleId) {
      const channelNames = [
        `helcim-payment-${saleId}`,
        `helcim-payment-SALE-${saleId}`,
      ];

      for (const channelName of channelNames) {
        const channel = supabase.channel(channelName);
        await channel.subscribe();

        const { error: sendError } = await channel.send({
          type: "broadcast",
          event: "payment_completed",
          payload: {
            saleId,
            invoiceNumber: invoiceNumber || saleId,
            transactionId,
            status: "completed",
            amount,
            deviceCode,
            cardType,
            lastFour,
            approvalCode,
            timestamp: new Date().toISOString()
          }
        });

        if (sendError) {
          console.error(`[Webhook] Realtime send error (${channelName}):`, sendError);
        } else {
          console.log(`[Webhook] Sent Realtime notification to channel: ${channelName}`);
        }

        await channel.unsubscribe();
      }
    }

    return new Response("Webhook processed", { 
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
    });

  } catch (err) {
    console.error("[Webhook] Error:", err);
    // Return 200 even on error so Helcim doesn't retry invalid requests
    return new Response("OK", { 
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
    });
  }
});

