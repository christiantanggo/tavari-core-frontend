# Environment Variables Setup

## Railway Environment Variables (Minimal)

You only need **3 variables** in Railway:

1. `OPENAI_API_KEY` - Your OpenAI API key (starts with `sk-`)
2. `SUPABASE_URL` - Your Supabase project URL
3. `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key

## Supabase Edge Function Secrets

All AWS SES credentials and other sensitive data are stored in **Supabase Edge Function secrets**, not in Railway.

### Required Supabase Edge Function Secrets

For the `custom-voice-agent-functions` Edge Function, ensure these secrets are set:

1. `SES_ACCESS_KEY_ID` - AWS SES access key ID
2. `SES_SECRET_ACCESS_KEY` - AWS SES secret access key
3. `AWS_REGION` - AWS region (e.g., `us-east-1`)
4. `AWS_SES_FROM_EMAIL` or `EMAIL_FROM_ADDRESS` - Verified SES email address
5. `TELNYX_API_KEY` - For SMS functionality (if using SMS)

### How to Set Supabase Edge Function Secrets

1. Go to Supabase Dashboard
2. Navigate to: **Project Settings** → **Edge Functions** → **Secrets**
3. Add each secret:
   - `SES_ACCESS_KEY_ID` = (your AWS access key)
   - `SES_SECRET_ACCESS_KEY` = (your AWS secret key)
   - `AWS_REGION` = `us-east-1` (or your region)
   - `AWS_SES_FROM_EMAIL` = `noreply@yourdomain.com`
   - `TELNYX_API_KEY` = (your Telnyx API key, if using SMS)

### Benefits

✅ **Single source of truth** - All credentials in Supabase  
✅ **No Railway updates needed** - Just set once in Supabase  
✅ **Secure** - Credentials never exposed in Railway logs  
✅ **Easy updates** - Change credentials in one place (Supabase)

## Local Development

For local development, create a `.env` file in `server/` directory:

```env
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

AWS SES credentials are not needed locally - they're handled by Supabase Edge Functions.

