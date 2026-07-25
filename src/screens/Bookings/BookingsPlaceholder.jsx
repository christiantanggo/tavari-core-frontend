// src/screens/Bookings/BookingsPlaceholder.jsx
// Placeholder screen for the Bookings module (not yet implemented)
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FiCalendar, FiClock } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';

const BookingsPlaceholder = () => {
  const navigate = useNavigate();

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '80vh',
      padding: '40px',
      textAlign: 'center'
    }}>
      <div style={{
        fontSize: '64px',
        marginBottom: '20px',
        color: TavariStyles.colors.primary
      }}>
        <FiCalendar />
      </div>
      
      <h1 style={{
        fontSize: '33px',
        fontWeight: '600',
        color: TavariStyles.colors.gray900,
        marginBottom: '16px'
      }}>
        Tavari Bookings
      </h1>
      
      <p style={{
        fontSize: '18px',
        color: TavariStyles.colors.gray600,
        marginBottom: '32px',
        maxWidth: '600px'
      }}>
        The Bookings module is currently under development. This feature will allow you to manage activity bookings, party reservations, and appointment scheduling.
      </p>
      
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        color: TavariStyles.colors.gray500,
        fontSize: '14px',
        marginTop: '20px'
      }}>
        <FiClock />
        <span>Coming Soon</span>
      </div>
      
      <button
        onClick={() => navigate('/dashboard/home')}
        style={{
          marginTop: '32px',
          padding: '12px 24px',
          backgroundColor: TavariStyles.colors.primary,
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          fontSize: '16px',
          fontWeight: '600',
          cursor: 'pointer',
          transition: 'background-color 0.2s'
        }}
        onMouseOver={(e) => {
          e.target.style.backgroundColor = TavariStyles.colors.primaryDark || '#0d9488';
        }}
        onMouseOut={(e) => {
          e.target.style.backgroundColor = TavariStyles.colors.primary;
        }}
      >
        Return to Dashboard
      </button>
    </div>
  );
};

export default BookingsPlaceholder;

