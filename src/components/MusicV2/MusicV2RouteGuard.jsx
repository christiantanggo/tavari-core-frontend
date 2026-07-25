// components/MusicV2/MusicV2RouteGuard.jsx
// Route guard that checks Music V2 feature flag and routes accordingly

import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useBusiness } from '../../contexts/BusinessContext';
import { isMusicV2Enabled } from '../../utils/musicV2FeatureFlag';

/**
 * Route guard component that redirects to appropriate music system
 * based on feature flag
 */
const MusicV2RouteGuard = ({ children }) => {
  const { business } = useBusiness();
  const location = useLocation();
  const [isEnabled, setIsEnabled] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkFeatureFlag = async () => {
      if (!business?.id) {
        setLoading(false);
        return;
      }

      try {
        const enabled = await isMusicV2Enabled(business.id);
        setIsEnabled(enabled);
      } catch (error) {
        console.error('Error checking Music V2 feature flag:', error);
        setIsEnabled(false);
      } finally {
        setLoading(false);
      }
    };

    checkFeatureFlag();
  }, [business?.id]);

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        <div>Loading...</div>
      </div>
    );
  }

  // If Music V2 is enabled, show the component
  if (isEnabled) {
    return children;
  }

  // Otherwise, redirect to old music system
  // Map music-v2 routes to music routes
  const oldPath = location.pathname.replace('/music-v2/', '/music/');
  return <Navigate to={oldPath} replace />;
};

export default MusicV2RouteGuard;


