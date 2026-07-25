# AWS Chime SIP Media App Voice Agent - Implementation Plan

## Overview
Build a Railway-hosted Node.js server that handles AWS Chime SIP Media App events, streams audio to/from OpenAI Realtime API (gpt-4o-mini-realtime-preview), and integrates with existing Tavari booking/email/SMS functions.

**Cost: ~$0.031 per minute (~$1.86/hour)**

## Architecture

```
Customer Call → AWS Chime SIP Media App → POST /chime/inbound
                                                    ↓
                                            Express Server (Railway)
                                                    ↓
                                    ┌───────────────┴───────────────┐
                                    │                               │
                            OpenAI Realtime WebSocket        Business Logic
                            (gpt-4o-mini-realtime)           (Booking/Email/SMS)
                                    │                               │
                                    └───────────────┴───────────────┘
                                                    ↓
                                            Return PCM Audio
                                            (Base64 encoded)
                                                    ↓
                                            AWS Chime → Customer
```

## File Structure

```
tavari-voice-server/
├── server/
│   ├── src/
│   │   ├── index.js              # Express app entry point
│   │   ├── chimeRouter.js        # AWS Chime event handlers
│   │   ├── openaiRealtime.js     # OpenAI Realtime WebSocket manager
│   │   ├── audioUtils.js         # Audio conversion utilities
│   │   ├── sessionManager.js     # Call session tracking
│   │   ├── booking.js             # Appointment booking logic
│   │   ├── email.js              # AWS SES email sender
│   │   └── sms.js                # SMS integration (optional)
│   ├── package.json              # Dependencies
│   └── .env.example              # Environment variables template
└── (existing files remain)
```

## Implementation Details

### 1. AWS Chime SIP Media App Event Format

**Incoming Event (POST /chime/inbound):**
```json
{
  "SchemaVersion": "1.0",
  "EventType": "CALL_RECEIVED" | "CALL_ANSWERED" | "AUDIO_RECEIVED" | "CALL_ENDED",
  "CallId": "unique-call-id",
  "FromNumber": "+1234567890",
  "ToNumber": "+1987654321",
  "AudioChunk": "<base64 PCM audio>" // Only in AUDIO_RECEIVED
}
```

**Response Format:**
```json
{
  "SchemaVersion": "1.0",
  "Actions": [
    {
      "Type": "Answer" | "Speak" | "Continue" | "End",
      "Parameters": {
        "Audio": "<base64 PCM>" // For Speak action
      }
    }
  ]
}
```

### 2. OpenAI Realtime API Integration

**Model:** `gpt-4o-mini-realtime-preview`
- Audio Input: $10 per 1M tokens
- Audio Output: $20 per 1M tokens

**WebSocket Events to Handle:**
- `conversation.item.input_audio_buffer.committed` - User speech received
- `conversation.item.output_audio_buffer.committed` - AI audio ready
- `response.audio_transcript.delta` - Text transcripts
- `response.function_call_arguments_completed` - Function calls
- `response.done` - Response complete

**Function Definitions:**
- `book_appointment` - Book calendar appointment
- `send_email` - Send email via AWS SES
- `send_sms` - Send SMS (optional)

### 3. Audio Processing

**Requirements:**
- Format: PCM 16-bit
- Sample Rate: 8kHz
- Encoding: Base64 for Chime responses

**Conversion Flow:**
1. Chime sends base64 PCM → Decode to Buffer
2. Buffer → OpenAI Realtime (as-is, already PCM)
3. OpenAI returns PCM → Encode to base64
4. Base64 → Chime Speak action

### 4. Session Management

**Per-Call Session:**
```javascript
{
  callId: string,
  sessionId: string, // OpenAI session ID
  agent: object, // From database
  openaiWs: WebSocket, // OpenAI Realtime connection
  messages: array, // Conversation history
  audioBuffer: Buffer, // Accumulated audio
  startedAt: Date,
  functionCallInProgress: boolean
}
```

## Files to Create

### 1. `server/src/index.js`
- Express app setup
- Health check route
- Chime webhook route
- Error handling
- Bind to `0.0.0.0:${PORT}`

### 2. `server/src/chimeRouter.js`
- Handle `CALL_RECEIVED` → Return Answer action
- Handle `CALL_ANSWERED` → Initialize OpenAI session
- Handle `AUDIO_RECEIVED` → Forward to OpenAI, return Speak
- Handle `CALL_ENDED` → Cleanup session

### 3. `server/src/openaiRealtime.js`
- Connect to OpenAI Realtime WebSocket
- Handle audio streaming (bidirectional)
- Handle function calls
- Return PCM audio buffers

### 4. `server/src/audioUtils.js`
- `decodeBase64PCM(base64)` → Buffer
- `encodePCMToBase64(buffer)` → string
- `formatChimeSpeakResponse(audioBase64)` → JSON

### 5. `server/src/sessionManager.js`
- `startSession(callId, agent)` → Create session
- `getSession(callId)` → Get session
- `appendAudio(callId, audio)` → Add audio
- `endSession(callId)` → Cleanup

### 6. `server/src/booking.js`
- `bookAppointment(parameters, session)` → Call Supabase Edge Function
- Returns user-friendly message for AI

### 7. `server/src/email.js`
- `sendEmailSES({ to, subject, htmlBody, textBody })` → AWS SES
- Uses `@aws-sdk/client-ses`

### 8. `server/src/sms.js`
- Optional SMS integration
- Can use existing Tavari SMS service or AWS SNS

### 9. `server/package.json`
- Dependencies: express, openai, @supabase/supabase-js, axios, ws, @aws-sdk/client-ses, dotenv
- Scripts: start, dev

### 10. `server/.env.example`
- Environment variables template

## Environment Variables

```env
# OpenAI
OPENAI_API_KEY=

# AWS
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1
EMAIL_FROM_ADDRESS=

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Server
PORT=3000
SERVER_URL=  # Railway will provide
```

## Integration Points

### Existing Supabase Edge Function
- Endpoint: `${SUPABASE_URL}/functions/v1/custom-voice-agent-functions`
- Functions: `book_appointment`, `send_email`, `send_sms`
- Already implemented and working

### Database Tables
- `custom_voice_agents` - Agent configuration
- `custom_voice_agent_configurations` - Settings
- `custom_voice_agent_calls` - Call records
- `voice_agent_bookings` - Appointments
- `custom_voice_agent_faqs` - FAQs
- `custom_voice_agent_knowledge_base` - Knowledge base

## Testing Strategy

1. **Local Testing:**
   - Mock Chime events
   - Test OpenAI Realtime connection
   - Verify audio conversion
   - Test function calls

2. **Railway Deployment:**
   - Deploy to Railway
   - Configure environment variables
   - Test with real Chime events

3. **Integration Testing:**
   - Test booking flow
   - Test email sending
   - Verify call recording/logging

## Deployment Checklist

- [ ] Create server directory structure
- [ ] Implement all modules
- [ ] Add error handling and logging
- [ ] Test locally
- [ ] Deploy to Railway
- [ ] Configure AWS Chime SIP Media App webhook
- [ ] Test end-to-end call flow
- [ ] Monitor costs and performance

## Cost Optimization

- Using `gpt-4o-mini-realtime-preview` (75% cheaper than gpt-4o-realtime)
- Efficient audio buffering to reduce token usage
- Session cleanup to prevent memory leaks
- Railway free tier for low-volume testing

## Next Steps

1. Create server directory structure
2. Implement core modules (index.js, chimeRouter.js, openaiRealtime.js)
3. Add audio utilities and session management
4. Integrate booking/email/SMS
5. Test and deploy


