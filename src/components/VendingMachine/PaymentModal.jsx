// src/components/VendingMachine/PaymentModal.jsx
// Payment modal with QR code

import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import './PaymentModal.css';

const PaymentModal = ({ total, onPayment, onClose, paymentInfo }) => {
  const [selectedPayType, setSelectedPayType] = useState(null);

  useEffect(() => {
    if (paymentInfo?.payUrl) {
      setSelectedPayType('qr');
    }
  }, [paymentInfo]);

  const handlePaymentType = (payType) => {
    setSelectedPayType(payType);
    onPayment(payType);
  };

  if (paymentInfo?.payUrl) {
    return (
      <div className="payment-modal-overlay" onClick={onClose}>
        <div className="payment-modal" onClick={(e) => e.stopPropagation()}>
          <button className="payment-modal-close" onClick={onClose}>×</button>
          
          <div className="payment-modal-content">
            <h2>Scan to Pay</h2>
            <p className="payment-total">Total: ${total.toFixed(2)}</p>
            
            <div className="payment-qr-container">
              <QRCodeSVG value={paymentInfo.payUrl} size={300} />
            </div>
            
            <p className="payment-instructions">
              Scan the QR code with WeChat Pay or Alipay to complete your purchase.
            </p>
            
            <p className="payment-order-info">
              Order: {paymentInfo.orderNo}
            </p>
            
            <div className="payment-status">
              <div className="payment-status-spinner"></div>
              <p>Waiting for payment...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="payment-modal-overlay" onClick={onClose}>
      <div className="payment-modal" onClick={(e) => e.stopPropagation()}>
        <button className="payment-modal-close" onClick={onClose}>×</button>
        
        <div className="payment-modal-content">
          <h2>Select Payment Method</h2>
          <p className="payment-total">Total: ${total.toFixed(2)}</p>
          
          <div className="payment-methods">
            <button
              className={`payment-method-btn ${selectedPayType === 1 ? 'active' : ''}`}
              onClick={() => handlePaymentType(1)}
            >
              <span className="payment-method-icon">💬</span>
              <span>WeChat Pay</span>
            </button>
            
            <button
              className={`payment-method-btn ${selectedPayType === 2 ? 'active' : ''}`}
              onClick={() => handlePaymentType(2)}
            >
              <span className="payment-method-icon">💰</span>
              <span>Alipay</span>
            </button>
            
            <button
              className={`payment-method-btn ${selectedPayType === 5 ? 'active' : ''}`}
              onClick={() => handlePaymentType(5)}
            >
              <span className="payment-method-icon">💳</span>
              <span>Custom Payment</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PaymentModal;

