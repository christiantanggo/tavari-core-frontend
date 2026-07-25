# Railway Deployment Checklist

## ✅ Pre-Deployment Checklist

### 1. Code is Ready
- [x] Environment variable validation added
- [x] Railway configuration file (`railway.json`) exists
- [x] `package.json` has correct start script
- [x] All dependencies are listed in `package.json`

### 2. Environment Variables to Set in Railway

Before deploying, make sure you have these values ready:

**Required Variables:**
- `PORT` - Railway will set this automatically, but you can set it to `3000` if needed
- `SUPABASE_URL` - Your Supabase project URL (e.g., `https://iagcamwcfuiopmwefohz.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key (starts with `eyJ...`)
- `OPENAI_API_KEY` - Your OpenAI API key (starts with `sk-...`)
- `TAVARI_VOICE_SERVER_URL` - Will be set AFTER deployment (see Step 6)

## 🚀 Step-by-Step Deployment

### Step 1: Sign Up / Login to Railway
1. Go to https://railway.app
2. Sign up with GitHub (if new) or login (if existing)

### Step 2: Create New Project
1. Click **"New Project"**
2. Select **"Deploy from GitHub repo"**
3. Authorize Railway to access your GitHub (if first time)
4. Select repository: `tavari-core-frontend`
5. Railway will auto-detect it's a Node.js project

### Step 3: Configure Root Directory
1. Railway creates a service automatically
2. Click on the service name
3. Go to **"Settings"** tab
4. Find **"Root Directory"** field
5. Set it to: `tavari-voice-server`
6. Click **"Save"**

### Step 4: Add Environment Variables
1. Go to **"Variables"** tab in Railway
2. Click **"New Variable"** for each one:

```
PORT=3000
SUPABASE_URL=https://iagcamwcfuiopmwefohz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_actual_service_role_key_here
OPENAI_API_KEY=your_actual_openai_api_key_here
TAVARI_VOICE_SERVER_URL=https://placeholder.railway.app
```

**Important Notes:**
- Replace `your_actual_service_role_key_here` with your real Supabase service role key
- Replace `your_actual_openai_api_key_here` with your real OpenAI API key
- For `TAVARI_VOICE_SERVER_URL`, use a placeholder for now (we'll update it after deployment)

### Step 5: Deploy
1. Railway will automatically start deploying after you save variables
2. Go to **"Deployments"** tab to watch the build logs
3. Wait for "Deploy successful" message
4. Check for any errors in the logs

### Step 6: Get Your Railway URL
1. After successful deployment, go to **"Settings"** tab
2. Scroll to **"Domains"** section
3. Railway will show your URL (e.g., `https://tavari-voice-server-production.up.railway.app`)
4. Copy this URL

### Step 7: Update TAVARI_VOICE_SERVER_URL
1. Go back to **"Variables"** tab
2. Find `TAVARI_VOICE_SERVER_URL`
3. Update it to your actual Railway URL (from Step 6)
4. Railway will automatically redeploy

### Step 8: Test Deployment
1. Visit: `https://your-app-name.railway.app/health`
2. Should return: `{"status":"ok","timestamp":"..."}`
3. Visit: `https://your-app-name.railway.app/`
4. Should return service information

## 🔍 Troubleshooting

### Deployment Fails with "Missing Environment Variable"
- Check that all required variables are set in Railway
- Verify variable names match exactly (case-sensitive)
- Make sure there are no extra spaces

### Server Starts but Health Check Fails
- Check Railway logs for errors
- Verify Supabase URL and keys are correct
- Verify OpenAI API key is valid

### WebSocket Connections Not Working
- Railway supports WebSockets on the same port as HTTP
- Make sure your Railway URL uses HTTPS (Railway provides this automatically)

### Build Fails
- Check that `package.json` is correct
- Verify all dependencies are listed
- Check Railway build logs for specific errors

## 📝 Post-Deployment

After successful deployment:

1. ✅ Test the health endpoint
2. ✅ Update Telnyx webhook URL to point to your Railway URL
3. ✅ Update any frontend code that references the voice server URL
4. ✅ Monitor Railway logs for any runtime errors

## 💰 Railway Pricing

- **Free Tier**: $5/month credit (usually enough for low traffic)
- **Usage**: Pay-as-you-go after free credit
- **Monitoring**: Check usage in Railway dashboard

## 🔗 Useful Links

- Railway Dashboard: https://railway.app/dashboard
- Railway Docs: https://docs.railway.app
- Your Supabase Dashboard: https://supabase.com/dashboard
- OpenAI Dashboard: https://platform.openai.com


## ✅ Pre-Deployment Checklist

### 1. Code is Ready
- [x] Environment variable validation added
- [x] Railway configuration file (`railway.json`) exists
- [x] `package.json` has correct start script
- [x] All dependencies are listed in `package.json`

### 2. Environment Variables to Set in Railway

Before deploying, make sure you have these values ready:

**Required Variables:**
- `PORT` - Railway will set this automatically, but you can set it to `3000` if needed
- `SUPABASE_URL` - Your Supabase project URL (e.g., `https://iagcamwcfuiopmwefohz.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key (starts with `eyJ...`)
- `OPENAI_API_KEY` - Your OpenAI API key (starts with `sk-...`)
- `TAVARI_VOICE_SERVER_URL` - Will be set AFTER deployment (see Step 6)

## 🚀 Step-by-Step Deployment

### Step 1: Sign Up / Login to Railway
1. Go to https://railway.app
2. Sign up with GitHub (if new) or login (if existing)

### Step 2: Create New Project
1. Click **"New Project"**
2. Select **"Deploy from GitHub repo"**
3. Authorize Railway to access your GitHub (if first time)
4. Select repository: `tavari-core-frontend`
5. Railway will auto-detect it's a Node.js project

### Step 3: Configure Root Directory
1. Railway creates a service automatically
2. Click on the service name
3. Go to **"Settings"** tab
4. Find **"Root Directory"** field
5. Set it to: `tavari-voice-server`
6. Click **"Save"**

### Step 4: Add Environment Variables
1. Go to **"Variables"** tab in Railway
2. Click **"New Variable"** for each one:

```
PORT=3000
SUPABASE_URL=https://iagcamwcfuiopmwefohz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_actual_service_role_key_here
OPENAI_API_KEY=your_actual_openai_api_key_here
TAVARI_VOICE_SERVER_URL=https://placeholder.railway.app
```

**Important Notes:**
- Replace `your_actual_service_role_key_here` with your real Supabase service role key
- Replace `your_actual_openai_api_key_here` with your real OpenAI API key
- For `TAVARI_VOICE_SERVER_URL`, use a placeholder for now (we'll update it after deployment)

### Step 5: Deploy
1. Railway will automatically start deploying after you save variables
2. Go to **"Deployments"** tab to watch the build logs
3. Wait for "Deploy successful" message
4. Check for any errors in the logs

### Step 6: Get Your Railway URL
1. After successful deployment, go to **"Settings"** tab
2. Scroll to **"Domains"** section
3. Railway will show your URL (e.g., `https://tavari-voice-server-production.up.railway.app`)
4. Copy this URL

### Step 7: Update TAVARI_VOICE_SERVER_URL
1. Go back to **"Variables"** tab
2. Find `TAVARI_VOICE_SERVER_URL`
3. Update it to your actual Railway URL (from Step 6)
4. Railway will automatically redeploy

### Step 8: Test Deployment
1. Visit: `https://your-app-name.railway.app/health`
2. Should return: `{"status":"ok","timestamp":"..."}`
3. Visit: `https://your-app-name.railway.app/`
4. Should return service information

## 🔍 Troubleshooting

### Deployment Fails with "Missing Environment Variable"
- Check that all required variables are set in Railway
- Verify variable names match exactly (case-sensitive)
- Make sure there are no extra spaces

### Server Starts but Health Check Fails
- Check Railway logs for errors
- Verify Supabase URL and keys are correct
- Verify OpenAI API key is valid

### WebSocket Connections Not Working
- Railway supports WebSockets on the same port as HTTP
- Make sure your Railway URL uses HTTPS (Railway provides this automatically)

### Build Fails
- Check that `package.json` is correct
- Verify all dependencies are listed
- Check Railway build logs for specific errors

## 📝 Post-Deployment

After successful deployment:

1. ✅ Test the health endpoint
2. ✅ Update Telnyx webhook URL to point to your Railway URL
3. ✅ Update any frontend code that references the voice server URL
4. ✅ Monitor Railway logs for any runtime errors

## 💰 Railway Pricing

- **Free Tier**: $5/month credit (usually enough for low traffic)
- **Usage**: Pay-as-you-go after free credit
- **Monitoring**: Check usage in Railway dashboard

## 🔗 Useful Links

- Railway Dashboard: https://railway.app/dashboard
- Railway Docs: https://docs.railway.app
- Your Supabase Dashboard: https://supabase.com/dashboard
- OpenAI Dashboard: https://platform.openai.com


