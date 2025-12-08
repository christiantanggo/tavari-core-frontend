// src/screens/HR/MilestoneCelebration.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { usePermissions } from '../../hooks/usePermissions';
import { useSecurityContext } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import toast from 'react-hot-toast';

const MilestoneCelebration = ({ employeeId, onCelebrationComplete }) => {
  const [pendingCelebrations, setPendingCelebrations] = useState([]);
  const [currentCelebration, setCurrentCelebration] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);

  // Security context
  const {
    recordAction,
    logSecurityEvent,
    checkRateLimit
  } = useSecurityContext({
    componentName: 'MilestoneCelebration',
    sensitiveComponent: false,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'low'
  });

  // Authentication
  const {
    selectedBusinessId,
    authUser,
    userRole,
    authLoading
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin', 'hr_admin'],
    requireBusiness: true,
    componentName: 'MilestoneCelebration'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Permission checks
  const canViewMilestones = hasAnyPermission([
    'hr.onboarding.view',
    'hr.milestones.view'
  ]) || hasElevatedPrivileges();

  const canSendCelebrations = hasPermission('hr.celebrations.send') || hasElevatedPrivileges();

  useEffect(() => {
    if (employeeId && selectedBusinessId && !authLoading && !permissionsLoading && canViewMilestones) {
      checkForPendingCelebrations();
    }
  }, [employeeId, selectedBusinessId, authLoading, permissionsLoading, canViewMilestones]);

  const checkForPendingCelebrations = async () => {
    if (!canViewMilestones) {
      console.log('User does not have permission to view milestones');
      return;
    }

    try {
      await logSecurityEvent('milestone_celebration_check', {
        action: 'check_pending_celebrations',
        employee_id: employeeId,
        business_id: selectedBusinessId
      }, 'low');

      const { data, error } = await supabase
        .rpc('get_employee_milestone_achievements', {
          p_employee_id: employeeId,
          p_business_id: selectedBusinessId
        });

      if (error) throw error;

      const pending = (data || []).filter(achievement => !achievement.celebration_sent);
      setPendingCelebrations(pending);

      if (pending.length > 0) {
        setCurrentCelebration(pending[0]);
        setShowModal(true);
        
        recordAction('view_pending_celebration', employeeId);
      }
    } catch (error) {
      console.error('Error checking for celebrations:', error);
      
      await logSecurityEvent('celebration_check_failed', {
        error_message: error.message,
        employee_id: employeeId,
        business_id: selectedBusinessId
      }, 'medium');
    }
  };

  const sendCelebration = async () => {
    if (!currentCelebration) return;

    if (!canSendCelebrations) {
      toast.error('You do not have permission to send celebrations');
      return;
    }

    // Rate limiting check
    const canProceed = await checkRateLimit('send_celebration', 10, 60);
    if (!canProceed) {
      toast.error('Too many celebration requests. Please wait a moment.');
      return;
    }

    try {
      setLoading(true);
      
      await logSecurityEvent('milestone_celebration_send', {
        action: 'send_milestone_celebration',
        employee_id: employeeId,
        business_id: selectedBusinessId,
        milestone_type: currentCelebration.milestone_type,
        sent_by: authUser?.id
      }, 'low');

      const { error } = await supabase
        .rpc('send_milestone_celebration', {
          p_employee_id: employeeId,
          p_business_id: selectedBusinessId,
          p_milestone_type: currentCelebration.milestone_type
        });

      if (error) throw error;

      // Remove current celebration from pending list
      const remainingCelebrations = pendingCelebrations.filter(
        c => c.milestone_type !== currentCelebration.milestone_type
      );
      setPendingCelebrations(remainingCelebrations);

      recordAction('celebration_sent', {
        employee_id: employeeId,
        milestone_type: currentCelebration.milestone_type
      });

      toast.success('Celebration sent successfully! 🎉');

      // Show next celebration or close modal
      if (remainingCelebrations.length > 0) {
        setCurrentCelebration(remainingCelebrations[0]);
      } else {
        setShowModal(false);
        setCurrentCelebration(null);
        if (onCelebrationComplete) {
          onCelebrationComplete();
        }
      }
    } catch (error) {
      console.error('Error sending celebration:', error);
      toast.error('Failed to send celebration');
      
      await logSecurityEvent('celebration_send_failed', {
        error_message: error.message,
        employee_id: employeeId,
        milestone_type: currentCelebration.milestone_type
      }, 'medium');
    } finally {
      setLoading(false);
    }
  };

  const skipCelebration = () => {
    if (!currentCelebration) return;

    recordAction('celebration_skipped', {
      employee_id: employeeId,
      milestone_type: currentCelebration.milestone_type
    });

    const remainingCelebrations = pendingCelebrations.filter(
      c => c.milestone_type !== currentCelebration.milestone_type
    );
    setPendingCelebrations(remainingCelebrations);

    if (remainingCelebrations.length > 0) {
      setCurrentCelebration(remainingCelebrations[0]);
    } else {
      setShowModal(false);
      setCurrentCelebration(null);
      if (onCelebrationComplete) {
        onCelebrationComplete();
      }
    }
  };

  const getBadgeIcon = (badge) => {
    const badgeIcons = {
      'orientation-complete': '🎓',
      'first-week-champion': '⭐',
      'essentials-master': '💪',
      'quarter-achiever': '🏆',
      'halfway-hero': '🚀',
      'almost-there': '🎯',
      'onboarding-graduate': '🏅'
    };
    return badgeIcons[badge] || '🏆';
  };

  const getCelebrationAnimation = () => {
    return (
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="celebration-confetti">
          <div className="confetti-piece" style={{ left: '10%', animationDelay: '0s' }}>🎉</div>
          <div className="confetti-piece" style={{ left: '20%', animationDelay: '0.1s' }}>⭐</div>
          <div className="confetti-piece" style={{ left: '30%', animationDelay: '0.2s' }}>🎊</div>
          <div className="confetti-piece" style={{ left: '40%', animationDelay: '0.3s' }}>✨</div>
          <div className="confetti-piece" style={{ left: '50%', animationDelay: '0.4s' }}>🎉</div>
          <div className="confetti-piece" style={{ left: '60%', animationDelay: '0.5s' }}>⭐</div>
          <div className="confetti-piece" style={{ left: '70%', animationDelay: '0.6s' }}>🎊</div>
          <div className="confetti-piece" style={{ left: '80%', animationDelay: '0.7s' }}>✨</div>
          <div className="confetti-piece" style={{ left: '90%', animationDelay: '0.8s' }}>🎉</div>
        </div>
      </div>
    );
  };

  // Don't render if user doesn't have permission
  if (!canViewMilestones) {
    return null;
  }

  if (!showModal || !currentCelebration) {
    return null;
  }

  return (
    <>
      <style jsx>{`
        @keyframes confetti-fall {
          0% {
            transform: translateY(-100vh) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotate(720deg);
            opacity: 0;
          }
        }
        
        @keyframes bounce {
          0%, 20%, 60%, 100% {
            transform: translateY(0);
          }
          40% {
            transform: translateY(-30px);
          }
          80% {
            transform: translateY(-15px);
          }
        }
        
        .confetti-piece {
          position: absolute;
          font-size: 1.5rem;
          animation: confetti-fall 3s linear infinite;
        }
        
        .celebration-badge {
          animation: bounce 2s infinite;
        }
      `}</style>
      
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="relative bg-white rounded-lg p-8 max-w-md w-full mx-4 text-center overflow-hidden">
          {getCelebrationAnimation()}
          
          <div className="relative z-10">
            <div className="celebration-badge text-6xl mb-4">
              {getBadgeIcon(currentCelebration.achievement_badge)}
            </div>
            
            <h2 className="text-3xl font-bold text-gray-900 mb-2">
              Congratulations!
            </h2>
            
            <h3 className="text-xl font-semibold text-teal-600 mb-4">
              {currentCelebration.milestone_type.replace('-', ' ').toUpperCase()}
            </h3>
            
            <p className="text-gray-600 mb-6 leading-relaxed">
              {currentCelebration.recognition_message}
            </p>
            
            {currentCelebration.milestone_percentage && (
              <div className="mb-6">
                <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                  <div
                    className="bg-gradient-to-r from-teal-500 to-blue-500 h-2 rounded-full transition-all duration-1000"
                    style={{ width: `${currentCelebration.milestone_percentage}%` }}
                  />
                </div>
                <p className="text-sm text-gray-500">
                  {currentCelebration.milestone_percentage}% Complete
                </p>
              </div>
            )}
            
            {pendingCelebrations.length > 1 && (
              <p className="text-xs text-gray-500 mb-4">
                {pendingCelebrations.length - 1} more celebration{pendingCelebrations.length > 2 ? 's' : ''} pending
              </p>
            )}
            
            <div className="flex space-x-3">
              {canSendCelebrations ? (
                <button
                  onClick={sendCelebration}
                  disabled={loading}
                  className="flex-1 bg-gradient-to-r from-teal-600 to-blue-600 text-white py-3 px-6 rounded-lg hover:from-teal-700 hover:to-blue-700 transition-all duration-200 font-semibold disabled:opacity-50"
                >
                  {loading ? (
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Celebrating...
                    </div>
                  ) : (
                    'Send Celebration 🎉'
                  )}
                </button>
              ) : (
                <div className="flex-1 bg-gray-300 text-gray-600 py-3 px-6 rounded-lg font-semibold cursor-not-allowed">
                  No Permission to Send
                </div>
              )}
              
              <button
                onClick={skipCelebration}
                disabled={loading}
                className="flex-1 bg-gray-300 text-gray-700 py-3 px-6 rounded-lg hover:bg-gray-400 transition-colors font-semibold disabled:opacity-50"
              >
                Skip for Now
              </button>
            </div>
            
            <div className="mt-4 text-xs text-gray-400">
              Achievement earned {new Date(currentCelebration.achieved_at).toLocaleDateString()}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default MilestoneCelebration;