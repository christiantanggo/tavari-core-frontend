# Tavari Voice Agent - AWS Chime SIP Media App

Cost-optimized AI voice agent using AWS Chime SIP Media App and OpenAI Realtime API.

**Cost: ~$0.031 per minute (~$1.86/hour)**

## Architecture

- **AWS Chime SIP Media App**: Handles telephony and audio streaming
- **Railway**: Hosts the Node.js server
- **OpenAI Realtime API**: Voice conversation (gpt-4o-mini-realtime-preview)
- **AWS SES**: Email sending
- **Supabase**: Database and Edge Functions for booking/SMS

## Setup

### 1. Install Dependencies

```bash
cd server
npm install
```

### 2. Environment Variables

**Railway (Production):**
Only 3 variables needed:
- `OPENAI_API_KEY` - Your OpenAI API key
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key

**Local Development (.env file):**
```env
# OpenAI Realtime API
OPENAI_API_KEY=sk-...

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...

# Server Configuration
PORT=3000
```

**Note:** AWS SES credentials are stored in Supabase Edge Function secrets, not in Railway. See `ENVIRONMENT_SETUP.md` for details.

### 3. Local Development

```bash
npm run dev
```

Server will start on `http://localhost:3000`

### 4. Deploy to Railway

1. Connect your GitHub repository to Railway
2. Set root directory to `tavari-voice-server/server`
3. Add all environment variables
4. Railway will automatically deploy

## API Endpoints

### Health Check
```
GET /health
```

### AWS Chime Webhook
```
POST /chime/inbound
```

## AWS Chime SIP Media App Configuration

1. Create a SIP Media Application in AWS Chime
2. Set the webhook URL to: `https://your-railway-domain.railway.app/chime/inbound`
3. Configure phone number to use the SIP Media Application

## Cost Breakdown

- **AWS Chime**: $0.003/min
- **OpenAI Realtime** (gpt-4o-mini): $0.027/min
- **AWS SES**: $0.00002/min (handled by Supabase Edge Functions)
- **Railway**: $0.001/min
- **Total**: ~$0.031/min

## Architecture Benefits

✅ **Single Source of Truth** - All AWS credentials stored in Supabase Edge Functions  
✅ **No Railway Updates** - Only need 3 variables in Railway  
✅ **Secure** - Credentials never exposed in Railway logs  
✅ **Easy Management** - Update credentials once in Supabase, works everywhere

## Features

- ✅ Real-time voice conversation
- ✅ Appointment booking via function calling
- ✅ Email sending via AWS SES
- ✅ SMS sending (optional)
- ✅ Knowledge base and FAQ support
- ✅ Call logging and analytics

## File Structure

```
server/
├── src/
│   ├── index.js              # Express server
│   ├── chimeRouter.js        # AWS Chime event handlers
│   ├── openaiRealtime.js     # OpenAI Realtime WebSocket
│   ├── audioUtils.js         # Audio conversion
│   ├── sessionManager.js     # Session management
│   ├── booking.js            # Appointment booking
│   ├── email.js              # AWS SES email
│   └── sms.js                # SMS integration
├── package.json
└── README.md
```

## Troubleshooting

### OpenAI WebSocket Connection Issues
- Verify `OPENAI_API_KEY` is set correctly
- Check OpenAI API status
- Ensure model name is correct: `gpt-4o-mini-realtime-preview-2024-12-17`

### AWS Chime Not Receiving Audio
- Verify webhook URL is accessible
- Check Chime SIP Media App configuration
- Ensure audio format is PCM 16-bit, 8kHz

### Booking Not Working
- Verify Supabase Edge Function is deployed
- Check `SUPABASE_SERVICE_ROLE_KEY` is correct
- Verify database tables exist

## License

MIT

