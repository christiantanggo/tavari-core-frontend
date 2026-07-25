# receive-email

Processes incoming emails for the accounting inbox: stores the email, converts attachments/body to PDFs, and creates draft expenses that show in the Queue. **File Storage** (`files-…@domain` from `file_storage_settings`) uses the same function and the same SES receipt rule.

## Bounce: `552 5.2.3` / “Message length exceeds limit” / “too large”

Senders see this **before** the Edge Function runs. It almost always means **Amazon SES inbound + SNS** is misconfigured, not that your email is literally huge.

1. **~150 KB SNS limit**  
   If the receipt rule publishes the **full raw email** into SNS (metadata-only mode is OK), SES enforces a **maximum message size of about 150 KB** (headers + body + attachments). Anything over that is **rejected with 552 5.2.3**. HTML signatures, embedded images, or a modest PDF can exceed 150 KB even when the message “looks” small in the inbox.

2. **Required fix**  
   Add **Deliver to S3** on the **same** receipt rule that triggers SNS (see below). The SNS notification should include `receipt.action.type === "S3"` with `bucketName` and `objectKey`. Then this function loads the full message from S3—**well above 150 KB** (up to SES receiving limits, typically tens of MB).

3. **Small mail still bouncing**  
   If SNS cannot deliver to your HTTPS endpoint (permissions, 4xx/5xx, timeout), AWS sometimes surfaces that as **552 5.2.3**. Check **CloudWatch** for the SNS subscription, and confirm `receive-email` returns **200** quickly for SNS `POST` requests.

4. **Same rule for all addresses**  
   `files-{local}@tavarios.ca`, accounting inbox addresses (`slug@domain` when configured, plus legacy `{uuid}@tavarios.ca`), and mailbox addresses should all hit **one** receipt rule that includes **S3 + SNS** as documented in [SES-S3-SETUP.md](./SES-S3-SETUP.md).

## How to make it work

The function needs the **full email body** (and attachments). It accepts two kinds of requests:

### 1. AWS SES (current setup)

SES is receiving the email and calling this function via SNS, but the SNS payload usually contains only **metadata** (from, to, subject), not the raw message. So we can’t parse attachments or turn the body into a PDF.

**Fix:** In the **SES receipt rule** that publishes to SNS, add a **“Save to S3”** action (before or after the SNS action):

1. Create an S3 bucket (e.g. `tavari-incoming-emails`) and give SES permission to write to it.
2. In the receipt rule, add action: **Save to S3** → choose that bucket (optional object key prefix).
3. Leave the SNS action so we still get the notification.

After that, the notification will include `receipt.action.type === "S3"` with `bucketName` and `objectKey`. This function will then fetch the full email from S3 and process it (attachments → PDFs, body → PDF when no attachments, then create drafts). **Without the S3 action, attachment invoices are not uploaded and no draft is created.**

### 2. Raw MIME POST (alternative)

The function also accepts a **raw MIME** body (the full email as sent):

- **Content-Type:** `message/rfc822` or `multipart/*`, or
- **Body:** starts with headers like `From:`, `To:`, `Subject:`.

You can:

- Use an inbound provider (e.g. Mailgun, SendGrid Inbound, Cloudmailin) that POSTs the raw email to this function’s URL.
- Or `curl`/Postman: POST the contents of an `.eml` file to the function URL with `Content-Type: message/rfc822`.

Then the same pipeline runs: parse → PDFs → drafts → Queue.

## Flow once body is available

1. Resolve recipient to business (for example configured `slug@domain` or legacy `{business_id}@tavarios.ca` → accounting inbox).
2. Build upload items: if there are attachments, each → PDF (or pass-through); if none, email body → one PDF.
3. Store `received_emails` and `received_email_attachments`, upload PDFs to `expense-invoices`.
4. For accounting inbox address match + whitelisted sender, call `accounting-process-inbound-invoice` per invoice-like attachment → creates rows in `accounting_draft_expenses` (source `email`).
5. Queue UI shows those under **Emailed invoices**.
