 
// functions/mail-send/index.ts
// Deno (Supabase Edge Functions) + AWS SES v2

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  SESv2Client,
  SendEmailCommand
} from "npm:@aws-sdk/client-sesv2@3.654.0";
import {
  SESClient,
  SendRawEmailCommand
} from "npm:@aws-sdk/client-ses@3.654.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  AWS_REGION,
  SES_ACCESS_KEY_ID,
  SES_SECRET_ACCESS_KEY
} = Deno.env.toObject();

const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

const ses = new SESv2Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: SES_ACCESS_KEY_ID!,
    secretAccessKey: SES_SECRET_ACCESS_KEY!
  }
});

// SES v1 client for Raw email (needed for attachments)
const sesV1 = new SESClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: SES_ACCESS_KEY_ID!,
    secretAccessKey: SES_SECRET_ACCESS_KEY!
  }
});

type Attachment = {
  filename: string;
  content: string; // base64 encoded
  contentType: string;
};

type SendPayload = {
  businessId: string;
  campaignId: string;
  contactId: string;
  to: string;
  fromEmail: string;
  fromName?: string;
  subject: string;
  html: string;
  text?: string;
  configurationSet?: string;
  attachments?: Attachment[];
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {

    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    }

    const payload = (await req.json()) as SendPayload;

    // CRITICAL: Check for attachments IMMEDIATELY after parsing
    // This must happen before any other processing
    const hasAttachments = !!(payload.attachments && 
                               Array.isArray(payload.attachments) && 
                               payload.attachments.length > 0);

    console.log('[mail-send] Received payload:', {
      businessId: payload.businessId,
      fromEmail: payload.fromEmail,
      fromName: payload.fromName,
      to: payload.to,
      subject: payload.subject,
      hasFromName: !!payload.fromName,
      fromNameValue: payload.fromName,
      'ATTACHMENTS CHECK (IMMEDIATE)': {
        'payload.attachments exists': !!payload.attachments,
        'payload.attachments type': typeof payload.attachments,
        'is array': Array.isArray(payload.attachments),
        'length': Array.isArray(payload.attachments) ? payload.attachments.length : 'N/A',
        'hasAttachments': hasAttachments,
        'attachment details': hasAttachments ? payload.attachments.map(a => ({
          filename: a.filename,
          contentType: a.contentType,
          hasContent: !!a.content,
          contentLength: a.content?.length || 0
        })) : 'NO ATTACHMENTS'
      },
      allPayloadKeys: Object.keys(payload)
    });

    // Basic validation
    for (const k of ["businessId","campaignId","contactId","to","fromEmail","subject","html"]) {
      // @ts-ignore
      if (!payload[k]) return new Response(`Missing ${k}`, { status: 400, headers: corsHeaders });
    }

    // 1) Compliance gate: block unsubscribed emails
    const { data: unsub } = await supabase.rpc("is_email_unsubscribed", {
      p_business_id: payload.businessId,
      p_email: payload.to
    });
    if (unsub === true) {
      return new Response("Contact is unsubscribed", {
        status: 409,
        headers: corsHeaders
      });
    }

    // 1b) Deliverability gate: block suppressed/bounced emails
    const { data: suppressed } = await supabase.rpc("is_email_suppressed", {
      p_business_id: payload.businessId,
      p_email: payload.to
    });
    if (suppressed === true) {
      await supabase.from("mail_campaign_sends").insert({
        campaign_id: payload.campaignId,
        contact_id: payload.contactId,
        email_address: payload.to,
        status: "suppressed",
        sent_at: new Date().toISOString(),
        error_message: "Email suppressed due to previous hard bounce or complaint"
      });
      return new Response("Contact is suppressed", {
        status: 409,
        headers: corsHeaders
      });
    }

    // 2) Format from address with display name if provided
    // AWS SES v2 FromEmailAddress should just be the email address
    // Display name needs to be added to email headers in the HTML
    console.log('[mail-send] Formatting from address:', {
      'payload.fromName exists': !!payload.fromName,
      'payload.fromName value': payload.fromName,
      'payload.fromEmail': payload.fromEmail
    });
    
    // For FromEmailAddress, use just the email (AWS SES v2 requirement)
    const fromEmailAddress = payload.fromEmail;
    
    // Add display name to email headers if provided
    let htmlWithHeaders = payload.html;
    if (payload.fromName) {
      // Add From header to HTML email content
      // Look for existing <head> tag or create one
      if (htmlWithHeaders.includes('<head>')) {
        htmlWithHeaders = htmlWithHeaders.replace(
          '<head>',
          `<head><meta name="From" content="${payload.fromName} <${payload.fromEmail}>">`
        );
      } else if (htmlWithHeaders.includes('<html>')) {
        htmlWithHeaders = htmlWithHeaders.replace(
          '<html>',
          `<html><head><meta name="From" content="${payload.fromName} <${payload.fromEmail}>"></head>`
        );
      } else {
        // No HTML structure, wrap it
        htmlWithHeaders = `<!DOCTYPE html><html><head><meta name="From" content="${payload.fromName} <${payload.fromEmail}>"></head><body>${htmlWithHeaders}</body></html>`;
      }
    }

    console.log('[mail-send] Formatted email:', {
      fromEmailAddress,
      fromEmail: payload.fromEmail,
      fromName: payload.fromName,
      to: payload.to,
      'will use display name': !!payload.fromName,
      'html includes From header': htmlWithHeaders.includes('name="From"')
    });

    // 3) Use the hasAttachments variable we already checked above
    // The check happens immediately after parsing the payload
    // This ensures we detect attachments before any other processing
    
    // Send via SES v2
    // AWS SES v2 FromEmailAddress supports: "Display Name" <email@domain.com>
    // Try putting display name directly in FromEmailAddress (as per AWS docs)
    const finalFromAddress = payload.fromName
      ? `"${payload.fromName}" <${payload.fromEmail}>`
      : fromEmailAddress;

    if (hasAttachments) {
      console.log('[mail-send] Using Raw email format for attachments:', {
        attachmentCount: payload.attachments.length,
        attachments: payload.attachments.map(a => ({
          filename: a.filename,
          contentType: a.contentType,
          contentLength: a.content?.length || 0
        }))
      });
      
      // Generate boundary for multipart message
      const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      
      // Build multipart MIME message
      let rawMessage = `From: ${finalFromAddress}\r\n`;
      rawMessage += `To: ${payload.to}\r\n`;
      rawMessage += `Subject: ${payload.subject}\r\n`;
      rawMessage += `MIME-Version: 1.0\r\n`;
      rawMessage += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n`;
      rawMessage += `\r\n`;
      
      // Add text/plain part
      rawMessage += `--${boundary}\r\n`;
      rawMessage += `Content-Type: text/plain; charset=UTF-8\r\n`;
      rawMessage += `Content-Transfer-Encoding: 7bit\r\n`;
      rawMessage += `\r\n`;
      rawMessage += payload.text || payload.html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
      rawMessage += `\r\n\r\n`;
      
      // Add text/html part
      rawMessage += `--${boundary}\r\n`;
      rawMessage += `Content-Type: text/html; charset=UTF-8\r\n`;
      rawMessage += `Content-Transfer-Encoding: 7bit\r\n`;
      rawMessage += `\r\n`;
      rawMessage += htmlWithHeaders;
      rawMessage += `\r\n\r\n`;
      
      // Add attachments
      for (const attachment of payload.attachments) {
        if (!attachment.content || !attachment.filename || !attachment.contentType) {
          console.error('[mail-send] Invalid attachment format:', {
            hasContent: !!attachment.content,
            hasFilename: !!attachment.filename,
            hasContentType: !!attachment.contentType,
            attachment: attachment
          });
          throw new Error(`Invalid attachment format: missing content, filename, or contentType`);
        }
        
        // Validate base64 content
        const base64Content = attachment.content.replace(/\s/g, ''); // Remove whitespace
        const isValidBase64 = /^[A-Za-z0-9+/]*={0,2}$/.test(base64Content);
        
        console.log('[mail-send] Adding attachment:', {
          filename: attachment.filename,
          contentType: attachment.contentType,
          contentLength: attachment.content.length,
          base64Length: base64Content.length,
          isValidBase64: isValidBase64,
          contentPreview: attachment.content.substring(0, 50) + '...',
          base64Preview: base64Content.substring(0, 50) + '...',
          base64End: '...' + base64Content.substring(base64Content.length - 50)
        });
        
        if (!isValidBase64) {
          console.error('[mail-send] WARNING: Base64 content appears invalid!');
        }
        
        rawMessage += `--${boundary}\r\n`;
        rawMessage += `Content-Type: ${attachment.contentType}; name="${attachment.filename}"\r\n`;
        rawMessage += `Content-Disposition: attachment; filename="${attachment.filename}"\r\n`;
        rawMessage += `Content-Transfer-Encoding: base64\r\n`;
        rawMessage += `\r\n`;
        
        // Base64 content must be chunked at 76 characters per line for proper MIME encoding (RFC 2045)
        // CRITICAL: Chunk properly to avoid corrupting base64 content
        // AWS SES can handle base64 content, but proper chunking ensures compatibility
        let chunkedBase64 = '';
        for (let i = 0; i < base64Content.length; i += 76) {
          if (i > 0) chunkedBase64 += '\r\n';
          chunkedBase64 += base64Content.substring(i, Math.min(i + 76, base64Content.length));
        }
        
        console.log('[mail-send] Base64 chunking:', {
          originalLength: base64Content.length,
          chunkedLength: chunkedBase64.length,
          expectedChunks: Math.ceil(base64Content.length / 76),
          first76Chars: base64Content.substring(0, 76),
          last76Chars: base64Content.substring(Math.max(0, base64Content.length - 76)),
          chunkedStartsWith: chunkedBase64.substring(0, 76),
          'base64 starts with PDF magic?': base64Content.startsWith('JVBERi0')
        });
        
        rawMessage += chunkedBase64;
        rawMessage += `\r\n`; // Line break after base64 content (required before next boundary)
      }
      
      // Close boundary
      rawMessage += `--${boundary}--\r\n`;
      
      // Log the raw message size and preview (for debugging)
      const rawMessageBytes = new TextEncoder().encode(rawMessage);
      
      // Find attachment section in raw message for debugging
      const attachmentSectionStart = rawMessage.indexOf('Content-Type: application/pdf');
      let attachmentSection = 'NOT FOUND';
      if (attachmentSectionStart > -1) {
        // Get more of the attachment section to see the full MIME structure
        attachmentSection = rawMessage.substring(attachmentSectionStart, Math.min(attachmentSectionStart + 1000, rawMessage.length));
      }
      
      // Also check if the base64 content is intact in the raw message
      const base64InRawMessage = attachmentSectionStart > -1 
        ? rawMessage.substring(attachmentSectionStart).match(/JVBERi0[^\r\n]*/)?.[0]?.substring(0, 100)
        : null;
      
      console.log('[mail-send] Raw message constructed:', {
        messageLength: rawMessage.length,
        messageBytesLength: rawMessageBytes.length,
        boundary: boundary,
        attachmentCount: payload.attachments.length,
        messagePreview: rawMessage.substring(0, 500) + '...',
        attachmentSectionStart: attachmentSectionStart,
        attachmentSectionPreview: attachmentSection.substring(0, 800) + '...',
        base64InRawMessage: base64InRawMessage,
        messageEnd: '...' + rawMessage.substring(rawMessage.length - 500)
      });
      
      // Send using Raw email (SES v1 client for attachments)
      // CRITICAL: RawMessage.Data must be a Uint8Array or Buffer
      const rawEmailCmd = new SendRawEmailCommand({
        RawMessage: {
          Data: rawMessageBytes
        },
        ...(payload.configurationSet ? { ConfigurationSetName: payload.configurationSet } : {})
      });
      
      console.log('[mail-send] Sending Raw email with attachments:', {
        hasRawMessage: !!rawEmailCmd.input.RawMessage,
        hasData: !!rawEmailCmd.input.RawMessage?.Data,
        dataLength: rawEmailCmd.input.RawMessage?.Data?.length || 0
      });
      
      const result = await sesV1.send(rawEmailCmd);
      
      console.log('[mail-send] Raw email sent successfully:', {
        MessageId: (result as any).MessageId,
        attachmentCount: payload.attachments.length,
        attachments: payload.attachments.map(a => a.filename),
        result: result
      });
      
      // Record the send
      await supabase
        .from("mail_campaign_sends")
        .insert({
          campaign_id: payload.campaignId,
          contact_id: payload.contactId,
          email_address: payload.to,
          status: "sent",
          sent_at: new Date().toISOString(),
          message_id: (result as any).MessageId ?? (result as any).$metadata?.requestId ?? null
        });

      const messageId = (result as any).MessageId || (result as any).$metadata?.requestId || null;
      
      const responseData = {
        ok: true,
        messageId: messageId,
        fromEmail: payload.fromEmail,
        fromName: payload.fromName || null,
        fromAddress: finalFromAddress,
        hasDisplayName: !!payload.fromName,
        hasAttachments: true,
        attachmentCount: payload.attachments.length,
        usedRawFormat: true
      };
      
      console.log('[mail-send] Returning Raw email response:', JSON.stringify(responseData, null, 2));
      console.log('[mail-send] Raw email response data types:', {
        ok: typeof responseData.ok,
        messageId: typeof responseData.messageId,
        fromAddress: typeof responseData.fromAddress,
        fromEmail: typeof responseData.fromEmail,
        fromName: typeof responseData.fromName,
        hasAttachments: typeof responseData.hasAttachments,
        attachmentCount: typeof responseData.attachmentCount,
        usedRawFormat: typeof responseData.usedRawFormat
      });
      
      return new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" }
      });
    }

    // No attachments - use Simple format
    const sendCmdInput: any = {
      Destination: { ToAddresses: [payload.to] },
      FromEmailAddress: finalFromAddress, // Include display name directly in FromEmailAddress
      Content: {
        Simple: {
          Subject: { Data: payload.subject },
          Body: {
            Html: { Data: htmlWithHeaders },
            ...(payload.text ? { Text: { Data: payload.text } } : {})
          }
        }
      }
    };

    // Add configuration set if provided
    if (payload.configurationSet) {
      sendCmdInput.ConfigurationSetName = payload.configurationSet;
    }

    const sendCmd = new SendEmailCommand(sendCmdInput);
    
    console.log('[mail-send] SendEmailCommand input:', {
      FromEmailAddress: sendCmd.input.FromEmailAddress,
      'FromEmailAddress format': sendCmd.input.FromEmailAddress,
      'FromEmailAddress length': sendCmd.input.FromEmailAddress?.length,
      Destination: sendCmd.input.Destination?.ToAddresses
    });

    const result = await ses.send(sendCmd);

    console.log('[mail-send] SES send result:', {
      MessageId: (result as any).MessageId,
      $metadata: (result as any).$metadata,
      'Request sent with FromEmailAddress': sendCmd.input.FromEmailAddress,
      'FromEmailAddress in result': (result as any).FromEmailAddress
    });

    // 4) Record the send
    await supabase
      .from("mail_campaign_sends")
      .insert({
        campaign_id: payload.campaignId,
        contact_id: payload.contactId,
        email_address: payload.to,
        status: "sent",
        sent_at: new Date().toISOString(),
        message_id: (result as any).MessageId ?? (result as any).$metadata?.requestId ?? null
      });

    // Build response with all debug info
    const messageId = (result as any).MessageId || (result as any).$metadata?.requestId || null;
    
    // WARNING: If we reach here, we used Simple format (no attachments)
    // But check if attachments were actually present - this is a bug if true!
    const hadAttachments = !!(payload.attachments && Array.isArray(payload.attachments) && payload.attachments.length > 0);
    if (hadAttachments) {
      console.error('[mail-send] CRITICAL BUG: Attachments were present but Simple format was used!', {
        attachmentCount: payload.attachments.length,
        attachments: payload.attachments.map(a => a.filename),
        hasAttachmentsCheck: hasAttachments,
        'why did check fail?': {
          'payload.attachments exists': !!payload.attachments,
          'is array': Array.isArray(payload.attachments),
          'length': payload.attachments?.length || 0,
          hasAttachments
        }
      });
    }
    
    const responseData = {
      ok: true,
      messageId: messageId,
      fromEmail: payload.fromEmail,
      fromName: payload.fromName || null,
      fromAddress: finalFromAddress,
      hasDisplayName: !!payload.fromName,
      hasAttachments: false,
      attachmentCount: 0,
      usedSimpleFormat: true,
      hadAttachmentsInPayload: hadAttachments // Debug flag
    };
    
    console.log('[mail-send] Returning response:', JSON.stringify(responseData, null, 2));
    console.log('[mail-send] Response data types:', {
      ok: typeof responseData.ok,
      messageId: typeof responseData.messageId,
      fromAddress: typeof responseData.fromAddress,
      fromEmail: typeof responseData.fromEmail,
      fromName: typeof responseData.fromName,
      hasAttachments: typeof responseData.hasAttachments,
      attachmentCount: typeof responseData.attachmentCount,
      usedSimpleFormat: typeof (responseData as any).usedSimpleFormat,
      hadAttachmentsInPayload: typeof (responseData as any).hadAttachmentsInPayload
    });

    const responseBody = JSON.stringify(responseData);
    console.log('[mail-send] Response body length:', responseBody.length);
    console.log('[mail-send] Response body preview:', responseBody.substring(0, 200));

    return new Response(responseBody, {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" }
    });
  } catch (e) {
    // Log error in DB for visibility
    try {
      const body = await req.text().catch(() => "");
      await supabase.from("mail_error_logs").insert({
        business_id: null,
        campaign_id: null,
        contact_id: null,
        contact_email: null,
        error_type: "mail_send_error",
        error_message: String(e?.message ?? e),
        status: "failed",
        severity: "high",
        metadata: { requestBody: body }
      });
    } catch (_ignored) {}
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" }
    });
  }
});