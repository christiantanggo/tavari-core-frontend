# Amazon Connect Setup Scripts

Scripts to programmatically create Contact Flows for Tavari Voice Agent.

## Prerequisites

1. AWS CLI configured with credentials
2. Node.js installed
3. Your Connect instance ID
4. Your Lambda function ARN

## Setup

1. Install dependencies:
```bash
cd aws-connect
npm install
```

2. Get your Connect Instance ID:
   - Go to Amazon Connect Console
   - Click on your instance "tavari-voice"
   - Copy the Instance ID (or ARN) from the URL or instance details

3. Get your Lambda ARN:
   - Go to Lambda Console
   - Click on `tavari-voice-agent` function
   - Copy the ARN from the top right

## Create Contact Flow

1. Edit `create-contact-flow.js`:
   - Update `CONFIG.instanceId` with your Connect instance ID
   - Update `CONFIG.lambdaFunctionArn` with your Lambda ARN
   - Update `CONFIG.region` if needed

2. Run the script:
```bash
node create-contact-flow.js
```

3. The script will create the contact flow and output the Contact Flow ID

4. Assign the flow to your phone number:
   - Go to Connect → Phone numbers
   - Click on your phone number
   - Set "Contact flow/IVR" to "Tavari Voice Agent"
   - Save

## What This Creates

The script creates a contact flow that:
1. Calls Lambda on call start
2. Plays greeting from Lambda
3. Gets customer input (speech)
4. Sends transcript to Lambda
5. Plays AI response
6. Loops back for more input

All AI logic is in your Lambda function - the flow just orchestrates the call.


