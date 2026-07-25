// lambda-proxy.js
// Lambda function that proxies AWS Connect events to Railway
// Copy this code into your Lambda function in AWS Console

const RAILWAY_URL = 'https://tavari-core-frontend-production.up.railway.app/chime/inbound';

export const handler = async (event) => {
  console.log('📞 Lambda received Connect event:', JSON.stringify(event, null, 2));

  try {
    // AWS Connect sends events in event.Details
    const connectEvent = event.Details || event;
    const contactId = connectEvent.ContactId || connectEvent.contactId;
    const phoneNumber = connectEvent.CustomerEndpoint?.Address || connectEvent.CustomerEndpoint?.PhoneNumber;
    const callerNumber = connectEvent.SystemEndpoint?.Address || connectEvent.SystemEndpoint?.PhoneNumber;
    
    // Convert Connect event to Chime-like format for Railway
    const chimeEvent = {
      EventType: 'CALL_RECEIVED',
      CallId: contactId,
      FromNumber: callerNumber,
      ToNumber: phoneNumber,
      AudioChunk: connectEvent.AudioChunk || null,
      ConnectEvent: connectEvent
    };

    // Forward to Railway using https module (fetch might not be available)
    const https = await import('https');
    const { URL } = await import('url');
    
    const url = new URL(RAILWAY_URL);
    const postData = JSON.stringify(chimeEvent);

    const response = await new Promise((resolve, reject) => {
      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, data: data });
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
    
    // Return response in Connect format
    return {
      statusCode: response.status,
      body: JSON.stringify(response.data),
    };
  } catch (error) {
    console.error('❌ Error proxying to Railway:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        SchemaVersion: '1.0',
        Actions: [{ Type: 'End' }],
        error: error.message,
      }),
    };
  }
};

