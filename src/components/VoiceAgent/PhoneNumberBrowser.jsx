// components/VoiceAgent/PhoneNumberBrowser.jsx
// Browse and purchase phone numbers from Tavari (Telnyx)
import React, { useState } from 'react';
import { Phone, Search, Check, Loader, X, ArrowLeft } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const PhoneNumberBrowser = ({ isOpen, onClose, onSelect, businessId, showPurchaseOption = true }) => {
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

      const response = await fetch(`${SUPABASE_URL}/functions/v1/voice-agent-search-numbers`, {
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
      // Just select without purchasing
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

      const response = await fetch(`${SUPABASE_URL}/functions/v1/voice-agent-purchase-number`, {
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
        onSelect(data.phone_number);
      }
      onClose();
    } catch (error) {
      console.error('Error purchasing number:', error);
      toast.error('Failed to purchase phone number: ' + error.message);
    } finally {
      setPurchasing(false);
    }
  };

  const handleUseOwnNumber = async () => {
    if (!ownPhoneNumber.trim()) {
      toast.error('Please enter your phone number');
      return;
    }

    // Format phone number
    let formattedNumber = ownPhoneNumber.trim().replace(/\D/g, '');
    if (!formattedNumber.startsWith('+')) {
      formattedNumber = `+1${formattedNumber}`;
    } else if (!formattedNumber.startsWith('+1')) {
      formattedNumber = `+1${formattedNumber.replace('+', '')}`;
    }

    if (onSelect) {
      onSelect({
        phone_number: formattedNumber,
        is_forwarding: true,
        ring_count: ringCount,
        forward_to_phone: formattedNumber,
        forward_enabled: true,
      });
    }
    onClose();
  };

  const formatPhoneNumber = (number) => {
    // Format E.164 to readable format
    const cleaned = number.replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      const areaCode = cleaned.slice(1, 4);
      const exchange = cleaned.slice(4, 7);
      const line = cleaned.slice(7);
      return `(${areaCode}) ${exchange}-${line}`;
    }
    return number;
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
    },
    modal: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      width: '90%',
      maxWidth: '600px',
      maxHeight: '90vh',
      overflow: 'auto',
      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
    },
    header: {
      padding: TavariStyles.spacing.xl,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
    },
    closeButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: TavariStyles.colors.gray600,
      padding: '4px',
    },
    content: {
      padding: TavariStyles.spacing.xl,
    },
    searchSection: {
      marginBottom: TavariStyles.spacing.xl,
    },
    searchRow: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.md,
    },
    input: {
      flex: 1,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
    },
    select: {
      flex: 1,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.base,
    },
    searchButton: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      backgroundColor: TavariStyles.colors.primary || '#008080',
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
    },
    numbersGrid: {
      display: 'grid',
      gap: TavariStyles.spacing.md,
    },
    numberCard: {
      padding: TavariStyles.spacing.lg,
      border: `2px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      cursor: 'pointer',
      transition: 'all 0.2s',
    },
    numberCardSelected: {
      borderColor: TavariStyles.colors.primary || '#008080',
      backgroundColor: TavariStyles.colors.primary + '10' || '#f0f9f9',
    },
    numberDisplay: {
      fontSize: '24px',
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: '4px',
    },
    numberInfo: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
    },
    purchaseButton: {
      marginTop: TavariStyles.spacing.md,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      backgroundColor: TavariStyles.colors.primary || '#008080',
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      cursor: 'pointer',
      width: '100%',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
    },
    divider: {
      margin: `${TavariStyles.spacing.xl} 0`,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      textAlign: 'center',
      position: 'relative',
    },
    dividerText: {
      position: 'absolute',
      top: '-10px',
      left: '50%',
      transform: 'translateX(-50%)',
      backgroundColor: TavariStyles.colors.white,
      padding: `0 ${TavariStyles.spacing.md}`,
      color: TavariStyles.colors.gray600,
      fontSize: TavariStyles.typography.fontSize.sm,
    },
    ownNumberSection: {
      marginTop: TavariStyles.spacing.xl,
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
    },
    toggleButton: {
      width: '100%',
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.white,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      cursor: 'pointer',
      marginBottom: TavariStyles.spacing.md,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TavariStyles.spacing.sm,
    },
  };

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>Get a Phone Number</h2>
          <button style={styles.closeButton} onClick={onClose}>
            <X size={24} />
          </button>
        </div>

        <div style={styles.content}>
          {/* Search for Available Numbers */}
          <div style={styles.searchSection}>
            <h3 style={{ marginBottom: TavariStyles.spacing.md, fontSize: TavariStyles.typography.fontSize.lg }}>
              Search Available Numbers
            </h3>
            <div style={styles.searchRow}>
              <input
                type="text"
                placeholder="Area Code (e.g., 416)"
                value={searchCriteria.areaCode}
                onChange={(e) => setSearchCriteria({ ...searchCriteria, areaCode: e.target.value })}
                style={styles.input}
                maxLength={3}
              />
              <select
                value={searchCriteria.state}
                onChange={(e) => setSearchCriteria({ ...searchCriteria, state: e.target.value })}
                style={styles.select}
              >
                <option value="">Select State/Province</option>
                <option value="AL">Alabama</option>
                <option value="AK">Alaska</option>
                <option value="AZ">Arizona</option>
                <option value="AR">Arkansas</option>
                <option value="CA">California</option>
                <option value="CO">Colorado</option>
                <option value="CT">Connecticut</option>
                <option value="DE">Delaware</option>
                <option value="FL">Florida</option>
                <option value="GA">Georgia</option>
                <option value="HI">Hawaii</option>
                <option value="ID">Idaho</option>
                <option value="IL">Illinois</option>
                <option value="IN">Indiana</option>
                <option value="IA">Iowa</option>
                <option value="KS">Kansas</option>
                <option value="KY">Kentucky</option>
                <option value="LA">Louisiana</option>
                <option value="ME">Maine</option>
                <option value="MD">Maryland</option>
                <option value="MA">Massachusetts</option>
                <option value="MI">Michigan</option>
                <option value="MN">Minnesota</option>
                <option value="MS">Mississippi</option>
                <option value="MO">Missouri</option>
                <option value="MT">Montana</option>
                <option value="NE">Nebraska</option>
                <option value="NV">Nevada</option>
                <option value="NH">New Hampshire</option>
                <option value="NJ">New Jersey</option>
                <option value="NM">New Mexico</option>
                <option value="NY">New York</option>
                <option value="NC">North Carolina</option>
                <option value="ND">North Dakota</option>
                <option value="OH">Ohio</option>
                <option value="OK">Oklahoma</option>
                <option value="OR">Oregon</option>
                <option value="PA">Pennsylvania</option>
                <option value="RI">Rhode Island</option>
                <option value="SC">South Carolina</option>
                <option value="SD">South Dakota</option>
                <option value="TN">Tennessee</option>
                <option value="TX">Texas</option>
                <option value="UT">Utah</option>
                <option value="VT">Vermont</option>
                <option value="VA">Virginia</option>
                <option value="WA">Washington</option>
                <option value="WV">West Virginia</option>
                <option value="WI">Wisconsin</option>
                <option value="WY">Wyoming</option>
                <option value="ON">Ontario</option>
                <option value="QC">Quebec</option>
                <option value="BC">British Columbia</option>
                <option value="AB">Alberta</option>
              </select>
            </div>
            <button
              style={styles.searchButton}
              onClick={handleSearch}
              disabled={searching}
            >
              {searching ? (
                <>
                  <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} />
                  Searching...
                </>
              ) : (
                <>
                  <Search size={18} />
                  Search Available Numbers
                </>
              )}
            </button>
          </div>

          {/* Available Numbers List */}
          {availableNumbers.length > 0 && (
            <div style={styles.numbersGrid}>
              <h3 style={{ marginBottom: TavariStyles.spacing.md, fontSize: TavariStyles.typography.fontSize.lg }}>
                Available Numbers
              </h3>
              {availableNumbers.map((num, index) => (
                <div
                  key={index}
                  style={{
                    ...styles.numberCard,
                    ...(selectedNumber === num.phone_number ? styles.numberCardSelected : {}),
                  }}
                  onClick={() => setSelectedNumber(num.phone_number)}
                >
                  <div style={styles.numberDisplay}>
                    {selectedNumber === num.phone_number && <Check size={20} style={{ marginRight: '8px', color: TavariStyles.colors.primary }} />}
                    {formatPhoneNumber(num.phone_number)}
                  </div>
                  {num.region_information && (
                    <div style={styles.numberInfo}>
                      {num.region_information.city_name && `${num.region_information.city_name}, `}
                      {num.region_information.region_name}
                    </div>
                  )}
                  <div style={styles.numberInfo}>
                    ${num.cost?.monthly || '15.00'}/month
                  </div>
                  {selectedNumber === num.phone_number && (
                    <button
                      style={styles.purchaseButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePurchase(num.phone_number);
                      }}
                      disabled={purchasing}
                    >
                      {purchasing ? 'Purchasing...' : showPurchaseOption ? 'Purchase This Number' : 'Select This Number'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Divider */}
          <div style={styles.divider}>
            <span style={styles.dividerText}>OR</span>
          </div>

          {/* Use Your Own Number */}
          <div style={styles.ownNumberSection}>
            <button
              style={styles.toggleButton}
              onClick={() => setUseOwnNumber(!useOwnNumber)}
            >
              <Phone size={18} />
              {useOwnNumber ? 'Hide' : 'Use Your Own Phone Number'}
            </button>

            {useOwnNumber && (
              <div>
                <div style={{ marginBottom: TavariStyles.spacing.md }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: TavariStyles.typography.fontSize.sm, fontWeight: '600' }}>
                    Your Phone Number
                  </label>
                  <input
                    type="tel"
                    placeholder="+1234567890"
                    value={ownPhoneNumber}
                    onChange={(e) => setOwnPhoneNumber(e.target.value)}
                    style={styles.input}
                  />
                </div>
                <div style={{ marginBottom: TavariStyles.spacing.md }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: TavariStyles.typography.fontSize.sm, fontWeight: '600' }}>
                    Ring Count Before Forwarding
                  </label>
                  <select
                    value={ringCount}
                    onChange={(e) => setRingCount(parseInt(e.target.value))}
                    style={styles.select}
                  >
                    <option value={1}>1 ring</option>
                    <option value={2}>2 rings</option>
                    <option value={3}>3 rings</option>
                    <option value={4}>4 rings</option>
                    <option value={5}>5 rings</option>
                    <option value={6}>6 rings</option>
                  </select>
                  <p style={{ fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray600, marginTop: '4px' }}>
                    Calls will forward to your phone after {ringCount} {ringCount === 1 ? 'ring' : 'rings'}
                  </p>
                </div>
                <button
                  style={styles.purchaseButton}
                  onClick={handleUseOwnNumber}
                >
                  Use This Number
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PhoneNumberBrowser;

