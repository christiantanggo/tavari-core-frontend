# ✅ Environment Variables Verification

## Code vs AWS Environment Variables

I've verified that the code uses the **exact same names** as your AWS environment variables:

### ✅ All Variables Match Correctly

| Code Variable | AWS Environment Variable | Status |
|--------------|------------------------|--------|
| `process.env.TELNYX_API_KEY` | `TELNYX_API_KEY` | ✅ **MATCH** |
| `process.env.SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SERVICE_ROLE_KEY` | ✅ **MATCH** |
| `process.env.SUPABASE_URL` | `SUPABASE_URL` | ✅ **MATCH** |
| `process.env.OPENAI_API_KEY` | `OPENAI_API_KEY` | ✅ **MATCH** |
| `process.env.PORT` | `PORT` | ✅ **MATCH** |
| `process.env.TAVARI_VOICE_SERVER_URL` | `TAVARI_VOICE_SERVER_URL` | ✅ **MATCH** |

## Code Verification

### Line 18: TELNYX_API_KEY
```javascript
const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
```
✅ Correctly reads from `TELNYX_API_KEY` environment variable

### Line 16: SUPABASE_SERVICE_ROLE_KEY
```javascript
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
```
✅ Correctly reads from `SUPABASE_SERVICE_ROLE_KEY` environment variable

### Usage in Telnyx API Calls
All Telnyx API calls use the correct format:
```javascript
'Authorization': `Bearer ${TELNYX_API_KEY}`
```
✅ Used correctly in:
- Line 81: Answer call
- Line 105: Start transcription
- Line 381: Start transcription (in session)
- Line 432: Speak to caller

## If Voice Agent Still Not Working

Since the environment variable names are correct and `TELNYX_API_KEY` is already set in AWS, check:

### 1. Verify Deployment Zip Has node_modules
The code uses ES6 imports which require `node_modules`:
```javascript
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import OpenAI from 'openai';
```

**Check:** Extract your deployment zip and verify `node_modules/` folder exists.

**Fix:** Rebuild zip using:
```powershell
cd tavari-voice-server
npm install
.\build-deployment-zip.ps1
```

### 2. Check AWS CloudWatch Logs
Look for these log messages when a call comes in:

**Expected logs:**
```
📞 Telnyx webhook received: call.initiated
📞 Answering call: call_control_id_here
✅ Call answered: call_control_id_here
🔍 Looking for agent for phone number: +15484880543
✅ Found agent: agent-id - Agent Name
🚀 Starting call session...
✅ Transcription started
🤖 AI response: ...
✅ Spoke to caller: ...
```

**If you see errors:**
- `❌ ERROR: TELNYX_API_KEY environment variable is required` → Variable not being read (check AWS config)
- `❌ Error answering call:` → API key might be invalid or expired
- `⚠️ No agent found for phone number:` → Agent not configured in database
- `Cannot find module` → `node_modules` missing from deployment

### 3. Verify TELNYX_API_KEY Value
The key in AWS should look like: `KEY019AF9C440E71...` (starts with `KEY`)

**Check:**
1. Go to Telnyx Dashboard: https://portal.telnyx.com/app/api-keys
2. Verify the key matches what's in AWS
3. Make sure the key hasn't been revoked or expired

### 4. Test Webhook Endpoint Manually
Test if your webhook is receiving events:

```bash
curl -X POST https://your-aws-url.com/webhook/telnyx \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "event_type": "call.initiated",
      "payload": {
        "call_control_id": "test123",
        "to": "+15484880543",
        "from": "+1234567890"
      }
    }
  }'
```

Should return: `{"received":true}`

### 5. Check Telnyx Webhook Configuration
1. Go to Telnyx Dashboard → Webhooks
2. Verify webhook URL points to: `https://your-aws-url.com/webhook/telnyx`
3. Check webhook delivery logs for errors
4. Verify phone number is connected to the webhook

## Summary

✅ **Environment variable names are CORRECT** - The code matches your AWS configuration exactly.

If the voice agent still isn't working, the issue is likely:
1. Missing `node_modules` in deployment zip
2. Invalid or expired `TELNYX_API_KEY` value
3. Webhook not configured correctly in Telnyx
4. Agent not found in database for the phone number

Check AWS CloudWatch logs for specific error messages to pinpoint the exact issue.


