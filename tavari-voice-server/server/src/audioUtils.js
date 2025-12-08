// audioUtils.js
// Audio conversion utilities for AWS Chime SIP Media App
// Handles PCM 16-bit, 8kHz audio encoding/decoding

/**
 * Decode base64 PCM audio to Buffer
 * @param {string} base64Audio - Base64 encoded PCM audio
 * @returns {Buffer} - PCM audio buffer
 */
export function decodeBase64PCM(base64Audio) {
  if (!base64Audio) {
    return Buffer.alloc(0);
  }
  return Buffer.from(base64Audio, 'base64');
}

/**
 * Encode PCM audio buffer to base64
 * @param {Buffer} pcmBuffer - PCM audio buffer
 * @returns {string} - Base64 encoded audio
 */
export function encodePCMToBase64(pcmBuffer) {
  if (!pcmBuffer || pcmBuffer.length === 0) {
    return '';
  }
  return pcmBuffer.toString('base64');
}

/**
 * Format Chime Speak response with audio
 * @param {string} audioBase64 - Base64 encoded PCM audio
 * @returns {object} - Chime response format
 */
export function formatChimeSpeakResponse(audioBase64) {
  return {
    SchemaVersion: '1.0',
    Actions: [
      {
        Type: 'Speak',
        Parameters: {
          Audio: audioBase64
        }
      }
    ]
  };
}

/**
 * Format Chime Answer response
 * @returns {object} - Chime response format
 */
export function formatChimeAnswerResponse() {
  return {
    SchemaVersion: '1.0',
    Actions: [
      {
        Type: 'Answer'
      }
    ]
  };
}

/**
 * Format Chime Continue response
 * @returns {object} - Chime response format
 */
export function formatChimeContinueResponse() {
  return {
    SchemaVersion: '1.0',
    Actions: [
      {
        Type: 'Continue'
      }
    ]
  };
}

/**
 * Format Chime End response
 * @returns {object} - Chime response format
 */
export function formatChimeEndResponse() {
  return {
    SchemaVersion: '1.0',
    Actions: [
      {
        Type: 'End'
      }
    ]
  };
}

/**
 * Combine multiple PCM buffers
 * @param {Buffer[]} buffers - Array of PCM buffers
 * @returns {Buffer} - Combined buffer
 */
export function combinePCMBuffers(buffers) {
  if (!buffers || buffers.length === 0) {
    return Buffer.alloc(0);
  }
  return Buffer.concat(buffers);
}

