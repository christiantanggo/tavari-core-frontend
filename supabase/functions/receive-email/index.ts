// supabase/functions/receive-email/index.ts
// AWS SES Incoming Email Webhook Handler
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { createVerify } from "node:crypto";
import {
  S3Client,
  GetObjectCommand
} from "npm:@aws-sdk/client-s3@3.654.0";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { emailBodyToPdf } from "../_shared/emailBodyToPdf.ts";

const { 
  SUPABASE_URL, 
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
  AWS_REGION,
  SES_ACCESS_KEY_ID,
  SES_SECRET_ACCESS_KEY,
  RECEIVE_EMAIL_WEBHOOK_SECRET,
  RECEIVE_EMAIL_SNS_TOPIC_ARN,
  AWS_SNS_TOPIC_ARN
} = Deno.env.toObject();

const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
const allowedSnsTopicArn = (RECEIVE_EMAIL_SNS_TOPIC_ARN || AWS_SNS_TOPIC_ARN || '').trim();
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-inbound-email-secret, x-webhook-secret",
};

// S3 client for fetching email content
const s3Client = new S3Client({
  region: AWS_REGION || 'us-east-2',
  credentials: SES_ACCESS_KEY_ID && SES_SECRET_ACCESS_KEY ? {
    accessKeyId: SES_ACCESS_KEY_ID,
    secretAccessKey: SES_SECRET_ACCESS_KEY
  } : undefined
});

interface SESReceipt {
  action: {
    type: string;
    topicArn?: string;
    bucketName?: string;
    objectKey?: string;
    functionArn?: string;
  };
  receipt: {
    timestamp: string;
    processingTimeMillis: number;
    recipients: string[];
    spamVerdict: { status: string };
    virusVerdict: { status: string };
    spfVerdict: { status: string };
    dkimVerdict: { status: string };
    dmarcVerdict: { status: string };
  };
  mail: {
    timestamp: string;
    source: string;
    messageId: string;
    destination: string[];
    headersTruncated: boolean;
    headers: Array<{ name: string; value: string }>;
    commonHeaders: {
      from: string[];
      to: string[];
      cc?: string[];
      bcc?: string[];
      subject?: string;
      date?: string;
      messageId?: string;
      returnPath?: string;
    };
  };
}

interface SNSMessage {
  Type: string;
  Message?: string;
  SubscribeURL?: string;
  Signature?: string;
  SignatureVersion?: string;
  SigningCertURL?: string;
  MessageId?: string;
  Subject?: string;
  Timestamp?: string;
  Token?: string;
  TopicArn?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function getBearerToken(req: Request): string {
  const authHeader = req.headers.get("Authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
}

function isInternalCaller(req: Request): boolean {
  const token = getBearerToken(req);
  return !!token && token === SUPABASE_SERVICE_ROLE_KEY;
}

function hasValidInboundWebhookSecret(req: Request): boolean {
  const configuredSecret = (RECEIVE_EMAIL_WEBHOOK_SECRET || "").trim();
  if (!configuredSecret) return false;
  const providedSecret = (
    req.headers.get("x-inbound-email-secret") ||
    req.headers.get("x-webhook-secret") ||
    getBearerToken(req)
  )?.trim();
  return !!providedSecret && providedSecret === configuredSecret;
}

async function createAuthenticatedUserClient(req: Request): Promise<{ client: ReturnType<typeof createClient>; userId: string } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !SUPABASE_ANON_KEY) return null;
  const client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } }
  });
  const { data: { user } } = await client.auth.getUser();
  if (!user?.id) return null;
  return { client, userId: user.id };
}

function buildSnsStringToSign(message: SNSMessage): string {
  const fields = message.Type === "Notification"
    ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
    : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  const lines: string[] = [];
  for (const field of fields) {
    const value = (message as Record<string, string | undefined>)[field];
    if (value != null && value !== "") {
      lines.push(field, value);
    }
  }
  return lines.join("\n") + "\n";
}

function isAllowedSigningCertUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:" && (
      host === "sns.amazonaws.com" ||
      /^sns\.[a-z0-9-]+\.amazonaws\.com$/i.test(host)
    );
  } catch {
    return false;
  }
}

async function verifySnsSignature(message: SNSMessage): Promise<boolean> {
  try {
    if (!message.Signature || !message.SigningCertURL || !message.SignatureVersion || !message.TopicArn) {
      return false;
    }
    if (allowedSnsTopicArn && message.TopicArn !== allowedSnsTopicArn) {
      console.warn("📧 SNS topic ARN mismatch", { received: message.TopicArn, expected: allowedSnsTopicArn });
      return false;
    }
    if (!isAllowedSigningCertUrl(message.SigningCertURL)) {
      console.warn("📧 Rejected SNS cert URL", message.SigningCertURL);
      return false;
    }
    const certRes = await fetch(message.SigningCertURL);
    if (!certRes.ok) {
      console.warn("📧 Failed to fetch SNS signing cert", certRes.status);
      return false;
    }
    const certPem = await certRes.text();
    const algorithm = message.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1";
    const verifier = createVerify(algorithm);
    verifier.update(buildSnsStringToSign(message), "utf8");
    verifier.end();
    return verifier.verify(certPem, message.Signature, "base64");
  } catch (error) {
    console.error("📧 SNS signature verification failed:", error);
    return false;
  }
}

// Parse email headers
function parseHeaders(headers: Array<{ name: string; value: string }>): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const header of headers) {
    const key = header.name.toLowerCase();
    if (parsed[key]) {
      parsed[key] += `, ${header.value}`;
    } else {
      parsed[key] = header.value;
    }
  }
  return parsed;
}

// Parse MIME header block (first line to blank line) into key-value map (lowercase keys)
function parseMimeHeaders(rawMime: string): Record<string, string> {
  const headerEnd = rawMime.indexOf('\r\n\r\n');
  const headerEndAlt = rawMime.indexOf('\n\n');
  const end = headerEnd >= 0 ? (headerEndAlt >= 0 ? Math.min(headerEnd, headerEndAlt) : headerEnd) : headerEndAlt;
  const headerBlock = end >= 0 ? rawMime.slice(0, end) : rawMime;
  const lines = headerBlock.split(/\r?\n/);
  const parsed: Record<string, string> = {};
  let currentKey = '';
  for (const line of lines) {
    if (/^\s/.test(line) && currentKey) {
      parsed[currentKey] = (parsed[currentKey] || '') + ' ' + line.trim();
    } else {
      const colon = line.indexOf(':');
      if (colon > 0) {
        currentKey = line.slice(0, colon).trim().toLowerCase();
        parsed[currentKey] = line.slice(colon + 1).trim();
      }
    }
  }
  return parsed;
}

// Build a minimal SES-shaped receipt from raw MIME so processEmailFromS3 can resolve inbox and store
function buildReceiptFromRawMime(rawMime: string): { mail: any; receipt: any } {
  const h = parseMimeHeaders(rawMime);
  const from = (h['from'] || '').trim() || 'unknown@unknown';
  const toRaw = (h['to'] || '').trim();
  const toAddresses = toRaw ? toRaw.split(/\s*,\s*/).map((a: string) => extractEmailAddress(a)) : [];
  const subject = (h['subject'] || '').trim() || '(No Subject)';
  const messageId = (h['message-id'] || '').trim() || `msg_${Date.now()}`;
  const date = (h['date'] || '').trim();
  return {
    mail: {
      source: from,
      messageId,
      destination: toAddresses,
      commonHeaders: {
        from: [from],
        to: toAddresses,
        subject,
        date: date || undefined
      },
      headers: []
    },
    receipt: {}
  };
}

// Extract email address from "Name <email@domain.com>" format
function extractEmailAddress(fullAddress: string): string {
  const match = fullAddress.match(/<([^>]+)>/);
  return match ? match[1] : fullAddress.trim();
}

// Extract name from "Name <email@domain.com>" format
function extractName(fullAddress: string): string {
  const match = fullAddress.match(/^(.+?)\s*<[^>]+>$/);
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
}

async function loadAccountingSenderWhitelist(businessId: string): Promise<string[]> {
  if (!businessId) return [];

  try {
    const { data: config, error } = await supabase
      .from('accounting_business_config')
      .select('accounting_sender_whitelist')
      .eq('business_id', businessId)
      .maybeSingle();

    if (!error) {
      const whitelist = ((config?.accounting_sender_whitelist as string[] | null) || [])
        .map((email) => normalizeEmailAddress(String(email || '')))
        .filter(Boolean);
      if (whitelist.length > 0) return whitelist;
    } else {
      console.warn('Failed loading accounting_sender_whitelist from config, falling back to table:', error.message);
    }
  } catch (e) {
    console.warn('Unexpected config whitelist load failure, falling back to table:', e);
  }

  const { data: rows, error: tableError } = await supabase
    .from('accounting_email_whitelist')
    .select('email_address')
    .eq('business_id', businessId);

  if (tableError) {
    console.warn('Fallback accounting_email_whitelist lookup failed:', tableError.message);
    return [];
  }

  return (rows || [])
    .map((row: { email_address?: string | null }) => normalizeEmailAddress(String(row.email_address || '')))
    .filter(Boolean);
}

function normalizeEmailAddress(email: string): string {
  return extractEmailAddress(String(email || '')).trim().toLowerCase();
}

function isSenderOnAccountingWhitelist(whitelist: string[], fromAddress: string): boolean {
  const from = normalizeEmailAddress(fromAddress);
  if (!from) return false;
  return whitelist.some((entry) => normalizeEmailAddress(entry) === from);
}

async function loadAccountingInboxAddresses(businessId: string): Promise<string[]> {
  // Legacy per-business UUID address is the primary intake route for new businesses.
  return [`${businessId}@tavarios.ca`.toLowerCase()];
}

async function loadAccountingIntakeAddresses(businessId: string): Promise<string[]> {
  const addresses = await loadAccountingInboxAddresses(businessId);
  const { data: config } = await supabase
    .from('accounting_business_config')
    .select('accounting_inbox_slug, accounting_inbox_domain')
    .eq('business_id', businessId)
    .maybeSingle();
  const slug = String(config?.accounting_inbox_slug || '').trim().toLowerCase();
  const domain = String(config?.accounting_inbox_domain || 'tavarios.ca').trim().toLowerCase();
  if (slug && domain) {
    addresses.push(`${slug}@${domain}`);
  }

  const { data: mailboxes } = await supabase
    .from('mailboxes')
    .select('email_address')
    .eq('business_id', businessId)
    .eq('status', 'active');

  for (const mailbox of mailboxes || []) {
    const email = normalizeEmailAddress(String(mailbox.email_address || ''));
    if (!email || addresses.includes(email)) continue;
    if (email === `${businessId}@tavarios.ca`.toLowerCase()) {
      addresses.push(email);
      continue;
    }
    const at = email.indexOf('@');
    if (at <= 0) continue;
    const local = email.slice(0, at);
    const mbDomain = email.slice(at + 1);
    if (slug && domain && local === slug && mbDomain === domain) {
      addresses.push(email);
    }
  }
  return Array.from(new Set(addresses.filter(Boolean)));
}

async function shouldQueueAccountingInvoices(
  businessId: string,
  fromAddress: string,
  toAddresses: string[],
  matchedMailboxEmails: string[] = []
): Promise<boolean> {
  const whitelist = await loadAccountingSenderWhitelist(businessId);
  const fromLower = normalizeEmailAddress(fromAddress);
  if (!isSenderOnAccountingWhitelist(whitelist, fromAddress)) {
    console.log(`Accounting invoice queue skipped for ${businessId}: sender "${fromLower}" not in whitelist (${whitelist.length} entries)`);
    return false;
  }
  const intakeAddresses = await loadAccountingIntakeAddresses(businessId);
  const candidateAddresses = [
    ...(toAddresses || []).map(normalizeEmailAddress),
    ...matchedMailboxEmails.map(normalizeEmailAddress),
  ].filter(Boolean);
  const hitsIntake = candidateAddresses.some((addr) => intakeAddresses.includes(addr));
  if (!hitsIntake) {
    console.log(`Accounting invoice queue skipped for ${businessId}: To not an accounting intake address`, {
      intakeAddresses,
      to: candidateAddresses,
    });
  }
  return hitsIntake;
}

async function resolveAccountingInboxMatches(toAddresses: string[]): Promise<Array<{ business_id: string }>> {
  const matches: Array<{ business_id: string }> = [];
  const seen = new Set<string>();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  for (const addr of toAddresses || []) {
    const at = addr.indexOf('@');
    if (at <= 0) continue;
    const local = addr.slice(0, at).trim().toLowerCase();
    const domain = addr.slice(at + 1).trim().toLowerCase();

    if (domain === 'tavarios.ca' && uuidRegex.test(local)) {
      const { data: biz } = await supabase.from('businesses').select('id').eq('id', local).maybeSingle();
      if (biz?.id && !seen.has(biz.id)) {
        seen.add(biz.id);
        matches.push({ business_id: biz.id });
      }
      continue;
    }

    const { data: config, error } = await supabase
      .from('accounting_business_config')
      .select('business_id')
      .eq('accounting_inbox_domain', domain)
      .eq('accounting_inbox_slug', local)
      .maybeSingle();

    if (error) {
      console.warn('Failed resolving accounting inbox match:', { address: addr, message: error.message });
      continue;
    }

    if (config?.business_id && !seen.has(config.business_id)) {
      seen.add(config.business_id);
      matches.push({ business_id: config.business_id });
    }
  }

  return matches;
}

type ParsedAttachment = { filename: string; content_type: string; content_base64: string };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function decodeQuotedPrintableToBytes(value: string): Uint8Array {
  const cleaned = value
    .replace(/=\r?\n/g, '')
    .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return Uint8Array.from(cleaned, (char) => char.charCodeAt(0) & 0xff);
}

function encodeAttachmentBodyToBase64(raw: string, encoding: string): string {
  if (encoding === 'base64') return raw;
  if (encoding === 'quoted-printable') {
    return bytesToBase64(decodeQuotedPrintableToBytes(raw));
  }
  return bytesToBase64(Uint8Array.from(raw, (char) => char.charCodeAt(0) & 0xff));
}

function extractFilenameFromPart(part: string): string | null {
  // Content-Disposition: attachment; filename="invoice.pdf" or filename=invoice.pdf
  const dispMatch = part.match(/Content-Disposition:\s*(?:attachment|inline)[\s\S]*?filename\s*=\s*"([^"]+)"|filename\s*=\s*([^";\r\n\s]+)/i);
  if (dispMatch) return (dispMatch[1] || dispMatch[2] || '').trim().replace(/^["']|["']$/g, '') || null;
  // RFC 5987: filename*=UTF-8''invoice%20name.pdf
  const starMatch = part.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;\r\n]+)/i);
  if (starMatch) {
    try {
      return decodeURIComponent(starMatch[1].trim()) || null;
    } catch {
      return starMatch[1].trim() || null;
    }
  }
  // Content-Type: application/pdf; name="invoice.pdf"
  const nameMatch = part.match(/Content-Type:[\s\S]*?name\s*=\s*"([^"]+)"|name\s*=\s*([^";\r\n\s]+)/i);
  if (nameMatch) return (nameMatch[1] || nameMatch[2] || '').trim().replace(/^["']|["']$/g, '') || null;
  return null;
}

// Parse MIME parts for attachments (recurses into nested multipart). Explicit attachment/inline with filename, or inline image/PDF.
function parseAttachmentsFromRaw(emailContent: string): ParsedAttachment[] {
  const attachments: ParsedAttachment[] = [];
  let inlineImageIndex = 0;

  function collectFromPart(partContent: string, boundary: string): void {
    const parts = partContent.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\r?\\n)?`));
    for (const part of parts) {
      if (!part.trim() || part.trim() === '--') continue;
      const ctMatch = part.match(/Content-Type:\s*([^\r\n;]+)/i);
      const content_type = (ctMatch ? ctMatch[1].trim() : 'application/octet-stream').split(';')[0].trim();

      // Nested multipart: recurse (Content-Type: multipart/...; boundary="...")
      const subBoundaryMatch = part.match(/Content-Type:\s*multipart\/[\s\S]*?boundary\s*=\s*"?([^"\s;\r\n]+)"?/i);
      if (subBoundaryMatch && subBoundaryMatch[1]) {
        const subBoundary = subBoundaryMatch[1].trim();
        const bodyMatch = part.match(/\r?\n\r?\n([\s\S]*)/);
        if (bodyMatch && bodyMatch[1]) collectFromPart(bodyMatch[1], subBoundary);
        continue;
      }

      const isInvoiceType = /^image\/(jpeg|png|webp)$/i.test(content_type) || content_type === 'application/pdf';
      let filename = extractFilenameFromPart(part);
      if (!filename && isInvoiceType && part.match(/Content-Disposition:\s*inline/i)) {
        const ext = content_type === 'application/pdf' ? 'pdf' : content_type.split('/')[1]?.toLowerCase() || 'bin';
        inlineImageIndex += 1;
        filename = `embedded-inline-${inlineImageIndex}.${ext}`;
      }
      if (!filename) continue;

      const encodingMatch = part.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
      const encoding = (encodingMatch ? encodingMatch[1].trim().toLowerCase() : '7bit');
      const bodyMatch = part.match(/\r?\n\r?\n([\s\S]*?)(?=\r?\n--|$)/);
      if (!bodyMatch) continue;
      let raw = bodyMatch[1].replace(/\r\n/g, '\n').replace(/\n/g, '').trim();
      if (!raw) continue;
      const content_base64 = encodeAttachmentBodyToBase64(raw, encoding);
      attachments.push({ filename, content_type, content_base64 });
    }
  }

  const boundaryMatch = emailContent.match(/boundary="?([^"\s;]+)"?/i);
  if (!boundaryMatch) return attachments;
  const boundary = boundaryMatch[1].trim();
  collectFromPart(emailContent, boundary);
  return attachments;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Convert image bytes (JPEG/PNG) to a single-page PDF. Returns null for unsupported types.
async function imageToPdf(bytes: Uint8Array, contentType: string): Promise<Uint8Array | null> {
  const ct = (contentType || '').toLowerCase().split(';')[0].trim();
  try {
    const doc = await PDFDocument.create();
    if (ct === 'image/jpeg' || ct === 'image/jpg') {
      const img = await doc.embedJpg(bytes);
      const page = doc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else if (ct === 'image/png') {
      const img = await doc.embedPng(bytes);
      const page = doc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else {
      return null;
    }
    return await doc.save();
  } catch (_e) {
    return null;
  }
}

type UploadItem = { bytes: Uint8Array; filename: string; content_type: string };

// Build list of PDFs and images to upload. PDFs stay as PDF; images kept as-is so extraction can use OpenAI vision on the real image (converting to PDF strips text and makes image extraction unreliable).
async function buildUploadItems(
  attachments: ParsedAttachment[],
  bodyText: string | null,
  bodyHtml: string | null
): Promise<UploadItem[]> {
  const items: UploadItem[] = [];
  if (attachments.length > 0) {
    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      const bytes = base64ToBytes(att.content_base64);
      const ct = (att.content_type || '').toLowerCase().split(';')[0].trim();
      if (ct === 'application/pdf') {
        const base = att.filename.replace(/\.pdf$/i, '') || 'attachment';
        items.push({ bytes, filename: `${base}.pdf`, content_type: 'application/pdf' });
      } else if (ct === 'image/jpeg' || ct === 'image/jpg' || ct === 'image/png') {
        // Keep as image so accounting-extract-draft-expense sends it to OpenAI vision; converting to PDF produced image-only PDFs with no extractable text/image.
        items.push({ bytes, filename: att.filename, content_type: att.content_type || (ct === 'image/jpg' ? 'image/jpeg' : ct) });
      } else if (ct === 'image/webp') {
        // webp: keep as-is so processor can handle
        items.push({ bytes, filename: att.filename, content_type: att.content_type || 'image/webp' });
      } else {
        // text/html, etc. — expense-invoices bucket does not allow; skip
        console.log(`Skip upload: content_type ${ct} not supported for expense-invoices (filename=${att.filename})`);
      }
    }
  }

  if (items.length === 0) {
    console.log('Accounting inbox: no uploadable attachments, building email-body PDF from body (text/html)');
    const pdfBytes = await emailBodyToPdf(bodyText, bodyHtml);
    if (pdfBytes) {
      items.push({ bytes: pdfBytes, filename: 'email-body.pdf', content_type: 'application/pdf' });
      console.log('Accounting inbox: email-body.pdf created, size', pdfBytes.length);
    } else {
      console.warn('Accounting inbox: emailBodyToPdf returned null; no PDF generated for email body');
    }
  }
  return items;
}

async function ensureStoredExpenseAttachments(
  emailRecordId: string,
  businessId: string,
  uploadItems: UploadItem[]
): Promise<Array<{ id: string; content_type: string }>> {
  const attachmentKey = (filename: string, contentType: string, sizeBytes: number) =>
    `${String(filename || "").trim().toLowerCase()}|${String(contentType || "").trim().toLowerCase()}|${Number(sizeBytes || 0)}`;

  const { data: existingRows, error: existingErr } = await supabase
    .from("received_email_attachments")
    .select("id, filename, content_type, size_bytes")
    .eq("received_email_id", emailRecordId);
  if (existingErr) {
    console.error(`Failed loading existing attachments for ${emailRecordId}:`, existingErr);
  }

  const remainingExistingCounts = new Map<string, number>();
  for (const row of existingRows || []) {
    const key = attachmentKey(row.filename || "", row.content_type || "", Number(row.size_bytes || 0));
    remainingExistingCounts.set(key, (remainingExistingCounts.get(key) || 0) + 1);
  }

  const insertedAttachmentIds: Array<{ id: string; content_type: string }> = [];
  for (const item of uploadItems) {
    try {
      const key = attachmentKey(item.filename, item.content_type, item.bytes.length);
      const existingCount = remainingExistingCounts.get(key) || 0;
      if (existingCount > 0) {
        remainingExistingCounts.set(key, existingCount - 1);
        continue;
      }

      const pathSegment = crypto.randomUUID();
      const safeName = item.filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "attachment";
      const storagePath = `${businessId}/${pathSegment}/${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("expense-invoices")
        .upload(storagePath, item.bytes, { contentType: item.content_type, upsert: false });
      if (upErr) {
        console.error(`Upload failed for ${item.filename}:`, upErr.message || upErr);
        continue;
      }
      const { data: attRow, error: attErr } = await supabase
        .from("received_email_attachments")
        .insert({
          received_email_id: emailRecordId,
          storage_path: storagePath,
          filename: item.filename,
          content_type: item.content_type,
          size_bytes: item.bytes.length,
        })
        .select("id, content_type")
        .single();
      if (attErr) {
        console.error(`Insert attachment row failed for ${item.filename}:`, attErr.message || attErr);
        continue;
      }
      insertedAttachmentIds.push({ id: attRow.id, content_type: attRow.content_type || item.content_type });
    } catch (error) {
      console.error(`Error storing attachment ${item.filename}:`, error);
    }
  }

  const { data: finalRows, error: finalErr } = await supabase
    .from("received_email_attachments")
    .select("id, content_type")
    .eq("received_email_id", emailRecordId);
  if (finalErr) {
    console.error(`Failed reloading attachments for ${emailRecordId}:`, finalErr);
    return insertedAttachmentIds;
  }

  return (finalRows || []).map((row: { id: string; content_type?: string | null }) => ({
    id: row.id,
    content_type: row.content_type || "application/octet-stream"
  }));
}

const INVOICE_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
function isInvoiceLikeContentType(contentType: string): boolean {
  const ct = (contentType || '').toLowerCase().split(';')[0].trim();
  return INVOICE_CONTENT_TYPES.some((t) => ct === t);
}

async function invokeInboundInvoiceProcessor(
  emailRecordId: string,
  attachmentId: string,
  contextLabel: string
): Promise<void> {
  const processorUrl = `${SUPABASE_URL}/functions/v1/accounting-process-inbound-invoice`;
  try {
    console.log(`[receive-email] CALL process-inbound-invoice (${contextLabel}) received_email_id=${emailRecordId} attachment_id=${attachmentId}`);
    const res = await fetch(processorUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ received_email_id: emailRecordId, attachment_id: attachmentId }),
    });
    const resBody = await res.text();
    console.log(`[receive-email] process-inbound-invoice RESPONSE status=${res.status} body=${(resBody || "").slice(0, 800)}`);
    if (!res.ok) {
      console.error(`[receive-email] accounting-process-inbound-invoice FAILED for attachment ${attachmentId}:`, res.status, resBody);
      return;
    }

    try {
      const parsed = JSON.parse(resBody || "{}");
      const draftId = parsed.draft_id;
      if (draftId) {
        if (parsed.extraction_scheduled) {
          console.log(`[receive-email] ✅ Draft created draft_id=${draftId}; extraction scheduled in background`);
        } else if (parsed.extraction_ok !== undefined) {
          const extMsg = parsed.extraction_message || "";
          let extData: { extracted_vendor?: string; extracted_total?: number; got_data?: boolean } = {};
          try {
            extData = typeof extMsg === "string" && extMsg ? JSON.parse(extMsg) : extMsg;
          } catch (_) {}
          const gotData = parsed.extraction_got_data === true || extData.got_data === true;
          console.log(`[receive-email] ✅ Draft draft_id=${draftId} extraction_ok=${parsed.extraction_ok} got_data=${gotData}`);
        } else {
          console.log(`[receive-email] ✅ Draft ready draft_id=${draftId}`);
        }
      }
    } catch (_) {
      console.log(`[receive-email] ✅ Invoked accounting-process-inbound-invoice for attachment ${attachmentId}`);
    }
  } catch (e) {
    console.error(`[receive-email] Error invoking accounting-process-inbound-invoice for ${attachmentId}:`, e);
  }
}

async function queueInboundInvoiceProcessing(
  emailRecordId: string,
  attachments: Array<{ id: string; content_type: string }>,
  contextLabel: string
): Promise<void> {
  for (const { id: attachmentId, content_type } of attachments) {
    if (!isInvoiceLikeContentType(content_type)) continue;
    await invokeInboundInvoiceProcessor(emailRecordId, attachmentId, contextLabel);
  }
}

// Parse raw MIME email string (from S3 or SES notification content) into body + attachments
function parseRawEmailContent(emailContent: string): { bodyText: string | null; bodyHtml: string | null; size: number; attachments: ParsedAttachment[] } {
  const size = emailContent.length;
  let attachments = parseAttachmentsFromRaw(emailContent);
  let bodyText: string | null = null;
  let bodyHtml: string | null = null;
  const boundaryMatch = emailContent.match(/boundary="?([^"\s]+)"?/i);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = emailContent.split(`--${boundary}`);
    for (const part of parts) {
      if (part.includes("Content-Disposition: attachment") || (part.includes("Content-Disposition: inline") && part.includes("filename="))) continue;
      if (part.includes("Content-Type: text/plain") && !bodyText) {
        const textMatch = part.match(/Content-Type: text\/plain[^]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|$)/i);
        if (textMatch) bodyText = textMatch[1].trim();
      }
      if (part.includes("Content-Type: text/html") && !bodyHtml) {
        const htmlMatch = part.match(/Content-Type: text\/html[^]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|$)/i);
        if (htmlMatch) bodyHtml = htmlMatch[1].trim();
      }
    }
  }
  if (!bodyText && !bodyHtml) {
    const textMatch = emailContent.match(/Content-Type:\s*text\/plain[^]*?\r?\n\r?\n([\s\S]*?)(?=\r?\nContent-Type:|\r?\n--|$)/i);
    const htmlMatch = emailContent.match(/Content-Type:\s*text\/html[^]*?\r?\n\r?\n([\s\S]*?)(?=\r?\nContent-Type:|\r?\n--|$)/i);
    if (textMatch) bodyText = textMatch[1].trim();
    if (htmlMatch) bodyHtml = htmlMatch[1].trim();
  }
  if (!bodyText && !bodyHtml) {
    const headerEnd = emailContent.indexOf("\r\n\r\n");
    if (headerEnd > 0) {
      const potentialBody = emailContent.substring(headerEnd + 4).trim();
      if (potentialBody.includes("<html") || potentialBody.includes("<body") || potentialBody.includes("<div")) bodyHtml = potentialBody;
      else if (potentialBody.length > 0) bodyText = potentialBody;
    }
  }
  if (attachments.length === 0 && bodyHtml) {
    const dataUrlRegex = /data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)/g;
    let match;
    let idx = 0;
    while ((match = dataUrlRegex.exec(bodyHtml)) !== null) {
      const mime = match[1].toLowerCase();
      if (mime === "image/gif") continue;
      const ext = mime === "image/jpeg" ? "jpg" : mime.split("/")[1] || "bin";
      attachments.push({ filename: `embedded-from-body-${++idx}.${ext}`, content_type: mime, content_base64: match[2] });
    }
  }
  return { bodyText, bodyHtml, size, attachments };
}

// Fetch email content from S3
async function fetchEmailFromS3(bucketName: string, objectKey: string): Promise<{
  bodyText: string | null;
  bodyHtml: string | null;
  size: number | null;
  attachments: ParsedAttachment[];
  rawContent: string | null;
}> {
  try {
    if (!SES_ACCESS_KEY_ID || !SES_SECRET_ACCESS_KEY) {
      console.warn("⚠️ AWS credentials not configured, skipping S3 fetch");
      return { bodyText: null, bodyHtml: null, size: null, attachments: [], rawContent: null };
    }

    console.log(`📧 Fetching email from S3: ${bucketName}/${objectKey}`);

    const command = new GetObjectCommand({ Bucket: bucketName, Key: objectKey });
    const response = await s3Client.send(command);
    if (!response.Body) {
      console.warn("⚠️ No body in S3 response");
      return { bodyText: null, bodyHtml: null, size: null, attachments: [], rawContent: null };
    }

    const emailContent = await response.Body.transformToString();
    const size = response.ContentLength || emailContent.length;
    const attachments = parseAttachmentsFromRaw(emailContent);

    let bodyText: string | null = null;
    let bodyHtml: string | null = null;
    const boundaryMatch = emailContent.match(/boundary="?([^"\s]+)"?/i);
    if (boundaryMatch) {
      const boundary = boundaryMatch[1];
      const parts = emailContent.split(`--${boundary}`);
      for (const part of parts) {
        if (part.includes("Content-Disposition: attachment") || (part.includes("Content-Disposition: inline") && part.includes("filename="))) continue;
        if (part.includes("Content-Type: text/plain") && !bodyText) {
          const textMatch = part.match(/Content-Type: text\/plain[^]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|$)/i);
          if (textMatch) bodyText = textMatch[1].trim();
        }
        if (part.includes("Content-Type: text/html") && !bodyHtml) {
          const htmlMatch = part.match(/Content-Type: text\/html[^]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|$)/i);
          if (htmlMatch) bodyHtml = htmlMatch[1].trim();
        }
      }
    }
    if (!bodyText && !bodyHtml) {
      const textMatch = emailContent.match(/Content-Type:\s*text\/plain[^]*?\r?\n\r?\n([\s\S]*?)(?=\r?\nContent-Type:|\r?\n--|$)/i);
      const htmlMatch = emailContent.match(/Content-Type:\s*text\/html[^]*?\r?\n\r?\n([\s\S]*?)(?=\r?\nContent-Type:|\r?\n--|$)/i);
      if (textMatch) bodyText = textMatch[1].trim();
      if (htmlMatch) bodyHtml = htmlMatch[1].trim();
    }
    if (!bodyText && !bodyHtml) {
      const headerEnd = emailContent.indexOf("\r\n\r\n");
      if (headerEnd > 0) {
        const potentialBody = emailContent.substring(headerEnd + 4).trim();
        if (potentialBody.includes("<html") || potentialBody.includes("<body") || potentialBody.includes("<div")) bodyHtml = potentialBody;
        else if (potentialBody.length > 0) bodyText = potentialBody;
      }
    }

    // If no MIME attachments, try to pull embedded images from HTML (data:image/...;base64,...)
    if (attachments.length === 0 && bodyHtml) {
      const dataUrlRegex = /data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)/g;
      let match;
      let idx = 0;
      while ((match = dataUrlRegex.exec(bodyHtml)) !== null) {
        const mime = match[1].toLowerCase();
        if (mime === "image/gif") continue; // processor only does jpeg/png/webp
        const ext = mime === "image/jpeg" ? "jpg" : mime.split("/")[1] || "bin";
        attachments.push({
          filename: `embedded-from-body-${++idx}.${ext}`,
          content_type: mime,
          content_base64: match[2]
        });
      }
      if (attachments.length > 0) console.log(`📧 Found ${attachments.length} embedded image(s) in HTML body`);
    }

    if (attachments.length === 0 && (bodyText || bodyHtml)) {
      console.log(`📧 Fetched from S3: body present but 0 attachments parsed (nested multipart or unusual MIME).`);
    }
    console.log(`📧 Fetched email: ${size} bytes, has text: ${!!bodyText}, has html: ${!!bodyHtml}, attachments: ${attachments.length}`);
    return { bodyText, bodyHtml, size, attachments, rawContent: emailContent };
  } catch (error) {
    console.error("❌ Error fetching email from S3:", error);
    return { bodyText: null, bodyHtml: null, size: null, attachments: [], rawContent: null };
  }
}

// Process incoming email from S3 or from raw MIME (e.g. SES notification content when no S3 action)
async function processEmailFromS3(bucketName: string, objectKey: string | null, receipt: any, rawEmailContent?: string) {
  try {
    console.log("📧 Processing email from receipt notification");
    // Note: In production, you would fetch the email from S3 using AWS SDK
    // For now, we'll extract what we can from the receipt notification
    const mail = receipt.mail;
    if (!mail) {
      console.error("❌ No mail data in receipt");
      return { success: false, error: "No mail data in receipt" };
    }
    
    const commonHeaders = mail.commonHeaders || {};
    
    // Extract email data
    console.log("📧 Extracting email data from mail object");
    const fromAddress = extractEmailAddress(commonHeaders.from?.[0] || mail.source || '');
    const fromName = extractName(commonHeaders.from?.[0] || mail.source || '');
    const toAddresses = (commonHeaders.to || mail.destination || []).map(extractEmailAddress);
    const ccAddresses = (commonHeaders.cc || []).map(extractEmailAddress);
    const subject = commonHeaders.subject || '(No Subject)';
    const sentAt = commonHeaders.date || mail.timestamp;
    
    console.log("📧 From:", fromAddress, "To:", toAddresses, "Subject:", subject);
    
    // Parse headers for additional info
    const headers = mail.headers ? parseHeaders(mail.headers) : {};
    const messageId = headers['message-id'] || mail.messageId || `msg_${Date.now()}`;
    const inReplyTo = headers['in-reply-to'] || null;
    const references = headers['references'] || null;
    
    // Calculate thread_id (simplified - use in-reply-to or message-id)
    const threadId = inReplyTo || messageId || `thread_${Date.now()}`;
    
    // Find matching mailbox(es) for the recipient addresses
    const mailboxQueries = await Promise.all(
      toAddresses.map(async (email) => {
        const { data: mailboxes } = await supabase
          .from('mailboxes')
          .select('id, business_id, email_address')
          .eq('email_address', email.toLowerCase())
          .eq('status', 'active')
          .limit(1);
        return mailboxes?.[0] || null;
      })
    );
    
    const matchedMailboxes = mailboxQueries.filter(Boolean);

    // File Storage inbox: local@domain from file_storage_settings (before accounting UUID routing)
    type FileStorageInboxMatch = { business_id: string };
    let fileStorageMatch: FileStorageInboxMatch | null = null;
    if (matchedMailboxes.length === 0 && toAddresses.length > 0) {
      for (const addr of toAddresses) {
        const at = addr.indexOf("@");
        if (at <= 0) continue;
        const local = addr.slice(0, at).trim().toLowerCase();
        const domain = addr.slice(at + 1).trim().toLowerCase();
        const { data: fsRow } = await supabase
          .from("file_storage_settings")
          .select("business_id")
          .eq("inbox_local_part", local)
          .eq("inbox_domain", domain)
          .maybeSingle();
        if (fsRow?.business_id) {
          fileStorageMatch = { business_id: fsRow.business_id as string };
          console.log(`Found file storage inbox ${addr} → business_id ${fsRow.business_id}`);
          break;
        }
      }
    }

    let accountingInboxMatches: Array<{ business_id: string }> = [];
    if (!fileStorageMatch && toAddresses.length > 0) {
      accountingInboxMatches = await resolveAccountingInboxMatches(toAddresses);
      if (accountingInboxMatches.length > 0) {
        console.log('Found accounting inbox matches', accountingInboxMatches);
      }
    }
    
    // If no mailbox and no accounting inbox match, try domain and store with domain's business_id
    let domainBusinessId: string | null = null;
    if (matchedMailboxes.length === 0 && accountingInboxMatches.length === 0 && !fileStorageMatch) {
      for (const email of toAddresses) {
        const domain = email.split('@')[1];
        if (domain) {
          const { data: domainData } = await supabase
            .from('mail_domains')
            .select('id, business_id, domain')
            .eq('domain', domain.toLowerCase())
            .eq('verified', true)
            .limit(1);
          
          if (domainData?.[0]) {
            domainBusinessId = domainData[0].business_id;
            console.log(`Found domain ${domain} with business_id ${domainBusinessId}, but no mailbox for ${email}`);
            break;
          }
        }
      }
    }

    // Dedupe: skip only when we already have a draft for this message (not just a received_email stub)
    const businessIdsToStore = matchedMailboxes.length > 0
      ? matchedMailboxes.map((m: { business_id: string }) => m.business_id)
      : fileStorageMatch
        ? [fileStorageMatch.business_id]
        : accountingInboxMatches.length > 0
          ? accountingInboxMatches.map((m: { business_id: string }) => m.business_id)
          : domainBusinessId
            ? [domainBusinessId]
            : [];
    if (businessIdsToStore.length > 0) {
      const { data: existingReceived } = await supabase
        .from('received_emails')
        .select('id')
        .eq('message_id', messageId)
        .in('business_id', businessIdsToStore);
      const receivedIds = (existingReceived || []).map((r: { id: string }) => r.id);
      if (receivedIds.length > 0) {
        const { data: drafts } = await supabase
          .from('accounting_draft_expenses')
          .select('id')
          .in('received_email_id', receivedIds)
          .limit(1);
        if (drafts?.length) {
          console.log(`📧 Skipping duplicate: already have draft for message_id ${messageId}`);
          return { success: true, processed: 0 };
        }
      }
    }

    // Resolve email body + attachments once (from S3 or from raw MIME when no S3 action)
    type EmailContentResult = { bodyText: string | null; bodyHtml: string | null; size: number | null; attachments: ParsedAttachment[] };
    let emailContentResult: EmailContentResult = { bodyText: null, bodyHtml: null, size: null, attachments: [] };
    if (objectKey && bucketName) {
      const fromS3 = await fetchEmailFromS3(bucketName, objectKey);
      emailContentResult = { bodyText: fromS3.bodyText, bodyHtml: fromS3.bodyHtml, size: fromS3.size, attachments: fromS3.attachments };
      if (fromS3.attachments.length === 0 && (fromS3.bodyText || fromS3.bodyHtml)) {
        console.log(`📧 Fetched from S3: body present but no attachments parsed. Email may use nested multipart or unusual MIME; check raw in S3 if needed.`);
      }
    } else if (rawEmailContent) {
      const parsed = parseRawEmailContent(rawEmailContent);
      emailContentResult = { bodyText: parsed.bodyText, bodyHtml: parsed.bodyHtml, size: parsed.size, attachments: parsed.attachments };
      console.log(`📧 Using SES content: ${parsed.attachments.length} attachment(s), has body: ${!!parsed.bodyText || !!parsed.bodyHtml}`);
    } else {
      console.warn(`📧 No email body or attachments: receipt has no S3 action and no inline content. To process attachments, add an S3 action to your SES receipt rule so the full message is stored and we can fetch it.`);
    }

    // Turn everything into PDFs (or keep pass-through): attachments → each as PDF; no attachments → email body as one PDF
    const uploadItems = await buildUploadItems(
      emailContentResult.attachments,
      emailContentResult.bodyText,
      emailContentResult.bodyHtml
    );
    console.log(`📧 Upload items (PDFs / pass-through): ${uploadItems.length}`);
    
    // Store email for each matched mailbox, or with domain's business_id, or accounting-inbox business (no mailbox)
    if (matchedMailboxes.length > 0) {
      // Store for each matched mailbox
      for (const mailbox of matchedMailboxes) {
      const itemCount = uploadItems.length;
      const { data: existingEmail } = await supabase
        .from('received_emails')
        .select('id')
        .eq('message_id', messageId)
        .eq('business_id', mailbox.business_id)
        .limit(1)
        .maybeSingle();

      let emailRecord: { id: string } | null = null;
      if (existingEmail?.id) {
        emailRecord = { id: existingEmail.id };
        if (emailContentResult.bodyText || emailContentResult.bodyHtml || emailContentResult.size != null) {
          await supabase.from('received_emails').update({
            body_text: emailContentResult.bodyText,
            body_html: emailContentResult.bodyHtml,
            size_bytes: emailContentResult.size,
            has_attachments: itemCount > 0,
            attachment_count: itemCount,
          }).eq('id', existingEmail.id);
        }
        console.log(`📧 Reusing received_email ${existingEmail.id} for message_id ${messageId} (no draft yet)`);
      } else {
      const emailData = {
        business_id: mailbox.business_id,
        mailbox_id: mailbox.id,
        message_id: messageId,
        in_reply_to: inReplyTo,
        email_references: references,
        thread_id: threadId,
        from_address: fromAddress,
        from_name: fromName || null,
        to_addresses: toAddresses,
        cc_addresses: ccAddresses.length > 0 ? ccAddresses : null,
        bcc_addresses: null, // BCC not available in receipt
        subject: subject,
        body_text: emailContentResult.bodyText,
        body_html: emailContentResult.bodyHtml,
        has_attachments: itemCount > 0,
        attachment_count: itemCount,
        status: (receipt.receipt?.spamVerdict?.status === 'PASS' || !receipt.receipt?.spamVerdict) ? 'unread' : 'spam',
        received_at: new Date().toISOString(),
        sent_at: sentAt ? new Date(sentAt).toISOString() : null,
        size_bytes: emailContentResult.size,
        raw_email_text: objectKey ? `s3://${bucketName}/${objectKey}` : null,
        processed_at: new Date().toISOString(),
        processing_error: null,
      };
      
      const { data: inserted, error } = await supabase
        .from('received_emails')
        .insert(emailData)
        .select()
        .single();
      
      if (error) {
        console.error(`Error storing email for mailbox ${mailbox.id}:`, error);
      } else {
        emailRecord = inserted;
      }
      }

      if (emailRecord) {
        console.log(`✅ Stored email ${emailRecord.id} for mailbox ${mailbox.id}`);
        const businessId = mailbox.business_id as string;
        const insertedAttachmentIds = await ensureStoredExpenseAttachments(emailRecord.id, businessId, uploadItems);
        if (insertedAttachmentIds.length > 0) {
          const matchedMailboxEmails = matchedMailboxes
            .filter((mb: { business_id: string }) => mb.business_id === businessId)
            .map((mb: { email_address?: string }) => String(mb.email_address || ''));
          if (await shouldQueueAccountingInvoices(businessId, fromAddress, toAddresses, matchedMailboxEmails)) {
            await queueInboundInvoiceProcessing(emailRecord.id, insertedAttachmentIds, 'mailbox');
          }
        }
      }
    }
    } else if (fileStorageMatch) {
      const fsBid = fileStorageMatch.business_id;
      const { data: fsDup } = await supabase
        .from("file_storage_inbound")
        .select("id")
        .eq("message_id", messageId)
        .eq("business_id", fsBid)
        .limit(1);
      if (fsDup && fsDup.length > 0) {
        console.log(`📧 File storage: skip duplicate message_id ${messageId}`);
      } else {
        let fsStored = 0;
        for (const item of uploadItems) {
          try {
            const pathSeg = crypto.randomUUID();
            const safeName = item.filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "attachment";
            const storagePath = `${fsBid}/inbound/${pathSeg}/${safeName}`;
            const { error: fsUpErr } = await supabase.storage
              .from("business-files")
              .upload(storagePath, item.bytes, { contentType: item.content_type, upsert: false });
            if (fsUpErr) {
              console.error(`File storage upload failed ${item.filename}:`, fsUpErr);
              continue;
            }
            const { error: fsInsErr } = await supabase.from("file_storage_inbound").insert({
              business_id: fsBid,
              message_id: messageId,
              from_address: fromAddress,
              subject,
              file_path: storagePath,
              original_filename: item.filename,
              mime_type: item.content_type,
              file_size: item.bytes.length,
              status: "pending",
            });
            if (fsInsErr) {
              console.error("File storage inbound insert failed:", fsInsErr);
              continue;
            }
            fsStored += 1;
          } catch (e) {
            console.error("File storage item error:", e);
          }
        }
        console.log(`✅ File storage: stored ${fsStored} pending inbound row(s) for business ${fsBid}`);
      }
    } else if (domainBusinessId) {
      // No mailbox found, but we have domain's business_id - store email anyway
      console.log(`Storing email without mailbox match, using domain business_id: ${domainBusinessId}`);
      const itemCountDomain = uploadItems.length;
      const { data: existingDomainEmail } = await supabase
        .from('received_emails')
        .select('id')
        .eq('message_id', messageId)
        .eq('business_id', domainBusinessId)
        .limit(1)
        .maybeSingle();

      let emailRecord: { id: string } | null = null;
      if (existingDomainEmail?.id) {
        emailRecord = { id: existingDomainEmail.id };
        if (emailContentResult.bodyText || emailContentResult.bodyHtml || emailContentResult.size != null) {
          await supabase.from('received_emails').update({
            body_text: emailContentResult.bodyText,
            body_html: emailContentResult.bodyHtml,
            size_bytes: emailContentResult.size,
            has_attachments: itemCountDomain > 0,
            attachment_count: itemCountDomain,
          }).eq('id', existingDomainEmail.id);
        }
        console.log(`📧 Reusing received_email ${existingDomainEmail.id} for message_id ${messageId} (no draft yet)`);
      } else {
      const emailData = {
        business_id: domainBusinessId,
        mailbox_id: null,
        message_id: messageId,
        in_reply_to: inReplyTo,
        email_references: references,
        thread_id: threadId,
        from_address: fromAddress,
        from_name: fromName || null,
        to_addresses: toAddresses,
        cc_addresses: ccAddresses.length > 0 ? ccAddresses : null,
        bcc_addresses: null,
        subject: subject,
        body_text: emailContentResult.bodyText,
        body_html: emailContentResult.bodyHtml,
        has_attachments: itemCountDomain > 0,
        attachment_count: itemCountDomain,
        status: (receipt.receipt?.spamVerdict?.status === 'PASS' || !receipt.receipt?.spamVerdict) ? 'unread' : 'spam',
        received_at: new Date().toISOString(),
        sent_at: sentAt ? new Date(sentAt).toISOString() : null,
        size_bytes: emailContentResult.size,
        raw_email_text: objectKey ? `s3://${bucketName}/${objectKey}` : null,
        processed_at: new Date().toISOString(),
        processing_error: null,
      };
      
      const { data: inserted, error } = await supabase
        .from('received_emails')
        .insert(emailData)
        .select()
        .single();
      
      if (error) {
        console.error(`Error storing email without mailbox:`, error);
      } else {
        emailRecord = inserted;
      }
      }

      if (emailRecord) {
        console.log(`✅ Stored email ${emailRecord.id} without mailbox match`);
        const businessId = domainBusinessId;
        const insertedAttachmentIds = await ensureStoredExpenseAttachments(emailRecord.id, businessId, uploadItems);
        if (insertedAttachmentIds.length > 0) {
          if (await shouldQueueAccountingInvoices(businessId, fromAddress, toAddresses)) {
            await queueInboundInvoiceProcessing(emailRecord.id, insertedAttachmentIds, 'domain');
          }
        }
      }
    } else if (accountingInboxMatches.length > 0) {
      // Resolved by generic accounting inbox [slug]@[domain] (e.g. acme@tavarios.ca) — no mailbox
      for (const { business_id: inboxBusinessId } of accountingInboxMatches) {
        const itemCountInbox = uploadItems.length;
        const { data: existingInboxEmail } = await supabase
          .from('received_emails')
          .select('id')
          .eq('message_id', messageId)
          .eq('business_id', inboxBusinessId)
          .limit(1)
          .maybeSingle();

        let emailRecord: { id: string } | null = null;
        if (existingInboxEmail?.id) {
          emailRecord = { id: existingInboxEmail.id };
          if (emailContentResult.bodyText || emailContentResult.bodyHtml || emailContentResult.size != null) {
            await supabase.from('received_emails').update({
              body_text: emailContentResult.bodyText,
              body_html: emailContentResult.bodyHtml,
              size_bytes: emailContentResult.size,
              has_attachments: itemCountInbox > 0,
              attachment_count: itemCountInbox,
            }).eq('id', existingInboxEmail.id);
          }
          console.log(`📧 Reusing received_email ${existingInboxEmail.id} for message_id ${messageId} (no draft yet)`);
        } else {
        const emailData = {
          business_id: inboxBusinessId,
          mailbox_id: null,
          message_id: messageId,
          in_reply_to: inReplyTo,
          email_references: references,
          thread_id: threadId,
          from_address: fromAddress,
          from_name: fromName || null,
          to_addresses: toAddresses,
          cc_addresses: ccAddresses.length > 0 ? ccAddresses : null,
          bcc_addresses: null,
          subject: subject,
          body_text: emailContentResult.bodyText,
          body_html: emailContentResult.bodyHtml,
          has_attachments: itemCountInbox > 0,
          attachment_count: itemCountInbox,
          status: (receipt.receipt?.spamVerdict?.status === 'PASS' || !receipt.receipt?.spamVerdict) ? 'unread' : 'spam',
          received_at: new Date().toISOString(),
          sent_at: sentAt ? new Date(sentAt).toISOString() : null,
          size_bytes: emailContentResult.size,
          raw_email_text: objectKey ? `s3://${bucketName}/${objectKey}` : null,
          processed_at: new Date().toISOString(),
          processing_error: null,
        };
        const { data: inserted, error } = await supabase.from('received_emails').insert(emailData).select().single();
        if (error) {
          console.error(`Error storing email for accounting inbox business ${inboxBusinessId}:`, error);
          continue;
        }
        emailRecord = inserted;
        }

        if (!emailRecord) continue;
        console.log(`✅ Stored email ${emailRecord.id} for accounting inbox business ${inboxBusinessId}, upload items: ${itemCountInbox}`);
        const insertedAttachmentIds = await ensureStoredExpenseAttachments(emailRecord.id, inboxBusinessId, uploadItems);
        if (insertedAttachmentIds.length > 0) {
          const fromLower = normalizeEmailAddress(fromAddress);
          const willQueue = await shouldQueueAccountingInvoices(inboxBusinessId, fromAddress, toAddresses);
          console.log(`Accounting inbox: ${insertedAttachmentIds.length} attachments, from "${fromLower}", queue draft: ${willQueue}`);
          if (willQueue) {
            await queueInboundInvoiceProcessing(emailRecord.id, insertedAttachmentIds, 'accounting-inbox');
          } else {
            console.log(`Accounting inbox: not calling processor. Add "${fromLower}" to Allowed sender emails in Accounting Settings and ensure the message was sent to your accounting inbox address.`);
          }
        } else {
          console.log(`Accounting inbox: no upload items stored (built: ${itemCountInbox}).`);
        }
      }
    } else {
      console.warn(`No mailbox or domain found for email to: ${toAddresses.join(', ')}`);
    }
    
    return {
      success: true,
      processed:
        matchedMailboxes.length ||
        (fileStorageMatch ? 1 : 0) ||
        (domainBusinessId ? 1 : 0) ||
        accountingInboxMatches.length,
    };
  } catch (error) {
    console.error('Error processing email from S3:', error);
    return { success: false, error: error.message };
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  // Read request body once
  const bodyText = await req.text();
  const contentType = req.headers.get('content-type') || '';

  // Accept raw MIME POST (e.g. from Mailgun, SendGrid Inbound, Cloudmailin, or manual .eml post)
  const isRawMime =
    contentType.toLowerCase().includes('message/rfc822') ||
    contentType.toLowerCase().includes('multipart/') ||
    (/^(From:|To:|Subject:|MIME-Version:)/m.test(bodyText) && bodyText.includes('\n'));
  if (isRawMime && bodyText.length > 50) {
    if (!hasValidInboundWebhookSecret(req) && !isInternalCaller(req)) {
      return jsonResponse({ success: false, error: 'Unauthorized raw MIME request' }, 401);
    }
    console.log('📧 Processing raw MIME POST (full email body received)');
    const receipt = buildReceiptFromRawMime(bodyText);
    console.log('📧 Parsed From:', receipt.mail.source, 'To:', receipt.mail.destination, 'Subject:', receipt.mail.commonHeaders.subject);
    const result = await processEmailFromS3('tavari-incoming-emails', null, receipt, bodyText);
    console.log('📧 Raw MIME processing result:', result);
    return jsonResponse({
      success: result.success,
      processed: result.processed || 0,
      message: result.success ? `Processed ${result.processed || 0} email(s)` : result.error
    }, result.success ? 200 : 500);
  }

  // Handle manual email body fetch request
  try {
    const body = JSON.parse(bodyText);
    
    if (body.action === 'fetch-body' && body.email_id) {
      const authContext = await createAuthenticatedUserClient(req);
      if (!authContext) {
        return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
      }
      console.log(`📧 Fetching email body for email_id: ${body.email_id}`);
      
      // Get email record from database
      const { data: emailRecord, error: fetchError } = await authContext.client
        .from('received_emails')
        .select('id, business_id, raw_email_text, body_text, body_html')
        .eq('id', body.email_id)
        .single();
      
      if (fetchError || !emailRecord) {
        return jsonResponse({ success: false, error: 'Email not found' }, 404);
      }
      
      // If body already exists, return it
      if (emailRecord.body_text || emailRecord.body_html) {
        return jsonResponse({
          success: true,
          body_text: emailRecord.body_text,
          body_html: emailRecord.body_html
        });
      }
      
      // Extract S3 path from raw_email_text
      if (!emailRecord.raw_email_text || !emailRecord.raw_email_text.startsWith('s3://')) {
        return jsonResponse({ success: false, error: 'No S3 path available' }, 400);
      }
      
      const s3Path = emailRecord.raw_email_text.replace('s3://', '');
      const [bucketName, ...keyParts] = s3Path.split('/');
      const objectKey = keyParts.join('/');
      
      console.log(`📧 Fetching from S3: ${bucketName}/${objectKey}`);
      
      // Fetch email body from S3
      const emailContent = await fetchEmailFromS3(bucketName, objectKey);
      
      if (!emailContent.bodyText && !emailContent.bodyHtml) {
        return jsonResponse({ success: false, error: 'Could not extract email body from S3' }, 500);
      }
      
      // Update email record with body content
      const { error: updateError } = await authContext.client
        .from('received_emails')
        .update({
          body_text: emailContent.bodyText,
          body_html: emailContent.bodyHtml,
          size_bytes: emailContent.size
        })
        .eq('id', body.email_id);
      
      if (updateError) {
        console.error('Error updating email body:', updateError);
        return jsonResponse({ success: false, error: 'Failed to update email record' }, 500);
      }
      
      return jsonResponse({
        success: true,
        body_text: emailContent.bodyText,
        body_html: emailContent.bodyHtml
      });
    }
  } catch (error) {
    // If parsing fails, continue with normal SNS processing
    console.log("📧 Not a fetch-body request, continuing with SNS processing");
  }

  console.log("📧 ========== RECEIVE-EMAIL FUNCTION CALLED ==========");
  console.log("📧 Request method:", req.method);
  console.log("📧 Request URL:", req.url);
  console.log("📧 Timestamp:", new Date().toISOString());

  let body: SNSMessage;
  try {
    console.log("📧 Raw request body length:", bodyText.length);
    console.log("📧 Raw request body (first 1000 chars):", bodyText.substring(0, 1000));
    body = JSON.parse(bodyText);
    console.log("📧 Parsed body type:", body.Type);
    console.log("📧 Body keys:", Object.keys(body));
  } catch (error) {
    console.error("❌ Invalid JSON payload:", error);
    return new Response("Bad Request", { status: 400, headers: corsHeaders });
  }

  const snsVerified = await verifySnsSignature(body);
  if (!snsVerified) {
    console.error("❌ Invalid SNS signature");
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  // Handle SNS subscription confirmation
  if (body.Type === "SubscriptionConfirmation") {
    console.log("✅ Processing subscription confirmation");
    const subscribeUrl = body.SubscribeURL;
    if (subscribeUrl) {
      try {
        console.log("📧 Confirming subscription at:", subscribeUrl);
        const confirmResponse = await fetch(subscribeUrl);
        console.log("📧 Subscription confirmation response status:", confirmResponse.status);
        const confirmText = await confirmResponse.text();
        console.log("📧 Subscription confirmation response:", confirmText.substring(0, 200));
        console.log("✅ SNS subscription confirmed successfully");
      } catch (error) {
        console.error("❌ Failed to confirm subscription:", error);
      }
    } else {
      console.warn("⚠️ No SubscribeURL in subscription confirmation");
    }
    return new Response("Subscription confirmed", { 
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/plain" }
    });
  }

  // Handle SNS notification
  if (body.Type === "Notification" && body.Message) {
    let sesNotification: any;
    try {
      sesNotification = JSON.parse(body.Message);
      console.log("📧 Parsed SES notification:", JSON.stringify(sesNotification).substring(0, 500));
    } catch (error) {
      console.error("Failed to parse SNS message:", error);
      return new Response("Bad Request", { status: 400, headers: corsHeaders });
    }

    // Check notification type
    const notificationType = sesNotification?.notificationType;
    console.log("📧 Notification type:", notificationType);
    console.log("📧 Has receipt:", !!sesNotification.receipt);
    console.log("📧 Has mail:", !!sesNotification.mail);
    console.log("📧 Full notification keys:", Object.keys(sesNotification));

    // Handle incoming email receipt (from SES receipt rule)
    if (notificationType === "Received" && sesNotification.mail) {
      console.log("📧 Processing Received notification");
      console.log("📧 Mail destination:", sesNotification.mail.destination);
      
      // Check if there's a receipt with action
      if (sesNotification.receipt?.action) {
        const action = sesNotification.receipt.action;
        console.log("📧 Receipt action:", JSON.stringify(action));
        
        // Handle S3 action (SES stores emails in S3)
        if (action.type === "S3" && action.bucketName && action.objectKey) {
          console.log("📧 Processing S3 action");
          const result = await processEmailFromS3(
            action.bucketName,
            action.objectKey,
            sesNotification
          );
          
          if (result.success) {
            console.log("✅ Successfully processed email");
            return new Response(
              JSON.stringify({ 
                success: true, 
                processed: result.processed,
                message: `Processed ${result.processed} email(s)` 
              }),
              { 
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              }
            );
          } else {
            console.error("❌ Failed to process email:", result.error);
            return new Response(
              JSON.stringify({ 
                success: false, 
                error: result.error 
              }),
              { 
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              }
            );
          }
        } else {
          console.log("📧 Action type is not S3 or missing bucket/key:", action.type, action.bucketName, action.objectKey);
        }
      }
      
      // Process directly from mail data (no S3 action): use SES content if present (raw MIME, up to 150KB)
      console.log("📧 Processing from mail data (no receipt action or different action type)");
      let rawContent: string | undefined;
      if (sesNotification.content != null) {
        const c = sesNotification.content;
        if (typeof c === 'string') {
          rawContent = /^[A-Za-z0-9+/=]+$/.test(c.replace(/\s/g, '')) ? atob(c) : c;
        }
      }
      console.log("📧 SES notification has content:", !!rawContent, rawContent ? `(${rawContent.length} chars)` : "(missing – configure receipt rule to include email body)");
      const result = await processEmailFromS3(
        'tavari-incoming-emails',
        null,
        sesNotification,
        rawContent
      );
      
      console.log("📧 Processing result:", result);
      return new Response(
        JSON.stringify({ 
          success: result.success, 
          processed: result.processed || 0,
          message: result.success ? `Processed ${result.processed || 0} email(s)` : result.error
        }),
        { 
          status: result.success ? 200 : 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    } else {
      console.log("📧 Unhandled notification - type:", notificationType, "has mail:", !!sesNotification.mail, "has receipt:", !!sesNotification.receipt);
    }

    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  return new Response("Ignored", { status: 200, headers: corsHeaders });
});

