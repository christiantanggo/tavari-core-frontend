// Quick test to verify .env file is loading correctly
import dotenv from 'dotenv';

dotenv.config();

console.log('Testing .env file...\n');

const requiredVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
  'PORT',
  'TAVARI_VOICE_SERVER_URL'
];

let allGood = true;

requiredVars.forEach(varName => {
  const value = process.env[varName];
  if (!value) {
    console.log(`❌ ${varName}: MISSING`);
    allGood = false;
  } else {
    // Mask sensitive values
    const displayValue = varName.includes('KEY') || varName.includes('SECRET')
      ? value.substring(0, 10) + '...' + value.substring(value.length - 4)
      : value;
    console.log(`✅ ${varName}: ${displayValue}`);
  }
});

console.log('\n' + (allGood ? '✅ All environment variables loaded!' : '❌ Some variables are missing!'));

