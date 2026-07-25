// src/services/Bookings/BookingPaymentService.js
import { supabase } from '../../supabaseClient';
import { getFunctionsInvokeErrorMessage } from '../../helpers/functionsInvokeError';

class BookingPaymentService {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Process payment for booking
  async processPayment(bookingId, paymentData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    // Get booking to calculate totals
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select(`
        *,
        booking_activities:activity_id (activity_name),
        booking_addon_items (
          total_price,
          booking_addons:addon_id (addon_name)
        )
      `)
      .eq('id', bookingId)
      .eq('business_id', this.businessId)
      .single();

    if (bookingError) {
      throw bookingError;
    }

    // Calculate total (activity price + addons)
    const addonTotal = booking.booking_addon_items?.reduce((sum, item) => sum + (parseFloat(item.total_price) || 0), 0) || 0;
    const totalAmount = parseFloat(paymentData.amount) || 0;

    // Create payment record
    const paymentRecord = {
      booking_id: bookingId,
      payment_type: paymentData.paymentType || 'full',
      amount_paid: totalAmount,
      deposit_amount: paymentData.paymentType === 'deposit' ? totalAmount : null,
      remaining_balance: paymentData.paymentType === 'deposit' ? (addonTotal - totalAmount) : null,
      payment_method: paymentData.paymentMethod,
      status: 'completed',
      transaction_id: paymentData.transactionId || null
    };

    // If payment is via POS, create pos_sale record
    if (paymentData.createPosSale && paymentData.userId) {
      // Get customer name from loyalty account if available
      let customerName = 'Booking Customer';
      if (booking.customer_id) {
        const { data: loyaltyAccount } = await supabase
          .from('pos_loyalty_accounts')
          .select('customer_name')
          .eq('id', booking.customer_id)
          .single();
        if (loyaltyAccount?.customer_name) {
          customerName = loyaltyAccount.customer_name;
        }
      }
      if (customerName === 'Booking Customer' && booking.customer_email) {
        customerName = booking.customer_email.split('@')[0];
      }

      const saleRecord = {
        business_id: this.businessId,
        user_id: paymentData.userId,
        customer_id: booking.customer_id || null,
        loyalty_customer_id: booking.customer_id || null,
        customer_name: customerName,
        customer_phone: booking.customer_phone || null,
        customer_email: booking.customer_email || null,
        subtotal: addonTotal,
        tax: 0,
        discount: 0,
        total: totalAmount,
        payment_status: 'completed',
        payment_method: paymentData.paymentMethod,
        sale_number: `BK-${booking.booking_number}`,
        notes: `Booking payment: ${booking.booking_number}`,
        item_count: 1,
        created_at: new Date().toISOString()
      };

      const { data: sale, error: saleError } = await supabase
        .from('pos_sales')
        .insert(saleRecord)
        .select()
        .single();

      if (saleError) {
        console.error('Error creating POS sale:', saleError);
        // Continue without POS sale
      } else {
        paymentRecord.sale_id = sale.id;

        // Create pos_payment record
        await supabase
          .from('pos_payments')
          .insert({
            business_id: this.businessId,
            sale_id: sale.id,
            payment_method: paymentData.paymentMethod,
            amount: totalAmount,
            processed_by: paymentData.userId,
            created_at: new Date().toISOString()
          });
      }
    }

    const { data: payment, error: paymentError } = await supabase
      .from('booking_payments')
      .insert(paymentRecord)
      .select()
      .single();

    if (paymentError) {
      console.error('Error creating payment:', paymentError);
      throw paymentError;
    }

    // Update booking payment status
    const newPaymentStatus = paymentData.paymentType === 'deposit' ? 'partial' : 'paid';
    await supabase
      .from('bookings')
      .update({
        payment_status: newPaymentStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', bookingId);

    return payment;
  }

  /**
   * Staff refund for a booking_payments row (partial or full).
   * @param {string} paymentId
   * @param {{ amount: number, reason: string, recordOnly?: boolean }} refundData
   */
  async processRefund(paymentId, refundData) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const amount = Number(refundData?.amount);
    const reason = String(refundData?.reason || '').trim();
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Refund amount must be greater than $0.00');
    }
    if (!reason) {
      throw new Error('Refund reason is required');
    }

    const { data: payment, error: paymentError } = await supabase
      .from('booking_payments')
      .select('*, bookings!inner(id, business_id, booking_number, order_total, payment_status)')
      .eq('id', paymentId)
      .single();

    if (paymentError || !payment || payment.bookings?.business_id !== this.businessId) {
      throw new Error('Payment not found');
    }

    const status = String(payment.status || '').toLowerCase();
    if (status === 'failed' || status === 'pending') {
      throw new Error('Only completed (or partially refunded) payments can be refunded');
    }

    const paid = Number(payment.amount_paid) || 0;
    const alreadyRefunded = Number(payment.refund_amount) || 0;
    const remaining = Math.round((paid - alreadyRefunded) * 100) / 100;
    if (remaining <= 0.005) {
      throw new Error('This payment has already been fully refunded');
    }
    if (amount > remaining + 0.001) {
      throw new Error(`Refund cannot exceed remaining $${remaining.toFixed(2)}`);
    }

    const method = String(payment.payment_method || '').toLowerCase();
    const isHelcim =
      method.includes('helcim') || method === 'credit' || method === 'debit' || method === 'card';
    const transactionId = String(payment.transaction_id || '').trim();
    const recordOnly = refundData.recordOnly === true;
    const isNumericHelcimId = /^\d+$/.test(transactionId);

    if (isHelcim && !recordOnly) {
      if (!transactionId || !isNumericHelcimId) {
        throw new Error(
          'This payment has no Helcim transaction id (H-ID). Use “Already refunded in Helcim (record only)” or refund manually in Helcim first.'
        );
      }

      const refundAmount = Number(amount.toFixed(2));
      const isFullPaymentRefund =
        alreadyRefunded <= 0.005 && Math.abs(refundAmount - paid) < 0.01;

      const deviceCode = (localStorage.getItem('helcim_device_code') || 'JSV5').toUpperCase();
      const { data: helcimResp, error: helcimFnError } = await supabase.functions.invoke(
        'helcim-terminal',
        {
          body: {
            action: 'refundPayment',
            businessId: this.businessId,
            data: {
              refundType: 'credit',
              originalTransactionId: transactionId,
              transactionAmount: refundAmount,
              currency: 'CAD',
              deviceCode,
              businessId: this.businessId,
            },
          },
        }
      );

      if (helcimFnError) {
        throw new Error(
          (await getFunctionsInvokeErrorMessage(helcimFnError, helcimResp)) ||
            helcimFnError.message ||
            'Helcim refund failed'
        );
      }

      if (!helcimResp?.success) {
        const rawError = String(helcimResp?.error || 'Helcim refund failed');
        const needsReverse =
          /cannot be refunded|not refundable|not settled|unsettled|batch|same.?day|must be reversed|void/i.test(
            rawError
          );

        // Same-day / open-batch online (hosted) charges often reject refund until settlement.
        // POS refunds already fall back to reverse/void — match that for booking payments.
        if (needsReverse && isFullPaymentRefund) {
          const { data: reverseResp, error: reverseFnError } = await supabase.functions.invoke(
            'helcim-terminal',
            {
              body: {
                action: 'reversePayment',
                businessId: this.businessId,
                data: {
                  originalTransactionId: transactionId,
                  transactionAmount: refundAmount,
                  currency: 'CAD',
                  businessId: this.businessId,
                },
              },
            }
          );

          if (reverseFnError) {
            throw new Error(
              (await getFunctionsInvokeErrorMessage(reverseFnError, reverseResp)) ||
                reverseFnError.message ||
                rawError
            );
          }
          if (!reverseResp?.success) {
            throw new Error(
              reverseResp?.error ||
                `${rawError} (Helcim reverse/void also failed — try again after the batch settles, or use record-only after refunding in Helcim.)`
            );
          }
        } else if (needsReverse && !isFullPaymentRefund) {
          throw new Error(
            `${rawError} Same-day online payments usually need a full reverse (full amount), not a partial refund. Refund the full $${paid.toFixed(2)}, or wait until the Helcim batch settles.`
          );
        } else {
          throw new Error(rawError);
        }
      }
    }

    const newRefundTotal = Math.round((alreadyRefunded + amount) * 100) / 100;
    const fullyRefunded = newRefundTotal >= paid - 0.005;
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('booking_payments')
      .update({
        status: fullyRefunded ? 'refunded' : status === 'refunded' ? 'refunded' : 'completed',
        refund_amount: newRefundTotal,
        refund_reason: reason,
        refunded_at: now,
        updated_at: now,
      })
      .eq('id', paymentId)
      .select()
      .single();

    if (error) {
      console.error('Error processing booking payment refund:', error);
      throw error;
    }

    await this.reconcileBookingPaymentStatus(payment.booking_id);

    return {
      payment: data,
      refundAmount: amount,
      fullyRefunded,
      remainingAfter: Math.round((paid - newRefundTotal) * 100) / 100,
    };
  }

  /** Recalculate bookings.payment_status from payments (subtracts prior refunds). */
  async reconcileBookingPaymentStatus(bookingId) {
    if (!this.businessId || !bookingId) return null;

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id, order_total, payment_status')
      .eq('id', bookingId)
      .eq('business_id', this.businessId)
      .maybeSingle();

    if (bookingError || !booking) return null;

    const { data: payments } = await supabase
      .from('booking_payments')
      .select('amount_paid, refund_amount, status')
      .eq('booking_id', bookingId);

    const rows = payments || [];
    const totalPaid = rows.reduce((sum, row) => {
      const st = String(row.status || '').toLowerCase();
      if (st === 'refunded' || st === 'failed' || st === 'pending') return sum;
      if (st !== 'completed') return sum;
      const paid = Number(row.amount_paid) || 0;
      const refunded = Number(row.refund_amount) || 0;
      return sum + Math.max(0, paid - refunded);
    }, 0);

    const anyRefundActivity = rows.some((row) => {
      const st = String(row.status || '').toLowerCase();
      return st === 'refunded' || (Number(row.refund_amount) || 0) > 0.005;
    });

    const orderTotal = Number(booking.order_total) || 0;
    const roundedPaid = Math.round(totalPaid * 100) / 100;
    const roundedTotal = Math.round(orderTotal * 100) / 100;
    let paymentStatus = 'unpaid';
    if (roundedPaid > 0.005) {
      paymentStatus =
        roundedTotal <= 0 || roundedPaid >= roundedTotal - 0.005 ? 'paid' : 'partial';
    } else if (anyRefundActivity) {
      paymentStatus = 'refunded';
    }

    if (booking.payment_status === paymentStatus) {
      return { paymentStatus, totalPaid: roundedPaid, changed: false };
    }

    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        payment_status: paymentStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .eq('business_id', this.businessId);

    if (updateError) {
      console.error('Error reconciling booking payment status:', updateError);
      throw updateError;
    }

    return { paymentStatus, totalPaid: roundedPaid, changed: true };
  }

  // Get payment history for booking
  async getPaymentHistory(bookingId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('booking_payments')
      .select('*')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching payment history:', error);
      throw error;
    }

    return data || [];
  }

  async getPaymentRequests(bookingId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase
      .from('booking_payment_requests')
      .select('*')
      .eq('booking_id', bookingId)
      .eq('business_id', this.businessId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching payment requests:', error);
      throw error;
    }

    return data || [];
  }

  async sendPaymentFollowUp({ bookingId, followUpType }) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase.functions.invoke('booking-manage-payment-request', {
      body: {
        businessId: this.businessId,
        bookingId,
        action: 'send_follow_up',
        followUpType,
      },
    });

    if (error || data?.error) {
      throw new Error(data?.error || error?.message || 'Could not send payment follow-up');
    }

    return data;
  }

  async sendPaymentCancelWarning({ bookingId, cancelDeadlineAt }) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase.functions.invoke('booking-manage-payment-request', {
      body: {
        businessId: this.businessId,
        bookingId,
        action: 'send_cancel_warning',
        cancelDeadlineAt,
      },
    });

    if (error || data?.error) {
      throw new Error(data?.error || error?.message || 'Could not send cancel warning');
    }

    return data;
  }

  async sendPaymentRequest({ bookingId, requestType, amount, dueAt, resend = false }) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase.functions.invoke('booking-manage-payment-request', {
      body: {
        businessId: this.businessId,
        bookingId,
        action: 'send',
        requestType,
        amount,
        dueAt,
        resend,
      },
    });

    if (error || data?.error) {
      throw new Error(data?.error || error?.message || 'Could not send payment request');
    }

    return data;
  }

  async cancelPaymentRequest(bookingId, requestId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase.functions.invoke('booking-manage-payment-request', {
      body: {
        businessId: this.businessId,
        bookingId,
        action: 'cancel',
        requestId,
      },
    });

    if (error || data?.error) {
      throw new Error(data?.error || error?.message || 'Could not cancel payment request');
    }

    return data;
  }

  async syncPendingHelcimPayments(bookingId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase.functions.invoke('booking-manage-payment-request', {
      body: {
        businessId: this.businessId,
        bookingId,
        action: 'sync_payments',
      },
    });

    if (error || data?.error) {
      throw new Error(data?.error || error?.message || 'Could not sync payment status');
    }

    return data;
  }

  async recordManualPayment({ bookingId, amount, transactionId, requestId }) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase.functions.invoke('booking-manage-payment-request', {
      body: {
        businessId: this.businessId,
        bookingId,
        action: 'record_manual_payment',
        amount,
        transactionId,
        requestId,
      },
    });

    if (error || data?.error) {
      throw new Error(data?.error || error?.message || 'Could not record payment');
    }

    return data;
  }

  async lookupStoredCard(bookingId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase.functions.invoke('booking-charge-card-on-file', {
      body: {
        businessId: this.businessId,
        bookingId,
        action: 'lookup',
      },
    });

    if (error || data?.error) {
      throw new Error(await getFunctionsInvokeErrorMessage(error, data) || 'Could not look up saved card');
    }

    return data;
  }

  async chargeCardOnFile({ bookingId, amount }) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data, error } = await supabase.functions.invoke('booking-charge-card-on-file', {
      body: {
        businessId: this.businessId,
        bookingId,
        action: 'charge',
        amount,
      },
    });

    if (error || data?.error) {
      throw new Error(await getFunctionsInvokeErrorMessage(error, data) || 'Could not charge card on file');
    }

    return data;
  }

  async linkHelcimCustomerCode({ customerId, customerCode }) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }
    if (!customerId) {
      throw new Error('Customer account is required');
    }

    const normalized = String(customerCode || '').trim();
    if (!normalized) {
      throw new Error('Enter a Helcim customer code');
    }

    const { data, error } = await supabase.functions.invoke('save-helcim-customer-code', {
      body: {
        businessId: this.businessId,
        customerId,
        customerCode: normalized,
      },
    });

    if (error || data?.error) {
      throw new Error(await getFunctionsInvokeErrorMessage(error, data) || 'Could not link Helcim customer');
    }

    if (!data?.ok) {
      throw new Error('Could not link Helcim customer');
    }

    return data;
  }
}

export default new BookingPaymentService();












