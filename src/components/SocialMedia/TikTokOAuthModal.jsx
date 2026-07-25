// components/SocialMedia/TikTokOAuthModal.jsx
// Production OAuth modal for TikTok connection
import React, { useState } from 'react';
import { X } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';
import { TikTokOAuthService } from '../../services/socialMedia/TikTokOAuthService';
import { usePOSAuth } from '../../hooks/usePOSAuth';

const TikTokOAuthModal = ({ isOpen, onClose, onSuccess }) => {
  const { selectedBusinessId } = usePOSAuth({
    requireBusiness: true,
    componentName: 'TikTokOAuthModal'
  });

  if (!isOpen) return null;

  const handleConnect = () => {
    try {
      if (!selectedBusinessId) {
        throw new Error('Business ID is required');
      }

      // Store business ID in session storage for callback
      sessionStorage.setItem('tiktok_oauth_business_id', selectedBusinessId);

      // Generate state token for CSRF protection
      const state = TikTokOAuthService.generateStateToken();
      TikTokOAuthService.storeStateToken(state);

      // Get redirect URI
      const redirectUri = `${window.location.origin}/auth/tiktok/callback`;

      // Generate TikTok OAuth URL
      const authUrl = TikTokOAuthService.generateAuthUrl(
        selectedBusinessId,
        redirectUri,
        state
      );

      // Redirect to TikTok OAuth
      window.location.href = authUrl;
    } catch (error) {
      console.error('Error initiating TikTok OAuth:', error);
      alert(`Failed to connect: ${error.message}`);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          padding: '32px',
          maxWidth: '480px',
          width: '90%',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#000000', margin: 0 }}>
            Connect to TikTok
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={24} color="#666" />
          </button>
        </div>

        {/* OAuth Authorization Info */}
        <div
          style={{
            backgroundColor: '#f5f5f5',
            borderRadius: '12px',
            padding: '40px',
            marginBottom: '24px',
            border: '2px dashed #ddd',
            textAlign: 'center',
            minHeight: '300px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '400px',
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              padding: '24px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
            }}
          >
            {/* TikTok Logo */}
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <div
                style={{
                  fontSize: '33px',
                  fontWeight: 'bold',
                  color: '#000000',
                  marginBottom: '8px',
                }}
              >
                TikTok
              </div>
              <div style={{ fontSize: '14px', color: '#666' }}>Authorize Tavari to access your account</div>
            </div>

            {/* Permissions List */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '14px', color: '#333', marginBottom: '12px', fontWeight: '500' }}>
                Tavari will be able to:
              </div>
              <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.6' }}>
                • Upload videos to your TikTok account<br />
                • Schedule posts<br />
                • View your account information
              </div>
            </div>

            {/* Authorize Button */}
            <button
              onClick={handleConnect}
              style={{
                width: '100%',
                padding: '12px 24px',
                backgroundColor: '#000000',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              Authorize with TikTok
            </button>
          </div>
        </div>

        <div style={{ fontSize: '14px', color: '#666', textAlign: 'center' }}>
          Click "Authorize with TikTok" to redirect to TikTok and connect your account
        </div>
      </div>
    </div>
  );
};

export default TikTokOAuthModal;

