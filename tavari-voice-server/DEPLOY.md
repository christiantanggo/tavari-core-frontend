# AWS Elastic Beanstalk Deployment Guide

## Quick Deploy

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create deployment zip:**
   ```bash
   # On Windows (PowerShell):
   Compress-Archive -Path index.js,package.json,package-lock.json,node_modules -DestinationPath tavari-voice-server-deployment.zip
   
   # On Linux/Mac:
   zip -r tavari-voice-server-deployment.zip . -x "*.git*" "*.zip" "*.log" "*.md" ".env*" "test-*"
   ```

3. **Upload to Elastic Beanstalk:**
   - Go to AWS Elastic Beanstalk console
   - Select your environment
   - Click "Upload and deploy"
   - Upload `tavari-voice-server-deployment.zip`

## Required Environment Variables

Set these in Elastic Beanstalk → Configuration → Software → Environment properties:

- `PORT=8080` (Elastic Beanstalk default)
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key
- `OPENAI_API_KEY` - Your OpenAI API key
- `TELNYX_API_KEY` - Your Telnyx API key
- `TAVARI_VOICE_SERVER_URL` - Your Elastic Beanstalk URL (e.g., `https://your-env.elasticbeanstalk.com`)

## Platform Configuration

- **Platform:** Node.js
- **Platform version:** Node.js 20 or later
- **Application port:** 8080

## Webhook Configuration

In Telnyx, set your webhook URL to:
```
https://your-eb-url.elasticbeanstalk.com/webhook/telnyx
```

## Testing

1. Check health: `GET https://your-eb-url.elasticbeanstalk.com/health`
2. Make a test call to your Telnyx number
3. Check logs in Elastic Beanstalk → Logs

## Troubleshooting

- **502 Bad Gateway:** Check that PORT=8080 is set
- **No response:** Check that all environment variables are set
- **Transcription not working:** Verify TELNYX_API_KEY is correct
- **Audio not playing:** Verify TAVARI_VOICE_SERVER_URL is set correctly


