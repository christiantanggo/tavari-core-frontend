// hooks/useHelcimPayment.js - Updated Helcim Generation 2 Terminal Integration
import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import {
  HELCIM_DUPLICATE_DECLINE_CODE,
  isSuspectedDuplicateDecline
} from '../utils/helcimDeclineHelpers';

/**
 * Attach a decline code to an error so callers can branch on it instead of matching
 * message text at every call site.
 */
const buildHelcimError = (message, declineCode = null) => {
  const err = new Error(message);
  const code = declineCode || (isSuspectedDuplicateDecline(message) ? HELCIM_DUPLICATE_DECLINE_CODE : null);
  if (code) err.declineCode = code;
  return err;
};

/**
 * Hook for Helcim Generation 2 terminal payment processing
 * Handles terminal discovery, payment processing, and connection status
 * Uses Supabase Edge Function for secure API calls
 */
const useHelcimPayment = (businessId) => {
  const [terminalConnected, setTerminalConnected] = useState(false);
  const [availableTerminals, setAvailableTerminals] = useState([]);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestSeqRef = useRef(0);
  const instanceIdRef = useRef(`H${Math.random().toString(36).slice(2, 8)}`);

  /**
   * Make authenticated request to Helcim Edge Function
   */
  const makeHelcimRequest = useCallback(async (action, data = {}) => {
    const requestId = ++requestSeqRef.current;
    const startedAt = Date.now();
    const hookId = instanceIdRef.current;
    console.log(`[Helcim Hook ${hookId}][${requestId}] Making request:`, { action, data });

    try {
      const dataWithBusiness = {
        ...data,
        ...(businessId ? { businessId } : {}),
      };

      const { data: response, error: functionError } = await supabase.functions.invoke(
        'helcim-terminal',
        {
          body: { action, data: dataWithBusiness },
        }
      );

      if (functionError) {
        console.error(`[Helcim Hook ${hookId}][${requestId}] Function error (${action}):`, functionError);
        console.error(`[Helcim Hook ${hookId}][${requestId}] Function error details:`, {
          message: functionError.message,
          status: functionError.status,
          statusCode: functionError.statusCode,
          context: functionError.context,
          error: functionError.error,
          fullError: JSON.stringify(functionError, null, 2)
        });
        
        // Try to extract error message from the error object
        let errorMessage = functionError.message || 
                           functionError.error || 
                           JSON.stringify(functionError) ||
                           'Helcim API request failed';
        
        // Check for 409 Conflict error - check multiple possible locations for status code
        const statusCode = functionError.status || 
                          functionError.statusCode || 
                          functionError.context?.status ||
                          functionError.context?.statusCode ||
                          (functionError.context?.response?.status);
        
        const is409Error = statusCode === 409 || 
                          statusCode === '409' ||
                          errorMessage.includes('409') || 
                          errorMessage.includes('Conflict') || 
                          errorMessage.includes('conflict') ||
                          // Also check for "non-2xx" which indicates an HTTP error (likely 409 based on browser console)
                          (errorMessage.includes('non-2xx') && action === 'processPayment');
        
        if (is409Error) {
          errorMessage = 'Payment terminal connection issue. This may be because:\n\n• You are too far away from the terminal\n• The terminal is not connecting to the network\n• There is a signal/connection issue\n• The terminal is busy with another transaction\n\nPlease move closer to the terminal, wait a moment, and try again.';
        }
        
        throw buildHelcimError(errorMessage);
      }

      // Check if response indicates an error
      if (response && response.error) {
        console.error(`[Helcim Hook ${hookId}][${requestId}] Response contains error (${action}):`, response);
        throw buildHelcimError(response.error || 'Unknown error occurred', response.declineCode);
      }

      if (!response || (response.success === false)) {
        const errorMessage = response?.error || 'Unknown error occurred';
        console.error(`[Helcim Hook ${hookId}][${requestId}] Response error (${action}):`, errorMessage, 'Full response:', response);
        throw buildHelcimError(errorMessage, response?.declineCode);
      }

      const durationMs = Date.now() - startedAt;
      console.log(`[Helcim Hook ${hookId}][${requestId}] Success (${action}, ${durationMs}ms):`, response);
      return response;
    } catch (err) {
      console.error(`[Helcim Hook ${hookId}][${requestId}] Request failed (${action}):`, err);
      // Extract more detailed error message
      let errorMessage = err.message || 'Request failed';
      if (err.error) {
        errorMessage = err.error;
      } else if (typeof err === 'string') {
        errorMessage = err;
      }
      
      // Check for 409 Conflict error - also check for "non-2xx" which indicates HTTP error
      // When we see "non-2xx" for processPayment, it's likely a 409 based on browser console
      const is409Error = errorMessage.includes('409') || 
                        errorMessage.includes('Conflict') || 
                        errorMessage.includes('conflict') ||
                        (errorMessage.includes('non-2xx') && action === 'processPayment');
      
      if (is409Error) {
        errorMessage = 'Payment terminal connection issue. This may be because:\n\n• You are too far away from the terminal\n• The terminal is not connecting to the network\n• There is a signal/connection issue\n• The terminal is busy with another transaction\n\nPlease move closer to the terminal, wait a moment, and try again.';
      } else if (errorMessage.includes('terminal') && (errorMessage.includes('not found') || errorMessage.includes('not connected'))) {
        errorMessage = 'No payment terminal found. This may be because:\n\n• You are too far away from the terminal\n• The terminal is not connecting to the network\n• There is a signal/connection issue\n\nPlease move closer to the terminal or check the connection and try again.';
      }
      
      throw buildHelcimError(errorMessage, err?.declineCode);
    }
  }, [businessId]);

  /**
   * Check terminal status and fetch available terminals
   * Note: For Smart Terminal API, discovery is optional - we can use device codes directly
   */
  const checkTerminalStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      console.log('[Helcim Hook] Checking terminal status...');
      
      // Try to discover terminals, but don't fail if it doesn't work
      // Smart Terminal API doesn't require discovery - we can use device codes directly
      try {
        const response = await makeHelcimRequest('getTerminals');
        
        if (response && response.terminals && response.terminals.length > 0) {
          const terminals = response.terminals;
          console.log('[Helcim Hook] All terminals received:', terminals.map(t => ({
            id: t.id,
            deviceCode: t.deviceCode || t.device_code,
            nickname: t.nickname || t.name,
            status: t.status,
            connected: t.connected
          })));
          
          setAvailableTerminals(terminals);
          
          // Check for online terminals
          const onlineTerminals = terminals.filter(terminal => {
            const status = (terminal.status || '').toLowerCase();
            const isOnline = status === 'online' || 
                            status === 'connected' || 
                            status === 'active' ||
                            terminal.connected === true ||
                            terminal.isConnected === true;
            return isOnline;
          });
          
          const hasConnectedTerminal = onlineTerminals.length > 0;
          setTerminalConnected(hasConnectedTerminal);
          
          if (hasConnectedTerminal) {
            console.log(`[Helcim Hook] Found ${onlineTerminals.length} terminal(s) available for payments`);
            setError(null);
          } else {
            console.log('[Helcim Hook] Terminals found but none are currently online');
            // Don't set error - allow manual device code entry
          }
          
          return hasConnectedTerminal;
        }
      } catch (discoveryError) {
        // Discovery failed - this is OK for Smart Terminal API
        // We can still process payments using device codes directly
        console.log('[Helcim Hook] Terminal discovery not available (this is normal for Smart Terminal API)');
        console.log('[Helcim Hook] You can still process payments using your device code directly');
      }
      
      // If discovery didn't work or returned no terminals, that's OK
      // Smart Terminal API works with device codes directly
      setTerminalConnected(true); // Allow payments even without discovery
      setAvailableTerminals([]);
      setError(null); // Clear error - discovery is optional
      return true; // Return true to allow payments
      
    } catch (err) {
      console.error('[Helcim Hook] Terminal status check failed:', err);
      // Don't block payments - Smart Terminal API doesn't require discovery
      setTerminalConnected(true); // Allow payments with device code
      setAvailableTerminals([]);
      setError(null); // Clear error - we can still use device codes
      return true; // Return true to allow payments
    } finally {
      setIsLoading(false);
    }
  }, [makeHelcimRequest]);

  /**
   * Initialize terminal connection
   */
  const initializeTerminal = useCallback(async () => {
    console.log('Initializing terminal connection...');
    return await checkTerminalStatus();
  }, [checkTerminalStatus]);

  /**
   * Process payment through terminal
   */
  const processPayment = useCallback(async (paymentData) => {
    setIsLoading(true);
    setError(null);

    try {
      const { amount, currency = 'CAD', saleId, description, terminalId: providedTerminalId } = paymentData;

      // Find an available terminal if none specified
      // Allow manual terminals (status unknown) since we can't verify their status via API
      let targetTerminal = providedTerminalId ? 
        availableTerminals.find(t => t.id === providedTerminalId || t.id === String(providedTerminalId)) :
        availableTerminals.find(t => {
          const status = (t.status || '').toLowerCase();
          return status === 'online' || 
                 status === 'connected' || 
                 status === 'active' ||
                 t.connected === true ||
                 t.manual === true; // Allow manual terminals
        });
      
      // If no terminal found, try to use device code from localStorage or allow manual entry
      if (!targetTerminal) {
        // Check if we have a stored device code
        const storedDeviceCode = localStorage.getItem('helcim_device_code') || 'JSV5'; // Default to JSV5
        
        // Create a virtual terminal object for payment processing
        targetTerminal = {
          id: storedDeviceCode,
          deviceCode: storedDeviceCode,
          name: `Terminal ${storedDeviceCode}`,
          nickname: storedDeviceCode,
          status: 'unknown',
          connected: false,
          manual: true
        };
        
        console.log('[Helcim Hook] No terminals found, using device code:', storedDeviceCode);
      }

      // Use deviceCode for Smart Terminal API, fall back to id if deviceCode not available
      const deviceCode = targetTerminal.deviceCode || targetTerminal.id;
      
      console.log('[Helcim Hook] Processing payment:', { 
        amount, 
        deviceCode: deviceCode,
        terminalId: targetTerminal.id,
        currency,
        saleId,
        description
      });

      const response = await makeHelcimRequest('processPayment', {
        amount: typeof amount === 'number' ? amount : parseFloat(amount),
        deviceCode: deviceCode, // Use deviceCode for Smart Terminal API
        terminalId: targetTerminal.id, // Keep for backward compatibility
        currency,
        description: description || `POS Sale ${saleId || 'N/A'}`,
        saleId: saleId || undefined, // Only send if available
        businessId
      });
      
      // Ensure invoiceNumber is in response for polling
      if (response.success && response.status === 'awaiting_card' && !response.invoiceNumber) {
        // Generate invoiceNumber from saleId if available
        if (saleId) {
          response.invoiceNumber = `SALE-${saleId}`;
        }
      }

      if (response.success) {
        console.log('[Helcim Hook] Payment response received:', response);

        // Helcim can return 2xx with a declined transaction attached.
        if (['failed', 'declined', 'cancelled', 'canceled'].includes(String(response.status || '').toLowerCase())) {
          throw buildHelcimError(
            response.message || response.error || 'Payment was declined on the terminal',
            response.declineCode
          );
        }

        // If status is 'awaiting_card', payment is initiated but waiting for customer
        if (response.status === 'awaiting_card') {
          return {
            success: true,
            status: 'awaiting_card',
            message: response.message || 'Please complete the payment on the device by tapping, inserting, or swiping your card.',
            deviceCode: response.deviceCode,
            amount: response.amount,
            invoiceNumber: response.invoiceNumber || (saleId ? `SALE-${saleId}` : null),
            transactionId: null,
            approvalCode: null,
            cardType: null,
            lastFour: null
          };
        }

        // If Helcim doesn't return a transactionId yet, DO NOT assume success.
        // We must confirm via transaction lookup (polling) or webhook.
        if (!response.transactionId) {
          return {
            success: true,
            status: 'awaiting_confirmation',
            message: response.message || 'Payment initiated. Waiting for Helcim to confirm the transaction.',
            deviceCode: response.deviceCode,
            amount: response.amount,
            invoiceNumber: response.invoiceNumber || (saleId ? `SALE-${saleId}` : null),
            transactionId: null,
            approvalCode: null,
            cardType: null,
            lastFour: null,
            transaction: response.transaction || null
          };
        }

        return {
          success: true,
          status: response.status || 'completed',
          message: response.message || 'Payment processed successfully',
          transactionId: response.transactionId,
          approvalCode: response.approvalCode || null,
          cardType: response.cardType || null,
          lastFour: response.lastFour || null,
          transaction: response.transaction,
          deviceCode: response.deviceCode,
          amount: response.amount,
          invoiceNumber: response.invoiceNumber || (saleId ? `SALE-${saleId}` : null)
        };
      } else {
        throw new Error(response.error || 'Payment failed');
      }
    } catch (err) {
      console.error('[Helcim Hook] Payment processing failed:', err);
      setError(err.message);
      return { success: false, error: err.message, declineCode: err.declineCode || null };
    } finally {
      setIsLoading(false);
    }
  }, [makeHelcimRequest, availableTerminals, businessId]);

  /**
   * Get detailed terminal information
   */
  const getTerminalInfo = useCallback(() => {
    return {
      connected: terminalConnected,
      count: availableTerminals.length,
      terminals: availableTerminals,
      config: {
        // Config is now handled server-side via Edge Function
        hasApiToken: true, // Always true since we're using Edge Function
        baseUrl: 'https://api.helcim.com/v2'
      }
    };
  }, [terminalConnected, availableTerminals]);

  // Auto-initialize on mount
  useEffect(() => {
    if (businessId) {
      console.log('[Helcim Hook] Auto-initializing Helcim terminal...');
      checkTerminalStatus();
    }
  }, [checkTerminalStatus, businessId]);

  /**
   * Cancel the active terminal transaction.
   */
  const cancelTransaction = useCallback(async (transactionData = {}) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await makeHelcimRequest('cancelTransaction', {
        deviceCode: transactionData.deviceCode || undefined,
        invoiceNumber: transactionData.invoiceNumber || undefined,
        saleId: transactionData.saleId || undefined,
        paymentInitiatedAt: transactionData.paymentInitiatedAt || undefined
      });

      return {
        success: true,
        status: response.status || 'cancelled',
        message: response.message || 'Payment cancelled on terminal',
        deviceCode: response.deviceCode || transactionData.deviceCode || null,
        invoiceNumber: response.invoiceNumber || transactionData.invoiceNumber || null
      };
    } catch (err) {
      console.error('[Helcim Hook] Cancel transaction failed:', err);
      setError(err.message || 'Unable to cancel payment');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [makeHelcimRequest]);

  /**
   * Check transaction status by invoiceNumber, or by amount and deviceCode
   * Used to poll for transaction completion after payment initiation
   */
  const checkTransactionStatus = useCallback(async (invoiceNumber, amount = null, deviceCode = null, paymentInitiatedAt = null, options = {}) => {
    if (!invoiceNumber && (!amount || !deviceCode)) {
      throw new Error('invoiceNumber is required, or both amount and deviceCode must be provided');
    }

    try {
      console.log('[Helcim Hook] Checking transaction status:', { invoiceNumber, amount, deviceCode, paymentInitiatedAt });
      const response = await makeHelcimRequest('checkTransactionStatus', {
        invoiceNumber: invoiceNumber || undefined,
        amount: amount || undefined,
        deviceCode: deviceCode || undefined,
        paymentInitiatedAt: paymentInitiatedAt || undefined,
        probeDuplicateDecline: options.probeDuplicateDecline ? true : undefined
      });

      if (response.success) {
        return {
          success: true,
          status: response.status,
          transaction: response.transaction,
          transactionId: response.transactionId,
          approvalCode: response.approvalCode,
          cardType: response.cardType,
          lastFour: response.lastFour,
          amount: response.amount,
          message: response.message,
          declineCode: response.declineCode || null,
          declineReason: response.declineReason || null,
          invoiceNumber: response.invoiceNumber || invoiceNumber,
          deviceCode: response.deviceCode || deviceCode
        };
      } else {
        return {
          success: false,
          status: 'pending',
          error: response.error
        };
      }
    } catch (err) {
      console.error('[Helcim Hook] Transaction status check failed:', err);
      // Return pending on error - transaction may still be processing
      return {
        success: true,
        status: 'pending',
        error: err.message
      };
    }
  }, [makeHelcimRequest]);

  /**
   * Clear/reset the device screen after payment completes
   */
  const clearDevice = useCallback(async (deviceCode) => {
    try {
      console.log('[Helcim Hook] Clearing device:', deviceCode);
      const response = await makeHelcimRequest('clearDevice', {
        deviceCode: deviceCode || 'JSV5'
      });
      
      if (response.success) {
        console.log('[Helcim Hook] Device clear result:', response.message);
        return { success: true, message: response.message };
      } else {
        console.log('[Helcim Hook] Device clear may not be supported:', response.message);
        return { success: false, message: response.message || 'Device clear not available' };
      }
    } catch (err) {
      console.log('[Helcim Hook] Device clear failed (non-critical):', err.message);
      // Non-critical - don't throw error
      return { success: false, message: err.message };
    }
  }, [makeHelcimRequest]);

  return {
    // State
    terminalConnected,
    availableTerminals,
    error,
    isLoading,
    isProcessing: isLoading,
    
    // Actions
    initializeTerminal,
    checkTerminalStatus,
    processPayment,
    checkTransactionStatus,
    cancelTransaction,
    clearDevice,
    getTerminalInfo,
    
    // Legacy compatibility
    terminalStatus: terminalConnected ? 'connected' : 'disconnected'
  };
};

export default useHelcimPayment;