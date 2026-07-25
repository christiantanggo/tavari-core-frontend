// components/CustomVoiceAgent/CustomPhoneNumberBrowser.jsx
// Browse and purchase phone numbers from Telnyx for custom voice agents
import React, { useState } from 'react';
import { Phone, Search, Check, Loader, X } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const CustomPhoneNumberBrowser = ({ isOpen, onClose, onSelect, businessId, showPurchaseOption = true }) => {
  const [searching, setSearching] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [availableNumbers, setAvailableNumbers] = useState([]);
  const [searchCriteria, setSearchCriteria] = useState({
    areaCode: '',
    state: '',
    countryCode: 'US',
  });
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [useOwnNumber, setUseOwnNumber] = useState(false);
  const [ownPhoneNumber, setOwnPhoneNumber] = useState('');
  const [ringCount, setRingCount] = useState(3);

  if (!isOpen) return null;

  const handleSearch = async () => {
    if (!searchCriteria.areaCode && !searchCriteria.state) {
      toast.error('Please enter an area code or select a state');
      return;
    }

    setSearching(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      // Use custom voice agent edge function
      const response = await fetch(`${SUPABASE_URL}/functions/v1/custom-voice-agent-search-numbers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          areaCode: searchCriteria.areaCode || undefined,
          state: searchCriteria.state || undefined,
          countryCode: searchCriteria.countryCode,
          limit: 5,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to search phone numbers');
      }

      setAvailableNumbers(data.numbers || []);
      if (data.numbers && data.numbers.length === 0) {
        toast.info('No numbers found. Try a different area code or state.');
      }
    } catch (error) {
      console.error('Error searching numbers:', error);
      toast.error('Failed to search phone numbers: ' + error.message);
    } finally {
      setSearching(false);
    }
  };

  const handlePurchase = async (phoneNumber) => {
    if (!showPurchaseOption) {
      if (onSelect) {
        onSelect(phoneNumber);
      }
      onClose();
      return;
    }

    if (!window.confirm(`Purchase ${phoneNumber}? This will charge your account.`)) {
      return;
    }

    setPurchasing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(`${SUPABASE_URL}/functions/v1/custom-voice-agent-purchase-number`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          phoneNumber,
          businessId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to purchase phone number');
      }

      toast.success('Phone number purchased successfully!');
      if (onSelect) {
        onSelect({ phone_number: phoneNumber, ...data });
      }
      onClose();
    } catch (error) {
      console.error('Error purchasing number:', error);
      toast.error('Failed to purchase phone number: ' + error.message);
    } finally {
      setPurchasing(false);
    }
  };

  const handleUseOwnNumber = () => {
    if (!ownPhoneNumber.trim()) {
      toast.error('Please enter a phone number');
      return;
    }

    if (onSelect) {
      onSelect({
        phone_number: ownPhoneNumber.trim(),
        is_forwarding: true,
        forward_to_phone: ownPhoneNumber.trim(),
        ring_count: ringCount,
      });
    }
    onClose();
  };

  const styles = {
    overlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: TavariStyles.spacing.lg,
    },
    modal: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      width: '100%',
      maxWidth: '600px',
      maxHeight: '90vh',
      overflowY: 'auto',
      boxShadow: TavariStyles.shadows?.xl || '0 20px 25px -5px rgba(0,0,0,0.1)',
    },
    header: {
      padding: TavariStyles.spacing.xl,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    content: {
      padding: TavariStyles.spacing.xl,
    },
    formGroup: {
      marginBottom: TavariStyles.spacing.md,
    },
    label: {
      display: 'block',
      marginBottom: TavariStyles.spacing.xs,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
    },
    input: {
      width: '100%',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
    },
    button: {
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
    },
    numberCard: {
      padding: TavariStyles.spacing.md,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      marginBottom: TavariStyles.spacing.sm,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
  };

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={{ fontSize: TavariStyles.typography.fontSize.xl, fontWeight: 'bold' }}>
            Select Phone Number
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={24} />
          </button>
        </div>

        <div style={styles.content}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Area Code</label>
            <input
              type="text"
              value={searchCriteria.areaCode}
              onChange={(e) => setSearchCriteria({ ...searchCriteria, areaCode: e.target.value })}
              style={styles.input}
              placeholder="e.g., 415"
            />
          </div>

          <button
            onClick={handleSearch}
            disabled={searching}
            style={{
              ...styles.button,
              backgroundColor: TavariStyles.colors.primary || '#008080',
              color: TavariStyles.colors.white,
              marginBottom: TavariStyles.spacing.lg,
            }}
          >
            {searching ? <Loader size={16} className="animate-spin" /> : <Search size={16} />}
            {searching ? 'Searching...' : 'Search Numbers'}
          </button>

          {availableNumbers.length > 0 && (
            <div style={{ marginBottom: TavariStyles.spacing.xl }}>
              <h3 style={{ fontSize: TavariStyles.typography.fontSize.lg, marginBottom: TavariStyles.spacing.md }}>
                Available Numbers
              </h3>
              {availableNumbers.map((number, idx) => (
                <div key={idx} style={styles.numberCard}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: TavariStyles.spacing.sm }}>
                    <Phone size={16} />
                    <span style={{ fontWeight: '600' }}>{number.phone_number || number}</span>
                  </div>
                  <button
                    onClick={() => handlePurchase(number.phone_number || number)}
                    disabled={purchasing}
                    style={{
                      ...styles.button,
                      backgroundColor: TavariStyles.colors.primary || '#008080',
                      color: TavariStyles.colors.white,
                    }}
                  >
                    {purchasing ? <Loader size={16} className="animate-spin" /> : <Check size={16} />}
                    {showPurchaseOption ? 'Purchase' : 'Select'}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ borderTop: `1px solid ${TavariStyles.colors.gray200}`, paddingTop: TavariStyles.spacing.lg }}>
            <h3 style={{ fontSize: TavariStyles.typography.fontSize.lg, marginBottom: TavariStyles.spacing.md }}>
              Use Your Own Number
            </h3>
            <div style={styles.formGroup}>
              <label style={styles.label}>Phone Number</label>
              <input
                type="tel"
                value={ownPhoneNumber}
                onChange={(e) => setOwnPhoneNumber(e.target.value)}
                style={styles.input}
                placeholder="+1234567890"
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Ring Count Before AI Answers</label>
              <input
                type="number"
                min="1"
                max="10"
                value={ringCount}
                onChange={(e) => setRingCount(parseInt(e.target.value) || 3)}
                style={styles.input}
              />
            </div>
            <button
              onClick={handleUseOwnNumber}
              style={{
                ...styles.button,
                backgroundColor: TavariStyles.colors.primary || '#008080',
                color: TavariStyles.colors.white,
              }}
            >
              <Check size={16} />
              Use This Number
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomPhoneNumberBrowser;

