// Script to create Amazon Connect Contact Flow via API
// Run: node create-contact-flow.js

import { ConnectClient, CreateContactFlowCommand } from '@aws-sdk/client-connect';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration - UPDATE THESE VALUES
const CONFIG = {
  region: 'ca-central-1', // Your AWS region
  instanceId: 'YOUR_INSTANCE_ID', // Your Connect instance ID (ARN or ID)
  lambdaFunctionArn: 'arn:aws:lambda:ca-central-1:595575695738:function:tavari-voice-agent', // Your Lambda ARN
  contactFlowName: 'Tavari Voice Agent',
  description: 'AI Voice Agent with OpenAI and booking functionality'
};

// Get instance ID from ARN if needed
function getInstanceId(instanceArn) {
  // ARN format: arn:aws:connect:region:account:instance/instance-id
  if (instanceArn.includes('/')) {
    return instanceArn.split('/')[1];
  }
  return instanceArn;
}

// Build the contact flow definition
function buildContactFlow(lambdaArn) {
  return {
    Version: '2019-10-30',
    StartAction: 'InvokeLambda',
    Metadata: {
      entryPointPosition: { x: 10, y: 10 }
    },
    Actions: [
      {
        Type: 'InvokeLambdaFunction',
        Parameters: {
          FunctionArn: lambdaArn,
          FunctionTimeout: '3000'
        },
        Transitions: {
          Success: 'CheckResult',
          Error: 'ErrorHandler'
        },
        Identifier: 'InvokeLambda',
        TypeName: 'InvokeLambdaFunction'
      },
      {
        Type: 'CheckAttributeCondition',
        Parameters: {
          Conditions: [
            {
              AttributeName: 'result',
              ComparisonType: 'Equals',
              Value: 'success'
            }
          ]
        },
        Transitions: {
          Matched: 'PlayGreeting',
          NotMatched: 'NoAgentHandler'
        },
        Identifier: 'CheckResult',
        TypeName: 'CheckAttributeCondition'
      },
      {
        Type: 'PlayPrompt',
        Parameters: {
          Text: '${greeting}',
          TextToSpeechVoice: 'Joanna'
        },
        Transitions: {
          Success: 'GetCustomerInput',
          Error: 'ErrorHandler'
        },
        Identifier: 'PlayGreeting',
        TypeName: 'PlayPrompt'
      },
      {
        Type: 'GetCustomerInput',
        Parameters: {
          Text: 'Please speak your request.',
          TextToSpeechVoice: 'Joanna',
          Timeout: '5000'
        },
        Transitions: {
          Success: 'ProcessInput',
          CustomerTimeout: 'GetCustomerInput',
          Error: 'ErrorHandler'
        },
        Identifier: 'GetCustomerInput',
        TypeName: 'GetCustomerInput'
      },
      {
        Type: 'InvokeLambdaFunction',
        Parameters: {
          FunctionArn: lambdaArn,
          FunctionTimeout: '8000',
          Attributes: JSON.stringify({
            transcript: '${CustomerInput.Transcript}',
            action: 'AUDIO_STREAM'
          })
        },
        Transitions: {
          Success: 'PlayAIResponse',
          Error: 'ErrorHandler'
        },
        Identifier: 'ProcessInput',
        TypeName: 'InvokeLambdaFunction'
      },
      {
        Type: 'PlayPrompt',
        Parameters: {
          Text: '${message}',
          TextToSpeechVoice: 'Joanna'
        },
        Transitions: {
          Success: 'GetCustomerInput',
          Error: 'ErrorHandler'
        },
        Identifier: 'PlayAIResponse',
        TypeName: 'PlayPrompt'
      },
      {
        Type: 'PlayPrompt',
        Parameters: {
          Text: 'Sorry, no agent is configured for this number. Goodbye.',
          TextToSpeechVoice: 'Joanna'
        },
        Transitions: {
          Success: 'Disconnect',
          Error: 'Disconnect'
        },
        Identifier: 'NoAgentHandler',
        TypeName: 'PlayPrompt'
      },
      {
        Type: 'PlayPrompt',
        Parameters: {
          Text: 'I apologize, I encountered an error. Please try calling again later.',
          TextToSpeechVoice: 'Joanna'
        },
        Transitions: {
          Success: 'Disconnect',
          Error: 'Disconnect'
        },
        Identifier: 'ErrorHandler',
        TypeName: 'PlayPrompt'
      },
      {
        Type: 'Disconnect',
        Parameters: {},
        Transitions: {},
        Identifier: 'Disconnect',
        TypeName: 'Disconnect'
      }
    ],
    InitialAction: {
      Type: 'InvokeLambdaFunction',
      Parameters: {
        FunctionArn: lambdaArn,
        FunctionTimeout: '3000'
      },
      Transitions: {
        Success: 'CheckResult',
        Error: 'ErrorHandler'
      },
      Identifier: 'InvokeLambda',
      TypeName: 'InvokeLambdaFunction'
    }
  };
}

async function createContactFlow() {
  try {
    // Initialize Connect client
    const client = new ConnectClient({ region: CONFIG.region });
    
    // Get instance ID
    const instanceId = getInstanceId(CONFIG.instanceId);
    
    // Build contact flow
    const contactFlowDefinition = buildContactFlow(CONFIG.lambdaFunctionArn);
    
    // Create contact flow
    const command = new CreateContactFlowCommand({
      InstanceId: instanceId,
      Name: CONFIG.contactFlowName,
      Description: CONFIG.description,
      Type: 'CONTACT_FLOW',
      Content: JSON.stringify(contactFlowDefinition)
    });
    
    console.log('🚀 Creating contact flow...');
    console.log(`   Instance ID: ${instanceId}`);
    console.log(`   Name: ${CONFIG.contactFlowName}`);
    console.log(`   Lambda ARN: ${CONFIG.lambdaFunctionArn}`);
    
    const response = await client.send(command);
    
    console.log('✅ Contact flow created successfully!');
    console.log(`   Contact Flow ID: ${response.ContactFlowId}`);
    console.log(`   ARN: ${response.ContactFlowArn}`);
    
    return response;
  } catch (error) {
    console.error('❌ Error creating contact flow:', error);
    if (error.name === 'ResourceNotFoundException') {
      console.error('   Make sure your instance ID is correct');
    }
    if (error.name === 'InvalidParameterException') {
      console.error('   Check your Lambda ARN and region');
    }
    throw error;
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  // Check if config is set
  if (CONFIG.instanceId === 'YOUR_INSTANCE_ID') {
    console.error('❌ Please update CONFIG in the script:');
    console.error('   1. Set instanceId to your Connect instance ID');
    console.error('   2. Update lambdaFunctionArn if needed');
    console.error('   3. Update region if needed');
    process.exit(1);
  }
  
  createContactFlow()
    .then(() => {
      console.log('\n✅ Done! Your contact flow is ready.');
      console.log('   Next: Assign it to your phone number in Connect.');
    })
    .catch(error => {
      console.error('\n❌ Failed to create contact flow');
      process.exit(1);
    });
}

export { createContactFlow, buildContactFlow };


