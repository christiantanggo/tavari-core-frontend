// src/screens/TavariMusicSplash.jsx
// Tavari Music Landing Page - Public marketing page for music program signup

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TavariStyles } from '../utils/TavariStyles';

const TavariMusicSplash = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');

  const handleGetStarted = () => {
    // Navigate to register page, with a query param to indicate they came from music splash
    navigate('/register?source=tavari-music');
  };

  const handleSignIn = () => {
    // Navigate to login page
    navigate('/login?source=tavari-music');
  };

  const handleEmailSubmit = (e) => {
    e.preventDefault();
    if (email) {
      // For now, just navigate to register with email pre-filled
      // In the future, could store this in a lead capture table
      navigate(`/register?source=tavari-music&email=${encodeURIComponent(email)}`);
    }
  };

  const styles = {
    container: {
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
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
      marginBottom: TavariStyles.spacing['4xl']
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
      transition: 'all 0.3s ease'
    },
    featureIcon: {
      fontSize: '3rem',
      marginBottom: TavariStyles.spacing.lg
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
    pricing: {
      background: TavariStyles.colors.gray50,
      padding: `${TavariStyles.spacing['6xl']} ${TavariStyles.spacing.xl}`,
      textAlign: 'center'
    },
    pricingContent: {
      maxWidth: '1200px',
      margin: '0 auto'
    },
    pricingTitle: {
      fontSize: TavariStyles.typography.fontSize['4xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: TavariStyles.spacing.lg,
      color: TavariStyles.colors.gray900
    },
    pricingSubtitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing['5xl']
    },
    pricingCards: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: TavariStyles.spacing['2xl'],
      marginBottom: TavariStyles.spacing['4xl']
    },
    pricingCard: {
      background: TavariStyles.colors.white,
      padding: TavariStyles.spacing['3xl'],
      borderRadius: TavariStyles.borderRadius.lg,
      border: `2px solid ${TavariStyles.colors.gray200}`,
      boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
      transition: 'all 0.3s ease'
    },
    pricingCardFeatured: {
      border: `3px solid ${TavariStyles.colors.primary}`,
      transform: 'scale(1.05)',
      boxShadow: '0 8px 30px rgba(0,128,128,0.3)'
    },
    planName: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: TavariStyles.spacing.md,
      color: TavariStyles.colors.gray900
    },
    planPrice: {
      fontSize: TavariStyles.typography.fontSize['4xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary,
      marginBottom: TavariStyles.spacing.lg
    },
    planFeatures: {
      listStyle: 'none',
      padding: 0,
      marginBottom: TavariStyles.spacing['2xl']
    },
    planFeature: {
      padding: `${TavariStyles.spacing.sm} 0`,
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray700
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
            🎵 Tavari Music
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
                e.target.style.background = TavariStyles.colors.primaryDark;
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
          Earn Money While You Play Music
        </h1>
        <p style={styles.heroSubtitle}>
          Replace expensive commercial music systems with Tavari Music. 
          <strong style={{ display: 'block', marginTop: TavariStyles.spacing.md, fontSize: '1.2em' }}>
            Choose your ad frequency and earn revenue—or pay a low monthly fee. You're in control.
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
          Start Your Free Trial →
        </button>
      </section>

      {/* Features Section */}
      <section style={styles.features}>
        <div style={styles.featuresContent}>
          <h2 style={styles.featuresTitle}>Everything You Need</h2>
          <div style={styles.featuresGrid}>
            <div style={styles.featureCard}>
              <div style={styles.featureIcon}>🎵</div>
              <h3 style={styles.featureTitle}>Curated Playlists</h3>
              <p style={styles.featureDescription}>
                Professionally curated music playlists for every mood and time of day. 
                From upbeat mornings to relaxed evenings, we've got you covered.
              </p>
            </div>
            <div style={styles.featureCard}>
              <div style={styles.featureIcon}>⏰</div>
              <h3 style={styles.featureTitle}>Smart Scheduling</h3>
              <p style={styles.featureDescription}>
                Automatically switch playlists based on time of day, day of week, 
                or custom rules. Set it and forget it.
              </p>
            </div>
            <div style={styles.featureCard}>
              <div style={styles.featureIcon}>💰</div>
              <h3 style={styles.featureTitle}>Earn Money From Ads</h3>
              <p style={styles.featureDescription}>
                <strong>Get paid to play ads!</strong> The more ads you allow, the more revenue you earn. 
                Earn 10-40% revenue share, or choose fewer ads and pay a low monthly fee. 
                You control your ad frequency and your income.
              </p>
            </div>
            <div style={styles.featureCard}>
              <div style={styles.featureIcon}>📱</div>
              <h3 style={styles.featureTitle}>Desktop & Web</h3>
              <p style={styles.featureDescription}>
                Run on dedicated desktop players or access from any device. 
                Works offline with automatic sync when online.
              </p>
            </div>
            <div style={styles.featureCard}>
              <div style={styles.featureIcon}>🎛️</div>
              <h3 style={styles.featureTitle}>Full Control</h3>
              <p style={styles.featureDescription}>
                Upload your own music, create custom playlists, blacklist songs, 
                and control every aspect of your music system.
              </p>
            </div>
            <div style={styles.featureCard}>
              <div style={styles.featureIcon}>📊</div>
              <h3 style={styles.featureTitle}>Analytics & Reports</h3>
              <p style={styles.featureDescription}>
                Track what's playing, monitor revenue, and export reports for taxes. 
                Complete transparency and control.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Revenue Highlight Section */}
      <section style={{
        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        padding: `${TavariStyles.spacing['6xl']} ${TavariStyles.spacing.xl}`,
        textAlign: 'center',
        color: TavariStyles.colors.white
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: TavariStyles.typography.fontSize['4xl'],
            fontWeight: TavariStyles.typography.fontWeight.bold,
            marginBottom: TavariStyles.spacing.lg
          }}>
            💰 Earn Money From Every Ad Played
          </h2>
          <p style={{
            fontSize: TavariStyles.typography.fontSize.xl,
            lineHeight: TavariStyles.typography.lineHeight.relaxed,
            marginBottom: TavariStyles.spacing['3xl']
          }}>
            Unlike other music services that charge you monthly fees, Tavari Music lets you <strong>earn revenue</strong> by playing ads. 
            The more ads you allow, the more money you make. Or choose fewer ads and pay a low monthly fee instead.
          </p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: TavariStyles.spacing['2xl'],
            marginTop: TavariStyles.spacing['4xl']
          }}>
            <div style={{
              background: 'rgba(255,255,255,0.15)',
              backdropFilter: 'blur(10px)',
              padding: TavariStyles.spacing['2xl'],
              borderRadius: TavariStyles.borderRadius.lg,
              border: '1px solid rgba(255,255,255,0.3)'
            }}>
              <div style={{ fontSize: '2.5rem', marginBottom: TavariStyles.spacing.sm }}>🎵</div>
              <div style={{ fontSize: TavariStyles.typography.fontSize['2xl'], fontWeight: TavariStyles.typography.fontWeight.bold }}>
                1 ad every 6 songs
              </div>
              <div style={{ fontSize: TavariStyles.typography.fontSize.xl, marginTop: TavariStyles.spacing.sm }}>
                Earn 10-20% revenue
              </div>
            </div>
            <div style={{
              background: 'rgba(255,255,255,0.15)',
              backdropFilter: 'blur(10px)',
              padding: TavariStyles.spacing['2xl'],
              borderRadius: TavariStyles.borderRadius.lg,
              border: '1px solid rgba(255,255,255,0.3)'
            }}>
              <div style={{ fontSize: '2.5rem', marginBottom: TavariStyles.spacing.sm }}>🎵</div>
              <div style={{ fontSize: TavariStyles.typography.fontSize['2xl'], fontWeight: TavariStyles.typography.fontWeight.bold }}>
                1 ad every 4 songs
              </div>
              <div style={{ fontSize: TavariStyles.typography.fontSize.xl, marginTop: TavariStyles.spacing.sm }}>
                Earn 20-30% revenue
              </div>
            </div>
            <div style={{
              background: 'rgba(255,255,255,0.15)',
              backdropFilter: 'blur(10px)',
              padding: TavariStyles.spacing['2xl'],
              borderRadius: TavariStyles.borderRadius.lg,
              border: '1px solid rgba(255,255,255,0.3)'
            }}>
              <div style={{ fontSize: '2.5rem', marginBottom: TavariStyles.spacing.sm }}>🎵</div>
              <div style={{ fontSize: TavariStyles.typography.fontSize['2xl'], fontWeight: TavariStyles.typography.fontWeight.bold }}>
                1 ad every 3 songs
              </div>
              <div style={{ fontSize: TavariStyles.typography.fontSize.xl, marginTop: TavariStyles.spacing.sm }}>
                Earn 20-40% revenue
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section style={styles.pricing}>
        <div style={styles.pricingContent}>
          <h2 style={styles.pricingTitle}>Flexible Pricing - Pay or Earn</h2>
          <p style={styles.pricingSubtitle}>
            Choose your plan and ad frequency. More ads = more revenue for you, or pay a low monthly fee for fewer ads.
          </p>
          <div style={styles.pricingCards}>
            <div style={styles.pricingCard}>
              <h3 style={styles.planName}>Standard</h3>
              <div style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginBottom: TavariStyles.spacing.sm }}>
                Professional Background Music
              </div>
              <div style={styles.planPrice}>From FREE</div>
              <div style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginBottom: TavariStyles.spacing.lg }}>
                (1 ad every 7 songs = FREE)
              </div>
              <ul style={styles.planFeatures}>
                <li style={styles.planFeature}>✓ 1 ad every 7 songs: <strong>FREE</strong></li>
                <li style={styles.planFeature}>✓ 1 ad every 6 songs: <strong style={{ color: TavariStyles.colors.success }}>Earn 10%</strong></li>
                <li style={styles.planFeature}>✓ 1 ad every 5 songs: <strong style={{ color: TavariStyles.colors.success }}>Earn 20%</strong></li>
                <li style={styles.planFeature}>✓ 1 ad every 4 songs: <strong style={{ color: TavariStyles.colors.success }}>Earn 30%</strong></li>
                <li style={styles.planFeature}>✓ 1 ad every 3 songs: <strong style={{ color: TavariStyles.colors.success }}>Earn 40%</strong></li>
                <li style={styles.planFeature}>✓ Zero ads: $29.99/mo</li>
              </ul>
            </div>
            <div style={{ ...styles.pricingCard, ...styles.pricingCardFeatured }}>
              <h3 style={styles.planName}>Plus</h3>
              <div style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginBottom: TavariStyles.spacing.sm }}>
                Background & Popular Music
              </div>
              <div style={styles.planPrice}>From FREE</div>
              <div style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginBottom: TavariStyles.spacing.lg }}>
                (1 ad every 6 songs = FREE)
              </div>
              <ul style={styles.planFeatures}>
                <li style={styles.planFeature}>✓ 1 ad every 6 songs: <strong>FREE</strong></li>
                <li style={styles.planFeature}>✓ 1 ad every 5 songs: <strong style={{ color: TavariStyles.colors.success }}>Earn 10%</strong></li>
                <li style={styles.planFeature}>✓ 1 ad every 4 songs: <strong style={{ color: TavariStyles.colors.success }}>Earn 20%</strong></li>
                <li style={styles.planFeature}>✓ 1 ad every 3 songs: <strong style={{ color: TavariStyles.colors.success }}>Earn 30%</strong></li>
                <li style={styles.planFeature}>✓ Zero ads: $39.99/mo</li>
                <li style={styles.planFeature}>✓ More music variety</li>
              </ul>
            </div>
            <div style={styles.pricingCard}>
              <h3 style={styles.planName}>Premium</h3>
              <div style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginBottom: TavariStyles.spacing.sm }}>
                Premium Licensed Music
              </div>
              <div style={styles.planPrice}>From FREE</div>
              <div style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginBottom: TavariStyles.spacing.lg }}>
                (1 ad every 5 songs = FREE)
              </div>
              <ul style={styles.planFeatures}>
                <li style={styles.planFeature}>✓ 1 ad every 5 songs: <strong>FREE</strong></li>
                <li style={styles.planFeature}>✓ 1 ad every 4 songs: <strong style={{ color: TavariStyles.colors.success }}>Earn 10%</strong></li>
                <li style={styles.planFeature}>✓ 1 ad every 3 songs: <strong style={{ color: TavariStyles.colors.success }}>Earn 20%</strong></li>
                <li style={styles.planFeature}>✓ Zero ads: $49.99/mo</li>
                <li style={styles.planFeature}>✓ Premium licensed tracks</li>
                <li style={styles.planFeature}>✓ Best music quality</li>
              </ul>
            </div>
          </div>
          <div style={{
            background: TavariStyles.colors.successBg,
            border: `1px solid ${TavariStyles.colors.success}`,
            borderRadius: TavariStyles.borderRadius.lg,
            padding: TavariStyles.spacing.xl,
            marginTop: TavariStyles.spacing['3xl'],
            textAlign: 'center'
          }}>
            <p style={{
              fontSize: TavariStyles.typography.fontSize.lg,
              color: TavariStyles.colors.gray900,
              margin: 0,
              fontWeight: TavariStyles.typography.fontWeight.semibold
            }}>
              💡 <strong>Pro Tip:</strong> Most businesses earn $50-200/month by allowing 1 ad every 4-5 songs. 
              That's money you're leaving on the table with traditional music services!
            </p>
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
            Start Free Trial
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer style={styles.footer}>
        <p>© {new Date().getFullYear()} Tavari Music. All rights reserved.</p>
        <p style={{ marginTop: TavariStyles.spacing.sm, opacity: 0.8 }}>
          Part of the Tavari Business Management Platform
        </p>
      </footer>
    </div>
  );
};

export default TavariMusicSplash;

