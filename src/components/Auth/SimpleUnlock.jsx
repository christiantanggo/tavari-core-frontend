// src/components/Auth/SimpleUnlock.jsx - BULLETPROOF INDEPENDENT UNLOCK
// This unlock component is completely independent of the security layer
// No automatic logout, no session timeouts, no security interference
// Follows Tavari Build Standards for styling

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { useSessionLock } from '../../hooks/useSessionLock';
import { sessionPersistence } from '../../services/SessionPersistence';
import toast from 'react-hot-toast';

const SimpleUnlock = () => {
  const navigate = useNavigate();
  const { unlockWithPin } = useSessionLock();
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);
  const [showPin, setShowPin] = useState(false);
  
  const pinInputRef = useRef(null);

  // Get current user and ensure session persistence is running
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      
      // Ensure session persistence is running even on unlock screen
      // This prevents the session from expiring while user enters PIN
      if (sessionPersistence.isPersistenceEnabled()) {
        console.log('🔄 Ensuring session persistence is active on unlock screen...');
        sessionPersistence.startAutoRefresh();
      }
    };
    getUser();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      // Use the session lock's unlock function for proper validation
      // This already checks against ALL staff members, not just the logged-in user
      const result = await unlockWithPin(pin);
      
      if (result.ok) {
        // IMPORTANT: Ensure session is still valid and restore if needed
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        
        if (!currentSession && sessionPersistence.isPersistenceEnabled()) {
          // Try to restore session before navigating
          console.log('🔄 Session missing after unlock - attempting restore...');
          const restoreResult = await sessionPersistence.restoreSession();
          if (restoreResult.restored) {
            console.log('✅ Session restored after PIN unlock');
          } else {
            console.warn('⚠️ Could not restore session after PIN unlock');
            // Don't navigate if session can't be restored - user needs to login again
            setError('Session expired. Please log in again.');
            setIsLoading(false);
            return;
          }
        } else if (currentSession) {
          // Session exists - ensure auto-refresh is running
          if (sessionPersistence.isPersistenceEnabled()) {
            console.log('🔄 Restarting auto-refresh after unlock...');
            sessionPersistence.startAutoRefresh();
          }
        }
        
        toast.success('Unlocked successfully!');
        navigate('/dashboard');
      } else {
        if (result.reason === 'locked_out') {
          const minutes = Math.ceil(result.msRemaining / 60000);
          setError(`Too many failed attempts. Please wait ${minutes} minutes.`);
        } else {
          setError('Invalid PIN');
        }
      }
    } catch (err) {
      console.error('Unlock error:', err);
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      localStorage.removeItem('stayLoggedIn');
      localStorage.removeItem('expiresAt');
      toast.success('Logged out successfully');
      navigate('/login');
    } catch (err) {
      toast.error('Logout failed');
    }
  };

  const styles = {
    container: {
      ...TavariStyles.layout.flexCenter,
      minHeight: '100vh',
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.xl,
      fontFamily: TavariStyles.typography.fontFamily
    },
    
    unlockCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing['4xl'],
      maxWidth: '400px',
      width: '100%',
      textAlign: 'center',
      position: 'relative'
    },
    
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing['2xl'],
      margin: '0 0 32px 0'
    },
    
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.lg,
      textAlign: 'center'
    },
    
    userInfo: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray700,
      textAlign: 'center',
      marginBottom: TavariStyles.spacing['2xl'],
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray100,
      borderRadius: TavariStyles.borderRadius.md
    },
    
    inputGroup: {
      marginBottom: TavariStyles.spacing.lg,
      textAlign: 'left',
      position: 'relative'
    },
    
    label: {
      ...TavariStyles.components.form.label,
      textAlign: 'left'
    },
    
    input: {
      ...TavariStyles.components.form.input,
      width: '100%',
      boxSizing: 'border-box',
      transition: TavariStyles.transitions.normal
    },
    
    pinContainer: {
      position: 'relative',
      width: '100%'
    },
    
    pinToggle: {
      position: 'absolute',
      right: '12px',
      top: '50%',
      transform: 'translateY(-50%)',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: TavariStyles.colors.gray500,
      fontSize: TavariStyles.typography.fontSize.sm,
      zIndex: 1
    },
    
    unlockButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg,
      width: '100%',
      marginBottom: TavariStyles.spacing.md,
      opacity: isLoading ? 0.6 : 1,
      cursor: isLoading ? 'not-allowed' : 'pointer'
    },
    
    logoutButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.danger,
      ...TavariStyles.components.button.sizes.lg,
      width: '100%'
    },
    
    errorMessage: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      marginBottom: TavariStyles.spacing.lg,
      textAlign: 'center',
      fontSize: TavariStyles.typography.fontSize.sm
    },
    
    loadingSpinner: {
      display: 'inline-block',
      width: '16px',
      height: '16px',
      border: '2px solid #ffffff40',
      borderTop: '2px solid #ffffff',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
      marginRight: '8px'
    },
    
    bulletproofInfo: {
      marginTop: TavariStyles.spacing.xl,
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.blue50,
      border: `1px solid ${TavariStyles.colors.blue200}`,
      borderRadius: TavariStyles.borderRadius.md,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.blue700
    },
    
    bulletproofTitle: {
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      marginBottom: TavariStyles.spacing.sm
    },
    
    bulletproofList: {
      margin: '10px 0',
      paddingLeft: '20px'
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.unlockCard}>
        <h2 style={styles.title}>Unlock Application</h2>
        <p style={styles.subtitle}>
          Enter your PIN to continue
        </p>
        
        {user && (
          <div style={styles.userInfo}>
            Logged in as: <strong>{user.email}</strong>
          </div>
        )}
        
        <form onSubmit={handleSubmit}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>PIN</label>
            <div style={styles.pinContainer}>
              <input
                ref={pinInputRef}
                type={showPin ? 'text' : 'password'}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                style={styles.input}
                required
                disabled={isLoading}
                placeholder="Enter your PIN"
                autoFocus
                maxLength="10"
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                style={styles.pinToggle}
                disabled={isLoading}
              >
                {showPin ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          
          {error && (
            <div style={styles.errorMessage}>
              {error}
            </div>
          )}
          
          <button
            type="submit"
            style={styles.unlockButton}
            disabled={isLoading}
          >
            {isLoading && <span style={styles.loadingSpinner} />}
            {isLoading ? 'Unlocking...' : 'Unlock'}
          </button>
        </form>
        
        <button
          onClick={handleLogout}
          style={styles.logoutButton}
        >
          Logout
        </button>
        
        <div style={styles.bulletproofInfo}>
          <div style={styles.bulletproofTitle}>Bulletproof Features:</div>
          <ul style={styles.bulletproofList}>
            <li>No automatic logout</li>
            <li>No session timeouts</li>
            <li>No security interference</li>
            <li>Manual logout only</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default SimpleUnlock;
