import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useBusinessContext } from '../../contexts/BusinessContext';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { usePermissions } from '../../hooks/usePermissions';
import { supabase } from '../../supabaseClient';
import * as GiftCardService from '../../services/GiftCards/GiftCardService';
import { gcStyles as s } from './giftCardStyles';

const SEARCH_DEBOUNCE_MS = 250;

export default function GiftCardsIssueScreen() {
  const { selectedBusinessId } = useBusinessContext();
  const { userId } = usePermissions();
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [cardType, setCardType] = useState('money');
  const [faceValue, setFaceValue] = useState('50');
  const [amountPaid, setAmountPaid] = useState('50');
  const [purchaserMode, setPurchaserMode] = useState('search'); // 'search' | 'custom'
  const [purchaserSearch, setPurchaserSearch] = useState('');
  const [purchaserResults, setPurchaserResults] = useState([]);
  const [purchaserSearching, setPurchaserSearching] = useState(false);
  const [showPurchaserResults, setShowPurchaserResults] = useState(false);
  const [purchaserCustomerId, setPurchaserCustomerId] = useState(null);
  const [purchaserName, setPurchaserName] = useState('');
  const [purchaserEmail, setPurchaserEmail] = useState('');
  const [purchaserPhone, setPurchaserPhone] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [personalMessage, setPersonalMessage] = useState('');
  const [notifyRecipient, setNotifyRecipient] = useState(false);
  const [isCharitable, setIsCharitable] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [inventoryQty, setInventoryQty] = useState('1');
  const [issued, setIssued] = useState(null);
  const [saving, setSaving] = useState(false);
  const searchTimerRef = useRef(null);
  const purchaserBoxRef = useRef(null);

  const loadProducts = useCallback(async () => {
    if (!selectedBusinessId) return;
    const rows = await GiftCardService.listProducts(selectedBusinessId, { activeOnly: true });
    setProducts(rows);
  }, [selectedBusinessId]);

  useEffect(() => {
    loadProducts().catch(() => {});
  }, [loadProducts]);

  useEffect(() => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    setCardType(product.product_type || 'money');
    if (product.face_value != null) {
      setFaceValue(String(product.face_value));
      setAmountPaid(String(product.sale_price ?? product.face_value));
    }
    if (product.inventory_qty) setInventoryQty(String(product.inventory_qty));
  }, [productId, products]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (purchaserBoxRef.current && !purchaserBoxRef.current.contains(e.target)) {
        setShowPurchaserResults(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const searchPurchasers = useCallback(async (term) => {
    if (!selectedBusinessId) return;
    const pat = String(term || '').trim();
    if (pat.length < 1) {
      setPurchaserResults([]);
      return;
    }
    setPurchaserSearching(true);
    try {
      const { data, error } = await supabase
        .from('pos_loyalty_accounts')
        .select('id, customer_name, customer_email, customer_phone')
        .eq('business_id', selectedBusinessId)
        .or(
          `customer_name.ilike.%${pat}%,customer_email.ilike.%${pat}%,customer_phone.ilike.%${pat}%`
        )
        .order('customer_name', { ascending: true })
        .limit(20);
      if (error) throw error;
      setPurchaserResults(data || []);
      setShowPurchaserResults(true);
    } catch (err) {
      console.warn('Purchaser search failed:', err);
      setPurchaserResults([]);
    } finally {
      setPurchaserSearching(false);
    }
  }, [selectedBusinessId]);

  useEffect(() => {
    if (purchaserMode !== 'search') return undefined;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      searchPurchasers(purchaserSearch);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [purchaserSearch, purchaserMode, searchPurchasers]);

  const clearSelectedPurchaser = () => {
    setPurchaserCustomerId(null);
    setPurchaserName('');
    setPurchaserEmail('');
    setPurchaserPhone('');
    setPurchaserSearch('');
    setPurchaserResults([]);
  };

  const selectPurchaserCustomer = (customer) => {
    setPurchaserCustomerId(customer.id);
    setPurchaserName(customer.customer_name || '');
    setPurchaserEmail(customer.customer_email || '');
    setPurchaserPhone(customer.customer_phone || '');
    setPurchaserSearch(customer.customer_name || customer.customer_email || '');
    setPurchaserResults([]);
    setShowPurchaserResults(false);
  };

  const switchPurchaserMode = (mode) => {
    setPurchaserMode(mode);
    clearSelectedPurchaser();
    setShowPurchaserResults(false);
  };

  const handleIssue = async (e) => {
    e.preventDefault();
    if (!selectedBusinessId) return;
    setSaving(true);
    try {
      const card = await GiftCardService.issueGiftCard({
        businessId: selectedBusinessId,
        productId: productId || null,
        cardType,
        faceValue: Number(faceValue),
        amountPaid: Number(amountPaid),
        inventoryQty: Number(inventoryQty) || 1,
        purchaserCustomerId: purchaserMode === 'search' ? purchaserCustomerId : null,
        purchaserName: purchaserName || null,
        purchaserEmail: purchaserEmail || null,
        purchaserPhone: purchaserPhone || null,
        recipientName: recipientName || null,
        recipientEmail: recipientEmail || null,
        personalMessage: personalMessage || null,
        notifyRecipient,
        isCharitable,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        saleSource: 'staff',
        processedByUserId: userId || null,
      });
      setIssued(card);
      toast.success(`Issued ${card.code}`);
    } catch (err) {
      toast.error(err.message || 'Failed to issue gift card');
    } finally {
      setSaving(false);
    }
  };

  const printCard = async () => {
    if (!issued) return;
    try {
      await GiftCardService.openPrintableGiftCard({
        card: issued,
        businessId: selectedBusinessId || issued.business_id,
      });
    } catch (err) {
      toast.error(err.message || 'Allow popups to print');
    }
  };

  return (
    <div style={s.panel}>
      <h3 style={{ marginTop: 0 }}>Sell / Issue gift card</h3>
      <form onSubmit={handleIssue}>
        <div style={s.grid2}>
          <div>
            <label style={s.label}>Product</label>
            <select style={s.select} value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Custom amount</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={s.label}>Type</label>
            <select style={s.select} value={cardType} onChange={(e) => setCardType(e.target.value)}>
              <option value="money">Money</option>
              <option value="item">Item / service voucher</option>
            </select>
          </div>
          <div>
            <label style={s.label}>Face value</label>
            <input style={s.input} type="number" min="0" step="0.01" value={faceValue} onChange={(e) => setFaceValue(e.target.value)} required={cardType === 'money'} />
          </div>
          <div>
            <label style={s.label}>Amount paid</label>
            <input style={s.input} type="number" min="0" step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} />
          </div>
          {cardType === 'item' && (
            <div>
              <label style={s.label}>Quantity on voucher</label>
              <input style={s.input} type="number" min="1" value={inventoryQty} onChange={(e) => setInventoryQty(e.target.value)} />
            </div>
          )}
          <div>
            <label style={s.label}>Expiry (optional — item/charity)</label>
            <input style={s.input} type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>

          <div style={{ gridColumn: '1 / -1' }} ref={purchaserBoxRef}>
            <label style={s.label}>Purchaser (optional)</label>
            <div style={{ ...s.row, marginBottom: 8 }}>
              <select
                style={{ ...s.select, minWidth: 220 }}
                value={purchaserMode}
                onChange={(e) => switchPurchaserMode(e.target.value)}
              >
                <option value="search">Search existing customers</option>
                <option value="custom">Enter custom name</option>
              </select>
              {purchaserCustomerId && (
                <button type="button" style={s.buttonSecondary} onClick={clearSelectedPurchaser}>
                  Clear selected
                </button>
              )}
            </div>

            {purchaserMode === 'search' ? (
              <div style={{ position: 'relative' }}>
                <input
                  style={{ ...s.input, width: '100%', minWidth: 280 }}
                  value={purchaserSearch}
                  onChange={(e) => {
                    setPurchaserSearch(e.target.value);
                    // Typing a new search clears a previously locked-in customer
                    if (purchaserCustomerId) {
                      setPurchaserCustomerId(null);
                      setPurchaserName('');
                      setPurchaserEmail('');
                      setPurchaserPhone('');
                    }
                  }}
                  onFocus={() => {
                    if (purchaserResults.length > 0) setShowPurchaserResults(true);
                  }}
                  placeholder="Search name, email, or phone…"
                  autoComplete="off"
                />
                {purchaserSearching && (
                  <div style={{ ...s.muted, marginTop: 6 }}>Searching…</div>
                )}
                {showPurchaserResults && purchaserResults.length > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      zIndex: 20,
                      left: 0,
                      right: 0,
                      top: '100%',
                      marginTop: 4,
                      background: '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: 8,
                      maxHeight: 240,
                      overflowY: 'auto',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                    }}
                  >
                    {purchaserResults.map((customer) => (
                      <button
                        key={customer.id}
                        type="button"
                        onClick={() => selectPurchaserCustomer(customer)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '10px 12px',
                          border: 'none',
                          borderBottom: '1px solid #f3f4f6',
                          background: '#fff',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{customer.customer_name || 'Unnamed'}</div>
                        <div style={s.muted}>
                          {[customer.customer_email, customer.customer_phone].filter(Boolean).join(' · ') || 'No contact info'}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {showPurchaserResults && !purchaserSearching && purchaserSearch.trim() && purchaserResults.length === 0 && (
                  <div style={{ ...s.muted, marginTop: 6 }}>
                    No customers found. Switch to “Enter custom name” or keep searching.
                  </div>
                )}
                {purchaserCustomerId && (
                  <div style={{ ...s.muted, marginTop: 8 }}>
                    Linked to customer account · {purchaserEmail || 'no email'}{purchaserPhone ? ` · ${purchaserPhone}` : ''}
                  </div>
                )}
              </div>
            ) : (
              <div style={s.grid2}>
                <div>
                  <label style={s.label}>Custom name</label>
                  <input
                    style={s.input}
                    value={purchaserName}
                    onChange={(e) => setPurchaserName(e.target.value)}
                    placeholder="Purchaser name"
                  />
                </div>
                <div>
                  <label style={s.label}>Email (optional)</label>
                  <input
                    style={s.input}
                    type="email"
                    value={purchaserEmail}
                    onChange={(e) => setPurchaserEmail(e.target.value)}
                    placeholder="email@example.com"
                  />
                </div>
              </div>
            )}
          </div>

          {purchaserMode === 'search' && purchaserCustomerId && (
            <div>
              <label style={s.label}>Purchaser email</label>
              <input style={s.input} type="email" value={purchaserEmail} readOnly />
            </div>
          )}

          <div>
            <label style={s.label}>Recipient name (optional)</label>
            <input style={s.input} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
          </div>
          <div>
            <label style={s.label}>Recipient email (optional)</label>
            <input style={s.input} type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={s.label}>Message on card (optional)</label>
            <textarea
              style={{ ...s.input, width: '100%', minHeight: 72, resize: 'vertical' }}
              value={personalMessage}
              onChange={(e) => setPersonalMessage(e.target.value)}
              placeholder="A note from the purchaser to the recipient…"
              maxLength={280}
            />
          </div>
        </div>

        <div style={{ ...s.row, marginTop: 16 }}>
          <TavariCheckbox
            id="notify-recipient"
            checked={notifyRecipient}
            onChange={setNotifyRecipient}
            label="Email recipient now (turn off for surprise gifts)"
          />
          <TavariCheckbox
            id="charitable-card"
            checked={isCharitable}
            onChange={setIsCharitable}
            label="Charitable issue (expiry allowed)"
          />
        </div>

        <div style={{ ...s.row, marginTop: 20 }}>
          <button type="submit" style={s.button} disabled={saving}>
            {saving ? 'Issuing…' : 'Issue gift card'}
          </button>
        </div>
      </form>

      {issued && (
        <div style={{ ...s.panel, marginTop: 20, background: '#ecfdf5' }}>
          <h4 style={{ marginTop: 0 }}>Issued: {issued.code}</h4>
          <p style={s.muted}>{issued.qr_payload}</p>
          <p>Face {`$${Number(issued.face_value).toFixed(2)}`} · Balance {`$${Number(issued.balance_remaining).toFixed(2)}`}</p>
          <div style={s.row}>
            <button type="button" style={s.button} onClick={printCard}>Print</button>
            <button
              type="button"
              style={s.buttonSecondary}
              onClick={() => {
                navigator.clipboard?.writeText(issued.code);
                toast.success('Code copied');
              }}
            >
              Copy code
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
