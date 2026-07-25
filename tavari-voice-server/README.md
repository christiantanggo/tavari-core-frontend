# Tavari Voice Server

Bridges Telnyx WebRTC and OpenAI Realtime API for custom voice agents.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```env
PORT=3000
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
OPENAI_API_KEY=your_openai_api_key
TAVARI_VOICE_SERVER_URL=https://your-voice-server.com
```

3. Run the server:
```bash
npm start
# or for development with auto-reload:
npm run dev
```

## Architecture

- **Express Server**: Handles HTTP webhooks from Telnyx
- **WebSocket Server**: Handles real-time media streams
- **OpenAI Realtime API**: Provides AI voice conversation
- **Supabase**: Stores call records and agent configuration

## Endpoints

- `GET /health` - Health check
- `POST /webhook/telnyx` - Telnyx webhook handler

## Deployment

Deploy to your preferred Node.js hosting (Railway, Render, Fly.io, etc.) and configure the webhook URL in Telnyx.

