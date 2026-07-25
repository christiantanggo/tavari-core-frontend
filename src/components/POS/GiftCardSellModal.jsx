import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import TavariCheckbox from '../UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Collect gift card issue details before adding a denomination to the POS cart.
 */
export default function GiftCardSellModal({
  product,
  giftCardProduct,
  businessId,
  onConfirm,
  onClose,
}) {
  const [purchaserMode, setPurchaserMode] = useState('search');
  const [purchaserSearch, setPurchaserSearch] = useState('');
  const [purchaserResults, setPurchaserResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [purchaserCustomerId, setPurchaserCustomerId] = useState(null);
  const [purchaserName, setPurchaserName] = useState('');
  const [purchaserEmail, setPurchaserEmail] = useState('');
  const [purchaserPhone, setPurchaserPhone] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [personalMessage, setPersonalMessage] = useState('');
  const [notifyRecipient, setNotifyRecipient] = useState(false);
  const [customAmount, setCustomAmount] = useState(
    String(giftCardProduct?.sale_price ?? giftCardProduct?.face_value ?? product?.price ?? '')
  );
  const boxRef = useRef(null);
  const timerRef = useRef(null);

  const faceValue = Number(giftCardProduct?.face_value ?? product?.price ?? 0);
  const isCustomAmount = !giftCardProduct?.face_value && giftCardProduct?.product_type === 'money';
  const salePrice = isCustomAmount
    ? Number(customAmount) || 0
    : Number(giftCardProduct?.sale_price ?? giftCardProduct?.face_value ?? product?.price ?? 0);

  useEffect(() => {
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setShowResults(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const searchCustomers = useCallback(async (term) => {
    if (!businessId) return;
    const pat = String(term || '').trim();
    if (!pat) {
      setPurchaserResults([]);
      return;
    }
    const { data } = await supabase
      .from('pos_loyalty_accounts')
      .select('id, customer_name, customer_email, customer_phone')
      .eq('business_id', businessId)
      .or(`customer_name.ilike.%${pat}%,customer_email.ilike.%${pat}%,customer_phone.ilike.%${pat}%`)
      .order('customer_name')
      .limit(20);
    setPurchaserResults(data || []);
    setShowResults(true);
  }, [businessId]);

  useEffect(() => {
    if (purchaserMode !== 'search') return undefined;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => searchCustomers(purchaserSearch), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timerRef.current);
  }, [purchaserSearch, purchaserMode, searchCustomers]);

  const selectCustomer = (c) => {
    setPurchaserCustomerId(c.id);
    setPurchaserName(c.customer_name || '');
    setPurchaserEmail(c.customer_email || '');
    setPurchaserPhone(c.customer_phone || '');
    setPurchaserSearch(c.customer_name || c.customer_email || '');
    setShowResults(false);
  };

  const handleConfirm = () => {
    const face = isCustomAmount ? salePrice : faceValue;
    if (!(face > 0)) return;
    onConfirm({
      price: salePrice,
      faceValue: face,
      gift_card: {
        gift_card_product_id: giftCardProduct?.id || null,
        card_type: giftCardProduct?.product_type || 'money',
        face_value: face,
        amount_paid: salePrice,
        inventory_item_id: giftCardProduct?.inventory_item_id || null,
        inventory_qty: giftCardProduct?.inventory_qty || 1,
        purchaser_customer_id: purchaserMode === 'search' ? purchaserCustomerId : null,
        purchaser_name: purchaserName || null,
        purchaser_email: purchaserEmail || null,
        purchaser_phone: purchaserPhone || null,
        recipient_name: recipientName || null,
        recipient_email: recipientEmail || null,
        personal_message: personalMessage.trim() || null,
        notify_recipient: Boolean(notifyRecipient && recipientEmail),
      },
    });
  };

  return (
    <div style={styles.overlay} onClick={onClose} role="presentation">
      <div style={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div style={styles.header}>
          <h3 style={styles.title}>Sell gift card</h3>
          <button type="button" style={styles.close} onClick={onClose} aria-label="Close">×</button>
        </div>
        <p style={styles.sub}>{product?.name || 'Gift Card'}</p>

        {isCustomAmount && (
          <div style={styles.field}>
            <label style={styles.label}>Amount</label>
            <input
              style={styles.input}
              type="number"
              min="1"
              step="0.01"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
            />
          </div>
        )}

        {!isCustomAmount && (
          <div style={styles.amountBox}>
            Face value <strong>${faceValue.toFixed(2)}</strong>
            {salePrice !== faceValue && <> · Sale price <strong>${salePrice.toFixed(2)}</strong></>}
          </div>
        )}

        <div style={styles.field} ref={boxRef}>
          <label style={styles.label}>Purchaser</label>
          <select
            style={styles.select}
            value={purchaserMode}
            onChange={(e) => {
              setPurchaserMode(e.target.value);
              setPurchaserCustomerId(null);
              setPurchaserName('');
              setPurchaserEmail('');
              setPurchaserPhone('');
              setPurchaserSearch('');
            }}
          >
            <option value="search">Search existing customers</option>
            <option value="custom">Enter custom name</option>
          </select>

          {purchaserMode === 'search' ? (
            <div style={{ position: 'relative', marginTop: 8 }}>
              <input
                style={styles.input}
                value={purchaserSearch}
                onChange={(e) => {
                  setPurchaserSearch(e.target.value);
                  if (purchaserCustomerId) {
                    setPurchaserCustomerId(null);
                    setPurchaserName('');
                    setPurchaserEmail('');
                    setPurchaserPhone('');
                  }
                }}
                placeholder="Search name, email, or phone…"
                autoComplete="off"
              />
              {showResults && purchaserResults.length > 0 && (
                <div style={styles.dropdown}>
                  {purchaserResults.map((c) => (
                    <button key={c.id} type="button" style={styles.dropdownItem} onClick={() => selectCustomer(c)}>
                      <div style={{ fontWeight: 600 }}>{c.customer_name || 'Unnamed'}</div>
                      <div style={styles.muted}>{[c.customer_email, c.customer_phone].filter(Boolean).join(' · ')}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              <input
                style={styles.input}
                value={purchaserName}
                onChange={(e) => setPurchaserName(e.target.value)}
                placeholder="Purchaser name"
              />
              <input
                style={styles.input}
                type="email"
                value={purchaserEmail}
                onChange={(e) => setPurchaserEmail(e.target.value)}
                placeholder="Purchaser email (optional)"
              />
            </div>
          )}
        </div>

        <div style={styles.grid2}>
          <div style={styles.field}>
            <label style={styles.label}>Recipient name (optional)</label>
            <input style={styles.input} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Recipient email (optional)</label>
            <input style={styles.input} type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} />
          </div>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Message on card (optional)</label>
          <textarea
            style={{ ...styles.input, minHeight: 72, resize: 'vertical' }}
            value={personalMessage}
            onChange={(e) => setPersonalMessage(e.target.value)}
            placeholder="A note from the purchaser to the recipient…"
            maxLength={280}
          />
        </div>

        <TavariCheckbox
          id="gc-notify-recipient"
          checked={notifyRecipient}
          onChange={setNotifyRecipient}
          label="Email gift card to recipient after payment (turn off for surprise gifts)"
        />

        <div style={styles.actions}>
          <button type="button" style={styles.secondary} onClick={onClose}>Cancel</button>
          <button
            type="button"
            style={styles.primary}
            onClick={handleConfirm}
            disabled={!(salePrice > 0)}
          >
            Add to cart · ${salePrice.toFixed(2)}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10050,
    padding: 16,
  },
  modal: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90vh',
    overflowY: 'auto',
    background: '#fff',
    borderRadius: 12,
    padding: 20,
    fontFamily: TavariStyles.typography.fontFamily,
    boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { margin: 0, fontSize: 20, color: '#0f172a' },
  close: { border: 'none', background: 'transparent', fontSize: 28, cursor: 'pointer', lineHeight: 1, color: '#64748b' },
  sub: { margin: '4px 0 16px', color: '#64748b', fontSize: 14 },
  field: { marginBottom: 12 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 },
  input: {
    width: '100%',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 14,
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  select: {
    width: '100%',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 14,
    fontFamily: 'inherit',
    background: '#fff',
  },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  amountBox: {
    background: '#ecfdf5',
    border: '1px solid #a7f3d0',
    borderRadius: 8,
    padding: '10px 12px',
    marginBottom: 12,
    color: '#065f46',
  },
  dropdown: {
    position: 'absolute',
    zIndex: 30,
    left: 0,
    right: 0,
    top: '100%',
    marginTop: 4,
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    maxHeight: 200,
    overflowY: 'auto',
    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
  },
  dropdownItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '10px 12px',
    border: 'none',
    borderBottom: '1px solid #f3f4f6',
    background: '#fff',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  muted: { fontSize: 13, color: '#6b7280' },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 },
  primary: {
    background: '#0f766e',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '10px 16px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  secondary: {
    background: '#fff',
    color: '#0f766e',
    border: '1px solid #0f766e',
    borderRadius: 8,
    padding: '10px 16px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
