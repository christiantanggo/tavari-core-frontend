// Supabase Edge Function for Helcim Generation 2 Terminal Integration
// Handles secure API calls to Helcim API v2 for terminal operations

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getHelcimCredentialsForBusiness } from "../_shared/helcimBusinessCredentials.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const getTransactionStatusText = (transaction: any) => {
  return String(
    transaction?.status ??
    transaction?.result ??
    transaction?.approval ??
    transaction?.responseCode ??
    transaction?.responseMessage ??
    ''
  ).trim();
};

const getTransactionErrorText = (transaction: any) => {
  const raw =
    transaction?.errors ??
    transaction?.error ??
    transaction?.responseMessage ??
    transaction?.message ??
    '';

  if (Array.isArray(raw)) return raw.filter(Boolean).join(', ').trim();
  if (raw && typeof raw === 'object') {
    try {
      return JSON.stringify(raw);
    } catch (e) {
      return '';
    }
  }
  return String(raw || '').trim();
};

// Helcim declines when cardNumber + cardholderName + amount match a transaction from
// the last five minutes. The check is server-side and cannot be waived from the API.
// https://devdocs.helcim.com/docs/suspected-duplicate-transactions
const isSuspectedDuplicateText = (text: string) => /duplicat/i.test(String(text || ''));

const SUSPECTED_DUPLICATE_CODE = 'suspected_duplicate';

const SUSPECTED_DUPLICATE_MESSAGE =
  'Helcim blocked this as a suspected duplicate: the same card was already charged this exact amount within the last 5 minutes.';

const classifyTransactionStatus = (transaction: any) => {
  const statusText = getTransactionStatusText(transaction).toUpperCase();
  const errorText = getTransactionErrorText(transaction);
  const hasTransactionId = !!(transaction?.transactionId || transaction?.id || transaction?.cardTransactionId);
  const hasApproval =
    !!(transaction?.approvalCode || transaction?.authCode || transaction?.approval);

  if (
    statusText.includes('CANCEL') ||
    statusText.includes('VOID') ||
    statusText.includes('ABORT')
  ) {
    return 'cancelled';
  }

  // A populated errors field means Helcim rejected it, even when the status field is
  // non-standard. Without this, duplicate declines fall through to the "has an id, so
  // treat it as captured" branch below.
  if (errorText && /DECLIN|DUPLICAT|REJECT|FAIL/i.test(errorText)) {
    return 'failed';
  }

  if (
    statusText.includes('DECLIN') ||
    statusText.includes('FAIL') ||
    statusText.includes('ERROR') ||
    statusText.includes('REJECT')
  ) {
    return 'failed';
  }

  if (
    statusText.includes('APPROVED') ||
    statusText.includes('SUCCESS') ||
    statusText.includes('COMPLETED') ||
    statusText === '1' ||
    statusText === '00'
  ) {
    return 'completed';
  }

  // Helcim sometimes returns purchase records with a transaction id / auth code
  // but an empty or non-standard status field. Treat those as captured.
  if (hasTransactionId && (hasApproval || !statusText)) {
    return 'completed';
  }

  if (hasTransactionId && (statusText.includes('PURCHASE') || statusText.includes('SALE') || statusText.includes('CAPTURE'))) {
    return 'completed';
  }

  return 'pending';
};

const buildTransactionResponse = (transaction: any, invoiceNumber: string | null, status: string) => {
  const declineReason = getTransactionErrorText(transaction);
  const isDuplicate = status === 'failed' && isSuspectedDuplicateText(declineReason);

  let message: string;
  if (status === 'completed') {
    message = 'Payment completed successfully';
  } else if (status === 'cancelled') {
    message = 'Payment was cancelled on the terminal';
  } else if (isDuplicate) {
    message = SUSPECTED_DUPLICATE_MESSAGE;
  } else {
    message = declineReason || 'Payment failed on the terminal';
  }

  return {
    success: true,
    status,
    transaction,
    transactionId: transaction?.transactionId || transaction?.id || null,
    approvalCode: transaction?.approvalCode || transaction?.authCode || transaction?.approval || null,
    cardType: transaction?.cardType || transaction?.cardBrand || null,
    lastFour: transaction?.lastFour || transaction?.cardNumberLast4 || transaction?.cardNumber?.slice?.(-4) || null,
    amount: transaction?.amount || transaction?.transactionAmount || null,
    invoiceNumber: invoiceNumber || transaction?.invoiceNumber || transaction?.invoice?.number || null,
    declineReason: declineReason || null,
    declineCode: isDuplicate ? SUSPECTED_DUPLICATE_CODE : null,
    message
  };
};

/**
 * Duplicate declines are not always searchable by invoiceNumber, so polling can miss
 * them entirely and time out after two minutes with no explanation. This probes for a
 * declined transaction at the same amount inside the polling window. It only ever
 * matches declines, so it can never mark a sale as paid.
 */
const findRecentDuplicateDecline = async (options: {
  baseUrl: string;
  token: string;
  amount: any;
  deviceCode?: string | null;
  dateFrom: string;
  dateTo: string;
}) => {
  const targetAmount = parseFloat(options.amount);
  if (!Number.isFinite(targetAmount)) return null;

  try {
    const searchResponse = await fetch(`${options.baseUrl}/transaction/search`, {
      method: 'POST',
      headers: {
        'api-token': options.token,
        'accept': 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        amount: targetAmount.toFixed(2),
        dateFrom: options.dateFrom,
        dateTo: options.dateTo,
        ...(options.deviceCode ? { deviceCode: options.deviceCode } : {})
      })
    });

    if (!searchResponse.ok) {
      console.log(`[Helcim Terminal] Duplicate decline probe failed: ${searchResponse.status}`);
      return null;
    }

    const searchData = await searchResponse.json();
    const transactions = searchData.response?.transactions ||
                        searchData.transactions ||
                        searchData.data?.transactions ||
                        (Array.isArray(searchData) ? searchData : []);

    const declines = transactions
      .filter((t: any) => {
        const transactionAmount = parseFloat(t.amount || t.transactionAmount || 0);
        if (Math.abs(transactionAmount - targetAmount) >= 0.01) return false;
        if (classifyTransactionStatus(t) !== 'failed') return false;
        return isSuspectedDuplicateText(getTransactionErrorText(t));
      })
      .sort((a: any, b: any) => {
        const dateA = new Date(a.dateCreated || a.date || a.timestamp || 0);
        const dateB = new Date(b.dateCreated || b.date || b.timestamp || 0);
        return dateB.getTime() - dateA.getTime();
      });

    return declines[0] || null;
  } catch (error) {
    console.log('[Helcim Terminal] Duplicate decline probe error:', error?.message || error);
    return null;
  }
};

serve(async (req) => {
  // Handle CORS preflight - must be first and return immediately
  if (req.method === 'OPTIONS') {
    return new Response('ok', { 
      status: 200,
      headers: corsHeaders 
    });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    // Verify user is authenticated
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    let requestBody;
    try {
      requestBody = await req.json();
    } catch (parseError) {
      console.error('[Helcim Terminal] JSON parse error:', parseError);
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body', details: parseError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const { action, data } = requestBody;
    
    if (!action) {
      return new Response(
        JSON.stringify({ error: 'Missing action parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log('[Helcim Terminal] Request received:', { action, hasData: !!data });

    const supabaseService = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const businessIdRaw =
      typeof data?.businessId === 'string'
        ? String(data.businessId).trim()
        : typeof (requestBody as Record<string, unknown>)?.businessId === 'string'
        ? String((requestBody as Record<string, unknown>).businessId).trim()
        : '';

    if (!businessIdRaw) {
      return new Response(
        JSON.stringify({
          error:
            'businessId is required. Each business uses its own Helcim account — ensure the POS client sends businessId.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const helcimCreds = await getHelcimCredentialsForBusiness(supabaseService, businessIdRaw);
    const HELCIM_API_TOKEN = helcimCreds?.apiToken;
    const HELCIM_ACCOUNT_ID = helcimCreds?.accountId ?? undefined;

    if (!HELCIM_API_TOKEN) {
      return new Response(
        JSON.stringify({
          error:
            'Helcim API token not configured for this business. Add it under POS → Settings → Payments (Helcim section).',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Helcim API v2 configuration - Using api-token header (not Bearer)
    // Based on API Access v2 configuration from Helcim dashboard
    const HELCIM_BASE_URL_V2 = 'https://api.helcim.com/v2';

    let result;

    switch (action) {
      case 'getTerminals': {
        // Get list of available Smart Terminal devices
        // Using the correct endpoint: GET /v2/devices/
        // This is for Smart Terminal API, not Card Terminals API
        console.log('[Helcim Terminal] Fetching Smart Terminal devices...');
        
        const { deviceCode, limit = 100, offset = 0, page = 0 } = data || {};
        
        // Build query string - can search by device code (4-digit alphanumeric like "JSV5")
        const queryParams = new URLSearchParams();
        if (deviceCode) queryParams.append('code', deviceCode);
        queryParams.append('limit', limit.toString());
        // Use either offset or page, not both
        if (offset > 0) {
          queryParams.append('offset', offset.toString());
        } else if (page > 0) {
          queryParams.append('page', page.toString());
        }
        const queryString = queryParams.toString();
        const devicesUrl = `${HELCIM_BASE_URL_V2}/devices/${queryString ? '?' + queryString : ''}`;
        
        console.log(`[Helcim Terminal] Calling: ${devicesUrl}`);
        
        try {
          const devicesResponse = await fetch(devicesUrl, {
            method: 'GET',
            headers: {
              'api-token': HELCIM_API_TOKEN,
              'accept': 'application/json',
              'content-type': 'application/json'
            }
          });
          
          const responseStatus = devicesResponse.status;
          const responseText = await devicesResponse.text();
          
          console.log(`[Helcim Terminal] Response status: ${responseStatus}`);
          console.log(`[Helcim Terminal] Response:`, responseText.substring(0, 500));
          
          if (!devicesResponse.ok) {
            // If 401, it's a permissions issue - but we can still use device codes directly for payments
            if (responseStatus === 401) {
              console.log('[Helcim Terminal] Device discovery requires General: Read and Settings: Read permissions');
              console.log('[Helcim Terminal] This is OK - Smart Terminal API allows direct payment with device codes');
              result = {
                success: true,
                terminals: [],
                count: 0,
                message: 'Device discovery unavailable (permissions issue). You can still process payments using your device code directly (e.g., "JSV5").'
              };
              break;
            }
            throw new Error(`Devices endpoint returned ${responseStatus}: ${responseText.substring(0, 200)}`);
          }
          
          const devicesData = JSON.parse(responseText);
          console.log('[Helcim Terminal] Devices data:', devicesData);
          
          // Extract devices from response - API returns array of devices
          // Example: [{ "code": "JSV5", "dateCreated": "2026-01-22 18:00:36" }]
          const rawDevices = Array.isArray(devicesData) ? devicesData : 
                            devicesData?.response?.devices ||
                            devicesData?.devices ||
                            devicesData?.data ||
                            [];
          
          // Map devices to our format
          let terminals = [];
          if (rawDevices && Array.isArray(rawDevices) && rawDevices.length > 0) {
            terminals = rawDevices.map(device => ({
              id: device.id || device.deviceId,
              deviceCode: device.code || device.deviceCode || device.device_code,
              name: device.name || device.nickname || `Device ${device.code}`,
              nickname: device.nickname || device.name || `Device ${device.code}`,
              status: device.status || 'unknown',
              connected: device.connected !== false, // Assume connected if not specified
              dateCreated: device.dateCreated,
              currency: device.currency || 'CAD'
            }));
          }
          
          result = {
            success: true,
            terminals: terminals,
            count: terminals.length
          };
        } catch (error) {
          console.error('[Helcim Terminal] Error fetching devices:', error);
          // Don't fail completely - Smart Terminal API allows direct payment with device codes
          result = {
            success: true,
            terminals: [],
            count: 0,
            error: error.message || 'Failed to fetch devices',
            message: 'Device discovery failed. You can still process payments by entering your device code directly (e.g., "JSV5").'
          };
        }
        break;
      }

      case 'processPayment': {
        // Process payment through device using device code
        // Using the correct endpoint: POST /v2/devices/{code}/payment/purchase
        const { amount, terminalId, deviceCode, currency = 'CAD', invoiceNumber, customerCode, saleId, businessId } = data;

        // Use deviceCode if provided, otherwise fall back to terminalId (which might be a device code)
        const code = deviceCode || terminalId;
        
        console.log('[Helcim Terminal] Payment request data:', {
          amount,
          deviceCode,
          terminalId,
          code,
          currency
        });
        
        if (!amount || !code) {
          console.error('[Helcim Terminal] Missing required fields:', { amount, code, deviceCode, terminalId });
          return new Response(
            JSON.stringify({ 
              error: 'Amount and device code (or terminalId) are required',
              received: { amount, deviceCode, terminalId, code }
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log('[Helcim Terminal] Processing payment:', {
          amount,
          deviceCode: code,
          currency,
          invoiceNumber,
          customerCode,
          saleId
        });

        // Format amount to 2 decimal places
        const formattedAmount = parseFloat(amount).toFixed(2);

        // Build payment payload according to API documentation
        // Required: currency, transactionAmount
        // Optional: invoiceNumber, customerCode
        const paymentPayload: any = {
          currency: currency,
          transactionAmount: parseFloat(formattedAmount)
        };
        
        // Always set invoiceNumber for transaction tracking and polling
        if (invoiceNumber) {
          paymentPayload.invoiceNumber = invoiceNumber;
        } else if (saleId) {
          // Use saleId as invoiceNumber if no invoiceNumber provided
          paymentPayload.invoiceNumber = `SALE-${saleId}`;
        } else {
          // Generate a temporary invoiceNumber if neither is provided
          // Format: TEMP-{timestamp}-{amount}
          paymentPayload.invoiceNumber = `TEMP-${Date.now()}-${Math.round(parseFloat(formattedAmount) * 100)}`;
          console.log('[Helcim Terminal] Generated temporary invoiceNumber:', paymentPayload.invoiceNumber);
        }
        
        if (customerCode) {
          paymentPayload.customerCode = customerCode;
        }

        // Use the correct endpoint: POST /v2/devices/{code}/payment/purchase
        const paymentUrl = `${HELCIM_BASE_URL_V2}/devices/${code}/payment/purchase`;
        
        console.log(`[Helcim Terminal] Payment URL: ${paymentUrl}`);
        console.log(`[Helcim Terminal] Payment payload:`, JSON.stringify(paymentPayload, null, 2));
        console.log(`[Helcim Terminal] API Token present: ${!!HELCIM_API_TOKEN}`);
        console.log(`[Helcim Terminal] API Token length: ${HELCIM_API_TOKEN ? HELCIM_API_TOKEN.length : 0}`);
        console.log(`[Helcim Terminal] API Token preview: ${HELCIM_API_TOKEN ? HELCIM_API_TOKEN.substring(0, 10) + '...' : 'MISSING'}`);

        try {
          const paymentResponse = await fetch(paymentUrl, {
            method: 'POST',
            headers: {
              'api-token': HELCIM_API_TOKEN,
              'accept': 'application/json',
              'content-type': 'application/json'
            },
            body: JSON.stringify(paymentPayload)
          });
          
          const responseStatus = paymentResponse.status;
          const responseText = await paymentResponse.text();
          
          console.log(`[Helcim Terminal] Payment response status: ${responseStatus}`);
          console.log(`[Helcim Terminal] Payment response length: ${responseText ? responseText.length : 0}`);
          console.log(`[Helcim Terminal] Payment response empty: ${!responseText || !responseText.trim()}`);
          console.log(`[Helcim Terminal] Payment response:`, responseText ? responseText.substring(0, 500) : '(empty)');
          
          if (!paymentResponse.ok) {
            let errorMessage = `Payment failed with status ${responseStatus}`;
            let errorDetails = null;
            try {
              if (responseText && responseText.trim()) {
                const errorData = JSON.parse(responseText);
                errorMessage = errorData.message || 
                             (Array.isArray(errorData.errors) ? errorData.errors.join(', ') : errorData.error) || 
                             errorMessage;
                errorDetails = errorData;
              } else {
                errorMessage = `Payment failed with status ${responseStatus} (empty response)`;
              }
            } catch (e) {
              errorMessage = responseText ? responseText.substring(0, 200) : `Payment failed with status ${responseStatus} (invalid response)`;
            }
            
            if (isSuspectedDuplicateText(errorMessage) || isSuspectedDuplicateText(responseText)) {
              return new Response(
                JSON.stringify({
                  success: false,
                  error: SUSPECTED_DUPLICATE_MESSAGE,
                  declineCode: SUSPECTED_DUPLICATE_CODE,
                  declineReason: errorMessage,
                  status: responseStatus,
                  details: errorDetails
                }),
                {
                  status: 200,
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                }
              );
            }

            // Provide helpful guidance for common errors
            if (responseStatus === 401 || responseStatus === 403) {
              errorMessage = `Authorization failed: ${errorMessage}. ` +
                           `The API token may not have the required permissions for Smart Terminal payments. ` +
                           `Required permission: Processing: 'PositiveTransaction' or higher. ` +
                           `Note: Smart Terminal API may require device registration or a different authentication method.`;
            }
            
            return new Response(
              JSON.stringify({ 
                success: false, 
                error: errorMessage,
                status: responseStatus,
                details: errorDetails
              }),
              { 
                status: responseStatus >= 400 && responseStatus < 500 ? responseStatus : 500, 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
              }
            );
          }

          // Check if response is empty before parsing
          // If status is OK and response is empty, payment was initiated and is waiting for customer to complete on device
          if (!responseText || !responseText.trim()) {
            console.log('[Helcim Terminal] Empty response from Helcim API, but status is OK - payment initiated, waiting for customer on device');
            result = {
              success: true,
              status: 'awaiting_card',
              message: 'Payment initiated on device. Please complete the payment by tapping, inserting, or swiping your card on the terminal.',
              deviceCode: code,
              amount: parseFloat(formattedAmount),
              currency: currency,
              invoiceNumber: paymentPayload.invoiceNumber
            };
            break;
          }

          let paymentData;
          try {
            paymentData = JSON.parse(responseText);
          } catch (parseError) {
            // If parsing fails but status is OK, payment was likely initiated
            console.log('[Helcim Terminal] Could not parse response, but status is OK - payment initiated');
            console.log('[Helcim Terminal] Response text:', responseText.substring(0, 500));
            result = {
              success: true,
              status: 'awaiting_card',
              message: 'Payment initiated on device. Please complete the payment by tapping, inserting, or swiping your card on the terminal.',
              deviceCode: code,
              amount: parseFloat(formattedAmount),
              currency: currency,
              invoiceNumber: paymentPayload.invoiceNumber,
              rawResponse: responseText.substring(0, 200)
            };
            break;
          }
          console.log('[Helcim Terminal] Payment processed successfully:', paymentData);

          // Extract transaction details from response
          // The API response structure may vary
          const transaction = paymentData.response || paymentData.transaction || paymentData.data || paymentData;

          // A 2xx response can still carry a declined transaction, so classify it before
          // reporting success — otherwise a decline is recorded as a captured payment.
          const inlineStatus = classifyTransactionStatus(transaction);
          if (inlineStatus === 'failed' || inlineStatus === 'cancelled') {
            console.log('[Helcim Terminal] Payment response carried a non-approved transaction:', {
              inlineStatus,
              errors: getTransactionErrorText(transaction)
            });
            result = buildTransactionResponse(transaction, paymentPayload.invoiceNumber, inlineStatus);
            break;
          }

          result = {
            success: true,
            transaction: transaction,
            transactionId: transaction.transactionId || transaction.id || paymentData.transactionId,
            approvalCode: transaction.approvalCode || transaction.authCode || paymentData.approvalCode,
            cardType: transaction.cardType || transaction.cardBrand || paymentData.cardType,
            lastFour: transaction.lastFour || transaction.cardNumberLast4 || paymentData.lastFour,
            message: transaction.message || paymentData.message || 'Payment processed successfully'
          };
          break;
        } catch (error) {
          console.error('[Helcim Terminal] Payment processing error:', error);
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: error.message || 'Payment processing failed'
            }),
            { 
              status: 500, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
        break;
      }

      case 'getTerminalStatus':
        // Get status of a specific terminal
        const { terminalId: statusTerminalId } = data;
        
        if (!statusTerminalId) {
          return new Response(
            JSON.stringify({ error: 'terminalId is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const statusResponse = await fetch(`${HELCIM_BASE_URL_V2}/terminals/${statusTerminalId}`, {
          method: 'GET',
          headers: {
            'api-token': HELCIM_API_TOKEN,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        });

        if (!statusResponse.ok) {
          const errorText = await statusResponse.text();
          throw new Error(`Failed to get terminal status: ${statusResponse.status} ${errorText}`);
        }

        const statusData = await statusResponse.json();
        result = {
          success: true,
          terminal: statusData.terminal || statusData.data || statusData,
          status: statusData.terminal?.status || statusData.data?.status || statusData.status,
          connected: statusData.terminal?.connected || statusData.data?.connected || false
        };
        break;

      case 'checkTransactionStatus': {
        // Check if a transaction has been completed by searching for it by invoiceNumber, or by amount and deviceCode
        const { invoiceNumber, amount, deviceCode, paymentInitiatedAt, probeDuplicateDecline } = data;
        
        if (!invoiceNumber && (!amount || !deviceCode)) {
          return new Response(
            JSON.stringify({ error: 'invoiceNumber is required, or both amount and deviceCode must be provided' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const isTemporaryInvoice = invoiceNumber && invoiceNumber.startsWith('TEMP-');
        const shouldSearchByAmount = isTemporaryInvoice || !invoiceNumber;
        
        // Calculate time window for matching (only match transactions within 3 minutes of payment initiation)
        const paymentTime = paymentInitiatedAt ? new Date(paymentInitiatedAt) : new Date(Date.now() - 2 * 60 * 1000); // Default to 2 minutes ago
        const timeWindowStart = new Date(paymentTime.getTime() - 1 * 60 * 1000); // 1 minute before payment
        const timeWindowEnd = new Date(Date.now()); // Up to now

        console.log('[Helcim Terminal] Checking transaction status:', {
          invoiceNumber,
          amount,
          deviceCode,
          isTemporaryInvoice,
          shouldSearchByAmount,
          paymentInitiatedAt,
          timeWindow: { start: timeWindowStart.toISOString(), end: timeWindowEnd.toISOString() }
        });

        try {
          // Try v2 transaction search endpoint first
          let searchUrl = `${HELCIM_BASE_URL_V2}/transaction/search`;
          let searchPayload: any = {};

          if (shouldSearchByAmount && amount && deviceCode) {
            // Search by amount and device code (for temporary invoices or missing invoiceNumber)
            // Use a very narrow time window to avoid matching old transactions
            console.log('[Helcim Terminal] Searching by amount and device code with time window');
            searchPayload = {
              amount: parseFloat(amount).toFixed(2),
              deviceCode: deviceCode,
              dateFrom: timeWindowStart.toISOString(),
              dateTo: timeWindowEnd.toISOString()
            };
          } else if (invoiceNumber) {
            // Search by invoiceNumber
            searchPayload.invoiceNumber = invoiceNumber;
          }

          let searchResponse = await fetch(searchUrl, {
            method: 'POST',
            headers: {
              'api-token': HELCIM_API_TOKEN,
              'accept': 'application/json',
              'content-type': 'application/json'
            },
            body: JSON.stringify(searchPayload)
          });

          // If v2 doesn't work, try v1 (which uses different format)
          if (!searchResponse.ok && searchResponse.status === 404) {
            console.log('[Helcim Terminal] v2 transaction search not available, trying v1...');
            searchUrl = 'https://api.helcim.com/v1/transaction/search';
            // v1 uses different format - may need token in body
            if (shouldSearchByAmount && amount && deviceCode) {
              searchPayload = {
                token: HELCIM_API_TOKEN,
                search: {
                  amount: parseFloat(amount).toFixed(2),
                  // v1 might not support deviceCode directly, try description or other fields
                  description: deviceCode
                }
              };
            } else {
              searchPayload = {
                token: HELCIM_API_TOKEN,
                search: { invoiceNumber: invoiceNumber }
              };
            }
            
            searchResponse = await fetch(searchUrl, {
              method: 'POST',
              headers: {
                'accept': 'application/json',
                'content-type': 'application/json'
              },
              body: JSON.stringify(searchPayload)
            });
          }

          if (!searchResponse.ok) {
            console.log(`[Helcim Terminal] Transaction search failed: ${searchResponse.status}`);
            
            // If searching by amount/deviceCode failed, try searching for recent transactions without filters
            if (shouldSearchByAmount && searchResponse.status === 400) {
              console.log('[Helcim Terminal] Amount/deviceCode search not supported, trying recent transactions search...');
              try {
                // Try to get recent transactions within our time window
                const recentSearchUrl = `${HELCIM_BASE_URL_V2}/transaction/search`;
                const recentSearchPayload: any = {
                  dateFrom: timeWindowStart.toISOString(),
                  dateTo: timeWindowEnd.toISOString()
                };
                
                const recentSearchResponse = await fetch(recentSearchUrl, {
                  method: 'POST',
                  headers: {
                    'api-token': HELCIM_API_TOKEN,
                    'accept': 'application/json',
                    'content-type': 'application/json'
                  },
                  body: JSON.stringify(recentSearchPayload)
                });
                
                if (recentSearchResponse.ok) {
                  const recentSearchData = await recentSearchResponse.json();
                  const recentTransactions = recentSearchData.response?.transactions || 
                                           recentSearchData.transactions || 
                                           recentSearchData.data?.transactions ||
                                           (Array.isArray(recentSearchData) ? recentSearchData : []);
                  
                  // Filter by amount and deviceCode, then get the most recent one
                  const targetAmount = parseFloat(amount);
                  const matchingTransactions = recentTransactions
                    .filter((t: any) => {
                      const transactionAmount = parseFloat(t.amount || t.transactionAmount || 0);
                      const amountMatches = Math.abs(transactionAmount - targetAmount) < 0.01;
                      
                      // Check device code if available
                      const deviceMatches = !t.deviceCode || t.deviceCode === deviceCode || 
                                           !t.terminalId || String(t.terminalId) === deviceCode;
                      
                      return amountMatches && deviceMatches;
                    })
                    .sort((a: any, b: any) => {
                      // Sort by date, most recent first
                      const dateA = new Date(a.dateCreated || a.date || a.timestamp || 0);
                      const dateB = new Date(b.dateCreated || b.date || b.timestamp || 0);
                      return dateB.getTime() - dateA.getTime();
                    });
                  
                  const matchingTransaction = matchingTransactions[0];
                  
                  if (matchingTransaction) {
                    const transactionStatus = classifyTransactionStatus(matchingTransaction);
                    console.log('[Helcim Terminal] Found matching transaction in recent transactions', {
                      transactionStatus,
                      transactionId: matchingTransaction.transactionId || matchingTransaction.id
                    });
                    result = buildTransactionResponse(
                      matchingTransaction,
                      invoiceNumber || matchingTransaction.invoiceNumber || null,
                      transactionStatus
                    );
                    break;
                  }
                }
              } catch (fallbackError) {
                console.error('[Helcim Terminal] Fallback search also failed:', fallbackError);
              }
            }
            
            // Return pending status - transaction may not be found yet
            result = {
              success: true,
              status: 'pending',
              message: 'Transaction not found or still processing',
              invoiceNumber: invoiceNumber
            };
            break;
          }

          const searchData = await searchResponse.json();
          console.log('[Helcim Terminal] Transaction search response:', JSON.stringify(searchData).substring(0, 500));
          
          // Extract transactions from response (structure may vary between v1 and v2)
          const transactions = searchData.response?.transactions || 
                              searchData.transactions || 
                              searchData.data?.transactions ||
                              (Array.isArray(searchData) ? searchData : []);
          
          // Find the most relevant transaction and classify its result.
          let matchedTransaction;
          
          if (shouldSearchByAmount && amount && deviceCode) {
            // Filter transactions by amount, device, and time window, then get the most recent one
            const targetAmount = parseFloat(amount);
            const matchingTransactions = transactions
              .filter((t: any) => {
                const transactionAmount = parseFloat(t.amount || t.transactionAmount || 0);
                const amountMatches = Math.abs(transactionAmount - targetAmount) < 0.01;
                
                // Check if transaction is within our time window
                const transactionDate = t.dateCreated || t.date || t.timestamp;
                let isInTimeWindow = true;
                if (transactionDate) {
                  const txDate = new Date(transactionDate);
                  isInTimeWindow = txDate >= timeWindowStart && txDate <= timeWindowEnd;
                }
                
                // Optionally check device code if available
                const deviceMatches = !t.deviceCode || t.deviceCode === deviceCode || 
                                     !t.terminalId || String(t.terminalId) === deviceCode;
                
                return amountMatches && isInTimeWindow && deviceMatches;
              })
              .sort((a: any, b: any) => {
                // Sort by date, most recent first
                const dateA = new Date(a.dateCreated || a.date || a.timestamp || 0);
                const dateB = new Date(b.dateCreated || b.date || b.timestamp || 0);
                return dateB.getTime() - dateA.getTime();
              });
            
            // Get the most recent matching transaction
            matchedTransaction = matchingTransactions[0];
            
            if (matchedTransaction) {
              console.log('[Helcim Terminal] Found matching transaction (most recent with matching amount):', {
                transactionId: matchedTransaction.transactionId || matchedTransaction.id,
                amount: matchedTransaction.amount || matchedTransaction.transactionAmount,
                date: matchedTransaction.dateCreated || matchedTransaction.date || matchedTransaction.timestamp,
                status: getTransactionStatusText(matchedTransaction)
              });
            }
          } else if (invoiceNumber) {
            // Match by invoiceNumber
            matchedTransaction = transactions.find((t: any) => {
              const matchesInvoice = t.invoiceNumber === invoiceNumber || 
                                    t.invoice?.number === invoiceNumber ||
                                    t.invoiceNumber === invoiceNumber.replace('SALE-', '');
              
              return matchesInvoice;
            });
          }

          if (matchedTransaction) {
            const transactionStatus = classifyTransactionStatus(matchedTransaction);
            console.log('[Helcim Terminal] Found transaction:', {
              status: transactionStatus,
              rawStatus: getTransactionStatusText(matchedTransaction),
              transactionId: matchedTransaction.transactionId || matchedTransaction.id
            });
            result = buildTransactionResponse(matchedTransaction, invoiceNumber, transactionStatus);
          } else {
            const duplicateDecline = probeDuplicateDecline && amount
              ? await findRecentDuplicateDecline({
                  baseUrl: HELCIM_BASE_URL_V2,
                  token: HELCIM_API_TOKEN,
                  amount,
                  deviceCode,
                  dateFrom: timeWindowStart.toISOString(),
                  dateTo: timeWindowEnd.toISOString()
                })
              : null;

            if (duplicateDecline) {
              console.log('[Helcim Terminal] Found suspected duplicate decline while polling:', {
                transactionId: duplicateDecline.transactionId || duplicateDecline.id,
                errors: getTransactionErrorText(duplicateDecline)
              });
              result = buildTransactionResponse(duplicateDecline, invoiceNumber, 'failed');
            } else {
              // Transaction not found or not approved yet
              result = {
                success: true,
                status: 'pending',
                message: 'Transaction not found or still processing',
                invoiceNumber: invoiceNumber
              };
            }
          }
        } catch (error) {
          console.error('[Helcim Terminal] Transaction search error:', error);
          // Return pending status on error - transaction may still be processing
          result = {
            success: true,
            status: 'pending',
            message: 'Transaction search failed, may still be processing',
            invoiceNumber: invoiceNumber,
            error: error.message
          };
        }
        break;
      }

      case 'cancelTransaction': {
        const { deviceCode, invoiceNumber } = data || {};
        const code = deviceCode || 'JSV5';

        console.log('[Helcim Terminal] Cancelling transaction:', { deviceCode: code, invoiceNumber });

        const cancelEndpoints = [
          `${HELCIM_BASE_URL_V2}/devices/${code}/payment/cancel`,
          `${HELCIM_BASE_URL_V2}/devices/${code}/cancel`,
          `${HELCIM_BASE_URL_V2}/devices/${code}/clear`,
          `${HELCIM_BASE_URL_V2}/devices/${code}/reset`
        ];

        let cancelled = false;
        let lastError: any = null;

        for (const cancelUrl of cancelEndpoints) {
          try {
            console.log(`[Helcim Terminal] Trying cancel endpoint: ${cancelUrl}`);

            const cancelResponse = await fetch(cancelUrl, {
              method: 'POST',
              headers: {
                'api-token': HELCIM_API_TOKEN,
                'accept': 'application/json',
                'content-type': 'application/json'
              }
            });

            if (cancelResponse.ok) {
              const cancelText = await cancelResponse.text();
              console.log('[Helcim Terminal] Cancel successful:', cancelText.substring(0, 500));
              cancelled = true;
              break;
            }

            const errorText = await cancelResponse.text();
            console.log(`[Helcim Terminal] Cancel endpoint failed (${cancelResponse.status}): ${errorText.substring(0, 500)}`);
            lastError = new Error(`Cancel endpoint returned ${cancelResponse.status}`);
          } catch (cancelError) {
            console.log('[Helcim Terminal] Cancel endpoint error:', cancelError);
            lastError = cancelError;
          }
        }

        if (!cancelled) {
          throw new Error(lastError?.message || 'Unable to cancel payment on terminal');
        }

        result = {
          success: true,
          status: 'cancelled',
          deviceCode: code,
          invoiceNumber: invoiceNumber || null,
          message: 'Payment cancelled on terminal'
        };
        break;
      }

      case 'clearDevice': {
        // Clear/reset the device screen after payment completes
        const { deviceCode } = data;
        const code = deviceCode || 'JSV5'; // Default to your device code
        
        console.log(`[Helcim Terminal] Clearing device: ${code}`);
        
        // Try multiple possible endpoints to clear/cancel the device
        // Helcim API might have different endpoints for canceling/clearing
        const clearEndpoints = [
          `${HELCIM_BASE_URL_V2}/devices/${code}/payment/cancel`,
          `${HELCIM_BASE_URL_V2}/devices/${code}/cancel`,
          `${HELCIM_BASE_URL_V2}/devices/${code}/clear`,
          `${HELCIM_BASE_URL_V2}/devices/${code}/reset`
        ];
        
        let cleared = false;
        let lastError = null;
        
        for (const clearUrl of clearEndpoints) {
          try {
            console.log(`[Helcim Terminal] Trying clear endpoint: ${clearUrl}`);
            const clearResponse = await fetch(clearUrl, {
              method: 'POST',
              headers: {
                'api-token': HELCIM_API_TOKEN,
                'accept': 'application/json',
                'content-type': 'application/json'
              },
              signal: AbortSignal.timeout(4000)
            });
            
            const responseStatus = clearResponse.status;
            const responseText = await clearResponse.text();
            
            console.log(`[Helcim Terminal] Clear device response status: ${responseStatus}`);
            console.log(`[Helcim Terminal] Clear device response:`, responseText.substring(0, 200));
            
            if (clearResponse.ok) {
              cleared = true;
              console.log(`[Helcim Terminal] Device cleared successfully via: ${clearUrl}`);
              break;
            } else if (responseStatus === 404) {
              // Endpoint doesn't exist, try next one
              lastError = `Endpoint not found (404)`;
              continue;
            } else {
              lastError = `Status ${responseStatus}: ${responseText.substring(0, 100)}`;
              continue;
            }
          } catch (error) {
            console.error(`[Helcim Terminal] Error trying clear endpoint ${clearUrl}:`, error);
            lastError = error.message;
            continue;
          }
        }
        
        // Even if clear fails, return success (device might auto-clear or endpoint might not exist)
        result = {
          success: true,
          message: cleared ? 'Device cleared successfully' : 'Device clear attempted (may auto-clear on next payment)',
          cleared: cleared,
          deviceCode: code,
          note: cleared ? null : 'Clear endpoint may not be available. Device will clear on next payment.'
        };
        break;
      }

      case 'refundPayment': {
        // Refund a previous transaction.
        // - Credit refunds can be processed via Payment API (no device required): POST /v2/payment/refund
        // - Debit refunds require customer present via device: POST /v2/devices/{code}/payment/refund
        const {
          refundType = 'credit', // 'credit' | 'debit'
          originalTransactionId,
          transactionId,
          transactionAmount,
          amount,
          currency = 'CAD',
          deviceCode
        } = data || {};

        const originalIdRaw = originalTransactionId || transactionId;
        const refundAmountRaw = transactionAmount ?? amount;

        if (!originalIdRaw || refundAmountRaw === undefined || refundAmountRaw === null) {
          result = {
            success: false,
            error: 'originalTransactionId (or transactionId) and transactionAmount (or amount) are required'
          };
          break;
        }

        const refundAmount = parseFloat(refundAmountRaw);
        if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
          result = {
            success: false,
            error: 'Refund amount must be a number greater than 0'
          };
          break;
        }

        const originalIdNum = Number(String(originalIdRaw).trim());
        if (!Number.isFinite(originalIdNum) || originalIdNum <= 0) {
          result = {
            success: false,
            error: 'originalTransactionId must be a numeric Helcim transaction id (H-ID)'
          };
          break;
        }

        // Helcim requires a 25-character alphanumeric idempotency key.
        // Use hex from UUID to stay alphanumeric.
        const idempotencyKey = (`TRFD${crypto.randomUUID().replace(/-/g, '').slice(0, 21)}`).toUpperCase();

        // Helcim v2 refund endpoints may require `amount` + `ipAddress` (per API validation errors).
        // Determine caller IP from common proxy headers.
        const forwardedFor = req.headers.get('x-forwarded-for') || '';
        const ipAddress =
          forwardedFor.split(',')[0]?.trim() ||
          req.headers.get('cf-connecting-ip') ||
          req.headers.get('x-real-ip') ||
          '0.0.0.0';

        // Refund payload (keep both `transactionAmount` and `amount` for compatibility across endpoints/versions).
        const refundPayload: any = {
          currency,
          transactionAmount: parseFloat(refundAmount.toFixed(2)),
          amount: parseFloat(refundAmount.toFixed(2)),
          originalTransactionId: originalIdNum,
          ipAddress,
        };

        try {
          if (String(refundType).toLowerCase() === 'debit') {
            const code = deviceCode || 'JSV5';
            const url = `${HELCIM_BASE_URL_V2}/devices/${code}/payment/refund`;
            console.log('[Helcim Terminal] Debit refund request:', { url, idempotencyKey, refundPayload });
            const resp = await fetch(url, {
              method: 'POST',
              headers: {
                'api-token': HELCIM_API_TOKEN,
                'idempotency-key': idempotencyKey,
                'accept': 'application/json',
                'content-type': 'application/json',
              },
              body: JSON.stringify(refundPayload),
            });

            const text = await resp.text();
            if (!resp.ok) {
              return new Response(
                JSON.stringify({ success: false, error: `Helcim debit refund failed (${resp.status}): ${text.substring(0, 300)}` }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }

            let json: any = null;
            try { json = text && text.trim() ? JSON.parse(text) : null; } catch { /* ignore */ }
            result = {
              success: true,
              status: 'pending',
              refundType: 'debit',
              idempotencyKey,
              originalTransactionId: String(originalIdNum),
              amount: refundPayload.transactionAmount,
              deviceCode: code,
              response: json || text || null,
              message: 'Debit refund initiated on device. Customer must complete on terminal.'
            };
            break;
          }

          // Default: credit refund via Payment API
          const url = `${HELCIM_BASE_URL_V2}/payment/refund`;
          console.log('[Helcim Terminal] Credit refund request:', { url, idempotencyKey, refundPayload });
          const resp = await fetch(url, {
            method: 'POST',
            headers: {
              'api-token': HELCIM_API_TOKEN,
              'idempotency-key': idempotencyKey,
              'accept': 'application/json',
              'content-type': 'application/json',
            },
            body: JSON.stringify(refundPayload),
          });

          const text = await resp.text();
          if (!resp.ok) {
            return new Response(
              JSON.stringify({ success: false, error: `Helcim credit refund failed (${resp.status}): ${text.substring(0, 300)}` }),
              { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          let json: any = null;
          try { json = text && text.trim() ? JSON.parse(text) : null; } catch { /* ignore */ }
          result = {
            success: true,
            status: 'completed',
            refundType: 'credit',
            idempotencyKey,
            originalTransactionId: String(originalIdNum),
            amount: refundPayload.transactionAmount,
            response: json || text || null,
            message: 'Credit refund processed successfully'
          };
          break;
        } catch (err) {
          console.error('[Helcim Terminal] Refund error:', err);
          result = {
            success: false,
            error: err?.message || 'Refund failed'
          };
          break;
        }
      }

      case 'reversePayment': {
        // Reverse (void) a previous card transaction.
        // Use when a transaction is not yet refundable (e.g., not settled / same-day batch open).
        // Endpoint: POST /v2/payment/reverse
        const {
          originalTransactionId,
          transactionId,
          transactionAmount,
          amount,
          currency = 'CAD',
        } = data || {};

        const originalIdRaw = originalTransactionId || transactionId;
        const reverseAmountRaw = transactionAmount ?? amount;

        if (!originalIdRaw || reverseAmountRaw === undefined || reverseAmountRaw === null) {
          result = {
            success: false,
            error: 'originalTransactionId (or transactionId) and transactionAmount (or amount) are required'
          };
          break;
        }

        const reverseAmount = parseFloat(reverseAmountRaw);
        if (!Number.isFinite(reverseAmount) || reverseAmount <= 0) {
          result = {
            success: false,
            error: 'Reverse amount must be a number greater than 0'
          };
          break;
        }

        const originalIdNum = Number(String(originalIdRaw).trim());
        if (!Number.isFinite(originalIdNum) || originalIdNum <= 0) {
          result = {
            success: false,
            error: 'originalTransactionId must be a numeric Helcim transaction id (H-ID)'
          };
          break;
        }

        const idempotencyKey = (`TRVS${crypto.randomUUID().replace(/-/g, '').slice(0, 21)}`).toUpperCase();

        const forwardedFor = req.headers.get('x-forwarded-for') || '';
        const ipAddress =
          forwardedFor.split(',')[0]?.trim() ||
          req.headers.get('cf-connecting-ip') ||
          req.headers.get('x-real-ip') ||
          '0.0.0.0';

        // Helcim reverse endpoint expects a card transaction id.
        // Use the same numeric Helcim transaction id (H-ID) as `cardTransactionId`.
        // Keep `originalTransactionId` as well for compatibility across versions.
        const reversePayload: any = {
          currency,
          transactionAmount: parseFloat(reverseAmount.toFixed(2)),
          amount: parseFloat(reverseAmount.toFixed(2)),
          cardTransactionId: originalIdNum,
          originalTransactionId: originalIdNum,
          ipAddress,
        };

        try {
          const url = `${HELCIM_BASE_URL_V2}/payment/reverse`;
          console.log('[Helcim Terminal] Reverse request:', { url, idempotencyKey, reversePayload });

          const resp = await fetch(url, {
            method: 'POST',
            headers: {
              'api-token': HELCIM_API_TOKEN,
              'idempotency-key': idempotencyKey,
              'accept': 'application/json',
              'content-type': 'application/json',
            },
            body: JSON.stringify(reversePayload),
          });

          const text = await resp.text();
          if (!resp.ok) {
            return new Response(
              JSON.stringify({ success: false, error: `Helcim reverse failed (${resp.status}): ${text.substring(0, 300)}` }),
              { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          let json: any = null;
          try { json = text && text.trim() ? JSON.parse(text) : null; } catch { /* ignore */ }
          result = {
            success: true,
            status: 'completed',
            idempotencyKey,
            originalTransactionId: String(originalIdNum),
            amount: reversePayload.transactionAmount,
            response: json || text || null,
            message: 'Transaction reversed successfully'
          };
          break;
        } catch (err) {
          console.error('[Helcim Terminal] Reverse error:', err);
          result = {
            success: false,
            error: err?.message || 'Reverse failed'
          };
          break;
        }
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    return new Response(
      JSON.stringify(result),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('[Helcim Terminal] Error:', error);
    console.error('[Helcim Terminal] Error stack:', error.stack);
    console.error('[Helcim Terminal] Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    
    // Return detailed error for debugging
    const errorMessage = error.message || 'Internal server error';
    const errorDetails = {
      success: false,
      error: errorMessage,
      type: error.constructor?.name || typeof error,
      ...(process.env.NODE_ENV === 'development' && {
        stack: error.stack,
        details: error.toString()
      })
    };
    
    return new Response(
      JSON.stringify(errorDetails),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

