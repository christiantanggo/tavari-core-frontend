import React from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { TavariStyles } from '../../utils/TavariStyles';
import { clearCustomerPortalSession } from '../../utils/customerPortalSession';
import { CUSTOMER_PORTAL_SECTIONS } from '../../utils/customerPortalSectionMeta';

const styles = {
  page: {
    minHeight: '100vh',
    backgroundColor: TavariStyles.colors.gray50,
    padding: '24px 16px 48px',
  },
  container: {
    maxWidth: 1200,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  header: {
    backgroundColor: 'white',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: 16,
    padding: '24px 28px',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 20,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  titleBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: TavariStyles.colors.primary,
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    color: TavariStyles.colors.gray900,
  },
  subtitle: {
    margin: 0,
    fontSize: 14,
    color: TavariStyles.colors.gray600,
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  accountBadge: {
    padding: '10px 14px',
    borderRadius: 999,
    backgroundColor: TavariStyles.colors.gray100,
    color: TavariStyles.colors.gray700,
    fontSize: 14,
  },
  button: {
    borderRadius: 8,
    padding: '12px 18px',
    fontSize: 14,
    fontWeight: 600,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    backgroundColor: 'white',
    color: TavariStyles.colors.gray800,
    cursor: 'pointer',
    textDecoration: 'none',
  },
  primaryButton: {
    borderColor: TavariStyles.colors.primary,
    backgroundColor: TavariStyles.colors.primary,
    color: 'white',
  },
  nav: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 16,
  },
  navCard: {
    backgroundColor: 'white',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: 16,
    padding: 20,
    textDecoration: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minHeight: 140,
  },
  navCardActive: {
    borderColor: TavariStyles.colors.primary,
    boxShadow: `0 0 0 2px ${TavariStyles.colors.primary}22`,
  },
  navCardTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: TavariStyles.colors.gray900,
  },
  navCardDesc: {
    fontSize: 14,
    color: TavariStyles.colors.gray600,
    lineHeight: 1.5,
  },
  navCardCount: {
    marginTop: 'auto',
    fontSize: 28,
    fontWeight: 700,
    color: TavariStyles.colors.primary,
  },
  content: {
    backgroundColor: 'white',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: 16,
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
};

const CustomerPortalShell = ({
  businessId,
  customer,
  counts = {},
  activeSection,
  title,
  subtitle,
  children,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const effectiveBusinessId = businessId || params.businessId;

  const handleSignOut = () => {
    clearCustomerPortalSession(effectiveBusinessId);
    navigate(`/customer-portal/${effectiveBusinessId}/portal`, { replace: true });
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.titleBlock}>
            <div style={styles.eyebrow}>Customer Portal</div>
            <h1 style={styles.title}>{title}</h1>
            <p style={styles.subtitle}>{subtitle}</p>
          </div>
          <div style={styles.headerActions}>
            <div style={styles.accountBadge}>
              {customer?.customer_name || customer?.customer_email || customer?.email || customer?.phone || 'Customer'}
            </div>
            <Link to={`/customer-portal/${effectiveBusinessId}/portal`} style={styles.button}>
              Book New Activity
            </Link>
            <button type="button" onClick={handleSignOut} style={styles.button}>
              Sign Out
            </button>
          </div>
        </div>

        <div style={styles.nav}>
          {CUSTOMER_PORTAL_SECTIONS.map((section) => {
            const href = `/customer-portal/${effectiveBusinessId}/account/${section.id}`;
            const isActive = activeSection === section.id || location.pathname === href;
            return (
              <Link
                key={section.id}
                to={href}
                style={{
                  ...styles.navCard,
                  ...(isActive ? styles.navCardActive : {}),
                }}
              >
                <div style={styles.navCardTitle}>{section.title}</div>
                <div style={styles.navCardDesc}>{section.description}</div>
                <div style={styles.navCardCount}>{counts[section.id] ?? 0}</div>
              </Link>
            );
          })}
        </div>

        <div style={styles.content}>{children}</div>
      </div>
    </div>
  );
};

export default CustomerPortalShell;
