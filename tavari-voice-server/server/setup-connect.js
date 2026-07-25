// setup-connect.js
// Script to programmatically set up AWS Connect Contact Flow
// This bypasses the Connect UI and creates everything via API

import dotenv from 'dotenv';
import { ConnectClient, CreateContactFlowCommand, UpdateContactFlowContentCommand, AssociatePhoneNumberContactFlowCommand } from '@aws-sdk/client-connect';
import { LambdaClient, GetFunctionCommand } from '@aws-sdk/client-lambda';

// Load environment variables from .env file
dotenv.config({ path: './setup.env' });

const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID; // You'll need to provide this
const PHONE_NUMBER = process.env.PHONE_NUMBER; // Your Connect phone number
const LAMBDA_FUNCTION_ARN = process.env.LAMBDA_FUNCTION_ARN; // The Lambda ARN we created
const RAILWAY_WEBHOOK_URL = process.env.RAILWAY_WEBHOOK_URL || 'https://tavari-core-frontend-production.up.railway.app/chime/inbound';

// Initialize AWS clients with credentials from environment
const connectClient = new ConnectClient({ 
  region: AWS_REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  } : undefined
});
const lambdaClient = new LambdaClient({ 
  region: AWS_REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  } : undefined
});

/**
 * Create a Contact Flow that invokes Lambda (which proxies to Railway)
 */
async function createContactFlow() {
  console.log('📞 Creating AWS Connect Contact Flow...');

  // Contact Flow JSON structure
  // Use the format from the working example
  const contactFlowContent = {
    Version: '2019-10-30',
    StartAction: 'InvokeLambda',
    Metadata: {
      entryPointPosition: { x: 10, y: 10 },
      snapshotFileVersion: '1.0'
    },
    Actions: [
      {
        Identifier: 'InvokeLambda',
        Type: 'InvokeLambdaFunction',
        TypeName: 'InvokeLambdaFunction',
        Parameters: {
          FunctionArn: LAMBDA_FUNCTION_ARN,
          FunctionTimeout: '8000'
        },
        Transitions: {
          Success: 'DisconnectCall',
          Error: 'DisconnectCall'
        }
      },
      {
        Identifier: 'DisconnectCall',
        Type: 'Disconnect',
        TypeName: 'Disconnect',
        Parameters: {},
        Transitions: {}
      }
    ]
  };

  try {
    const command = new CreateContactFlowCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      Name: 'Tavari Voice Agent Flow',
      Type: 'CONTACT_FLOW',
      Content: JSON.stringify(contactFlowContent),
      Description: 'AI Voice Agent - Routes calls to Railway via Lambda'
    });

    const response = await connectClient.send(command);
    console.log('✅ Contact Flow created:', response.ContactFlowId);
    return response.ContactFlowId;
  } catch (error) {
    console.error('❌ Error creating Contact Flow:', error);
    throw error;
  }
}

/**
 * Associate the Contact Flow with a phone number
 */
async function assignFlowToPhoneNumber(contactFlowId) {
  console.log('📱 Assigning Contact Flow to phone number...');

  try {
    const command = new AssociatePhoneNumberContactFlowCommand({
      PhoneNumberId: PHONE_NUMBER,
      InstanceId: CONNECT_INSTANCE_ID,
      ContactFlowId: contactFlowId
    });

    await connectClient.send(command);
    console.log('✅ Contact Flow assigned to phone number');
  } catch (error) {
    console.error('❌ Error assigning Contact Flow:', error);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Setting up AWS Connect for Tavari Voice Agent\n');

  // Validate environment variables
  if (!CONNECT_INSTANCE_ID) {
    console.error('❌ CONNECT_INSTANCE_ID environment variable is required');
    console.log('   Get it from: AWS Connect Console > Your Instance > Settings > Overview');
    process.exit(1);
  }

  if (!PHONE_NUMBER) {
    console.error('❌ PHONE_NUMBER environment variable is required');
    console.log('   Format: The phone number ID from AWS Connect');
    process.exit(1);
  }

  if (!LAMBDA_FUNCTION_ARN) {
    console.error('❌ LAMBDA_FUNCTION_ARN environment variable is required');
    console.log('   Use the Lambda ARN we created earlier');
    process.exit(1);
  }

  try {
    // Create Contact Flow
    const contactFlowId = await createContactFlow();

    // Assign to phone number
    await assignFlowToPhoneNumber(contactFlowId);

    console.log('\n✅ Setup complete!');
    console.log(`   Contact Flow ID: ${contactFlowId}`);
    console.log(`   Phone Number: ${PHONE_NUMBER}`);
    console.log(`   Railway Webhook: ${RAILWAY_WEBHOOK_URL}`);
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    process.exit(1);
  }
}

main();

