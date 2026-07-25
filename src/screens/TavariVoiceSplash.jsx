// src/screens/TavariVoiceSplash.jsx
// Tavari Voice Landing Page - Public marketing page for AI Voice Agent signup

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TavariStyles } from '../utils/TavariStyles';
import { Phone, Clock, Users, TrendingUp, CheckCircle, ArrowRight } from 'lucide-react';

const TavariVoiceSplash = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');

  const handleGetStarted = () => {
    // Navigate to register page, with a query param to indicate they came from voice splash
    navigate('/register?source=tavari-voice');
  };

  const handleSignIn = () => {
    // Navigate to login page
    navigate('/login?source=tavari-voice');
  };

  const handleEmailSubmit = (e) => {
    e.preventDefault();
    if (email) {
      // Navigate to register with email pre-filled
      navigate(`/register?source=tavari-voice&email=${encodeURIComponent(email)}`);
    }
  };

  const styles = {
    container: {
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #008080 0%, #006666 100%)',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: TavariStyles.typography.fontFamily
    },
    header: {
      background: 'rgba(255, 255, 255, 0.95)',
      backdropFilter: 'blur(10px)',
      padding: `${TavariStyles.spacing.lg} ${TavariStyles.spacing.xl}`,
      boxShadow: '0 2px 20px rgba(0,0,0,0.1)',
      position: 'sticky',
      top: 0,
      zIndex: 100
    },
    headerContent: {
      maxWidth: '1200px',
      margin: '0 auto',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    },
    logo: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.md,
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary
    },
    headerButtons: {
      display: 'flex',
      gap: TavariStyles.spacing.md
    },
    headerButton: {
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.xl}`,
      borderRadius: TavariStyles.borderRadius.md,
      border: 'none',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: 'pointer',
      transition: 'all 0.3s ease',
      fontFamily: TavariStyles.typography.fontFamily
    },
    signInButton: {
      background: 'transparent',
      color: TavariStyles.colors.primary,
      border: `2px solid ${TavariStyles.colors.primary}`
    },
    getStartedButton: {
      background: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      border: `2px solid ${TavariStyles.colors.primary}`
    },
    hero: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: `${TavariStyles.spacing['6xl']} ${TavariStyles.spacing.xl}`,
      textAlign: 'center',
      color: TavariStyles.colors.white,
      maxWidth: '1200px',
      margin: '0 auto',
      width: '100%'
    },
    heroTitle: {
      fontSize: 'clamp(2.5rem, 5vw, 4rem)',
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: TavariStyles.spacing.xl,
      lineHeight: TavariStyles.typography.lineHeight.tight,
      textShadow: '0 2px 20px rgba(0,0,0,0.3)'
    },
    heroSubtitle: {
      fontSize: 'clamp(1.125rem, 2vw, 1.5rem)',
      marginBottom: TavariStyles.spacing['4xl'],
      lineHeight: TavariStyles.typography.lineHeight.relaxed,
      maxWidth: '800px',
      opacity: 0.95
    },
    emailForm: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      maxWidth: '500px',
      width: '100%',
      marginBottom: TavariStyles.spacing['3xl']
    },
    emailInput: {
      flex: 1,
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      borderRadius: TavariStyles.borderRadius.md,
      border: 'none',
      fontSize: TavariStyles.typography.fontSize.base,
      fontFamily: TavariStyles.typography.fontFamily,
      boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
    },
    submitButton: {
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing['2xl']}`,
      borderRadius: TavariStyles.borderRadius.md,
      border: 'none',
      background: TavariStyles.colors.white,
      color: TavariStyles.colors.primary,
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      cursor: 'pointer',
      transition: 'all 0.3s ease',
      fontFamily: TavariStyles.typography.fontFamily,
      boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
      whiteSpace: 'nowrap'
    },
    ctaButton: {
      padding: `${TavariStyles.spacing.lg} ${TavariStyles.spacing['3xl']}`,
      borderRadius: TavariStyles.borderRadius.lg,
      border: 'none',
      background: TavariStyles.colors.white,
      color: TavariStyles.colors.primary,
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      cursor: 'pointer',
      transition: 'all 0.3s ease',
      fontFamily: TavariStyles.typography.fontFamily,
      boxShadow: '0 8px 25px rgba(0,0,0,0.3)',
      marginBottom: TavariStyles.spacing['4xl'],
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.md
    },
    features: {
      background: TavariStyles.colors.white,
      padding: `${TavariStyles.spacing['6xl']} ${TavariStyles.spacing.xl}`,
      color: TavariStyles.colors.gray900
    },
    featuresContent: {
      maxWidth: '1200px',
      margin: '0 auto'
    },
    featuresTitle: {
      fontSize: TavariStyles.typography.fontSize['4xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      textAlign: 'center',
      marginBottom: TavariStyles.spacing['5xl'],
      color: TavariStyles.colors.gray900
    },
    featuresGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
      gap: TavariStyles.spacing['3xl'],
      marginBottom: TavariStyles.spacing['5xl']
    },
    featureCard: {
      padding: TavariStyles.spacing['3xl'],
      borderRadius: TavariStyles.borderRadius.lg,
      background: TavariStyles.colors.gray50,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      transition: 'all 0.3s ease',
      textAlign: 'center'
    },
    featureIcon: {
      marginBottom: TavariStyles.spacing.lg,
      display: 'flex',
      justifyContent: 'center',
      color: TavariStyles.colors.primary
    },
    featureTitle: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: TavariStyles.spacing.md,
      color: TavariStyles.colors.gray900
    },
    featureDescription: {
      fontSize: TavariStyles.typography.fontSize.base,
      lineHeight: TavariStyles.typography.lineHeight.relaxed,
      color: TavariStyles.colors.gray700
    },
    benefits: {
      background: TavariStyles.colors.gray50,
      padding: `${TavariStyles.spacing['6xl']} ${TavariStyles.spacing.xl}`,
      textAlign: 'center'
    },
    benefitsContent: {
      maxWidth: '1200px',
      margin: '0 auto'
    },
    benefitsTitle: {
      fontSize: TavariStyles.typography.fontSize['4xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: TavariStyles.spacing.lg,
      color: TavariStyles.colors.gray900
    },
    benefitsSubtitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing['5xl']
    },
    benefitsList: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
      gap: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing['4xl'],
      textAlign: 'left'
    },
    benefitItem: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.lg,
      background: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    benefitIcon: {
      color: TavariStyles.colors.success,
      flexShrink: 0,
      marginTop: '4px'
    },
    benefitText: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray700,
      lineHeight: TavariStyles.typography.lineHeight.relaxed
    },
    footer: {
      background: TavariStyles.colors.gray900,
      color: TavariStyles.colors.white,
      padding: `${TavariStyles.spacing['3xl']} ${TavariStyles.spacing.xl}`,
      textAlign: 'center'
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <div style={styles.logo}>
            📞 Tavari Voice
          </div>
          <div style={styles.headerButtons}>
            <button
              style={{ ...styles.headerButton, ...styles.signInButton }}
              onClick={handleSignIn}
              onMouseEnter={(e) => {
                e.target.style.background = TavariStyles.colors.primary;
                e.target.style.color = TavariStyles.colors.white;
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'transparent';
                e.target.style.color = TavariStyles.colors.primary;
              }}
            >
              Sign In
            </button>
            <button
              style={{ ...styles.headerButton, ...styles.getStartedButton }}
              onClick={handleGetStarted}
              onMouseEnter={(e) => {
                e.target.style.background = TavariStyles.colors.primaryDark || '#006666';
                e.target.style.transform = 'translateY(-2px)';
                e.target.style.boxShadow = '0 4px 15px rgba(0,128,128,0.4)';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = TavariStyles.colors.primary;
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = 'none';
              }}
            >
              Get Started
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section style={styles.hero}>
        <h1 style={styles.heroTitle}>
          Never Miss a Call Again
        </h1>
        <p style={styles.heroSubtitle}>
          Your AI phone agent answers calls 24/7, captures leads, schedules appointments, 
          and provides instant answers to customer questions—all while you sleep.
          <strong style={{ display: 'block', marginTop: TavariStyles.spacing.md, fontSize: '1.2em' }}>
            Professional. Intelligent. Always available.
          </strong>
        </p>
        
        {/* Email Capture Form */}
        <form style={styles.emailForm} onSubmit={handleEmailSubmit}>
          <input
            type="email"
            placeholder="Enter your business email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.emailInput}
            required
          />
          <button type="submit" style={styles.submitButton}>
            Get Started Free
          </button>
        </form>

        <button
          style={styles.ctaButton}
          onClick={handleGetStarted}
          onMouseEnter={(e) => {
            e.target.style.transform = 'translateY(-3px) scale(1.02)';
            e.target.style.boxShadow = '0 12px 35px rgba(0,0,0,0.4)';
          }}
          onMouseLeave={(e) => {
            e.target.style.transform = 'translateY(0) scale(1)';
            e.target.style.boxShadow = '0 8px 25px rgba(0,0,0,0.3)';
          }}
        >
          Start Your Free Trial
          <ArrowRight size={20} />
        </button>
      </section>

      {/* Features Section */}
      <section style={styles.features}>
        <div style={styles.featuresContent}>
          <h2 style={styles.featuresTitle}>Everything You Need to Automate Your Phone</h2>
          <div style={styles.featuresGrid}>
            <div style={styles.featureCard}>
              <div style={styles.featureIcon}>
                <Clock size={48} />
              </div>
              <h3 style={styles.featureTitle}>24/7 Availability</h3>
              <p style={styles.featureDescription}>
                Never miss a call, even after hours. Your AI agent is always ready to answer, 
                capture information, and schedule appointments—day or night.
              </p>
            </div>
            <div style={styles.featureCard}>
              <div style={styles.featureIcon}>
                <Users size={48} />
              </div>
              <h3 style={styles.featureTitle}>Lead Capture</h3>
              <p style={styles.featureDescription}>
                Automatically collect caller information, phone numbers, and messages. 
                Get instant notifications when leads come in so you never miss an opportunity.
              </p>
            </div>
            <div style={styles.featureCard}>
              <div style={styles.featureIcon}>
                <Phone size={48} />
              </div>
              <h3 style={styles.featureTitle}>Natural Conversations</h3>
              <p style={styles.featureDescription}>
                Advanced AI that sounds human and understands context. Handles complex questions, 
                provides accurate answers, and creates a professional experience for every caller.
              </p>
            </div>
            <div style={styles.featureCard}>
              <div style={styles.featureIcon}>
                <TrendingUp size={48} />
              </div>
              <h3 style={styles.featureTitle}>Smart Analytics</h3>
              <p style={styles.featureDescription}>
                Track every call, measure conversion rates, analyze customer questions, 
                and optimize your AI agent's performance with detailed insights and reports.
              </p>
            </div>
            <div style={styles.featureCard}>
              <div style={styles.featureIcon}>
                <CheckCircle size={48} />
              </div>
              <h3 style={styles.featureTitle}>Easy Setup</h3>
              <p style={styles.featureDescription}>
                Get started in minutes. Configure your AI's personality, add FAQs, 
                set business hours, and connect your phone number—all from one simple dashboard.
              </p>
            </div>
            <div style={styles.featureCard}>
              <div style={styles.featureIcon}>
                <Phone size={48} />
              </div>
              <h3 style={styles.featureTitle}>Customizable</h3>
              <p style={styles.featureDescription}>
                Train your AI with your business knowledge, FAQs, operating hours, and unique voice. 
                Make it sound exactly how you want it to represent your brand.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section style={styles.benefits}>
        <div style={styles.benefitsContent}>
          <h2 style={styles.benefitsTitle}>Why Businesses Love Tavari Voice</h2>
          <p style={styles.benefitsSubtitle}>
            Join thousands of businesses that never miss a call
          </p>
          <div style={styles.benefitsList}>
            <div style={styles.benefitItem}>
              <CheckCircle size={24} style={styles.benefitIcon} />
              <p style={styles.benefitText}>
                <strong>Answer every call</strong>—even when you're closed or busy
              </p>
            </div>
            <div style={styles.benefitItem}>
              <CheckCircle size={24} style={styles.benefitIcon} />
              <p style={styles.benefitText}>
                <strong>Capture more leads</strong>—never lose a potential customer
              </p>
            </div>
            <div style={styles.benefitItem}>
              <CheckCircle size={24} style={styles.benefitIcon} />
              <p style={styles.benefitText}>
                <strong>Save time and money</strong>—reduce missed calls and no-shows
              </p>
            </div>
            <div style={styles.benefitItem}>
              <CheckCircle size={24} style={styles.benefitIcon} />
              <p style={styles.benefitText}>
                <strong>Professional 24/7</strong>—impress customers with instant responses
              </p>
            </div>
            <div style={styles.benefitItem}>
              <CheckCircle size={24} style={styles.benefitIcon} />
              <p style={styles.benefitText}>
                <strong>Scale effortlessly</strong>—handle unlimited calls simultaneously
              </p>
            </div>
            <div style={styles.benefitItem}>
              <CheckCircle size={24} style={styles.benefitIcon} />
              <p style={styles.benefitText}>
                <strong>Data-driven insights</strong>—understand your customers better
              </p>
            </div>
          </div>
          <button
            style={styles.ctaButton}
            onClick={handleGetStarted}
            onMouseEnter={(e) => {
              e.target.style.background = TavariStyles.colors.primary;
              e.target.style.color = TavariStyles.colors.white;
              e.target.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = TavariStyles.colors.white;
              e.target.style.color = TavariStyles.colors.primary;
              e.target.style.transform = 'translateY(0)';
            }}
          >
            Get Started Today
            <ArrowRight size={20} />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer style={styles.footer}>
        <p>© {new Date().getFullYear()} Tavari Voice. All rights reserved.</p>
        <p style={{ marginTop: TavariStyles.spacing.sm, opacity: 0.8 }}>
          Part of the Tavari Business Management Platform
        </p>
      </footer>
    </div>
  );
};

export default TavariVoiceSplash;

