// list-lambdas.js
// List all Lambda functions to find the correct one

import dotenv from 'dotenv';
import { LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';

dotenv.config({ path: './setup.env' });

const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';

const lambdaClient = new LambdaClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});

async function listLambdas() {
  console.log('🔍 Listing Lambda functions in', AWS_REGION, '...\n');

  try {
    const command = new ListFunctionsCommand({});
    const response = await lambdaClient.send(command);

    if (response.Functions && response.Functions.length > 0) {
      console.log('Found Lambda functions:');
      response.Functions.forEach(func => {
        console.log(`  - ${func.FunctionName} (${func.FunctionArn})`);
      });
    } else {
      console.log('No Lambda functions found.');
    }
  } catch (error) {
    console.error('❌ Error listing Lambdas:', error.message);
    process.exit(1);
  }
}

listLambdas();


