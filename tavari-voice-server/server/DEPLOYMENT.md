# Deployment Guide - AWS Chime SIP Media App Voice Agent

## Quick Start

### 1. Railway Deployment

1. **Connect Repository**
   - Go to [Railway](https://railway.app)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository
   - Set root directory to: `tavari-voice-server/server`

2. **Environment Variables**
   Add these in Railway dashboard:
   ```
   OPENAI_API_KEY=sk-...
   AWS_ACCESS_KEY_ID=...
   AWS_SECRET_ACCESS_KEY=...
   AWS_REGION=us-east-1
   EMAIL_FROM_ADDRESS=noreply@yourdomain.com
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=...
   ```

3. **Deploy**
   - Railway will automatically detect `package.json` and deploy
   - Wait for deployment to complete
   - Copy the generated domain (e.g., `your-app.railway.app`)

### 2. AWS Chime SIP Media App Setup

1. **Create SIP Media Application**
   - Go to AWS Chime Console
   - Navigate to "SIP Media Applications"
   - Click "Create SIP Media Application"
   - Name: `tavari-voice-agent`
   - Endpoint: `https://your-app.railway.app/chime/inbound`
   - Click "Create"

2. **Configure Phone Number**
   - Go to "Phone Numbers" in Chime Console
   - Select your phone number
   - Under "SIP Media Application", select your new application
   - Save

### 3. Test

1. Call your phone number
2. The AI should answer and start conversation
3. Check Railway logs for debugging

## Troubleshooting

### Server Not Starting
- Check Railway logs for errors
- Verify all environment variables are set
- Ensure `package.json` is in the `server` directory

### Calls Not Working
- Verify webhook URL is accessible: `https://your-app.railway.app/health`
- Check AWS Chime SIP Media App configuration
- Review Railway logs for incoming requests

### OpenAI Connection Issues
- Verify `OPENAI_API_KEY` is correct
- Check OpenAI API status
- Ensure model name matches: `gpt-4o-mini-realtime-preview-2024-12-17`

### Audio Issues
- Verify audio format: PCM 16-bit, 8kHz
- Check audio buffer handling in logs
- Ensure WebSocket connection is stable

## Monitoring

### Railway Metrics
- CPU usage
- Memory usage
- Request count
- Error rate

### AWS Chime Metrics
- Call volume
- Call duration
- Error rate

### Cost Monitoring
- OpenAI usage: Check OpenAI dashboard
- AWS Chime: Check AWS billing
- Railway: Check Railway usage

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for Realtime API |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `AWS_ACCESS_KEY_ID` | Yes | AWS access key for SES |
| `AWS_SECRET_ACCESS_KEY` | Yes | AWS secret key for SES |
| `AWS_REGION` | No | AWS region (default: us-east-1) |
| `EMAIL_FROM_ADDRESS` | Yes | Email address for sending emails |
| `PORT` | No | Server port (default: 3000) |

## Next Steps

1. ✅ Deploy to Railway
2. ✅ Configure AWS Chime SIP Media App
3. ✅ Test with a phone call
4. ✅ Monitor costs and performance
5. ✅ Set up alerts for errors

