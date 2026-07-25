// src/components/Auth/SimpleLogin.jsx - BULLETPROOF INDEPENDENT LOGIN
// This login component is completely independent of the security layer
// No automatic logout, no session timeouts, no security interference
// Follows Tavari Build Standards for styling

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import toast from 'react-hot-toast';

const SimpleLogin = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [stayLoggedIn, setStayLoggedIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  const passwordInputRef = useRef(null);
  const emailInputRef = useRef(null);

  // Check if user is already logged in
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        // User is already logged in, redirect to dashboard
        navigate('/dashboard');
      }
    };
    checkSession();
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setError('Invalid credentials. Please check your email and password.');
        setIsLoading(false);
        return;
      }

      if (data.user) {
        // Set session persistence to indefinite
        if (stayLoggedIn) {
          localStorage.setItem('stayLoggedIn', 'true');
          localStorage.setItem('expiresAt', new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()); // 1 year from now
        }
        
        toast.success('Login successful!');
        navigate('/dashboard');
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
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
    
    loginCard: {
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
      marginBottom: TavariStyles.spacing['2xl'],
      textAlign: 'center'
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
    
    passwordContainer: {
      position: 'relative',
      width: '100%'
    },
    
    passwordToggle: {
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
    
    checkboxContainer: {
      marginBottom: TavariStyles.spacing.xl,
      textAlign: 'left'
    },
    
    loginButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg,
      width: '100%',
      marginBottom: TavariStyles.spacing.lg,
      opacity: isLoading ? 0.6 : 1,
      cursor: isLoading ? 'not-allowed' : 'pointer'
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
      <div style={styles.loginCard}>
        <h2 style={styles.title}>Welcome Back</h2>
        <p style={styles.subtitle}>
          BULLETPROOF LOGIN - No automatic logout
        </p>
        
        <form onSubmit={handleSubmit}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Email Address</label>
            <input
              ref={emailInputRef}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              required
              disabled={isLoading}
              placeholder="Enter your email address"
              autoComplete="email"
            />
          </div>
          
          <div style={styles.inputGroup}>
            <label style={styles.label}>Password</label>
            <div style={styles.passwordContainer}>
              <input
                ref={passwordInputRef}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={styles.input}
                required
                disabled={isLoading}
                placeholder="Enter your password"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={styles.passwordToggle}
                disabled={isLoading}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          
          <div style={styles.checkboxContainer}>
            <TavariCheckbox
              checked={stayLoggedIn}
              onChange={setStayLoggedIn}
              label="Stay logged in indefinitely"
              disabled={isLoading}
            />
          </div>
          
          {error && (
            <div style={styles.errorMessage}>
              {error}
            </div>
          )}
          
          <button
            type="submit"
            style={styles.loginButton}
            disabled={isLoading}
          >
            {isLoading && <span style={styles.loadingSpinner} />}
            {isLoading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        
        <div style={styles.bulletproofInfo}>
          <div style={styles.bulletproofTitle}>Bulletproof Features:</div>
          <ul style={styles.bulletproofList}>
            <li>No automatic logout</li>
            <li>No session timeouts</li>
            <li>No security interference</li>
            <li>Stays logged in indefinitely</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default SimpleLogin;
