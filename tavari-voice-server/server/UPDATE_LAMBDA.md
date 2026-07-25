# Update Lambda Function Code

The Lambda function needs to be updated with the proxy code.

## Step 1: Copy the Lambda Code

1. Open the file: `tavari-voice-server/server/lambda-proxy.js`
2. Copy ALL the code from that file

## Step 2: Update Lambda in AWS Console

1. Go to AWS Lambda Console
2. Click on function: `tavari-voice-agent`
3. In the code editor, select all and delete
4. Paste the code from `lambda-proxy.js`
5. Click "Deploy"

## Step 3: Run Setup Script

After Lambda is updated, run the setup script to create the Contact Flow.


