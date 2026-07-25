# Get full email: add S3 to your SES receipt rule

SES only sends the full message when you use the **Deliver to S3** action. Do this once.

---

## 1. Create S3 bucket

- AWS Console → **S3** → Create bucket  
- Name: e.g. `tavari-incoming-emails`  
- **Region: same as your SES receiving** (e.g. us-east-2)  
- Create (no need to enable Block Public Access for this use case; bucket is for SES only)

---

## 2. Let SES write to the bucket

- Open the bucket → **Permissions** → **Bucket policy** → Edit  
- Paste this (replace the 4 placeholders):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSESPuts",
      "Effect": "Allow",
      "Principal": { "Service": "ses.amazonaws.com" },
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::tavari-incoming-emails/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceAccount": "YOUR_AWS_ACCOUNT_ID",
          "AWS:SourceArn": "arn:aws:ses:us-east-2:YOUR_AWS_ACCOUNT_ID:receipt-rule-set/YOUR_RULE_SET_NAME:receipt-rule/YOUR_RULE_NAME"
        }
      }
    }
  ]
}
```

Replace:

- `tavari-incoming-emails` → your bucket name if different  
- `YOUR_AWS_ACCOUNT_ID` → 12-digit account ID (AWS Console top-right, or run `aws sts get-caller-identity`)  
- `us-east-2` → your SES receiving region if different  
- `YOUR_RULE_SET_NAME` → SES → Email receiving → Receipt rule sets → the rule set that has your rule (e.g. default)  
- `YOUR_RULE_NAME` → the receipt rule that currently sends to SNS (the one you’ll add S3 to)

Save.

---

## 3. Add S3 action to the receipt rule

- AWS Console → **SES** → **Email receiving** → **Receipt rules**  
- Open the **rule set** that’s in use (e.g. default)  
- Click the **receipt rule** that publishes to SNS (the one that calls your Supabase function)  
- **Add action** → **Deliver to S3 bucket**  
  - S3 bucket: select `tavari-incoming-emails` (or Create bucket if you prefer)  
  - Object key prefix: leave empty (or e.g. `incoming/`)  
  - **SNS topic**: select the **same SNS topic** you already use for this rule (so the same webhook still gets called, but the notification will now include S3 bucket/key)  
- Save

**Order:** S3 action can be first, then SNS, or both on the same rule. The notification that hits your function will include `receipt.action.type === "S3"` with `bucketName` and `objectKey`.

---

## 4. Supabase / function

- Your function already uses `bucketName` and `objectKey` from the notification to fetch the full email from S3.  
- Ensure the Edge function has **AWS credentials** (e.g. `SES_ACCESS_KEY_ID` / `SES_SECRET_ACCESS_KEY` or an IAM role that can read from that bucket). Those are used by the S3 client in the function to `GetObject` from the bucket.

---

## 5. Test

Send an email to your accounting inbox. In Supabase logs you should see the function fetching from S3 and processing. Drafts should appear in the Queue.
