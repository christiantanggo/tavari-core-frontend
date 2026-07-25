// sessionManager.js
// Call session management for AWS Chime voice agent

/**
 * Session structure:
 * {
 *   callId: string,
 *   sessionId: string, // OpenAI session ID
 *   agent: object, // From database
 *   openaiWs: WebSocket, // OpenAI Realtime connection
 *   messages: array, // Conversation history
 *   audioBuffer: Buffer, // Accumulated audio
 *   startedAt: Date,
 *   functionCallInProgress: boolean,
 *   systemPrompt: string
 * }
 */

const activeSessions = new Map();

/**
 * Start a new call session
 * @param {string} callId - Unique call ID from Chime
 * @param {object} agent - Agent configuration from database
 * @param {string} systemPrompt - System prompt for OpenAI
 * @returns {object} - Session object
 */
export function startSession(callId, agent, systemPrompt) {
  const session = {
    callId,
    sessionId: null, // Will be set when OpenAI session starts
    agent,
    openaiWs: null, // Will be set when WebSocket connects
    messages: [],
    audioBuffer: Buffer.alloc(0),
    startedAt: new Date(),
    functionCallInProgress: false,
    systemPrompt,
    isSpeaking: false,
    lastAudioTime: null
  };

  activeSessions.set(callId, session);
  console.log(`✅ Session started: ${callId} for agent ${agent.id}`);
  
  return session;
}

/**
 * Get an existing session
 * @param {string} callId - Call ID
 * @returns {object|null} - Session object or null
 */
export function getSession(callId) {
  return activeSessions.get(callId) || null;
}

/**
 * Update session with OpenAI WebSocket
 * @param {string} callId - Call ID
 * @param {WebSocket} ws - OpenAI Realtime WebSocket
 * @param {string} sessionId - OpenAI session ID
 */
export function setOpenAISession(callId, ws, sessionId) {
  const session = getSession(callId);
  if (session) {
    session.openaiWs = ws;
    session.sessionId = sessionId;
    console.log(`🔌 OpenAI session connected: ${callId} (${sessionId})`);
  }
}

/**
 * Append audio to session buffer
 * @param {string} callId - Call ID
 * @param {Buffer} audio - PCM audio buffer
 */
export function appendAudio(callId, audio) {
  const session = getSession(callId);
  if (session) {
    session.audioBuffer = Buffer.concat([session.audioBuffer, audio]);
    session.lastAudioTime = new Date();
  }
}

/**
 * Clear audio buffer
 * @param {string} callId - Call ID
 */
export function clearAudioBuffer(callId) {
  const session = getSession(callId);
  if (session) {
    session.audioBuffer = Buffer.alloc(0);
  }
}

/**
 * Add message to conversation history
 * @param {string} callId - Call ID
 * @param {object} message - Message object {role, content}
 */
export function addMessage(callId, message) {
  const session = getSession(callId);
  if (session) {
    session.messages.push(message);
  }
}

/**
 * Get conversation messages
 * @param {string} callId - Call ID
 * @returns {array} - Array of messages
 */
export function getMessages(callId) {
  const session = getSession(callId);
  return session ? session.messages : [];
}

/**
 * Set function call in progress flag
 * @param {string} callId - Call ID
 * @param {boolean} inProgress - Whether function call is in progress
 */
export function setFunctionCallInProgress(callId, inProgress) {
  const session = getSession(callId);
  if (session) {
    session.functionCallInProgress = inProgress;
  }
}

/**
 * End a session and cleanup
 * @param {string} callId - Call ID
 */
export function endSession(callId) {
  const session = getSession(callId);
  if (session) {
    // Close OpenAI WebSocket if open
    if (session.openaiWs && session.openaiWs.readyState === 1) {
      try {
        session.openaiWs.close();
      } catch (error) {
        console.error(`Error closing WebSocket for ${callId}:`, error);
      }
    }

    const duration = (new Date() - session.startedAt) / 1000;
    console.log(`🔚 Session ended: ${callId} (duration: ${duration.toFixed(2)}s)`);
    
    activeSessions.delete(callId);
  }
}

/**
 * Get all active sessions (for debugging)
 * @returns {Map} - Map of active sessions
 */
export function getAllSessions() {
  return activeSessions;
}

/**
 * Cleanup stale sessions (older than 1 hour)
 */
export function cleanupStaleSessions() {
  const now = new Date();
  const maxAge = 60 * 60 * 1000; // 1 hour

  for (const [callId, session] of activeSessions.entries()) {
    const age = now - session.startedAt;
    if (age > maxAge) {
      console.log(`🧹 Cleaning up stale session: ${callId}`);
      endSession(callId);
    }
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupStaleSessions, 10 * 60 * 1000);


