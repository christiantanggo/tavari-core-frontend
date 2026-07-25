import React from 'react';
import { Link } from 'react-router-dom';

const COLORS = {
  bg: '#f8fafc',
  card: '#ffffff',
  cardBorder: 'rgba(15, 23, 42, 0.08)',
  heading: '#0f172a',
  body: '#64748b',
  indigo: '#6366f1',
};

const SUPPORT_EMAIL = 'info@tanggo.ca';

export default function PetCarePageLayout({ children }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: COLORS.bg,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <header
        style={{
          maxWidth: 720,
          margin: '0 auto',
          padding: '20px 24px',
        }}
      >
        <Link
          to="/petcare-app"
          style={{
            fontSize: 18,
            fontWeight: 800,
            color: COLORS.heading,
            textDecoration: 'none',
            letterSpacing: '-0.02em',
          }}
        >
          Pull Together
        </Link>
      </header>

      <main
        style={{
          maxWidth: 720,
          margin: '0 auto',
          padding: '0 24px 48px',
        }}
      >
        <div
          style={{
            backgroundColor: COLORS.card,
            border: `1px solid ${COLORS.cardBorder}`,
            borderRadius: 24,
            padding: 32,
          }}
        >
          {children}
        </div>
      </main>

      <footer style={{ maxWidth: 720, margin: '0 auto', padding: '0 24px 40px', textAlign: 'center' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
          <Link to="/petcare-app/privacy" style={footerLinkStyle}>
            Privacy
          </Link>
          <span style={{ color: COLORS.body }}>·</span>
          <Link to="/petcare-app/terms" style={footerLinkStyle}>
            Terms
          </Link>
          <span style={{ color: COLORS.body }}>·</span>
          <a href={`mailto:${SUPPORT_EMAIL}`} style={footerLinkStyle}>
            {SUPPORT_EMAIL}
          </a>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: COLORS.body, lineHeight: 1.5 }}>
          Pull Together: Pet Care is not veterinary advice and is not a substitute for professional veterinary care.
        </p>
      </footer>
    </div>
  );
}

const footerLinkStyle = {
  fontSize: 14,
  fontWeight: 600,
  color: '#6366f1',
  textDecoration: 'none',
};

export { COLORS, SUPPORT_EMAIL };
