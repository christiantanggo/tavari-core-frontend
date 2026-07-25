// index.js
// Main Express server for Twilio voice agent

import express from 'express';
import dotenv from 'dotenv';
import { 
  handleIncomingCall, 
  handleCallStatus, 
  handleAIConversation 
} from './twilioRouter.js';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;
const app = express();

// Middleware
app.use(express.json({ limit: '10mb' })); // Chime sends base64 audio
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Health check route (required for Railway)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'tavari-voice-agent-chime'
  });
});

// AWS Chime SIP Media App webhook
app.post('/chime/inbound', handleChimeWebhook);

// Root route
app.get('/', (req, res) => {
  res.status(200).json({
    service: 'Tavari Voice Agent - AWS Chime SIP Media App',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      webhook: '/chime/inbound'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path
  });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Tavari Voice Agent server running on port ${PORT}`);
  console.log(`📞 Chime webhook: POST http://localhost:${PORT}/chime/inbound`);
  console.log(`❤️  Health check: GET http://localhost:${PORT}/health`);
  
  // Validate environment variables
  // Note: AWS SES credentials are stored in Supabase Edge Functions, not here
  const requiredEnvVars = [
    'OPENAI_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];
  
  const missing = requiredEnvVars.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.warn(`⚠️  Missing environment variables: ${missing.join(', ')}`);
  } else {
    console.log('✅ All required environment variables are set');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

