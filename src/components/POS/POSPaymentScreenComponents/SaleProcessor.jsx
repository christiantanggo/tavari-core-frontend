// components/POS/POSPaymentScreenComponents/SaleProcessor.jsx
import React from 'react';
import { supabase } from '../../../supabaseClient';
import { logAction } from '../../../helpers/posAudit';

export const useSaleProcessor = (auth, taxCalc, businessSettings) => {
  // Generate receipt number with retry logic to prevent duplicates
  const generateReceiptNumber = async (maxRetries = 5) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const businessShort = auth.selectedBusinessId.slice(-4).toUpperCase();
        const today = new Date();
        const dateStr = today.toISOString().slice(2, 10).replace(/-/g, '');
        
        // Use a random component to reduce collision probability
        const randomComponent = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        const timestamp = Date.now().toString().slice(-4);
        
        // Generate receipt number with unique components
        const receiptNumber = `R${businessShort}${dateStr}${timestamp}${randomComponent}`;
        
        // Check if this receipt number already exists
        const { data: existing, error: checkError } = await supabase
          .from('pos_sales')
          .select('id')
          .eq('business_id', auth.selectedBusinessId)
          .eq('sale_number', receiptNumber)
          .maybeSingle();
        
        if (checkError && checkError.code !== 'PGRST116') {
          console.error('Error checking receipt number:', checkError);
          throw checkError;
        }
        
        // If no existing record found, this number is unique
        if (!existing) {
          console.log(`✅ Generated unique receipt number on attempt ${attempt}:`, receiptNumber);
          return receiptNumber;
        }
        
        // If we found a duplicate, log it and retry
        console.warn(`⚠️ Duplicate receipt number detected on attempt ${attempt}, retrying...`);
        
        // Add exponential backoff delay before retry
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, attempt * 100));
        }
        
      } catch (err) {
        console.error(`Error generating receipt number (attempt ${attempt}):`, err);
        
        if (attempt === maxRetries) {
          throw err;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, attempt * 100));
      }
    }
    
    // If all retries failed, throw error
    throw new Error('Failed to generate unique receipt number after maximum retries');
  };

  const generateQRCode = (receiptNumber) => {
    return `${receiptNumber}-${auth.selectedBusinessId.slice(-8)}`;
  };

  const createReceiptRecord = async (saleId, receiptNumber, qrCode, saleData, payments, tipAmount, changeOwed, displayTotal, taxCalculation, finalTaxAmount, saleSubtotal, discountAmount, loyaltyRedemption) => {
    try {
      console.log('Creating receipt record for sale:', saleId);
      
      const receiptData = {
        business_id: auth.selectedBusinessId,
        sale_id: saleId,
        receipt_number: receiptNumber,
        qr_code: qrCode,
        total: displayTotal,
        items: saleData.items || [],
        receipt_type: 'Standard',
        subtotal: saleSubtotal,
        discount_amount: discountAmount,
        loyalty_redemption: loyaltyRedemption,
        tax_amount: finalTaxAmount,
        tip_amount: tipAmount,
        aggregated_taxes: taxCalculation.aggregatedTaxes,
        aggregated_rebates: taxCalculation.aggregatedRebates,
        payment_methods: payments,
        change_given: changeOwed,
        customer_name: saleData.loyaltyCustomer?.customer_name || null,
        customer_phone: saleData.loyaltyCustomer?.customer_phone || null,
        customer_email: saleData.loyaltyCustomer?.customer_email || null,
        employee_name: auth.authUser?.email || 'Unknown',
        business_name: businessSettings?.name || 'Business',
        cash_rounding_applied: taxCalc.applyCashRounding(displayTotal, 'cash') !== displayTotal
      };

      const { data: receipt, error: receiptError } = await supabase
        .from('pos_receipts')
        .insert(receiptData)
        .select()
        .single();

      if (receiptError) {
        console.error('Receipt creation error:', receiptError);
        throw receiptError;
      }

      console.log('Receipt created successfully:', receipt);
      return receipt;
      
    } catch (err) {
      console.error('Error creating receipt record:', err);
      throw err;
    }
  };

  // Helper function to get today's date in business timezone
  const getTodayInBusinessTimezone = () => {
    const businessTimezone = businessSettings?.timezone || 'America/Toronto';
    const today = new Date();
    
    const todayInBizTz = new Intl.DateTimeFormat('sv-SE', {
      timeZone: businessTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(today);
    
    return todayInBizTz;
  };

  return {
    generateReceiptNumber,
    generateQRCode,
    createReceiptRecord,
    getTodayInBusinessTimezone
  };
};

const SaleProcessor = () => {
  // This is a utility component, no JSX needed
  return null;
};

export default SaleProcessor;