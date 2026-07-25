// src/layouts/VoiceOnlyLayout.jsx
// Layout for voice-only interface - includes HeaderBar but no SidebarNav
import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import HeaderBar from '../components/HeaderBar';

const VoiceOnlyLayout = () => {
  const navigate = useNavigate();

  return (
    <>
      <HeaderBar onLogoClick={() => navigate('/tavari-voice/dashboard')} />
      <div style={{ 
        width: '100%', 
        padding: '20px',
        paddingTop: '100px', // Extra padding to account for header height
        maxWidth: '100%',
        margin: '0 auto'
      }}>
        <Outlet />
      </div>
    </>
  );
};

export default VoiceOnlyLayout;

