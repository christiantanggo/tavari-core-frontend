# Environment Variables Setup Guide

## Where to Create the .env File

Create a `.env` file in the `tavari-voice-server` folder:

```
tavari-voice-server/
  ├── .env          ← Create this file here
  ├── index.js
  ├── package.json
  └── ...
```

## Step-by-Step Setup

### Step 1: Create the .env File

1. Navigate to the `tavari-voice-server` folder
2. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Or manually create a new file named `.env`

### Step 2: Get Your Supabase Credentials

1. **Go to Supabase Dashboard:**
   - Visit: https://supabase.com/dashboard
   - Select your project

2. **Get Supabase URL:**
   - Go to **Settings** → **API**
   - Copy the **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - This is your `SUPABASE_URL`

3. **Get Service Role Key:**
   - Still in **Settings** → **API**
   - Scroll to **Project API keys**
   - Copy the **service_role** key (⚠️ Keep this secret!)
   - This is your `SUPABASE_SERVICE_ROLE_KEY`

### Step 3: Get Your Telnyx API Key

1. **Go to Telnyx Dashboard:**
   - Visit: https://portal.telnyx.com
   - Sign in to your account

2. **Navigate to API Keys:**
   - Click on your profile icon (top right)
   - Select **"API Keys"** or go to **"Settings"** → **"API Keys"**
   - Or go directly to: https://portal.telnyx.com/app/api-keys

3. **Get or Create API Key:**
   - If you already have an API key, copy it
   - If not, click **"Create API Key"**
   - Give it a name (e.g., "Tavari Voice Server")
   - Copy the key immediately - it will look like: `KEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
   - ⚠️ **IMPORTANT:** This key is required for the voice agent to answer calls and process audio

### Step 4: Get Your OpenAI API Key

1. **Go to OpenAI Platform:**
   - Visit: https://platform.openai.com
   - Sign in or create an account

2. **Navigate to API Keys:**
   - Click your profile icon (top right)
   - Select **"API keys"** from the menu
   - Or go directly to: https://platform.openai.com/api-keys

3. **Create a New API Key:**
   - Click **"Create new secret key"**
   - Give it a name (e.g., "Tavari Voice Server")
   - Click **"Create secret key"**
   - ⚠️ **IMPORTANT:** Copy the key immediately - you won't see it again!
   - It will look like: `sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

4. **Add Credits (if needed):**
   - Go to: https://platform.openai.com/account/billing
   - Add payment method and credits
   - OpenAI API costs ~$0.01-0.02 per 1K tokens

### Step 5: Fill in Your .env File

Open `.env` and fill in the values:

```env
# Server Configuration
PORT=3000
TAVARI_VOICE_SERVER_URL=http://localhost:3000

# Supabase Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Telnyx Configuration (REQUIRED for voice agent to work!)
TELNYX_API_KEY=KEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# OpenAI Configuration
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Step 6: Test Your Configuration

1. **Start the server:**
   ```bash
   cd tavari-voice-server
   npm start
   ```

2. **Check if it starts without errors:**
   - Should see: `🚀 Tavari Voice Server running on port 3000`
   - If you see errors about missing variables, check your .env file

3. **Test the health endpoint:**
   ```bash
   curl http://localhost:3000/health
   ```
   Should return: `{"status":"ok","timestamp":"..."}`

## Security Notes

⚠️ **IMPORTANT:**
- Never commit `.env` to Git (it's already in `.gitignore`)
- Never share your API keys publicly
- The `SUPABASE_SERVICE_ROLE_KEY` has admin access - keep it secret!
- The `OPENAI_API_KEY` can be used to make API calls on your account

## After Deployment

When you deploy to Railway/Render/Fly.io/AWS, you'll need to:
1. Add these same environment variables in your hosting platform's dashboard:
   - `PORT=3000`
   - `SUPABASE_URL=your_supabase_url`
   - `SUPABASE_SERVICE_ROLE_KEY=your_service_role_key`
   - `TELNYX_API_KEY=your_telnyx_api_key` ⚠️ **REQUIRED!**
   - `OPENAI_API_KEY=your_openai_api_key`
   - `TAVARI_VOICE_SERVER_URL=https://your-production-url.com`
2. Update `TAVARI_VOICE_SERVER_URL` to your production URL
   - Example: `https://your-app.railway.app`

## Troubleshooting

**"Missing SUPABASE_URL" error:**
- Check that `.env` file exists in `tavari-voice-server` folder
- Check that variable names match exactly (case-sensitive)
- Make sure there are no spaces around the `=` sign

**"Invalid API key" error:**
- Verify your OpenAI API key is correct
- Check that you have credits in your OpenAI account
- Make sure the key starts with `sk-`

**"Cannot connect to Supabase" error:**
- Verify your Supabase URL is correct
- Check that your Service Role Key is correct
- Make sure your Supabase project is active

**"Missing TELNYX_API_KEY" error:**
- Check that TELNYX_API_KEY is set in your .env file
- Verify the key is correct in Telnyx Dashboard
- Make sure there are no spaces around the `=` sign
- This key is REQUIRED for the voice agent to answer calls and process audio

**Voice agent not responding to calls:**
- Verify TELNYX_API_KEY is set correctly
- Check that the webhook URL is configured in Telnyx Dashboard
- Make sure the phone number is connected to the webhook
- Check server logs for errors when calls come in

