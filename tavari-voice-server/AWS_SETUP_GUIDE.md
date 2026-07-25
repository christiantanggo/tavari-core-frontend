# AWS Connect Setup Guide for Tavari Voice Agent

This guide walks you through setting up the Tavari Voice Agent using Amazon Connect instead of Telnyx.

## Prerequisites

- AWS Account with admin access
- Amazon Connect instance
- AWS Lambda access
- Phone number in Amazon Connect
- Environment variables configured

## Step 1: Create Lambda Function

### 1.1 Create Lambda Function

1. Go to AWS Lambda Console
2. Click "Create function"
3. Choose "Author from scratch"
4. Configure:
   - **Function name**: `tavari-voice-agent`
   - **Runtime**: Node.js 20.x
   - **Architecture**: x86_64
5. Click "Create function"

### 1.2 Upload Code

1. In the Lambda function, go to "Code" tab
2. Upload the `handler.js` file from `aws-lambda/` folder
3. Or use the inline editor to paste the code

### 1.3 Configure Environment Variables

In Lambda Configuration → Environment variables, add:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
OPENAI_API_KEY=your_openai_api_key
```

### 1.4 Set Timeout

1. Go to Configuration → General configuration
2. Set **Timeout** to 30 seconds (or more if needed)
3. Set **Memory** to 512 MB (or more)

### 1.5 Add IAM Permissions

The Lambda execution role needs:

- `logs:CreateLogGroup`
- `logs:CreateLogStream`
- `logs:PutLogEvents`
- `connect:StartOutboundVoiceContact` (if needed)

## Step 2: Create Amazon Connect Instance

### 2.1 Create Connect Instance

1. Go to Amazon Connect Console
2. Click "Add instance"
3. Choose:
   - **Identity management**: Store users within Amazon Connect
   - **Access URL**: Choose a unique name (e.g., `tavari-voice`)
4. Click "Next" and create admin user
5. Click "Create instance"

### 2.2 Claim Phone Number

1. In Connect, go to **Phone numbers** → **Claim phone number**
2. Choose your country (Canada supported)
3. Select a phone number
4. Click "Next" and assign to your instance

### 2.3 Configure Phone Number

1. Click on your phone number
2. Set **Contact flow** to the flow you'll create (see Step 3)
3. Save

## Step 3: Create Contact Flow

### 3.1 Create New Contact Flow

1. In Amazon Connect, go to **Routing** → **Contact flows**
2. Click "Create contact flow"
3. Name it: `Tavari Voice Agent`

### 3.2 Import Contact Flow

1. Click the menu (three dots) → **Import flow (beta)**
2. Upload the `contact-flow.json` file from `aws-connect/` folder
3. **IMPORTANT**: Update the Lambda ARN in the flow:
   - Find all instances of `arn:aws:lambda:REGION:ACCOUNT_ID:function:tavari-voice-agent`
   - Replace `REGION` with your AWS region (e.g., `us-east-1`)
   - Replace `ACCOUNT_ID` with your AWS account ID

### 3.3 Manual Contact Flow Setup (Alternative)

If import doesn't work, build manually:

1. **Entry point** → **Invoke Lambda Function**
   - Function: `tavari-voice-agent`
   - Timeout: 3 seconds
   - On success → Check condition
   - On error → Error handler

2. **Check condition**
   - Attribute: `result`
   - Condition: Equals
   - Value: `success`
   - If matched → Play prompt
   - If not matched → No agent handler

3. **Play prompt**
   - Text: `${greeting}` (from Lambda)
   - Voice: Joanna (or your preference)
   - On success → Get customer input

4. **Get customer input**
   - Text: "Please speak your request."
   - Voice: Joanna
   - Timeout: 5 seconds
   - On success → Invoke Lambda
   - On timeout → Loop back to Get customer input

5. **Invoke Lambda Function** (for processing)
   - Function: `tavari-voice-agent`
   - Attributes:
     - `transcript`: `${CustomerInput.Transcript}`
     - `action`: `AUDIO_STREAM`
   - Timeout: 8 seconds
   - On success → Play AI response

6. **Play AI response**
   - Text: `${message}` (from Lambda)
   - Voice: Joanna
   - On success → Loop back to Get customer input

7. **Error handler**
   - Play: "I apologize, I encountered an error. Please try calling again later."
   - Then disconnect

8. **Disconnect**
   - End the call

### 3.4 Publish Contact Flow

1. Click "Save"
2. Click "Publish"

## Step 4: Assign Contact Flow to Phone Number

1. Go to **Phone numbers**
2. Click on your phone number
3. Set **Contact flow / IVR** to `Tavari Voice Agent`
4. Save

## Step 5: Test the Setup

### 5.1 Test Lambda Function

1. Go to Lambda Console
2. Open `tavari-voice-agent` function
3. Click "Test"
4. Create test event:
```json
{
  "Details": {
    "ContactId": "test-contact-123",
    "CustomerEndpoint": {
      "Address": "+1234567890"
    },
    "SystemEndpoint": {
      "Address": "+15551234567"
    },
    "InvocationEventType": "INITIATE_CALL"
  }
}
```
5. Click "Test"
6. Check logs for errors

### 5.2 Test Phone Call

1. Call your Amazon Connect phone number
2. You should hear the greeting
3. Speak your request
4. AI should respond

## Step 6: Configure Supabase

Ensure your Supabase database has:

- `custom_voice_agents` table with phone numbers
- `custom_voice_agent_calls` table for call records
- `custom_voice_agent_knowledge_base` table
- `custom_voice_agent_faqs` table
- Edge Function: `custom-voice-agent-functions` for bookings

## Troubleshooting

### Lambda Timeout

- Increase Lambda timeout to 30+ seconds
- Check CloudWatch logs for errors

### No Response from Lambda

- Verify Lambda ARN in Contact Flow is correct
- Check Lambda execution role has Connect permissions
- Verify environment variables are set

### AI Not Responding

- Check OpenAI API key is valid
- Check Lambda logs in CloudWatch
- Verify Supabase connection

### Phone Number Not Working

- Verify Contact Flow is published
- Check phone number is assigned to Connect instance
- Verify Contact Flow is assigned to phone number

## Architecture Diagram

```
Caller → Amazon Connect → Contact Flow → Lambda Function
                                              ↓
                                    OpenAI API (GPT-4)
                                              ↓
                                    Supabase Edge Function
                                              ↓
                                    Database (Bookings)
                                              ↓
                                    Lambda → Connect → Caller
```

## Cost Estimation

- **Amazon Connect**: Pay per minute of usage
- **Lambda**: First 1M requests free, then $0.20 per 1M requests
- **OpenAI API**: Pay per token usage
- **Supabase**: Based on your plan

## Next Steps

1. Set up CloudWatch alarms for errors
2. Configure DynamoDB for session storage (instead of in-memory Map)
3. Add audio streaming for real-time conversation
4. Set up EventBridge for analytics
5. Configure S3 for audio file storage (if needed)

## Support

For issues, check:
- AWS CloudWatch Logs
- Lambda function logs
- Amazon Connect Contact Flow logs
- Supabase Edge Function logs


