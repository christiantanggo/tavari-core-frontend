# AWS Deployment Guide for Tavari Voice Server

## Important: Why node_modules Must Be Included

The Tavari Voice Server uses ES6 modules (`import` statements) and requires all dependencies to be present. **You MUST include `node_modules` in your deployment zip** for the voice agent to work.

## Step 1: Install Dependencies

Before building the zip, make sure dependencies are installed:

```bash
cd tavari-voice-server
npm install
```

## Step 2: Build Deployment Zip

### Option A: Using PowerShell Script (Windows)

```powershell
cd tavari-voice-server
.\build-deployment-zip.ps1
```

This will create `tavari-voice-server-deployment.zip` with:
- ✅ `index.js` (main server file)
- ✅ `package.json` (dependencies list)
- ✅ `package-lock.json` (exact versions)
- ✅ `node_modules/` (ALL dependencies - REQUIRED!)

### Option B: Manual Zip Creation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create zip file** including:
   - `index.js`
   - `package.json`
   - `package-lock.json`
   - `node_modules/` (entire directory)

3. **Exclude:**
   - `.env` (sensitive data)
   - `*.zip` (old zip files)
   - `*.md` (documentation)
   - `test-*.js` (test files)

## Step 3: Deploy to AWS

### AWS Lambda (Serverless)

**Note:** Lambda has a 50MB limit for direct uploads. If your zip is larger, use S3.

1. **Go to AWS Lambda Console:**
   - https://console.aws.amazon.com/lambda

2. **Create Function:**
   - Click "Create function"
   - Choose "Author from scratch"
   - Runtime: **Node.js 20.x** (or latest)
   - Architecture: x86_64

3. **Upload Zip:**
   - In "Code" tab, click "Upload from" → ".zip file"
   - Select your `tavari-voice-server-deployment.zip`
   - Click "Save"

4. **Configure Handler:**
   - Handler: `index.handler` (if using Lambda wrapper) OR
   - For Express apps, you may need a Lambda adapter (see below)

5. **Set Environment Variables:**
   - Go to "Configuration" → "Environment variables"
   - Add all required variables:
     ```
     PORT=3000
     SUPABASE_URL=your_supabase_url
     SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
     TELNYX_API_KEY=your_telnyx_api_key
     OPENAI_API_KEY=your_openai_api_key
     TAVARI_VOICE_SERVER_URL=https://your-lambda-url.amazonaws.com
     ```
   
   ⚠️ **CRITICAL:** `TELNYX_API_KEY` is REQUIRED! Without it, the voice agent will not work.

6. **Set Timeout:**
   - Go to "Configuration" → "General configuration"
   - Set timeout to **15 minutes** (maximum for Lambda)
   - Set memory to at least **512 MB**

7. **Create API Gateway:**
   - Go to "Configuration" → "Triggers"
   - Click "Add trigger"
   - Select "API Gateway"
   - Create new API or use existing
   - Security: Open (or configure as needed)
   - Click "Add"

8. **Get Webhook URL:**
   - Copy the API Gateway endpoint URL
   - Your webhook URL will be: `https://your-api-id.execute-api.region.amazonaws.com/stage/webhook/telnyx`

### AWS Elastic Beanstalk (Recommended for Express Apps)

Elastic Beanstalk is better suited for Express applications that need to run continuously.

1. **Go to AWS Elastic Beanstalk Console:**
   - https://console.aws.amazon.com/elasticbeanstalk

2. **Create Application:**
   - Click "Create application"
   - Name: `tavari-voice-server`
   - Platform: **Node.js**
   - Platform branch: Latest Node.js version

3. **Upload Zip:**
   - In "Application code", select "Upload your code"
   - Upload `tavari-voice-server-deployment.zip`

4. **Configure Environment:**
   - Environment name: `tavari-voice-server-prod`
   - Domain: (auto-generated or custom)
   - Description: "Tavari Voice Agent Server"

5. **Configure Environment Variables:**
   - Go to "Configuration" → "Software"
   - Click "Edit"
   - Add environment properties:
     ```
     PORT=8080
     SUPABASE_URL=your_supabase_url
     SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
     TELNYX_API_KEY=your_telnyx_api_key
     OPENAI_API_KEY=your_openai_api_key
     TAVARI_VOICE_SERVER_URL=https://your-app.elasticbeanstalk.com
     ```
   
   ⚠️ **CRITICAL:** `TELNYX_API_KEY` is REQUIRED!

6. **Deploy:**
   - Click "Create environment"
   - Wait for deployment (5-10 minutes)

7. **Get Webhook URL:**
   - After deployment, copy the environment URL
   - Your webhook URL will be: `https://your-app.elasticbeanstalk.com/webhook/telnyx`

### AWS EC2 (Full Control)

1. **Launch EC2 Instance:**
   - Choose Amazon Linux 2 or Ubuntu
   - Instance type: t2.micro (free tier) or t3.small
   - Configure security group to allow HTTP (port 80) and HTTPS (port 443)

2. **SSH into Instance:**
   ```bash
   ssh -i your-key.pem ec2-user@your-instance-ip
   ```

3. **Install Node.js:**
   ```bash
   # Amazon Linux 2
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   source ~/.bashrc
   nvm install 20
   nvm use 20
   
   # Ubuntu
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

4. **Upload and Extract Zip:**
   ```bash
   # Upload zip file (use SCP or AWS CLI)
   scp -i your-key.pem tavari-voice-server-deployment.zip ec2-user@your-instance-ip:~/
   
   # SSH into instance
   ssh -i your-key.pem ec2-user@your-instance-ip
   
   # Extract
   unzip tavari-voice-server-deployment.zip -d tavari-voice-server
   cd tavari-voice-server
   ```

5. **Set Environment Variables:**
   ```bash
   # Create .env file
   nano .env
   ```
   
   Add:
   ```
   PORT=3000
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   TELNYX_API_KEY=your_telnyx_api_key
   OPENAI_API_KEY=your_openai_api_key
   TAVARI_VOICE_SERVER_URL=http://your-instance-ip:3000
   ```

6. **Install PM2 (Process Manager):**
   ```bash
   npm install -g pm2
   ```

7. **Start Server:**
   ```bash
   pm2 start index.js --name tavari-voice-server
   pm2 save
   pm2 startup
   ```

8. **Set Up Reverse Proxy (Nginx):**
   ```bash
   sudo yum install nginx -y  # Amazon Linux
   # or
   sudo apt-get install nginx -y  # Ubuntu
   
   # Configure Nginx
   sudo nano /etc/nginx/conf.d/tavari-voice.conf
   ```
   
   Add:
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;
       
       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```
   
   ```bash
   sudo systemctl start nginx
   sudo systemctl enable nginx
   ```

## Step 4: Configure Telnyx Webhook

1. **Go to Telnyx Dashboard:**
   - https://portal.telnyx.com

2. **Configure Webhook:**
   - Go to "Messaging" → "Webhooks" or "Voice" → "Event Notifications"
   - Create new webhook
   - URL: `https://your-aws-url.com/webhook/telnyx`
   - Events: Select all call events

3. **Configure Phone Number:**
   - Go to "Numbers" → "Phone Numbers"
   - Select your number
   - Set webhook URL in Call Control settings

## Step 5: Test

1. **Test Health Endpoint:**
   ```bash
   curl https://your-aws-url.com/health
   ```
   Should return: `{"status":"ok","timestamp":"..."}`

2. **Make Test Call:**
   - Call your Telnyx phone number
   - Check AWS CloudWatch logs for webhook events
   - Verify AI agent responds

## Troubleshooting

### "Cannot find module" errors

**Problem:** `node_modules` not included in zip  
**Solution:** Rebuild zip using `build-deployment-zip.ps1` script

### "Missing TELNYX_API_KEY" error

**Problem:** Environment variable not set  
**Solution:** Add `TELNYX_API_KEY` to AWS environment variables

### Voice agent not responding

**Check:**
1. ✅ `TELNYX_API_KEY` is set correctly
2. ✅ Webhook URL is configured in Telnyx
3. ✅ Phone number is connected to webhook
4. ✅ Check CloudWatch logs for errors
5. ✅ Verify `node_modules` is included in deployment

### Lambda timeout errors

**Problem:** Lambda function timing out  
**Solution:** 
- Increase timeout to 15 minutes (maximum)
- Consider using Elastic Beanstalk or EC2 instead

## Important Notes

- ⚠️ **ALWAYS include `node_modules` in your deployment zip**
- ⚠️ **ALWAYS set `TELNYX_API_KEY` in environment variables**
- ⚠️ **Test the health endpoint after deployment**
- ⚠️ **Check CloudWatch logs if calls aren't working**

## Support

If you're still having issues:
1. Check AWS CloudWatch logs
2. Verify all environment variables are set
3. Test webhook endpoint manually with curl
4. Check Telnyx webhook delivery logs


