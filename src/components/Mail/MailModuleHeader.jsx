import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiPlus } from 'react-icons/fi';
import { usePermissions } from '../../hooks/usePermissions';
import TavariModuleHeader from '../UI/TavariModuleHeader';

const MailModuleHeader = ({
  actionLabel = '+ Campaign',
  actionPath = '/dashboard/mail/builder'
}) => {
  const navigate = useNavigate();
  const { hasPermission, hasElevatedPrivileges } = usePermissions();

  const [emailSendingPaused, setEmailSendingPaused] = useState(() => {
    const stored = localStorage.getItem('EMAIL_SENDING_PAUSED');
    return stored ? JSON.parse(stored) : true;
  });

  const canCreateCampaigns = hasPermission('mail.campaigns.create') || hasElevatedPrivileges();

  useEffect(() => {
    const syncPauseState = () => {
      const stored = localStorage.getItem('EMAIL_SENDING_PAUSED');
      setEmailSendingPaused(stored ? JSON.parse(stored) : true);
    };

    window.addEventListener('storage', syncPauseState);
    window.addEventListener('emailPauseStateChanged', syncPauseState);

    return () => {
      window.removeEventListener('storage', syncPauseState);
      window.removeEventListener('emailPauseStateChanged', syncPauseState);
    };
  }, []);

  return (
    <TavariModuleHeader
      title="Tavari Email Marketing"
      description="Pay-per-email marketing with unlimited contacts"
      actionLabel={actionLabel}
      actionIcon={<FiPlus size={18} />}
      onAction={() => navigate(actionPath)}
      actionDisabled={emailSendingPaused || !canCreateCampaigns}
      actionButtonStyle={
        emailSendingPaused || !canCreateCampaigns
          ? {
              opacity: 0.65,
              cursor: 'not-allowed'
            }
          : {}
      }
    />
  );
};

export default MailModuleHeader;
