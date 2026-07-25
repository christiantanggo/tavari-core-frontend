// associate-lambda.js
// Quick script to associate Lambda with Connect instance

import dotenv from 'dotenv';
import { ConnectClient, AssociateLambdaFunctionCommand } from '@aws-sdk/client-connect';

dotenv.config({ path: './setup.env' });

const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID;
const LAMBDA_FUNCTION_ARN = process.env.LAMBDA_FUNCTION_ARN;

const connectClient = new ConnectClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});

async function associateLambda() {
  console.log('🔗 Associating Lambda function with Connect instance...');
  console.log(`   Instance ID: ${CONNECT_INSTANCE_ID}`);
  console.log(`   Lambda ARN: ${LAMBDA_FUNCTION_ARN}`);

  try {
    const command = new AssociateLambdaFunctionCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      FunctionArn: LAMBDA_FUNCTION_ARN,
    });

    await connectClient.send(command);
    console.log('✅ Lambda function associated successfully!');
    console.log('   You can now go back to the Contact Flow designer and select your Lambda function.');
  } catch (error) {
    console.error('❌ Error associating Lambda:', error.message);
    if (error.name === 'ResourceConflictException') {
      console.log('   (Lambda is already associated - this is OK!)');
    } else {
      process.exit(1);
    }
  }
}

associateLambda();


