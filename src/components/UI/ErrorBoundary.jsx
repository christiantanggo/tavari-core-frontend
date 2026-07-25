// src/components/UI/ErrorBoundary.jsx
// Standardized error boundary component for modules
import React from 'react';
import { FiAlertCircle, FiRefreshCw, FiHome } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { TavariStyles } from '../../utils/TavariStyles';
import { supabase } from '../../supabaseClient';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null 
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    
    // Log error to system health
    this.logErrorToSystemHealth(error, errorInfo);
  }

  async logErrorToSystemHealth(error, errorInfo) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const businessId = localStorage.getItem('currentBusinessId') || localStorage.getItem('selectedBusinessId');
      
      // Log to audit_logs
      await supabase.from('audit_logs').insert({
        business_id: businessId,
        user_id: user?.id,
        event_type: 'system.error',
        module_key: this.props.moduleKey || 'unknown',
        metadata: {
          error: error.toString(),
          errorInfo: errorInfo?.componentStack,
          url: window.location.href,
          userAgent: navigator.userAgent
        }
      });

      // If system_health table exists, log there too
      try {
        await supabase.from('system_health').insert({
          business_id: businessId,
          module_key: this.props.moduleKey || 'unknown',
          status: 'error',
          error_message: error.toString(),
          error_details: errorInfo?.componentStack
        });
      } catch (e) {
        // Table might not exist yet, ignore
      }
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback 
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          moduleName={this.props.moduleName || 'Module'}
          onReset={this.handleReset}
          onGoHome={() => {
            const navigate = this.props.navigate || (() => window.location.href = '/dashboard');
            navigate('/dashboard');
          }}
        />
      );
    }

    return this.props.children;
  }
}

// Error Fallback Component
const ErrorFallback = ({ error, errorInfo, moduleName, onReset, onGoHome }) => {
  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      padding: TavariStyles?.spacing?.xl || '24px',
      textAlign: 'center'
    },
    icon: {
      fontSize: '64px',
      color: TavariStyles?.colors?.error || '#ef4444',
      marginBottom: TavariStyles?.spacing?.lg || '16px'
    },
    title: {
      fontSize: TavariStyles?.typography?.fontSize?.['2xl'] || '24px',
      fontWeight: TavariStyles?.typography?.fontWeight?.bold || '700',
      color: TavariStyles?.colors?.gray900 || '#111827',
      marginBottom: TavariStyles?.spacing?.sm || '8px'
    },
    message: {
      fontSize: TavariStyles?.typography?.fontSize?.base || '16px',
      color: TavariStyles?.colors?.gray600 || '#4b5563',
      marginBottom: TavariStyles?.spacing?.xl || '24px',
      maxWidth: '600px'
    },
    errorDetails: {
      backgroundColor: TavariStyles?.colors?.gray50 || '#f9fafb',
      border: `1px solid ${TavariStyles?.colors?.gray200 || '#e5e7eb'}`,
      borderRadius: TavariStyles?.borderRadius?.md || '8px',
      padding: TavariStyles?.spacing?.md || '16px',
      marginBottom: TavariStyles?.spacing?.xl || '24px',
      textAlign: 'left',
      fontSize: TavariStyles?.typography?.fontSize?.sm || '14px',
      color: TavariStyles?.colors?.gray700 || '#374151',
      maxWidth: '800px',
      maxHeight: '200px',
      overflow: 'auto',
      fontFamily: 'monospace'
    },
    actions: {
      display: 'flex',
      gap: TavariStyles?.spacing?.md || '12px',
      flexWrap: 'wrap',
      justifyContent: 'center'
    },
    button: {
      padding: '12px 24px',
      border: 'none',
      borderRadius: TavariStyles?.borderRadius?.lg || '8px',
      fontSize: TavariStyles?.typography?.fontSize?.base || '16px',
      fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },
    primaryButton: {
      backgroundColor: TavariStyles?.colors?.primary || '#008080',
      color: TavariStyles?.colors?.white || '#ffffff'
    },
    secondaryButton: {
      backgroundColor: TavariStyles?.colors?.gray200 || '#e5e7eb',
      color: TavariStyles?.colors?.gray700 || '#374151'
    }
  };

  return (
    <div style={styles.container}>
      <FiAlertCircle style={styles.icon} />
      <h2 style={styles.title}>Something went wrong</h2>
      <p style={styles.message}>
        {moduleName} encountered an error. Don't worry, your data is safe. 
        You can try refreshing the page or go back to the dashboard.
      </p>
      
      {process.env.NODE_ENV === 'development' && errorInfo && (
        <details style={styles.errorDetails}>
          <summary style={{ cursor: 'pointer', marginBottom: '8px' }}>
            Error Details (Development Only)
          </summary>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {error?.toString()}
            {errorInfo?.componentStack}
          </pre>
        </details>
      )}

      <div style={styles.actions}>
        <button
          style={{ ...styles.button, ...styles.primaryButton }}
          onClick={onReset}
        >
          <FiRefreshCw /> Try Again
        </button>
        <button
          style={{ ...styles.button, ...styles.secondaryButton }}
          onClick={onGoHome}
        >
          <FiHome /> Go to Dashboard
        </button>
      </div>
    </div>
  );
};

// HOC wrapper for functional components
export const withErrorBoundary = (Component, moduleName, moduleKey) => {
  return (props) => {
    const navigate = useNavigate();
    return (
      <ErrorBoundary moduleName={moduleName} moduleKey={moduleKey} navigate={navigate}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
};

export default ErrorBoundary;



