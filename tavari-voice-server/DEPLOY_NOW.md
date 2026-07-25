# Deploy Tavari Voice Server - Step by Step

## Option 1: Railway (Recommended - Easiest)

### Step 1: Sign Up for Railway
1. Go to https://railway.app
2. Click **"Start a New Project"**
3. Sign up with **GitHub** (easiest option)

### Step 2: Create New Project
1. Click **"New Project"**
2. Select **"Deploy from GitHub repo"**
3. Authorize Railway to access your GitHub
4. Select your repository: `tavari-core-frontend`
5. Railway will detect it's a Node.js project

### Step 3: Configure the Service
1. Railway will create a service automatically
2. Click on the service to open settings
3. Go to **"Settings"** tab
4. Set the **Root Directory** to: `tavari-voice-server`
   - This tells Railway where your Node.js app is

### Step 4: Add Environment Variables
1. Go to **"Variables"** tab
2. Click **"New Variable"** and add each one:

```
PORT=3000
SUPABASE_URL=https://iagcamwcfuiopmwefohz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
TELNYX_API_KEY=your_telnyx_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
TAVARI_VOICE_SERVER_URL=https://your-app-name.railway.app
```

⚠️ **CRITICAL:** `TELNYX_API_KEY` is REQUIRED! Without it, the voice agent cannot answer calls or process audio. Get it from https://portal.telnyx.com/app/api-keys

**Important:** 
- Copy the values from your local `.env` file
- For `TAVARI_VOICE_SERVER_URL`, you'll need to update it AFTER deployment with your actual Railway URL

### Step 5: Deploy
1. Railway will automatically start deploying
2. Watch the logs in the **"Deployments"** tab
3. Wait for "Deploy successful" message
4. Railway will give you a URL like: `https://your-app-name.railway.app`

### Step 6: Update TAVARI_VOICE_SERVER_URL
1. Once you have your Railway URL, go back to **"Variables"**
2. Update `TAVARI_VOICE_SERVER_URL` to your actual Railway URL
3. Railway will automatically redeploy

### Step 7: Test
1. Visit: `https://your-app-name.railway.app/health`
2. Should return: `{"status":"ok","timestamp":"..."}`

---

## Option 2: Render (Free Tier)

### Step 1: Sign Up
1. Go to https://render.com
2. Sign up with GitHub

### Step 2: Create Web Service
1. Click **"New"** → **"Web Service"**
2. Connect your GitHub repository
3. Select `tavari-core-frontend`

### Step 3: Configure
- **Name:** `tavari-voice-server`
- **Root Directory:** `tavari-voice-server`
- **Environment:** `Node`
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Plan:** `Free`

### Step 4: Add Environment Variables
Click **"Environment"** and add all variables (same as Railway)

### Step 5: Deploy
Click **"Create Web Service"** and wait for deployment

---

## Option 3: Fly.io

### Step 1: Install Fly CLI
```bash
npm install -g @fly/cli
```

### Step 2: Sign Up
```bash
fly auth signup
```

### Step 3: Launch
```bash
cd tavari-voice-server
fly launch
```

### Step 4: Add Secrets
```bash
fly secrets set SUPABASE_URL=your_url
fly secrets set SUPABASE_SERVICE_ROLE_KEY=your_key
fly secrets set OPENAI_API_KEY=your_key
fly secrets set TAVARI_VOICE_SERVER_URL=https://your-app.fly.dev
```

### Step 5: Deploy
```bash
fly deploy
```

---

## After Deployment

Once deployed, you'll have a URL like:
- Railway: `https://your-app.railway.app`
- Render: `https://your-app.onrender.com`
- Fly.io: `https://your-app.fly.dev`

**Save this URL** - you'll need it for:
1. Telnyx webhook configuration
2. Updating `TAVARI_VOICE_SERVER_URL` environment variable

## Next Steps

After deployment:
1. ✅ Test the health endpoint
2. ✅ Configure Telnyx webhooks (see `TELNYX_WEBHOOK_SETUP.md`)
3. ✅ Update Supabase configuration with webhook URL

