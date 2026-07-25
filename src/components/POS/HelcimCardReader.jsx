// components/POS/HelcimCardReader.jsx - Helcim 2nd Gen Terminal Interface Component
import React, { useState, useEffect, useRef } from 'react';
import { TavariStyles } from '../../utils/TavariStyles';
import { supabase } from '../../supabaseClient';
import useHelcimPayment from '../../hooks/useHelcimPayment';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import HelcimTerminalSetup from './HelcimTerminalSetup';
import {
  HELCIM_DUPLICATE_DECLINE_CODE,
  HELCIM_DUPLICATE_WINDOW_MS,
  formatCountdown,
  isSuspectedDuplicateDecline,
  suggestDuplicateSplit
} from '../../utils/helcimDeclineHelpers';

/**
 * Helcim Card Reader Interface Component
 * Handles card payment processing through Helcim 2nd Gen terminal
 * 
 * @param {Object} props
 * @param {number} props.amount - Payment amount in cents
 * @param {string} props.currency - Currency code (default: CAD)
 * @param {string} props.saleId - POS sale ID for tracking
 * @param {string} props.description - Transaction description
 * @param {Function} props.onPaymentSuccess - Callback for successful payment
 * @param {Function} props.onPaymentError - Callback for payment errors
 * @param {Function} props.onCancel - Callback for cancellation
 * @param {Function} props.onSplitRequest - Callback to split a duplicate-blocked charge in two
 * @param {string} props.businessId - Business ID for transaction tracking
 * @param {boolean} props.isVisible - Whether the component is visible
 * @returns {React.ReactNode} Helcim card reader interface
 */
const HelcimCardReader = ({
  amount,
  currency = 'CAD',
  saleId,
  description,
  onPaymentSuccess,
  onPaymentError,
  onCancel,
  onSplitRequest,
  businessId,
  isVisible = true,
  // When true, automatically starts the terminal payment when the modal opens.
  // Keeps manual button as fallback.
  autoStart = true
}) => {
  const {
    isProcessing,
    terminalConnected,
    availableTerminals = [],
    error,
    initializeTerminal,
    processPayment,
    checkTransactionStatus,
    cancelTransaction,
    checkTerminalStatus
  } = useHelcimPayment(businessId);

  const { validateManagerPin } = usePOSAuth();

  const [connectionStatus, setConnectionStatus] = useState('checking');
  const [paymentStep, setPaymentStep] = useState('ready'); // ready, processing, success, error, timeout, duplicate_blocked
  const [retryCount, setRetryCount] = useState(0);
  const [showTerminalSetup, setShowTerminalSetup] = useState(false);
  const [pollingIntervalId, setPollingIntervalId] = useState(null);
  const [pendingInvoiceNumber, setPendingInvoiceNumber] = useState(null);
  const [pendingPaymentResult, setPendingPaymentResult] = useState(null);
  const [realtimeStatus, setRealtimeStatus] = useState(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [failureMessage, setFailureMessage] = useState(null);

  // Amount actually sent to the terminal. Normally the sale amount, but a manager can
  // nudge it to clear Helcim's duplicate check.
  const [chargeAmountCents, setChargeAmountCents] = useState(() => Math.round(Number(amount) || 0));
  const [duplicateDecline, setDuplicateDecline] = useState(null);
  const [duplicateOverride, setDuplicateOverride] = useState(null);
  const [duplicateNow, setDuplicateNow] = useState(() => Date.now());
  const [showManagerPin, setShowManagerPin] = useState(false);
  const [managerPin, setManagerPin] = useState('');
  const [pinError, setPinError] = useState(null);
  const [pinChecking, setPinChecking] = useState(false);

  const realtimeChannelsRef = useRef([]);
  const pollingIntervalRef = useRef(null);
  const paymentFinalizedRef = useRef(false);
  const cancelledRef = useRef(false);
  const autoStartRef = useRef(false);
  // Kept in a ref so polling callbacks started before React re-renders still see it.
  const duplicateOverrideRef = useRef(null);

  const cleanupRealtimeChannels = () => {
    try {
      (realtimeChannelsRef.current || []).forEach((ch) => {
        try {
          supabase.removeChannel(ch);
        } catch (e) {
          // ignore
        }
      });
    } finally {
      realtimeChannelsRef.current = [];
    }
  };

  const stopPolling = () => {
    const id = pollingIntervalRef.current || pollingIntervalId;
    if (id) {
      clearInterval(id);
    }
    pollingIntervalRef.current = null;
    setPollingIntervalId(null);
  };

  const finalizeSuccess = (paymentDetails, source = 'unknown') => {
    if (cancelledRef.current) {
      console.log('[HelcimCardReader] Ignoring success after cancel:', source);
      return;
    }
    if (paymentFinalizedRef.current) {
      console.log('[HelcimCardReader] Duplicate success ignored:', source);
      return;
    }

    paymentFinalizedRef.current = true;
    stopPolling();
    cleanupRealtimeChannels();
    setPendingInvoiceNumber(null);
    setPendingPaymentResult(null);
    setIsCancelling(false);
    setActionError(null);
    setDuplicateDecline(null);
    setPaymentStep('success');
    onPaymentSuccess?.({
      ...paymentDetails,
      duplicateOverride: duplicateOverrideRef.current || null
    });
  };

  const getSessionDetails = () => ({
    deviceCode: pendingPaymentResult?.deviceCode || localStorage.getItem('helcim_device_code') || 'JSV5',
    invoiceNumber: pendingInvoiceNumber || pendingPaymentResult?.invoiceNumber || (saleId ? `SALE-${saleId}` : null),
    saleId: saleId || null,
    paymentInitiatedAt: pendingPaymentResult?.paymentInitiatedAt || null
  });

  const normalizeTerminalStatus = (status) => String(status || '').trim().toLowerCase();

  /**
   * Helcim's suspected duplicate check is enforced on their servers, so retrying the
   * identical amount cannot succeed until the 5 minute window clears. Keep the cashier
   * in this modal with the options that actually work instead of bubbling a dead-end
   * error up to the payment screen.
   */
  const handleDuplicateDecline = (reason, source = 'unknown') => {
    if (paymentFinalizedRef.current) {
      console.log('[HelcimCardReader] Duplicate-decline notice ignored:', source);
      return;
    }

    console.log('[HelcimCardReader] Helcim blocked the charge as a suspected duplicate:', { reason, source });

    paymentFinalizedRef.current = true;
    stopPolling();
    cleanupRealtimeChannels();
    setPendingInvoiceNumber(null);
    setPendingPaymentResult(null);
    setIsCancelling(false);
    setActionError(null);

    const detectedAt = Date.now();
    setDuplicateDecline({
      reason: reason || null,
      detectedAt,
      clearsAt: detectedAt + HELCIM_DUPLICATE_WINDOW_MS
    });
    setDuplicateNow(detectedAt);
    setPaymentStep('duplicate_blocked');
  };

  const finalizeFailure = (message, source = 'unknown', options = {}) => {
    const isDuplicate =
      options.declineCode === HELCIM_DUPLICATE_DECLINE_CODE ||
      isSuspectedDuplicateDecline(options.declineReason) ||
      isSuspectedDuplicateDecline(message);

    if (isDuplicate) {
      handleDuplicateDecline(options.declineReason || message, source);
      return;
    }

    if (paymentFinalizedRef.current) {
      console.log('[HelcimCardReader] Duplicate failure ignored:', source);
      return;
    }

    paymentFinalizedRef.current = true;
    stopPolling();
    cleanupRealtimeChannels();
    setPendingInvoiceNumber(null);
    setPendingPaymentResult(null);
    setIsCancelling(false);
    setFailureMessage(message || 'Payment failed');
    setPaymentStep('error');
    onPaymentError?.(message || 'Payment failed');
  };

  const finalizeCancellation = (details = {}, source = 'unknown') => {
    if (paymentFinalizedRef.current) {
      console.log('[HelcimCardReader] Duplicate cancellation ignored:', source);
      return;
    }

    paymentFinalizedRef.current = true;
    cancelledRef.current = true;
    stopPolling();
    cleanupRealtimeChannels();
    setPendingInvoiceNumber(null);
    setPendingPaymentResult(null);
    setIsCancelling(false);
    setActionError(null);
    setPaymentStep('ready');
    onCancel?.({
      status: details.status || 'cancelled',
      message: details.message || 'Payment cancelled',
      deviceCode: details.deviceCode || null,
      invoiceNumber: details.invoiceNumber || null,
      source
    });
  };

  const isDebugEnabled = () => {
    try {
      return localStorage.getItem('helcim_debug') === '1';
    } catch (e) {
      return false;
    }
  };

  const sendTestBroadcast = async () => {
    if (!saleId) return;
    const channelNames = [
      `helcim-payment-${saleId}`,
      `helcim-payment-SALE-${saleId}`,
    ];

    for (const channelName of channelNames) {
      try {
        // Create a short-lived channel just to send a broadcast.
        const ch = supabase.channel(channelName);
        await ch.subscribe((status) => {
          console.log(`[HelcimCardReader][Debug] test channel subscribe (${channelName}):`, status);
        });
        await ch.send({
          type: 'broadcast',
          event: 'payment_completed',
          payload: {
            invoiceNumber: `SALE-${saleId}`,
            rawInvoiceNumber: saleId,
            saleId,
            transactionId: 'TEST-TX',
            approvalCode: 'TEST',
            amount: chargeAmountCents / 100,
            deviceCode: localStorage.getItem('helcim_device_code') || 'JSV5',
            cardType: 'TEST',
            lastFour: '0000',
            status: 'completed',
            timestamp: new Date().toISOString(),
          },
        });
        supabase.removeChannel(ch);
      } catch (e) {
        console.warn('[HelcimCardReader][Debug] failed to send test broadcast:', e);
      }
    }
  };

  // Format amount for display
  const formatAmount = (amountInCents) => {
    return (amountInCents / 100).toFixed(2);
  };

  // A new sale amount is a fresh charge, so drop any duplicate state from the last one.
  useEffect(() => {
    setChargeAmountCents(Math.round(Number(amount) || 0));
    setDuplicateDecline(null);
    setDuplicateOverride(null);
    duplicateOverrideRef.current = null;
    setShowManagerPin(false);
    setManagerPin('');
    setPinError(null);
    setFailureMessage(null);
  }, [amount]);

  // Tick the duplicate countdown once per second while it is on screen.
  useEffect(() => {
    if (paymentStep !== 'duplicate_blocked') return undefined;

    setDuplicateNow(Date.now());
    const intervalId = setInterval(() => setDuplicateNow(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, [paymentStep]);

  const duplicateMsRemaining = duplicateDecline
    ? Math.max(0, duplicateDecline.clearsAt - duplicateNow)
    : 0;
  const duplicateWindowClear = duplicateMsRemaining <= 0;

  // Initialize terminal connection when component mounts
  useEffect(() => {
    if (isVisible && businessId) {
      checkConnection();
    }
  }, [isVisible, businessId]);

  // Auto-start payment when the Helcim modal opens (reduce cashier steps)
  useEffect(() => {
    if (!isVisible) return;
    if (!autoStart) return;
    if (!saleId) return;
    if (!amount || Number(amount) <= 0) return;
    if (paymentStep !== 'ready') return;
    if (autoStartRef.current) return;

    autoStartRef.current = true;
    let isCancelled = false;

    (async () => {
      try {
        // Don't wait for terminal discovery/connection checks.
        // We can start immediately using the saved device code flow.
        await handleProcessPayment();
      } catch (e) {
        // Non-fatal: user can retry via button
        console.warn('[HelcimCardReader] Auto-start failed (can retry manually):', e?.message || e);
      }
    })();

    return () => {
      isCancelled = true;
    };
  // Intentionally depend on saleId/amount so each new payment auto-starts once.
  }, [isVisible, autoStart, saleId, amount, paymentStep, isProcessing]);

  // Check terminal connection status
  const checkConnection = async () => {
    setConnectionStatus('checking');
    try {
      const isConnected = await checkTerminalStatus();
      setConnectionStatus(isConnected ? 'connected' : 'disconnected');
    } catch (err) {
      console.error('Terminal connection check failed:', err);
      setConnectionStatus('disconnected');
    }
  };

  // Process the card payment. `overrideCents` lets a manager-authorized retry charge a
  // different amount without waiting for state to flush.
  const handleProcessPayment = async (overrideCents = null) => {
    const cents = Math.round(Number(overrideCents ?? chargeAmountCents) || 0);
    if (!cents || cents <= 0) {
      onPaymentError?.('Invalid payment amount');
      return;
    }

    // Allow payment even if terminal discovery failed - we'll use device code directly
    if (!terminalConnected && availableTerminals.length === 0) {
      // Check if we have a device code stored
      const deviceCode = localStorage.getItem('helcim_device_code') || 'JSV5';
      console.log('[HelcimCardReader] No terminals discovered, using device code:', deviceCode);
      // Continue with payment using device code
    } else if (!terminalConnected) {
      onPaymentError?.('Terminal not connected. Please check connection and try again.');
      return;
    }

    setPaymentStep('processing');
    // Reset guards for a fresh attempt
    cancelledRef.current = false;
    paymentFinalizedRef.current = false;
    setActionError(null);
    setIsCancelling(false);
    setPendingInvoiceNumber(null);
    setPendingPaymentResult(null);
    setDuplicateDecline(null);
    setFailureMessage(null);

    try {
      const paymentData = {
        amount: cents / 100, // Convert cents to dollars
        currency,
        saleId,
        description: description || `POS Sale ${saleId || 'N/A'}`,
        businessId
      };

      const result = await processPayment(paymentData);

      if (result.success) {
        // If payment is awaiting card/confirmation, start polling for transaction completion
        if (result.status === 'awaiting_card' || result.status === 'awaiting_confirmation') {
          console.log('[HelcimCardReader] Payment awaiting confirmation - starting transaction status polling');
          
          // Get invoiceNumber from result, or generate from saleId, or create a temporary one
          let invoiceNumber = result.invoiceNumber;
          
          if (!invoiceNumber && saleId) {
            invoiceNumber = `SALE-${saleId}`;
            console.log('[HelcimCardReader] Generated invoiceNumber from saleId:', invoiceNumber);
          }
          
          if (!invoiceNumber) {
            // Generate a temporary invoiceNumber using timestamp and amount for tracking
            // This won't match Helcim transactions, but at least we can try polling
            const tempInvoiceNumber = `TEMP-${Date.now()}-${cents}`;
            invoiceNumber = tempInvoiceNumber;
            console.warn('[HelcimCardReader] No saleId available - using temporary invoiceNumber:', invoiceNumber);
            console.warn('[HelcimCardReader] Transaction polling may not work without a valid saleId');
          }

          // Check if invoiceNumber is temporary (won't match real transactions)
          const isTemporaryInvoice = invoiceNumber.startsWith('TEMP-');
          
          // Store payment initiation time for precise transaction matching
          const paymentInitiatedAt = new Date().toISOString();
          
          // Store for potential retry (include payment initiation time)
          setPendingInvoiceNumber(invoiceNumber);
          setPendingPaymentResult({
            ...result,
            saleId,
            invoiceNumber,
            paymentInitiatedAt: paymentInitiatedAt
          });

          // Subscribe to webhook broadcast so we can confirm instantly when Helcim posts back.
          // Helcim sometimes sends invoiceNumber back without the "SALE-" prefix, so listen to both.
          cleanupRealtimeChannels();
          try {
            const channelNames = new Set();
            if (invoiceNumber) channelNames.add(`helcim-payment-${invoiceNumber}`);
            if (invoiceNumber && invoiceNumber.startsWith('SALE-')) {
              channelNames.add(`helcim-payment-${invoiceNumber.replace('SALE-', '')}`);
            }

            realtimeChannelsRef.current = Array.from(channelNames).map((channelName) => {
              return supabase
                .channel(channelName)
                .on('broadcast', { event: 'payment_completed' }, ({ payload }) => {
                  // Basic sanity check: match invoice/sale if present
                  const payloadInvoice = payload?.invoiceNumber || payload?.rawInvoiceNumber;
                  const payloadSaleId = payload?.saleId;
                  const invoiceMatches = payloadInvoice === invoiceNumber;
                  const saleMatches = (invoiceNumber && invoiceNumber.startsWith('SALE-'))
                    ? payloadSaleId === invoiceNumber.replace('SALE-', '')
                    : false;

                  if (!invoiceMatches && !saleMatches) return;

                  const normalizedStatus = normalizeTerminalStatus(payload?.status);

                  if (normalizedStatus === 'completed') {
                    console.log('[HelcimCardReader] Webhook confirmed payment:', payload);
                    finalizeSuccess({
                      type: 'helcim_terminal',
                      amount: payload?.amount || cents / 100,
                      transactionId: payload?.transactionId,
                      approvalCode: payload?.approvalCode,
                      cardType: payload?.cardType,
                      lastFour: payload?.lastFour,
                      message: 'Payment completed successfully',
                      deviceCode: payload?.deviceCode || result.deviceCode,
                      status: 'completed'
                    }, 'webhook');
                    return;
                  }

                  if (['cancelled', 'canceled', 'aborted', 'voided'].includes(normalizedStatus)) {
                    console.log('[HelcimCardReader] Webhook reported cancelled payment:', payload);
                    finalizeCancellation({
                      status: 'cancelled',
                      message: payload?.message || 'Payment was cancelled on the terminal',
                      deviceCode: payload?.deviceCode || result.deviceCode,
                      invoiceNumber
                    }, 'webhook');
                    return;
                  }

                  if (['declined', 'failed', 'error'].includes(normalizedStatus)) {
                    console.log('[HelcimCardReader] Webhook reported failed payment:', payload);
                    finalizeFailure(
                      payload?.message || 'Payment was declined on the terminal',
                      'webhook',
                      { declineCode: payload?.declineCode, declineReason: payload?.declineReason || payload?.errors }
                    );
                  }
                })
                .subscribe((status) => {
                  console.log(`[HelcimCardReader] realtime subscribe (${channelName}):`, status);
                  setRealtimeStatus(status);
                });
            });
          } catch (subscribeErr) {
            console.warn('[HelcimCardReader] Realtime subscribe failed (will continue polling):', subscribeErr);
          }
          
          // Even with temporary invoiceNumber, we can search by amount and deviceCode
          // So we'll still poll, but note that it's a temporary invoiceNumber
          if (isTemporaryInvoice) {
            console.warn('[HelcimCardReader] Using temporary invoiceNumber - will search by amount and device code with time window');
          }

          // Start polling for transaction completion
          let pollCount = 0;
          const maxPolls = 60; // Poll for up to 60 times (120 seconds total)
          const pollInterval = 2000; // Poll every 2 seconds

          const startPolling = () => {
            const pollIntervalId = setInterval(async () => {
            pollCount++;
            console.log(`[HelcimCardReader] Polling transaction status (attempt ${pollCount}/${maxPolls})...`);

            try {
              // Pass amount, deviceCode, and payment initiation time for precise matching.
              // Duplicate declines are often not searchable by invoiceNumber, so probe for
              // one every few polls rather than on every request.
              const statusResult = await checkTransactionStatus(
                invoiceNumber,
                cents / 100,
                result.deviceCode,
                paymentInitiatedAt,
                { probeDuplicateDecline: pollCount >= 3 && pollCount % 3 === 0 }
              );

              if (
                statusResult.status === 'completed' ||
                (statusResult.transactionId &&
                  !['cancelled', 'canceled', 'aborted', 'voided', 'declined', 'failed', 'error'].includes(
                    normalizeTerminalStatus(statusResult.status)
                  ))
              ) {
                // Transaction completed!
                clearInterval(pollIntervalId);
                pollingIntervalRef.current = null;
                setPollingIntervalId(null);
                console.log('[HelcimCardReader] Transaction completed!', statusResult);
                finalizeSuccess({
                  type: 'helcim_terminal',
                  amount: statusResult.amount || cents / 100,
                  transactionId: statusResult.transactionId,
                  approvalCode: statusResult.approvalCode,
                  cardType: statusResult.cardType,
                  lastFour: statusResult.lastFour,
                  message: 'Payment completed successfully',
                  deviceCode: result.deviceCode,
                  status: 'completed'
                }, 'polling');
              } else if (['cancelled', 'canceled', 'aborted', 'voided'].includes(normalizeTerminalStatus(statusResult.status))) {
                clearInterval(pollIntervalId);
                pollingIntervalRef.current = null;
                setPollingIntervalId(null);
                console.log('[HelcimCardReader] Transaction cancelled during polling:', statusResult);
                finalizeCancellation({
                  status: 'cancelled',
                  message: statusResult.message || 'Payment was cancelled on the terminal',
                  deviceCode: statusResult.deviceCode || result.deviceCode,
                  invoiceNumber
                }, 'polling');
              } else if (['declined', 'failed', 'error'].includes(normalizeTerminalStatus(statusResult.status))) {
                clearInterval(pollIntervalId);
                pollingIntervalRef.current = null;
                setPollingIntervalId(null);
                console.log('[HelcimCardReader] Transaction failed during polling:', statusResult);
                finalizeFailure(
                  statusResult.message || 'Payment was declined on the terminal',
                  'polling',
                  { declineCode: statusResult.declineCode, declineReason: statusResult.declineReason }
                );
              } else if (pollCount >= maxPolls) {
                // Timeout - stop polling
                clearInterval(pollIntervalId);
                pollingIntervalRef.current = null;
                setPollingIntervalId(null);
                cleanupRealtimeChannels();
                console.warn('[HelcimCardReader] Polling timeout - transaction not found after 120 seconds');
                console.warn('[HelcimCardReader] Payment may still be processing - showing timeout state');
                // Show timeout state instead of error - allow retry
                setPaymentStep('timeout');
                return; // Don't call onPaymentSuccess or onPaymentError
              }
              // If status is still 'pending', continue polling
            } catch (pollError) {
              console.error('[HelcimCardReader] Polling error:', pollError);
              // Continue polling on error - transaction may still be processing
              if (pollCount >= maxPolls) {
                clearInterval(pollIntervalId);
                  pollingIntervalRef.current = null;
                  setPollingIntervalId(null);
                  cleanupRealtimeChannels();
                // Timeout reached - show timeout state
                console.warn('[HelcimCardReader] Polling error timeout - transaction verification failed');
                setPaymentStep('timeout');
                return; // Don't call onPaymentSuccess or onPaymentError
              }
            }
          }, pollInterval);
          
          // Store interval ID for cleanup
          pollingIntervalRef.current = pollIntervalId;
          setPollingIntervalId(pollIntervalId);
          };
          
          // Start polling
          startPolling();

          // Show message to customer - payment step is already 'processing' which shows the right message
          return;
        }
        
        // Payment is completed (must have transactionId)
        if (!result.transactionId) {
          console.error('[HelcimCardReader] Missing transactionId on completed payment result:', result);
          setPaymentStep('timeout');
          return;
        }

        setPaymentStep('success');
        
        // Call success callback with payment details
        finalizeSuccess({
          type: 'helcim_terminal',
          amount: result.amount || cents / 100,
          transactionId: result.transactionId,
          approvalCode: result.approvalCode,
          cardType: result.cardType,
          lastFour: result.lastFour,
          message: result.message,
          deviceCode: result.deviceCode,
          status: result.status
        }, 'immediate');
      } else {
        const failure = new Error(result.error || result.message || 'Payment failed');
        failure.declineCode = result.declineCode || null;
        throw failure;
      }
    } catch (err) {
      console.error('[HelcimCardReader] Payment processing error:', err);

      if (err?.declineCode === HELCIM_DUPLICATE_DECLINE_CODE || isSuspectedDuplicateDecline(err?.message)) {
        paymentFinalizedRef.current = false;
        handleDuplicateDecline(err?.message, 'immediate');
        return;
      }

      setPaymentStep('error');
      
      // Check for 409 Conflict error or connection-related errors
      let errorMessage = err.message || 'Payment processing failed';
      
      // Check if error message contains 409 or conflict
      if (errorMessage.includes('409') || errorMessage.includes('Conflict') || errorMessage.includes('conflict')) {
        errorMessage = 'Payment terminal connection issue. This may be because:\n\n• You are too far away from the terminal\n• The terminal is not connecting to the network\n• There is a signal/connection issue\n• The terminal is busy with another transaction\n\nPlease move closer to the terminal, wait a moment, and try again.';
      } else if (errorMessage.includes('terminal') && (errorMessage.includes('not found') || errorMessage.includes('not connected'))) {
        errorMessage = 'No payment terminal found. This may be because:\n\n• You are too far away from the terminal\n• The terminal is not connecting to the network\n• There is a signal/connection issue\n\nPlease move closer to the terminal or check the connection and try again.';
      }
      
      setFailureMessage(errorMessage);
      onPaymentError?.(errorMessage);
    }
  };

  /**
   * Charging one cent more changes the amount Helcim fingerprints, which is the only
   * lever the POS has over the duplicate check. Manager PIN gated because it charges
   * the customer a different amount than the sale total.
   */
  const handleDuplicateOverride = async () => {
    setPinError(null);

    if (!managerPin.trim()) {
      setPinError('Enter a manager PIN to authorize the adjusted charge');
      return;
    }

    setPinChecking(true);
    try {
      const isValid = await validateManagerPin(managerPin.trim());
      if (!isValid) {
        setPinError('Invalid manager PIN. Please try again.');
        return;
      }

      const nextCents = chargeAmountCents + 1;
      const override = {
        originalCents: Math.round(Number(amount) || 0),
        chargedCents: nextCents,
        authorizedAt: new Date().toISOString()
      };
      duplicateOverrideRef.current = override;
      setDuplicateOverride(override);
      setChargeAmountCents(nextCents);
      setShowManagerPin(false);
      setManagerPin('');
      await handleProcessPayment(nextCents);
    } catch (err) {
      console.error('[HelcimCardReader] Manager PIN validation failed:', err);
      setPinError(err?.message || 'Unable to validate manager PIN');
    } finally {
      setPinChecking(false);
    }
  };

  /**
   * Two uneven charges collect the exact total while sidestepping the duplicate check.
   */
  const handleDuplicateSplit = () => {
    const split = suggestDuplicateSplit(chargeAmountCents);
    if (!split) return;

    paymentFinalizedRef.current = true;
    cancelledRef.current = true;
    stopPolling();
    cleanupRealtimeChannels();
    onSplitRequest?.({ ...split, totalCents: chargeAmountCents });
  };

  // Cancel current transaction
  const handleCancelPayment = async () => {
    // A duplicate-blocked charge is already finalized, so release the guard or the
    // cancellation below would be swallowed as a repeat.
    if (paymentStep === 'duplicate_blocked') {
      paymentFinalizedRef.current = false;
    }

    const sessionDetails = getSessionDetails();
    const hasActiveTerminalSession = paymentStep === 'processing' || paymentStep === 'timeout' || !!pendingPaymentResult || !!pendingInvoiceNumber;

    if (!hasActiveTerminalSession) {
      finalizeCancellation({
        status: 'cancelled',
        message: 'Payment cancelled',
        deviceCode: sessionDetails.deviceCode,
        invoiceNumber: sessionDetails.invoiceNumber
      }, 'cashier');
      return;
    }

    try {
      setIsCancelling(true);
      setActionError(null);
      const cancelResult = await cancelTransaction(sessionDetails);
      finalizeCancellation({
        ...cancelResult,
        deviceCode: cancelResult?.deviceCode || sessionDetails.deviceCode,
        invoiceNumber: cancelResult?.invoiceNumber || sessionDetails.invoiceNumber
      }, 'cashier');
    } catch (err) {
      console.error('[HelcimCardReader] Cancel transaction error:', err);
      setActionError(err?.message || 'Unable to cancel the payment on the terminal');
    } finally {
      setIsCancelling(false);
    }
  };

  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => {
      stopPolling();
      cleanupRealtimeChannels();
    };
  // IMPORTANT: this must run ONLY on unmount.
  // Depending on `pollingIntervalId` causes React to run cleanup whenever the interval changes,
  // which immediately closes the realtime subscriptions (you saw `CLOSED` right after subscribe).
  }, []);

  // Retry connection
  const handleRetryConnection = async () => {
    setRetryCount(prev => prev + 1);
    await checkConnection();
  };

  // Retry payment
  const handleRetryPayment = () => {
    setPaymentStep('ready');
    handleProcessPayment();
  };

  // Retry polling for transaction status
  const handleRetryPolling = async () => {
    if (!pendingInvoiceNumber) {
      console.error('[HelcimCardReader] No invoiceNumber available for retry');
      setPaymentStep('error');
      onPaymentError?.('Unable to retry verification - invoice number not available');
      return;
    }

    // Clear any existing polling interval
    if (pollingIntervalId) {
      clearInterval(pollingIntervalId);
      setPollingIntervalId(null);
    }

    console.log('[HelcimCardReader] Retrying transaction status polling...');
    setPaymentStep('processing');
    setRetryCount(prev => prev + 1);
    setActionError(null);

    // Start polling again
    let pollCount = 0;
    const maxPolls = 60; // Poll for up to 60 times (120 seconds total)
    const pollInterval = 2000; // Poll every 2 seconds

    const pollIntervalId = setInterval(async () => {
      pollCount++;
      console.log(`[HelcimCardReader] Retry polling transaction status (attempt ${pollCount}/${maxPolls})...`);

      try {
        // Pass amount, deviceCode, and payment initiation time for precise matching
        // Use the original payment initiation time (stored when payment was first initiated)
        const paymentInitiatedAt = pendingPaymentResult?.paymentInitiatedAt || new Date(Date.now() - 60 * 1000).toISOString(); // Default to 1 minute ago if not stored
        const statusResult = await checkTransactionStatus(
          pendingInvoiceNumber,
          chargeAmountCents / 100,
          pendingPaymentResult?.deviceCode,
          paymentInitiatedAt,
          { probeDuplicateDecline: pollCount >= 3 && pollCount % 3 === 0 }
        );

        if (
          statusResult.status === 'completed' ||
          (statusResult.transactionId &&
            !['cancelled', 'canceled', 'aborted', 'voided', 'declined', 'failed', 'error'].includes(
              normalizeTerminalStatus(statusResult.status)
            ))
        ) {
          // Transaction completed!
          clearInterval(pollIntervalId);
          setPollingIntervalId(null);
          console.log('[HelcimCardReader] Transaction completed on retry!', statusResult);

          finalizeSuccess({
            type: 'helcim_terminal',
            amount: statusResult.amount || chargeAmountCents / 100,
            transactionId: statusResult.transactionId,
            approvalCode: statusResult.approvalCode,
            cardType: statusResult.cardType,
            lastFour: statusResult.lastFour,
            message: 'Payment completed successfully',
            deviceCode: pendingPaymentResult?.deviceCode,
            status: 'completed'
          }, 'retry-polling');
        } else if (['cancelled', 'canceled', 'aborted', 'voided'].includes(normalizeTerminalStatus(statusResult.status))) {
          clearInterval(pollIntervalId);
          setPollingIntervalId(null);
          console.log('[HelcimCardReader] Transaction cancelled on retry polling:', statusResult);
          finalizeCancellation({
            status: 'cancelled',
            message: statusResult.message || 'Payment was cancelled on the terminal',
            deviceCode: pendingPaymentResult?.deviceCode,
            invoiceNumber: pendingInvoiceNumber
          }, 'retry-polling');
        } else if (['declined', 'failed', 'error'].includes(normalizeTerminalStatus(statusResult.status))) {
          clearInterval(pollIntervalId);
          setPollingIntervalId(null);
          console.log('[HelcimCardReader] Transaction failed on retry polling:', statusResult);
          finalizeFailure(
            statusResult.message || 'Payment was declined on the terminal',
            'retry-polling',
            { declineCode: statusResult.declineCode, declineReason: statusResult.declineReason }
          );
        } else if (pollCount >= maxPolls) {
          // Timeout again - stop polling
          clearInterval(pollIntervalId);
          setPollingIntervalId(null);
          console.warn('[HelcimCardReader] Retry polling timeout - transaction not found after 120 seconds');
          setPaymentStep('timeout');
        }
        // If status is still 'pending', continue polling
      } catch (pollError) {
        console.error('[HelcimCardReader] Retry polling error:', pollError);
        // Continue polling on error - transaction may still be processing
        if (pollCount >= maxPolls) {
          clearInterval(pollIntervalId);
          setPollingIntervalId(null);
          setPaymentStep('timeout');
        }
      }
    }, pollInterval);
    
    // Store interval ID for cleanup
    setPollingIntervalId(pollIntervalId);
  };

  const styles = {
    container: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      maxWidth: '500px',
      margin: '0 auto',
      textAlign: 'center'
    },
    
    header: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.lg
    },
    
    amount: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary,
      marginBottom: TavariStyles.spacing.xl
    },
    
    status: {
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius.md,
      marginBottom: TavariStyles.spacing.lg,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    
    statusConnected: {
      backgroundColor: TavariStyles.colors.successBg,
      color: TavariStyles.colors.successText,
      border: `1px solid ${TavariStyles.colors.success}`
    },
    
    statusDisconnected: {
      backgroundColor: TavariStyles.colors.errorBg,
      color: TavariStyles.colors.errorText,
      border: `1px solid ${TavariStyles.colors.danger}`
    },
    
    statusChecking: {
      backgroundColor: TavariStyles.colors.infoBg,
      color: TavariStyles.colors.infoText,
      border: `1px solid ${TavariStyles.colors.info}`
    },
    
    instructions: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.xl,
      lineHeight: TavariStyles.typography.lineHeight.relaxed
    },
    
    processingIndicator: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.xl
    },
    
    spinner: {
      width: '40px',
      height: '40px',
      border: '4px solid #f3f4f6',
      borderTop: '4px solid #008080',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite'
    },
    
    buttonGroup: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      justifyContent: 'center',
      marginTop: TavariStyles.spacing.xl
    },
    
    primaryButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg
    },
    
    secondaryButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.lg
    },
    
    dangerButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.danger,
      ...TavariStyles.components.button.sizes.lg
    },
    
    successIcon: {
      fontSize: '48px',
      color: TavariStyles.colors.success,
      marginBottom: TavariStyles.spacing.lg
    },
    
    errorIcon: {
      fontSize: '48px',
      color: TavariStyles.colors.danger,
      marginBottom: TavariStyles.spacing.lg
    },
    
    terminalInfo: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray500,
      marginTop: TavariStyles.spacing.lg,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md
    },

    duplicateBox: {
      textAlign: 'left',
      padding: TavariStyles.spacing.md,
      backgroundColor: '#fff3cd',
      border: '1px solid #ffc107',
      borderRadius: TavariStyles.borderRadius.md,
      marginBottom: TavariStyles.spacing.lg,
      fontSize: TavariStyles.typography.fontSize.sm,
      lineHeight: TavariStyles.typography.lineHeight.relaxed,
      color: TavariStyles.colors.gray800
    },

    duplicateCountdown: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.md
    },

    duplicateButtonColumn: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm,
      marginTop: TavariStyles.spacing.lg
    },

    pinRow: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      alignItems: 'center',
      marginTop: TavariStyles.spacing.md
    },

    pinInput: {
      ...TavariStyles.components.form.input,
      flex: 1
    },

    errorText: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.danger,
      marginTop: TavariStyles.spacing.sm
    },

    rawReason: {
      fontSize: '10px',
      color: TavariStyles.colors.gray500,
      marginTop: TavariStyles.spacing.sm,
      textAlign: 'left',
      wordBreak: 'break-word'
    }
  };

  if (!isVisible) {
    return null;
  }

  // Connection Status Display
  const renderConnectionStatus = () => {
    let statusStyle = styles.statusChecking;
    let statusText = 'Checking terminal connection...';
    
    if (connectionStatus === 'connected' && terminalConnected) {
      statusStyle = { ...styles.status, ...styles.statusConnected };
      statusText = '✓ Terminal connected and ready';
    } else if (connectionStatus === 'disconnected' || !terminalConnected) {
      statusStyle = { ...styles.status, ...styles.statusDisconnected };
      statusText = '✗ Terminal not connected';
    }

    return (
      <div style={statusStyle}>
        {statusText}
      </div>
    );
  };

  // Payment Step Content
  const renderPaymentContent = () => {
    switch (paymentStep) {
      case 'processing':
        return (
          <>
            <div style={styles.processingIndicator}>
              <div style={styles.spinner}></div>
              <span>Processing payment...</span>
            </div>
            <p style={styles.instructions}>
              Please follow the prompts on the terminal to complete your payment.
              Insert, tap, or swipe your card when prompted.
              <br />
              <small style={{ fontSize: '11px', color: '#666' }}>
                Waiting for transaction confirmation (up to 120 seconds)...
              </small>
            </p>
            {actionError && (
              <p style={styles.errorText}>{actionError}</p>
            )}
            {isDebugEnabled() && (
              <div style={{ marginTop: '12px', fontSize: '10px', color: '#555', textAlign: 'left' }}>
                <div><strong>Realtime status:</strong> {realtimeStatus || 'unknown'}</div>
                <div><strong>Listening channels:</strong> {saleId ? `helcim-payment-${saleId}` : 'n/a'} and {saleId ? `helcim-payment-SALE-${saleId}` : 'n/a'}</div>
                <button
                  style={{ ...styles.secondaryButton, marginTop: '8px' }}
                  onClick={sendTestBroadcast}
                  disabled={!saleId}
                >
                  Test broadcast (no charge)
                </button>
              </div>
            )}
            <div style={styles.buttonGroup}>
              <button 
                style={styles.dangerButton}
                onClick={handleCancelPayment}
                disabled={isCancelling}
              >
                {isCancelling ? 'Cancelling...' : 'Cancel Payment'}
              </button>
            </div>
          </>
        );
        
      case 'success':
        return (
          <>
            <div style={styles.successIcon}>✓</div>
            <p style={styles.instructions}>
              Payment processed successfully!
            </p>
          </>
        );
        
      case 'timeout':
        return (
          <>
            <div style={styles.errorIcon}>⏱️</div>
            <p style={styles.instructions}>
              Payment verification timed out after 120 seconds.
              <br />
              <small style={{ fontSize: '11px', color: '#666', marginTop: '8px', display: 'block' }}>
                The customer may still be completing the payment on the device.
                <br />
                Please check the device to confirm payment status.
              </small>
            </p>
            <div style={styles.buttonGroup}>
              <button 
                style={styles.primaryButton}
                onClick={handleRetryPolling}
              >
                Retry Verification
              </button>
              <button 
                style={styles.secondaryButton}
                onClick={handleCancelPayment}
              >
                Cancel
              </button>
            </div>
          </>
        );
        
      case 'duplicate_blocked': {
        const split = suggestDuplicateSplit(chargeAmountCents);
        const splitFirst = split ? formatAmount(split.firstCents) : null;
        const splitSecond = split ? formatAmount(split.secondCents) : null;

        return (
          <>
            <div style={styles.errorIcon}>⚠️</div>
            <p style={styles.instructions}>
              Helcim blocked this charge as a suspected duplicate.
            </p>

            <div style={styles.duplicateBox}>
              This card was already charged ${formatAmount(chargeAmountCents)} within the last
              5 minutes. Helcim runs this check on its own servers, so the POS cannot force
              the charge through. Choose one of the options below.
              {duplicateDecline?.reason && (
                <div style={styles.rawReason}>Helcim said: {duplicateDecline.reason}</div>
              )}
            </div>

            <div style={styles.duplicateCountdown}>
              {duplicateWindowClear
                ? 'The 5 minute window has passed — the same amount should go through now.'
                : `Same amount can be retried in ${formatCountdown(duplicateMsRemaining)}`}
            </div>

            <div style={styles.duplicateButtonColumn}>
              <button
                style={
                  duplicateWindowClear
                    ? styles.primaryButton
                    : { ...styles.primaryButton, opacity: 0.55, cursor: 'not-allowed' }
                }
                onClick={() => handleProcessPayment()}
                disabled={!duplicateWindowClear}
              >
                Retry ${formatAmount(chargeAmountCents)}
              </button>

              {split && onSplitRequest && (
                <button style={styles.secondaryButton} onClick={handleDuplicateSplit}>
                  Split into ${splitFirst} + ${splitSecond}
                </button>
              )}

              {!showManagerPin && (
                <button
                  style={styles.secondaryButton}
                  onClick={() => {
                    setPinError(null);
                    setShowManagerPin(true);
                  }}
                >
                  Charge ${formatAmount(chargeAmountCents + 1)} instead (manager)
                </button>
              )}

              <button
                style={styles.dangerButton}
                onClick={handleCancelPayment}
                disabled={isCancelling}
              >
                {isCancelling ? 'Cancelling...' : 'Cancel Payment'}
              </button>
            </div>

            {showManagerPin && (
              <div>
                <div style={styles.pinRow}>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="Manager PIN"
                    value={managerPin}
                    onChange={(e) => setManagerPin(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleDuplicateOverride();
                    }}
                    style={styles.pinInput}
                    disabled={pinChecking}
                  />
                  <button
                    style={styles.primaryButton}
                    onClick={handleDuplicateOverride}
                    disabled={pinChecking}
                  >
                    {pinChecking ? 'Checking...' : 'Authorize'}
                  </button>
                </div>
                <div style={styles.rawReason}>
                  The customer is charged ${formatAmount(chargeAmountCents + 1)} instead of
                  ${formatAmount(chargeAmountCents)}. The extra cent is recorded against the
                  sale so the till still matches the Helcim batch.
                </div>
                {pinError && <p style={styles.errorText}>{pinError}</p>}
              </div>
            )}
          </>
        );
      }

      case 'error':
        return (
          <>
            <div style={styles.errorIcon}>✗</div>
            <p style={styles.instructions}>
              Payment failed: {failureMessage || actionError || error}
            </p>
            <div style={styles.buttonGroup}>
              <button 
                style={styles.primaryButton}
                onClick={handleRetryPayment}
              >
                Retry Payment
              </button>
              <button 
                style={styles.secondaryButton}
                onClick={handleCancelPayment}
              >
                Cancel
              </button>
            </div>
          </>
        );
        
      default: // ready
        return (
          <>
            <p style={styles.instructions}>
              Press "Process Payment" to begin card payment on the terminal.
              Your customer can then insert, tap, or swipe their card.
            </p>
            <div style={styles.buttonGroup}>
              <button 
                style={styles.primaryButton}
                onClick={() => handleProcessPayment()}
                // Allow manual start even if discovery failed (device code flow).
                disabled={((!terminalConnected && availableTerminals.length > 0) || isProcessing)}
              >
                Process Payment
              </button>
              <button 
                style={styles.secondaryButton}
                onClick={handleCancelPayment}
              >
                Cancel
              </button>
            </div>
            {(!terminalConnected || connectionStatus === 'disconnected') && (
              <div style={styles.buttonGroup}>
                <button 
                  style={styles.secondaryButton}
                  onClick={handleRetryConnection}
                >
                  Retry Connection {retryCount > 0 && `(${retryCount})`}
                </button>
              </div>
            )}
          </>
        );
    }
  };

  return (
    <div style={styles.container}>
      {/* Add CSS for spinner animation */}
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
      
      <h2 style={styles.header}>Helcim Card Payment</h2>
      
      <div style={styles.amount}>
        ${formatAmount(chargeAmountCents)} {currency}
        {duplicateOverride && (
          <div style={{ fontSize: '12px', color: TavariStyles.colors.gray500, marginTop: '4px' }}>
            Sale total ${formatAmount(duplicateOverride.originalCents)} · manager override +$0.01
          </div>
        )}
      </div>
      
      {renderConnectionStatus()}
      
      {/* Show device code entry if no terminals found */}
      {availableTerminals.length === 0 && !terminalConnected && (
        <div style={{
          padding: '16px',
          backgroundColor: '#fff3cd',
          border: '1px solid #ffc107',
          borderRadius: '8px',
          marginBottom: '16px',
          marginTop: '16px'
        }}>
          <p style={{ margin: '0 0 8px 0', fontWeight: 'bold' }}>No terminals discovered</p>
          <p style={{ margin: '0 0 12px 0', fontSize: '11px' }}>
            Enter your device code (e.g., JSV5) to process payments:
          </p>
          <input
            type="text"
            placeholder="Enter device code (e.g., JSV5)"
            defaultValue={localStorage.getItem('helcim_device_code') || 'JSV5'}
            onChange={(e) => {
              localStorage.setItem('helcim_device_code', e.target.value.toUpperCase());
            }}
            style={{
              padding: '8px',
              border: '1px solid #ccc',
              borderRadius: '4px',
              width: '100%',
              marginBottom: '8px'
            }}
          />
          <p style={{ margin: '0', fontSize: '10px', color: '#666' }}>
            Device code will be saved and used for payments
          </p>
        </div>
      )}
      
      {renderPaymentContent()}
      
      {/* Terminal Information Display */}
      {availableTerminals && availableTerminals.length > 0 && (
        <div style={styles.terminalInfo}>
          <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>Available Terminals:</div>
          {availableTerminals.map((terminal, index) => (
            <div key={terminal.id || index} style={{ marginBottom: '4px', fontSize: '10px' }}>
              {terminal.nickname || terminal.name || `Terminal ${index + 1}`}
              {terminal.deviceCode && ` (Code: ${terminal.deviceCode})`}
              {terminal.status && ` - ${terminal.status}`}
            </div>
          ))}
        </div>
      )}
      
      <div style={styles.terminalInfo}>
        Transaction: {saleId || 'N/A'}
      </div>

      {/* Terminal Setup Modal */}
      {showTerminalSetup && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            padding: '24px',
            maxWidth: '600px',
            width: '90%',
            maxHeight: '90vh',
            overflow: 'auto',
            position: 'relative'
          }}>
            <button
              onClick={() => setShowTerminalSetup(false)}
              style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                background: 'none',
                border: 'none',
                fontSize: '19px',
                cursor: 'pointer',
                color: TavariStyles.colors.gray600
              }}
            >
              ×
            </button>
            <HelcimTerminalSetup
              businessId={businessId}
              onTerminalRegistered={(terminal) => {
                setShowTerminalSetup(false);
                checkConnection(); // Refresh connection
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default HelcimCardReader;