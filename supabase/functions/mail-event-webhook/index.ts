// supabase/functions/mail-event-webhook/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { createVerify, X509Certificate } from "node:crypto";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MAIL_EVENT_SNS_TOPIC_ARN } = Deno.env.toObject();

const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
const SNS_CERT_HOST_REGEX = /^sns\.[a-z0-9-]+\.amazonaws\.com$/i;

const getAllowedTopicArns = () =>
  String(MAIL_EVENT_SNS_TOPIC_ARN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const isAllowedTopicArn = (topicArn: unknown) => {
  const normalized = String(topicArn || "").trim();
  if (!normalized) return false;

  const allowed = getAllowedTopicArns();
  if (allowed.length === 0) {
    return true;
  }

  return allowed.includes(normalized);
};

const isValidSigningCertUrl = (value: unknown) => {
  try {
    const url = new URL(String(value || ""));
    return (
      url.protocol === "https:" &&
      SNS_CERT_HOST_REGEX.test(url.hostname) &&
      url.pathname.startsWith("/SimpleNotificationService-") &&
      url.pathname.endsWith(".pem")
    );
  } catch {
    return false;
  }
};

const buildSnsStringToSign = (body: Record<string, unknown>) => {
  const type = String(body?.Type || "").trim();
  const fields =
    type === "Notification"
      ? ["Message", "MessageId", "Subject", "Type", "Timestamp", "TopicArn"]
      : type === "SubscriptionConfirmation" || type === "UnsubscribeConfirmation"
        ? ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"]
        : null;

  if (!fields) return null;

  const lines: string[] = [];
  for (const field of fields) {
    const value = body[field];
    if (field === "Subject" && (value === undefined || value === null || value === "")) {
      continue;
    }
    if (value === undefined || value === null) {
      return null;
    }
    lines.push(field, String(value));
  }

  return `${lines.join("\n")}\n`;
};

const verifySnsSignature = async (body: Record<string, unknown>) => {
  const signature = String(body?.Signature || "").trim();
  const signatureVersion = String(body?.SignatureVersion || "").trim();
  const signingCertUrl = String(body?.SigningCertURL || "").trim();
  const stringToSign = buildSnsStringToSign(body);

  if (!signature || !stringToSign || !isValidSigningCertUrl(signingCertUrl)) {
    return false;
  }

  const algorithm =
    signatureVersion === "2" ? "RSA-SHA256" :
    signatureVersion === "1" ? "RSA-SHA1" :
    null;

  if (!algorithm) {
    return false;
  }

  const certResponse = await fetch(signingCertUrl);
  if (!certResponse.ok) {
    return false;
  }

  const certPem = await certResponse.text();
  const cert = new X509Certificate(certPem);
  const verifier = createVerify(algorithm);
  verifier.update(stringToSign, "utf8");
  verifier.end();

  return verifier.verify(cert.publicKey, signature, "base64");
};

const suppressMarketingEmail = async ({
  businessId,
  email,
  source,
}: {
  businessId?: string | null;
  email?: string | null;
  source: string;
}) => {
  const normalizedBusinessId = String(businessId || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedBusinessId || !normalizedEmail) return;

  const nowIso = new Date().toISOString();

  let contactId: string | null = null;

  try {
    const { data: contact } = await supabase
      .from("mail_contacts")
      .select("id")
      .eq("business_id", normalizedBusinessId)
      .eq("email", normalizedEmail)
      .maybeSingle();

    contactId = contact?.id ?? null;

    if (contactId) {
      const { error: updateError } = await supabase
        .from("mail_contacts")
        .update({
          subscribed: false,
          unsubscribed_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", contactId)
        .eq("business_id", normalizedBusinessId);

      if (updateError) {
        console.error("mail_contacts suppression update failed:", updateError);
      }
    }

    const { error: unsubscribeError } = await supabase
      .from("mail_unsubscribes")
      .upsert(
        {
          business_id: normalizedBusinessId,
          email: normalizedEmail,
          contact_id: contactId,
          unsubscribed_at: nowIso,
          source,
        },
        {
          onConflict: "business_id,email",
        },
      );

    if (unsubscribeError) {
      console.error("mail_unsubscribes suppression upsert failed:", unsubscribeError);
    }
  } catch (error) {
    console.error("suppressMarketingEmail failed:", error);
  }
};

const confirmSubscription = async (url: string) => {
  try {
    await fetch(url);
  } catch (error) {
    console.error("Failed to confirm subscription:", error);
  }
};

function normalizeSesMessageId(id: unknown): string {
  return String(id ?? "").replace(/^<|>$/g, "").trim();
}

async function applySystemEmailLogSesEvent(input: {
  sesMessageId: string | null;
  recipientEmail: string;
  status: "bounced" | "complained" | "delivered" | "rejected";
  errorMessage: string | null;
  eventMetadata: Record<string, unknown>;
}) {
  const mid = normalizeSesMessageId(input.sesMessageId);
  const email = String(input.recipientEmail || "").trim().toLowerCase();
  if (!mid || !email) return;

  try {
    const { data, error } = await supabase.rpc("system_email_log_apply_ses_event", {
      p_ses_message_id: mid,
      p_recipient_email: email,
      p_status: input.status,
      p_error_message: input.errorMessage,
      p_event_metadata: input.eventMetadata,
    });
    if (error) {
      console.error("[mail-event-webhook] system_email_log_apply_ses_event failed:", error);
      return;
    }
    const n = typeof data === "number" ? data : Number(data ?? 0);
    if (!Number.isFinite(n) || n === 0) {
      console.log("[mail-event-webhook] system_email_log_apply_ses_event: no matching row", {
        sesMessageId: mid,
        recipientEmail: email,
        status: input.status,
      });
    }
  } catch (error) {
    console.error("[mail-event-webhook] system_email_log_apply_ses_event exception:", error);
  }
}

function formatBounceExplanation(payload: any, recipient: any): string {
  const bounce = payload?.bounce || {};
  const lines: string[] = ["The recipient mail server returned a bounce (message was not delivered)."];
  if (bounce.bounceType) lines.push(`Bounce type: ${bounce.bounceType}.`);
  if (bounce.bounceSubType) lines.push(`Bounce subtype: ${bounce.bounceSubType}.`);
  if (recipient?.action) lines.push(`SMTP action: ${recipient.action}.`);
  if (recipient?.status) lines.push(`SMTP status: ${recipient.status}.`);
  if (recipient?.diagnosticCode) lines.push(`Diagnostic: ${recipient.diagnosticCode}`);
  return lines.join(" ");
}

function formatComplaintExplanation(payload: any, complaint: any): string {
  const lines: string[] = ["A recipient or mailbox provider reported this message as abusive (complaint / feedback loop)."];
  if (complaint?.complaintFeedbackType) lines.push(`Feedback type: ${complaint.complaintFeedbackType}.`);
  if (complaint?.complaintSubType) lines.push(`Subtype: ${complaint.complaintSubType}.`);
  return lines.join(" ");
}

function formatDeliveryExplanation(payload: any): string | null {
  const d = payload?.delivery;
  if (!d) return null;
  if (d.smtpResponse) return `Recipient MX accepted the message (SMTP response: ${d.smtpResponse}).`;
  if (d.reportingMTA) return `Recipient MX accepted the message (reporting MTA: ${d.reportingMTA}).`;
  return "Recipient MX accepted the message (SES delivery event).";
}

const handleBounce = async (payload: any) => {
  const bounce = payload.bounce;
  if (!bounce || !Array.isArray(bounce.bouncedRecipients)) return;

  await Promise.all(
    bounce.bouncedRecipients.map(async (recipient: any) => {
      const email = recipient?.emailAddress;
      if (!email) return;
      const sesMessageId = payload?.mail?.messageId ?? null;
      const businessId = payload?.mail?.tags?.business_id?.[0] ?? null;
      const bounceReason =
        recipient?.diagnosticCode ??
        bounce?.reportingMTA ??
        "Bounce reported by SES";
      const bounceType = String(bounce.bounceType || "").trim().toLowerCase();
      try {
        const { error: updateError } = await supabase
          .from("mail_campaign_sends")
          .update({
            status: "bounced",
            error_message: bounceReason,
          })
          .eq("ses_message_id", sesMessageId)
          .eq("email_address", email);

        if (updateError) {
          console.error("mail_campaign_sends bounce update failed, inserting fallback row:", updateError);

          await supabase
            .from("mail_campaign_sends")
            .insert({
              campaign_id: payload?.mail?.tags?.campaign_id?.[0] ?? null,
              contact_id: null,
              rollout_id: payload?.mail?.tags?.rollout_id?.[0] ?? null,
              rollout_batch_id: payload?.mail?.tags?.rollout_batch_id?.[0] ?? null,
              email_address: email,
              status: "bounced",
              sent_at: new Date().toISOString(),
              error_message: bounceReason,
              ses_message_id: sesMessageId,
            });
        }

        if (bounceType === "permanent" || bounceType === "undetermined") {
          await suppressMarketingEmail({
            businessId,
            email,
            source: "auto_bounce",
          });
        }

        await supabase.rpc("handle_email_bounce", {
          p_business_id: businessId,
          p_campaign_id: payload?.mail?.tags?.campaign_id?.[0] ?? null,
          p_email_address: email,
          p_ses_message_id: sesMessageId,
          p_bounce_type: bounce.bounceType ?? "hard",
          p_bounce_reason: bounceReason,
          p_bounce_subtype: bounce.bounceSubType ?? null,
        });
      } catch (error) {
        console.error("handle_email_bounce failed:", error);
      }

      await applySystemEmailLogSesEvent({
        sesMessageId,
        recipientEmail: email,
        status: "bounced",
        errorMessage: formatBounceExplanation(payload, recipient),
        eventMetadata: {
          ses_delivery: {
            event: "Bounce",
            bounceType: bounce.bounceType ?? null,
            bounceSubType: bounce.bounceSubType ?? null,
            diagnosticCode: recipient?.diagnosticCode ?? null,
            action: recipient?.action ?? null,
            status: recipient?.status ?? null,
          },
        },
      });
    })
  );
};

const handleComplaint = async (payload: any) => {
  const complaint = payload.complaint;
  if (!complaint || !Array.isArray(complaint.complainedRecipients)) return;

  await Promise.all(
    complaint.complainedRecipients.map(async (recipient: any) => {
      const email = recipient?.emailAddress;
      if (!email) return;
      const sesMessageId = payload?.mail?.messageId ?? null;
      const businessId = payload?.mail?.tags?.business_id?.[0] ?? null;
      const complaintType = complaint.complaintFeedbackType ?? "Complaint reported by SES";
      try {
        const { error: updateError } = await supabase
          .from("mail_campaign_sends")
          .update({
            status: "failed",
            error_message: complaintType,
          })
          .eq("ses_message_id", sesMessageId)
          .eq("email_address", email);

        if (updateError) {
          console.error("mail_campaign_sends complaint update failed, inserting fallback row:", updateError);

          await supabase
            .from("mail_campaign_sends")
            .insert({
              campaign_id: payload?.mail?.tags?.campaign_id?.[0] ?? null,
              contact_id: null,
              rollout_id: payload?.mail?.tags?.rollout_id?.[0] ?? null,
              rollout_batch_id: payload?.mail?.tags?.rollout_batch_id?.[0] ?? null,
              email_address: email,
              status: "failed",
              sent_at: new Date().toISOString(),
              error_message: complaintType,
              ses_message_id: sesMessageId,
            });
        }

        await suppressMarketingEmail({
          businessId,
          email,
          source: "auto_complaint",
        });

        await supabase.rpc("process_complaint_notification", {
          p_business_id: businessId,
          p_campaign_id: payload?.mail?.tags?.campaign_id?.[0] ?? null,
          p_email_address: email,
          p_ses_message_id: sesMessageId,
          p_complaint_type: complaint.complaintFeedbackType ?? null,
          p_raw_notification: payload,
        });
      } catch (error) {
        console.error("process_complaint_notification failed:", error);
      }

      await applySystemEmailLogSesEvent({
        sesMessageId,
        recipientEmail: email,
        status: "complained",
        errorMessage: formatComplaintExplanation(payload, complaint),
        eventMetadata: {
          ses_delivery: {
            event: "Complaint",
            complaintFeedbackType: complaint.complaintFeedbackType ?? null,
            complaintSubType: complaint.complaintSubType ?? null,
          },
        },
      });
    })
  );
};

const handleDelivery = async (payload: any) => {
  const sesMessageId = payload?.mail?.messageId;
  if (!sesMessageId) return;

  try {
    await supabase
      .from("mail_campaign_sends")
      .update({
        delivered_at: new Date().toISOString(),
      })
      .eq("ses_message_id", sesMessageId)
      .is("delivered_at", null);
  } catch (error) {
    console.error("mail delivery update failed:", error);
  }

  const delivery = payload?.delivery;
  const fromRecipients = Array.isArray(delivery?.recipients) ? delivery.recipients : [];
  const fromDestination = Array.isArray(payload?.mail?.destination) ? payload.mail.destination : [];
  const recipientList = fromRecipients.length > 0 ? fromRecipients : fromDestination;
  const note = formatDeliveryExplanation(payload);

  for (const rawEmail of recipientList) {
    const email = String(rawEmail || "").trim();
    if (!email) continue;
    await applySystemEmailLogSesEvent({
      sesMessageId,
      recipientEmail: email,
      status: "delivered",
      errorMessage: note,
      eventMetadata: {
        ses_delivery: {
          event: "Delivery",
          smtpResponse: delivery?.smtpResponse ?? null,
          reportingMTA: delivery?.reportingMTA ?? null,
          processingTimeMillis: delivery?.processingTimeMillis ?? null,
        },
      },
    });
  }
};

const handleReject = async (payload: any) => {
  const sesMessageId = normalizeSesMessageId(payload?.mail?.messageId);
  const reason = String(payload?.reject?.reason || "").trim() || "Rejected by Amazon SES before delivery.";
  const dest = Array.isArray(payload?.mail?.destination) ? payload.mail.destination : [];
  for (const rawEmail of dest) {
    const email = String(rawEmail || "").trim();
    if (!email) continue;
    await applySystemEmailLogSesEvent({
      sesMessageId,
      recipientEmail: email,
      status: "rejected",
      errorMessage: `Message was not accepted for delivery: ${reason}`,
      eventMetadata: {
        ses_delivery: {
          event: "Reject",
          reason,
        },
      },
    });
  }
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch (error) {
    console.error("Invalid JSON payload:", error);
    return new Response("Bad Request", { status: 400 });
  }

  const messageType = body?.Type;
  const signatureValid = await verifySnsSignature(body);

  if (!signatureValid) {
    console.error("Rejected unsigned or invalid SNS request");
    return new Response("Unauthorized", { status: 401 });
  }

  if (!isAllowedTopicArn(body?.TopicArn)) {
    console.error("Rejected SNS request for unexpected topic", body?.TopicArn);
    return new Response("Forbidden", { status: 403 });
  }

  if (messageType === "SubscriptionConfirmation") {
    if (getAllowedTopicArns().length === 0) {
      console.error("MAIL_EVENT_SNS_TOPIC_ARN is not configured; refusing auto-confirmation");
      return new Response("Forbidden", { status: 403 });
    }

    const subscribeUrl = body?.SubscribeURL;
    if (subscribeUrl) {
      await confirmSubscription(subscribeUrl);
    }
    return new Response("Subscription confirmed", { status: 200 });
  }

  if (messageType === "Notification") {
    let messageJson: any;
    try {
      messageJson = JSON.parse(body?.Message ?? "{}");
    } catch (error) {
      console.error("Failed to parse SNS message:", error);
      return new Response("Bad Request", { status: 400 });
    }

    const eventType = messageJson?.notificationType || messageJson?.eventType;

    if (eventType === "Bounce") {
      await handleBounce(messageJson);
    } else if (eventType === "Complaint") {
      await handleComplaint(messageJson);
    } else if (eventType === "Delivery") {
      await handleDelivery(messageJson);
    } else if (eventType === "Reject") {
      await handleReject(messageJson);
    } else {
      console.log("Unhandled SES event:", eventType);
    }

    return new Response("OK", { status: 200 });
  }

  return new Response("Ignored", { status: 200 });
});