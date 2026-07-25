# Tavari Voice Server - Deployment Guide

## Hosting Explanation

**Important:** The Tavari Voice Server is a **separate Node.js service** that needs to run continuously (24/7) to handle real-time voice calls. 

- **Vercel** (where your website is hosted) is for **serverless functions** and **static sites** - it's not suitable for long-running WebSocket connections
- The **Voice Server** needs **persistent hosting** that can keep WebSocket connections alive

## Free Hosting Options

### Option 1: Railway (Recommended - Easiest)
**Free Tier:** $5/month credit (usually enough for low traffic)

1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your repository
5. Railway will auto-detect it's a Node.js app
6. Add environment variables:
   ```
   PORT=3000
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   TELNYX_API_KEY=your_telnyx_api_key
   OPENAI_API_KEY=your_openai_api_key
   TAVARI_VOICE_SERVER_URL=https://your-app-name.railway.app
   ```
   
   ⚠️ **CRITICAL:** `TELNYX_API_KEY` is REQUIRED! Without it, calls will be answered but the AI agent won't respond. Get it from https://portal.telnyx.com/app/api-keys
7. Deploy! Railway gives you a URL like: `https://your-app-name.railway.app`

### Option 2: Render (Free Tier Available)
**Free Tier:** 750 hours/month (enough for 24/7 if you're the only user)

1. Go to [render.com](https://render.com)
2. Sign up
3. Click "New" → "Web Service"
4. Connect your GitHub repo
5. Settings:
   - **Name:** tavari-voice-server
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
6. Add environment variables (same as Railway)
7. Deploy! Render gives you: `https://tavari-voice-server.onrender.com`

### Option 3: Fly.io (Free Tier Available)
**Free Tier:** 3 shared VMs, 3GB storage

1. Install Fly CLI: `npm install -g @fly/cli`
2. Sign up: `fly auth signup`
3. In `tavari-voice-server` folder, run: `fly launch`
4. Follow prompts
5. Add secrets:
   ```bash
   fly secrets set SUPABASE_URL=your_url
   fly secrets set SUPABASE_SERVICE_ROLE_KEY=your_key
   fly secrets set TELNYX_API_KEY=your_telnyx_key
   fly secrets set OPENAI_API_KEY=your_key
   fly secrets set TAVARI_VOICE_SERVER_URL=https://your-app.fly.dev
   ```
   
   ⚠️ **CRITICAL:** `TELNYX_API_KEY` is REQUIRED! Without it, the voice agent cannot answer calls or process audio.
6. Deploy: `fly deploy`

## After Deployment

Once deployed, you'll get a URL like:
- Railway: `https://your-app.railway.app`
- Render: `https://your-app.onrender.com`
- Fly.io: `https://your-app.fly.dev`

**Use this URL for:**
1. Telnyx webhook configuration (see Telnyx setup below)
2. `TAVARI_VOICE_SERVER_URL` environment variable

## Testing

After deployment, test the health endpoint:
```bash
curl https://your-voice-server-url.com/health
```

Should return: `{"status":"ok","timestamp":"..."}`

