# Tavari Voice Agent - AWS Lambda Function

This Lambda function handles AI voice conversations for Amazon Connect.

## Architecture

```
Amazon Connect → Lambda → OpenAI → Supabase → Response → Connect → Caller
```

## Function Flow

1. **Inbound Call**: Connect invokes Lambda with call details
2. **Initialize Session**: Lambda finds agent, loads knowledge base
3. **Process Speech**: Lambda receives transcript, sends to OpenAI
4. **Function Calls**: If AI wants to book, calls Supabase Edge Function
5. **Return Response**: Lambda returns text/SSML for Connect to speak

## Environment Variables

Required in Lambda configuration:

- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key
- `OPENAI_API_KEY`: OpenAI API key

## Deployment

### Option 1: AWS Console

1. Create Lambda function
2. Paste `handler.js` code
3. Upload dependencies (or use Lambda layers)
4. Set environment variables
5. Configure timeout (30+ seconds)

### Option 2: AWS CLI

```bash
cd aws-lambda
zip -r function.zip handler.js package.json node_modules/
aws lambda create-function \
  --function-name tavari-voice-agent \
  --runtime nodejs20.x \
  --role arn:aws:iam::ACCOUNT_ID:role/lambda-execution-role \
  --handler handler.handler \
  --zip-file fileb://function.zip \
  --timeout 30 \
  --memory-size 512
```

### Option 3: AWS SAM / CDK

Use Infrastructure as Code for production deployments.

## Testing Locally

Create `test-handler.js`:

```javascript
import { handler } from './handler.js';

const testEvent = {
  Details: {
    ContactId: 'test-123',
    CustomerEndpoint: { Address: '+15551234567' },
    SystemEndpoint: { Address: '+15559876543' },
    InvocationEventType: 'INITIATE_CALL'
  }
};

handler(testEvent).then(console.log).catch(console.error);
```

Run: `node test-handler.js`

## Response Format

Lambda returns:

```json
{
  "statusCode": 200,
  "result": "success",
  "greeting": "Hello, thank you for calling...",
  "message": "AI response text",
  "ssml": "<speak>AI response</speak>",
  "agentId": "uuid",
  "contactId": "connect-contact-id"
}
```

## Contact Flow Integration

The Contact Flow passes attributes to Lambda:

- `ContactId`: Unique call identifier
- `CustomerEndpoint.Address`: Caller's phone number
- `SystemEndpoint.Address`: Called number
- `CustomerInput.Transcript`: User's speech transcript

Lambda returns attributes:

- `greeting`: Initial greeting message
- `message`: AI response text
- `result`: "success" or "error"

## Function Calling

When AI wants to book an appointment:

1. Lambda calls Supabase Edge Function
2. Edge Function creates booking in database
3. Lambda receives success/error
4. AI responds to caller with result

## Session Management

Currently uses in-memory Map. For production:

1. Use DynamoDB for session storage
2. Set TTL on sessions (1 hour)
3. Use ContactId as partition key

## Monitoring

- CloudWatch Logs: All Lambda invocations
- CloudWatch Metrics: Duration, errors, throttles
- X-Ray: For distributed tracing (optional)

## Error Handling

- Returns error message if agent not found
- Returns error message if Lambda fails
- Contact Flow handles errors gracefully

## Performance

- Cold start: ~1-2 seconds
- Warm execution: ~200-500ms
- With OpenAI API: +500-2000ms
- Total response time: ~1-3 seconds

## Security

- Environment variables encrypted at rest
- IAM role with least privilege
- VPC configuration (optional)
- API keys never logged


