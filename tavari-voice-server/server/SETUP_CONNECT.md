# AWS Connect Setup Script

This script programmatically sets up AWS Connect to route calls to your Railway webhook via Lambda.

## Prerequisites

1. AWS Connect instance created (you already have this)
2. Phone number claimed in Connect
3. Lambda function created (we already created `tavari-voice-agent`)

## Setup

1. **Install dependencies:**
   ```bash
   cd tavari-voice-server/server
   npm install
   ```

2. **Get your Connect Instance ID:**
   - Go to AWS Connect Console
   - Click your instance
   - Go to Settings > Overview
   - Copy the "Instance ID" (looks like: `12345678-1234-1234-1234-123456789012`)

3. **Get your Phone Number ID:**
   - In Connect Console, go to "Phone numbers"
   - Click your phone number
   - Copy the Phone Number ID from the URL or details page

4. **Set environment variables:**
   ```bash
   export CONNECT_INSTANCE_ID="your-instance-id"
   export PHONE_NUMBER="your-phone-number-id"
   export LAMBDA_FUNCTION_ARN="arn:aws:lambda:ca-central-1:595575695738:function:tavari-voice-agent"
   export AWS_REGION="ca-central-1"
   export AWS_ACCESS_KEY_ID="your-access-key"
   export AWS_SECRET_ACCESS_KEY="your-secret-key"
   ```

5. **Run the script:**
   ```bash
   node setup-connect.js
   ```

## What it does

1. Creates a Contact Flow that invokes your Lambda function
2. Assigns the Contact Flow to your phone number
3. Lambda proxies requests to Railway webhook

## Troubleshooting

- Make sure your AWS credentials have permissions for:
  - `connect:CreateContactFlow`
  - `connect:UpdateContactFlowContent`
  - `connect:AssociatePhoneNumberContactFlow`
  - `lambda:InvokeFunction`


