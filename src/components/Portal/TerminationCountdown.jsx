// TerminationCountdown.jsx - Shows countdown to when terminated employee's access ends
import React, { useState, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';

const TerminationCountdown = ({ terminationDate }) => {
  const [timeRemaining, setTimeRemaining] = useState(null);

  useEffect(() => {
    if (!terminationDate) return;

    // Calculate access end date (7 years from termination)
    const termDate = new Date(terminationDate);
    const accessEndDate = new Date(termDate);
    accessEndDate.setFullYear(accessEndDate.getFullYear() + 7);

    const updateCountdown = () => {
      const now = new Date();
      const diff = accessEndDate - now;

      if (diff <= 0) {
        setTimeRemaining({ expired: true });
        return;
      }

      const years = Math.floor(diff / (1000 * 60 * 60 * 24 * 365));
      const months = Math.floor((diff % (1000 * 60 * 60 * 24 * 365)) / (1000 * 60 * 60 * 24 * 30));
      const days = Math.floor((diff % (1000 * 60 * 60 * 24 * 30)) / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      setTimeRemaining({
        years,
        months,
        days,
        hours,
        minutes,
        accessEndDate: accessEndDate.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      });
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [terminationDate]);

  if (!timeRemaining) return null;

  if (timeRemaining.expired) {
    return (
      <div style={{
        backgroundColor: TavariStyles.colors.danger + '15',
        border: `1px solid ${TavariStyles.colors.danger}`,
        borderRadius: TavariStyles.borderRadius?.md || '8px',
        padding: TavariStyles.spacing.md,
        marginBottom: TavariStyles.spacing.md,
        display: 'flex',
        alignItems: 'center',
        gap: TavariStyles.spacing.sm
      }}>
        <AlertCircle size={20} color={TavariStyles.colors.danger} />
        <div style={{ flex: 1 }}>
          <strong style={{ color: TavariStyles.colors.danger }}>
            Portal Access Expired
          </strong>
          <p style={{ margin: 0, fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray700 }}>
            Your portal access has expired. Please contact HR for assistance.
          </p>
        </div>
      </div>
    );
  }

  const timeParts = [];
  if (timeRemaining.years > 0) {
    timeParts.push(`${timeRemaining.years} year${timeRemaining.years !== 1 ? 's' : ''}`);
  }
  if (timeRemaining.months > 0) {
    timeParts.push(`${timeRemaining.months} month${timeRemaining.months !== 1 ? 's' : ''}`);
  }
  if (timeRemaining.days > 0 && timeParts.length < 2) {
    timeParts.push(`${timeRemaining.days} day${timeRemaining.days !== 1 ? 's' : ''}`);
  }
  if (timeRemaining.hours > 0 && timeParts.length < 2) {
    timeParts.push(`${timeRemaining.hours} hour${timeRemaining.hours !== 1 ? 's' : ''}`);
  }
  if (timeParts.length === 0) {
    timeParts.push(`${timeRemaining.minutes} minute${timeRemaining.minutes !== 1 ? 's' : ''}`);
  }

  const timeString = timeParts.join(', ');

  return (
    <div style={{
      backgroundColor: TavariStyles.colors.warning + '15',
      border: `1px solid ${TavariStyles.colors.warning}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      padding: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.md,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    }}>
      <AlertCircle size={20} color={TavariStyles.colors.warning} />
      <div style={{ flex: 1 }}>
        <strong style={{ color: TavariStyles.colors.warning }}>
          Terminated Employee Access
        </strong>
        <p style={{ margin: 0, fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray700 }}>
          Your portal access will expire in <strong>{timeString}</strong> (on {timeRemaining.accessEndDate}).
          You can only access your employee portal, not the main system.
        </p>
      </div>
    </div>
  );
};

export default TerminationCountdown;
















