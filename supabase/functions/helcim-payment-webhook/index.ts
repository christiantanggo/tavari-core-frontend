// supabase/functions/helcim-payment-webhook/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { finalizePendingBooking } from "../_shared/bookingFinalization.ts";
import { finalizeKioskPendingPayment } from "../_shared/kioskHelcimFinalization.ts";
import { finalizePendingInvoice } from "../_shared/invoiceHelcimFinalization.ts";
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

const normalizeWebhookStatus = (status: any) => {
  const text = String(status || '').trim().toUpperCase();

  if (!text) return 'pending';
  if (text.includes('APPROVED') || text.includes('SUCCESS') || text.includes('COMPLETED')) return 'completed';
  if (text.includes('CANCEL') || text.includes('VOID') || text.includes('ABORT')) return 'cancelled';
  if (text.includes('DECLIN') || text.includes('FAIL') || text.includes('ERROR')) return 'failed';

  return 'pending';
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

    console.log("[Webhook] Received Helcim webhook:", JSON.stringify(body, null, 2));

    // Helcim webhook format — HelcimPay / new APIs nest fields under data.transaction, etc.
    const eventType = body?.event || body?.type || body?.eventType || body?.event_type;
    let transactionId =
      body?.transactionId ||
      body?.transaction?.transactionId ||
      body?.transaction_id ||
      body?.id ||
      body?.data?.transactionId ||
      body?.data?.transaction?.transactionId ||
      body?.data?.id;
    let invoiceNumber =
      body?.invoiceNumber ||
      body?.invoice?.number ||
      body?.invoice_number ||
      body?.reference ||
      body?.data?.invoiceNumber ||
      body?.data?.invoice?.number ||
      body?.transaction?.invoiceNumber ||
      body?.transaction?.invoice?.number;
    let status =
      body?.status ||
      body?.transaction?.status ||
      body?.transaction_status ||
      body?.result ||
      body?.data?.status ||
      body?.data?.transaction?.status ||
      body?.paymentStatus ||
      body?.payment_status;
    let amount =
      body?.amount ||
      body?.transaction?.amount ||
      body?.transactionAmount ||
      body?.transaction_amount ||
      body?.data?.amount ||
      body?.data?.transaction?.amount;
    const deviceCode = body?.deviceCode || body?.device?.code || body?.data?.deviceCode;
    const cardType = body?.cardType || body?.card?.type || body?.data?.cardType;
    const lastFour =
      body?.lastFour ||
      body?.card?.lastFour ||
      body?.cardNumber?.slice(-4) ||
      body?.data?.lastFour;
    let approvalCode =
      body?.approvalCode ||
      body?.approval?.code ||
      body?.approval_code ||
      body?.data?.approvalCode ||
      body?.transaction?.approvalCode;
    const customerCode =
      body?.customerCode ||
      body?.customer_code ||
      body?.data?.customerCode ||
      body?.data?.customer_code ||
      body?.transaction?.customerCode ||
      body?.transaction?.customer_code ||
      null;

    // Legacy format support (saleReference)
    const saleReference = body?.saleReference || body?.sale_reference || body?.data?.saleReference;

    // Completed HelcimPay webhooks sometimes omit status when invoice + transaction id are present.
    if (
      transactionId &&
      typeof invoiceNumber === "string" &&
      (invoiceNumber.startsWith("BP-") || invoiceNumber.startsWith("KK-") || invoiceNumber.startsWith("IP-")) &&
      !status
    ) {
      status = "APPROVED";
    }

    console.log("[Webhook] Parsed:", { eventType, transactionId, invoiceNumber, status, saleReference });

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

    // Customer portal bookings (invoice BP-{pendingUuid}) must finalize even when eventType is e.g.
    // "payment.completed" — before the generic filter that required "transaction"/"card" in the name.
    const bpPrefix = "BP-";
    if (typeof invoiceNumber === "string" && invoiceNumber.startsWith(bpPrefix)) {
      const normalizedBp = normalizeWebhookStatus(status);
      const approvedExplicit =
        normalizedBp === "completed" ||
        (typeof status === "string" &&
          ["APPROVED", "SUCCESS", "COMPLETED"].some((s) => status.toUpperCase().includes(s)));
      if (!approvedExplicit) {
        console.log("[Webhook] BP booking webhook not approved, status:", status);
        return new Response("Payment not approved", {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "text/plain" },
        });
      }
      const pendingId = invoiceNumber.slice(bpPrefix.length);
      const finalizedBp = await finalizePendingBooking({
        supabase,
        pendingId,
        transactionId: transactionId ? String(transactionId) : null,
        amount,
        approvalCode: approvalCode ? String(approvalCode) : null,
        customerCode: customerCode ? String(customerCode) : null,
        recoverPaidCheckout: true,
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
      console.warn("[Webhook] BP finalize returned 404 — falling through for diagnostics");
    }

    const kkPrefix = "KK-";
    if (typeof invoiceNumber === "string" && invoiceNumber.startsWith(kkPrefix)) {
      const normalizedKk = normalizeWebhookStatus(status);
      const approvedKk =
        normalizedKk === "completed" ||
        (typeof status === "string" &&
          ["APPROVED", "SUCCESS", "COMPLETED"].some((s) => status.toUpperCase().includes(s)));
      if (!approvedKk) {
        console.log("[Webhook] KK kiosk webhook not approved, status:", status);
        return new Response("Payment not approved", {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "text/plain" },
        });
      }
      const pendingKkId = invoiceNumber.slice(kkPrefix.length);
      const finalizedKk = await finalizeKioskPendingPayment({
        supabase,
        pendingId: pendingKkId,
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
      console.warn("[Webhook] KK finalize returned 404 — falling through for diagnostics");
    }

    const ipPrefix = "IP-";
    if (typeof invoiceNumber === "string" && invoiceNumber.startsWith(ipPrefix)) {
      const normalizedIp = normalizeWebhookStatus(status);
      const approvedIp =
        normalizedIp === "completed" ||
        (typeof status === "string" &&
          ["APPROVED", "SUCCESS", "COMPLETED"].some((s) => status.toUpperCase().includes(s)));
      if (!approvedIp) {
        console.log("[Webhook] IP invoice webhook not approved, status:", status);
        return new Response("Payment not approved", {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "text/plain" },
        });
      }
      const pendingIpId = invoiceNumber.slice(ipPrefix.length);
      const finalizedIp = await finalizePendingInvoice({
        supabase,
        pendingId: pendingIpId,
        transactionId: transactionId ? String(transactionId) : null,
        amount,
        approvalCode: approvalCode ? String(approvalCode) : null,
      });
      if (finalizedIp.ok) {
        return new Response("Invoice payment completed", {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "text/plain" },
        });
      }
      if (finalizedIp.status !== 404) {
        return new Response(finalizedIp.message, {
          status: finalizedIp.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.warn("[Webhook] IP finalize returned 404 — falling through for diagnostics");
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

      // Prefer `payment_status` as the source of truth; keep `is_paid` if your schema has it.
      // If one of these columns doesn't exist, retry without it.
      const baseUpdate: any = { 
        updated_at: new Date().toISOString(),
        payment_status: 'completed',
        is_paid: true
      };

      let updateError: any = null;
      {
        const { error } = await supabase
          .from("pos_sales")
          .update(baseUpdate)
          .eq("id", saleId)
          .eq("business_id", businessId);
        updateError = error;
      }

      if (updateError) {
        // Retry without `is_paid`
        const retryUpdate: any = { ...baseUpdate };
        delete retryUpdate.is_paid;
        const { error: retryError } = await supabase
          .from("pos_sales")
          .update(retryUpdate)
          .eq("id", saleId)
          .eq("business_id", businessId);
        updateError = retryError;
      }

      if (updateError) {
        // Retry without `payment_status`
        const retryUpdate: any = { ...baseUpdate };
        delete retryUpdate.payment_status;
        const { error: retryError } = await supabase
          .from("pos_sales")
          .update(retryUpdate)
          .eq("id", saleId)
          .eq("business_id", businessId);
        updateError = retryError;
      }

      if (updateError) {
        console.error("[Webhook] Update error:", updateError);
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
    const normalizedPaymentStatus = normalizeWebhookStatus(status);
    const isApproved = normalizedPaymentStatus === 'completed';

    if (!isApproved) {
      const looksLikePosSale = typeof invoiceNumber === "string" && (
        invoiceNumber.startsWith("SALE-") ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceNumber)
      );

      if (!looksLikePosSale || normalizedPaymentStatus === 'pending') {
      console.log("[Webhook] Payment not approved, status:", status);
      return new Response("Payment not approved", { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
      });
      }
    }

    if (!invoiceNumber && !transactionId) {
      console.log("[Webhook] Missing invoice number and transaction ID");
      return new Response("Missing invoice number or transaction ID", { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Extract saleId from invoiceNumber (format: "SALE-{saleId}" or just the saleId)
    let saleId = null;
    let businessId = null;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let normalizedInvoiceNumber = invoiceNumber || null;

    if (invoiceNumber) {
      if (invoiceNumber.startsWith("SALE-")) {
        saleId = invoiceNumber.replace("SALE-", "");
        normalizedInvoiceNumber = invoiceNumber;
      } else {
        // If Helcim sends back the raw UUID as the "invoice number", treat it as the saleId.
        if (uuidRegex.test(invoiceNumber)) {
          saleId = invoiceNumber;
          normalizedInvoiceNumber = `SALE-${invoiceNumber}`;
        }

        // Try to find sale by invoiceNumber in database
        if (!saleId) {
          const { data: sale } = await supabase
            .from("pos_sales")
            .select("id, business_id")
            .eq("invoice_number", invoiceNumber)
            .maybeSingle();
          
          if (sale) {
            saleId = sale.id;
            businessId = sale.business_id;
            normalizedInvoiceNumber = `SALE-${sale.id}`;
          }
        }

        // If we have a saleId but not businessId yet, fetch it
        if (saleId && !businessId) {
          const { data: saleById } = await supabase
            .from("pos_sales")
            .select("id, business_id")
            .eq("id", saleId)
            .maybeSingle();
          if (saleById) {
            businessId = saleById.business_id;
          }
        }
      }
    }

    if (!isApproved) {
      const channelsToNotify = new Set<string>();
      if (invoiceNumber) channelsToNotify.add(`helcim-payment-${invoiceNumber}`);
      if (normalizedInvoiceNumber) channelsToNotify.add(`helcim-payment-${normalizedInvoiceNumber}`);
      if (saleId) channelsToNotify.add(`helcim-payment-${saleId}`);
      if (saleId) channelsToNotify.add(`helcim-payment-SALE-${saleId}`);

      for (const channelName of channelsToNotify) {
        await supabase
          .channel(channelName)
          .send({
            type: "broadcast",
            event: "payment_completed",
            payload: {
              invoiceNumber: normalizedInvoiceNumber || invoiceNumber,
              rawInvoiceNumber: invoiceNumber,
              transactionId,
              status: normalizedPaymentStatus,
              amount,
              deviceCode,
              cardType,
              lastFour,
              approvalCode,
              saleId,
              businessId,
              message:
                normalizedPaymentStatus === 'cancelled'
                  ? 'Payment was cancelled on the terminal'
                  : 'Payment failed on the terminal',
              timestamp: new Date().toISOString()
            }
          });
      }

      return new Response("Webhook processed", {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
      });
    }

    // Update sale if we found it
    if (saleId) {
      const updateData: any = {
        payment_status: 'completed',
        is_paid: true,
        updated_at: new Date().toISOString()
      };

      // Store Helcim fields (columns added via SQL migration)
      if (transactionId) updateData.helcim_transaction_id = String(transactionId);
      if (approvalCode) updateData.helcim_approval_code = String(approvalCode);
      if (deviceCode) updateData.helcim_device_code = String(deviceCode);

      // Try update with both `payment_status` and `is_paid`, but gracefully fallback if columns differ.
      let { error } = await supabase
        .from("pos_sales")
        .update(updateData)
        .eq("id", saleId);

      if (error) {
        const retry1 = { ...updateData };
        delete retry1.is_paid;
        const { error: retryError } = await supabase
          .from("pos_sales")
          .update(retry1)
          .eq("id", saleId);
        error = retryError;
      }

      if (error) {
        const retry2 = { ...updateData };
        delete retry2.payment_status;
        const { error: retryError } = await supabase
          .from("pos_sales")
          .update(retry2)
          .eq("id", saleId);
        error = retryError;
      }

      if (error) {
        console.error("[Webhook] Update error:", error);
        return new Response("Failed to update sale", { 
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Notify frontend via Supabase Realtime using invoiceNumber/saleId channels
    {
      const channelsToNotify = new Set<string>();
      if (invoiceNumber) channelsToNotify.add(`helcim-payment-${invoiceNumber}`);
      if (normalizedInvoiceNumber) channelsToNotify.add(`helcim-payment-${normalizedInvoiceNumber}`);
      if (saleId) channelsToNotify.add(`helcim-payment-${saleId}`);
      if (saleId) channelsToNotify.add(`helcim-payment-SALE-${saleId}`);

      for (const channelName of channelsToNotify) {
        await supabase
          .channel(channelName)
          .send({
            type: "broadcast",
            event: "payment_completed",
            payload: {
              invoiceNumber: normalizedInvoiceNumber || invoiceNumber,
              rawInvoiceNumber: invoiceNumber,
              transactionId,
              status: "completed",
              amount,
              deviceCode,
              cardType,
              lastFour,
              approvalCode,
              saleId,
              businessId,
              timestamp: new Date().toISOString()
            }
          });
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
