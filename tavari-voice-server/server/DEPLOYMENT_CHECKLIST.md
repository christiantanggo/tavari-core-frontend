# Deployment Checklist - AWS Chime Voice Agent

## ✅ Code Changes Status

All code changes are **COMPLETE**:
- ✅ Server code updated to use Supabase Edge Functions
- ✅ Email/SMS/Booking all route through Supabase
- ✅ AWS SDK removed from server
- ✅ Supabase Edge Function updated to use `SES_ACCESS_KEY_ID` and `SES_SECRET_ACCESS_KEY`

## Step 1: Verify Supabase Edge Function Secrets

### Check if these secrets exist in Supabase:

1. Go to **Supabase Dashboard** → Your Project
2. Navigate to: **Settings** → **Edge Functions** → **Secrets**
3. Verify these secrets exist:
   - ✅ `SES_ACCESS_KEY_ID` (should already exist)
   - ✅ `SES_SECRET_ACCESS_KEY` (should already exist)
   - ✅ `AWS_REGION` (should already exist)
   - ⚠️ `AWS_SES_FROM_EMAIL` or `EMAIL_FROM_ADDRESS` (add if missing)

### If `AWS_SES_FROM_EMAIL` is missing:

1. Click **"Add new secret"**
2. Name: `AWS_SES_FROM_EMAIL`
3. Value: Your verified SES email (e.g., `noreply@yourdomain.com`)
4. Click **"Save"**

**Note:** The Edge Function will use `noreply@tavari.com` as fallback if not set, but it's better to set it explicitly.

## Step 2: Add Railway Environment Variables

### Step-by-Step Instructions:

1. **Go to Railway Dashboard**
   - Visit: https://railway.app
   - Log in to your account

2. **Select Your Project**
   - Click on your project (or create new one if needed)

3. **Open Service Settings**
   - Click on your service (or create new service)
   - Click on the service name/icon
   - Go to **"Variables"** tab (or **"Settings"** → **"Variables"**)

4. **Add Environment Variables**

   You need to add **ONE new variable**:

   **Variable Name:** `OPENAI_API_KEY`
   - Click **"New Variable"** or **"Add Variable"**
   - Key: `OPENAI_API_KEY`
   - Value: Your OpenAI API key (starts with `sk-`)
   - Click **"Add"** or **"Save"**

   **Verify existing variables:**
   - ✅ `SUPABASE_URL` (should already exist)
   - ✅ `SUPABASE_SERVICE_ROLE_KEY` (should already exist)

5. **Set Root Directory (if creating new service)**
   - Go to **"Settings"** tab
   - Find **"Root Directory"** or **"Source"**
   - Set to: `tavari-voice-server/server`
   - Click **"Save"**

6. **Deploy**
   - Railway will automatically detect changes and redeploy
   - Or click **"Redeploy"** button if needed

## Step 3: Verify Deployment

1. **Check Railway Logs**
   - Go to **"Deployments"** tab
   - Click on latest deployment
   - Check logs for:
     - ✅ "Tavari Voice Agent server running on port 3000"
     - ✅ "All required environment variables are set"
     - ❌ Should NOT see "Missing environment variables"

2. **Test Health Endpoint**
   - Copy your Railway domain (e.g., `your-app.railway.app`)
   - Visit: `https://your-app.railway.app/health`
   - Should return: `{"status":"ok",...}`

## Step 4: Configure AWS Chime (After Railway is Live)

1. **Get Railway Webhook URL**
   - Your webhook URL: `https://your-app.railway.app/chime/inbound`

2. **Create SIP Media Application in AWS Chime**
   - Go to AWS Chime Console
   - Navigate to "SIP Media Applications"
   - Click "Create SIP Media Application"
   - Name: `tavari-voice-agent`
   - Endpoint: `https://your-app.railway.app/chime/inbound`
   - Click "Create"

3. **Assign to Phone Number**
   - Go to "Phone Numbers" in Chime Console
   - Select your phone number
   - Under "SIP Media Application", select your new application
   - Save

## Summary

### What's Done:
- ✅ All code changes complete
- ✅ Supabase Edge Function updated
- ✅ Server ready for deployment

### What You Need to Do:
1. ✅ Verify Supabase secrets (add `AWS_SES_FROM_EMAIL` if missing)
2. ✅ Add `OPENAI_API_KEY` to Railway
3. ✅ Deploy to Railway
4. ✅ Configure AWS Chime webhook

### Files Changed (for reference):
- `tavari-voice-server/server/src/email.js` - Now calls Supabase Edge Function
- `supabase/functions/custom-voice-agent-functions/index.ts` - Uses `SES_ACCESS_KEY_ID`
- `tavari-voice-server/server/package.json` - Removed AWS SDK
- All other files unchanged

**You're ready to deploy! 🚀**

