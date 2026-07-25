// components/HR/EmployeeCard.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { hasHRPermission, HR_PERMISSIONS, canViewEmployee, canEditEmployee, canViewEmployeeWage } from '../../utils/hrPermissions';
import PositionLabel from './PositionLabel';

const EmployeeCard = ({ 
  employee, 
  userContext, 
  size = 'medium', 
  showActions = true, 
  showWage = true, 
  onClick = null,
  className = '',
  style = {},
  variant = 'default'
}) => {
  const navigate = useNavigate();

  // Employee display helpers
  const getEmployeeDisplayName = (emp) => {
    if (emp.first_name && emp.last_name) {
      return `${emp.first_name} ${emp.last_name}`;
    }
    if (emp.full_name) {
      return emp.full_name;
    }
    return 'Unknown Employee';
  };

  const calculateTenure = (emp) => {
    const hireDate = emp.hire_date || emp.start_date;
    if (!hireDate) return '';
    
    const hire = new Date(hireDate);
    const endDate = emp.termination_date ? new Date(emp.termination_date) : new Date();
    const diffTime = Math.abs(endDate - hire);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 30) return `${diffDays} day${diffDays !== 1 ? 's' : ''}`;
    if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} month${months !== 1 ? 's' : ''}`;
    }
    const years = Math.floor(diffDays / 365);
    const remainingMonths = Math.floor((diffDays % 365) / 30);
    if (remainingMonths > 0) {
      return `${years} year${years !== 1 ? 's' : ''}, ${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`;
    }
    return `${years} year${years !== 1 ? 's' : ''}`;
  };

  const getStatusBadgeStyle = (status) => {
    switch (status) {
      case 'active':
        return { backgroundColor: '#dcfce7', color: '#166534', borderColor: '#bbf7d0' };
      case 'terminated':
        return { backgroundColor: '#fee2e2', color: '#991b1b', borderColor: '#fecaca' };
      case 'on_leave':
        return { backgroundColor: '#fef3c7', color: '#92400e', borderColor: '#fde68a' };
      case 'suspended':
        return { backgroundColor: '#fed7aa', color: '#c2410c', borderColor: '#fdba74' };
      case 'probation':
        return { backgroundColor: '#fef2f2', color: '#b91c1c', borderColor: '#fecaca' };
      default:
        return { backgroundColor: '#f3f4f6', color: '#374151', borderColor: '#d1d5db' };
    }
  };

  const getRoleColor = (role) => {
    switch (role?.toLowerCase()) {
      case 'owner':
        return '#dc2626';
      case 'admin':
        return '#7c2d12';
      case 'manager':
        return '#0369a1';
      case 'employee':
        return '#059669';
      default:
        return '#6b7280';
    }
  };

  const formatHireDate = (emp) => {
    const hireDate = emp.hire_date || emp.start_date;
    if (!hireDate) return 'No hire date';
    
    const date = new Date(hireDate);
    const formatted = date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
    
    const isTerminated = emp.employment_status === 'terminated' || emp.termination_date;
    return isTerminated 
      ? `${formatted} - ${emp.termination_date ? new Date(emp.termination_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Terminated'}`
      : formatted;
  };

  const formatWage = (wage) => {
    if (!wage) return null;
    return `$${parseFloat(wage).toFixed(2)}/hr`;
  };

  // Permission checks
  const canView = canViewEmployee(userContext, employee.id);
  const canEdit = canEditEmployee(userContext, employee.id);
  const canViewWage = showWage && canViewEmployeeWage(userContext, employee.id);
  const isOwnProfile = userContext?.user?.id === employee.id;

  // Processed employee data
  const displayName = getEmployeeDisplayName(employee);
  const tenure = calculateTenure(employee);
  const currentStatus = employee.employment_status || employee.status || 'active';
  const statusStyle = getStatusBadgeStyle(currentStatus);
  const systemRole = employee.business_users?.[0]?.role || employee.role || 'employee';
  const roleColor = getRoleColor(systemRole);
  const wageDisplay = formatWage(employee.wage);

  // Handle card click
  const handleCardClick = (e) => {
    if (onClick) {
      onClick(employee, e);
    } else if (canView) {
      navigate(`/dashboard/hr/employee/${employee.id}`);
    }
  };

  // Handle action buttons
  const handleViewProfile = (e) => {
    e.stopPropagation();
    navigate(`/dashboard/hr/employee/${employee.id}`);
  };

  const handleEditEmployee = (e) => {
    e.stopPropagation();
    navigate(`/dashboard/hr/employee/${employee.id}/edit`);
  };

  // Size configurations
  const sizeConfig = {
    small: {
      padding: '16px',
      fontSize: '14px',
      nameSize: '16px',
      showDetails: false,
      showTenure: false,
      showManager: false
    },
    medium: {
      padding: '20px',
      fontSize: '14px',
      nameSize: '18px',
      showDetails: true,
      showTenure: true,
      showManager: true
    },
    large: {
      padding: '24px',
      fontSize: '16px',
      nameSize: '20px',
      showDetails: true,
      showTenure: true,
      showManager: true
    }
  };

  const config = sizeConfig[size] || sizeConfig.medium;

  // Variant styles
  const variantStyles = {
    default: {
      backgroundColor: 'white',
      border: '1px solid #e5e7eb',
      boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
    },
    compact: {
      backgroundColor: 'white',
      border: '1px solid #e5e7eb',
      boxShadow: 'none'
    },
    highlighted: {
      backgroundColor: 'white',
      border: '2px solid #14B8A6',
      boxShadow: '0 4px 12px 0 rgba(20, 184, 166, 0.15)'
    },
    minimal: {
      backgroundColor: '#f9fafb',
      border: '1px solid #f3f4f6',
      boxShadow: 'none'
    }
  };

  const cardStyle = {
    ...variantStyles[variant],
    padding: config.padding,
    borderRadius: '12px',
    cursor: (onClick || canView) ? 'pointer' : 'default',
    transition: 'all 0.2s ease',
    ...style
  };

  const handleMouseEnter = (e) => {
    if (onClick || canView) {
      if (variant === 'default') {
        e.currentTarget.style.boxShadow = '0 4px 12px 0 rgba(0, 0, 0, 0.15)';
      }
    }
  };

  const handleMouseLeave = (e) => {
    if (onClick || canView) {
      e.currentTarget.style.boxShadow = variantStyles[variant].boxShadow;
    }
  };

  return (
    <div
      className={`employee-card ${className}`}
      style={cardStyle}
      onClick={handleCardClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Header with Name and Status */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: config.showDetails ? '12px' : '8px',
        gap: '12px'
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{
            fontSize: config.nameSize,
            fontWeight: '600',
            color: '#111827',
            margin: '0 0 4px 0',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {displayName}
            {isOwnProfile && (
              <span style={{
                fontSize: '12px',
                fontWeight: '500',
                color: '#059669',
                marginLeft: '8px',
                backgroundColor: '#dcfce7',
                padding: '2px 8px',
                borderRadius: '12px'
              }}>
                You
              </span>
            )}
          </h3>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {employee.employee_number && (
              <p style={{
                fontSize: '12px',
                color: '#6b7280',
                margin: 0
              }}>
                #{employee.employee_number}
              </p>
            )}
            
            <span style={{
              fontSize: '12px',
              fontWeight: '600',
              color: roleColor,
              textTransform: 'capitalize'
            }}>
              {systemRole}
            </span>
          </div>
        </div>
        
        <span style={{
          ...statusStyle,
          padding: size === 'small' ? '4px 8px' : '6px 12px',
          borderRadius: '20px',
          fontSize: '12px',
          fontWeight: '600',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          border: `1px solid ${statusStyle.borderColor}`,
          textTransform: 'capitalize'
        }}>
          {currentStatus.replace('_', ' ')}
        </span>
      </div>

      {/* Employee Details */}
      {config.showDetails && (
        <div style={{ marginBottom: showActions ? '16px' : '0' }}>
          <p style={{
            fontSize: config.fontSize,
            color: '#111827',
            fontWeight: '500',
            margin: '0 0 6px 0'
          }}
          >
            <PositionLabel businessId={userContext?.businessId} value={employee.position} emptyFallback="—" />
          </p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {employee.department && (
              <p style={{
                fontSize: config.fontSize,
                color: '#6b7280',
                margin: 0
              }}>
                Department: {employee.department}
              </p>
            )}
            
            {employee.email && (
              <p style={{
                fontSize: config.fontSize,
                color: '#6b7280',
                margin: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }} title={employee.email}>
                {employee.email}
              </p>
            )}
            
            {employee.phone && (
              <p style={{
                fontSize: config.fontSize,
                color: '#6b7280',
                margin: 0
              }}>
                {employee.phone}
              </p>
            )}
            
            {config.showManager && employee.manager && (
              <p style={{
                fontSize: config.fontSize,
                color: '#6b7280',
                margin: 0
              }}>
                Reports to: {getEmployeeDisplayName(employee.manager)}
                {employee.manager.employee_number && ` (#${employee.manager.employee_number})`}
              </p>
            )}
            
            <p style={{
              fontSize: config.fontSize,
              color: '#6b7280',
              margin: 0
            }}>
              {formatHireDate(employee)}
              {config.showTenure && tenure && ` (${tenure})`}
            </p>
            
            {canViewWage && wageDisplay && (
              <p style={{
                fontSize: config.fontSize,
                color: '#16a34a',
                fontWeight: '500',
                margin: 0
              }}>
                {wageDisplay}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {showActions && canView && (
        <div style={{
          display: 'flex',
          gap: size === 'small' ? '6px' : '8px'
        }}>
          <button
            onClick={handleViewProfile}
            style={{
              flex: 1,
              padding: size === 'small' ? '8px 10px' : '10px 12px',
              fontSize: size === 'small' ? '13px' : '14px',
              backgroundColor: 'white',
              border: '2px solid #14B8A6',
              color: '#374151',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              fontWeight: '600',
              outline: 'none'
            }}
            onMouseOver={(e) => {
              e.target.style.backgroundColor = '#f0fdfa';
              e.target.style.color = '#0F766E';
            }}
            onMouseOut={(e) => {
              e.target.style.backgroundColor = 'white';
              e.target.style.color = '#374151';
            }}
          >
            View Profile
          </button>
          
          {canEdit && (
            <button
              onClick={handleEditEmployee}
              style={{
                flex: 1,
                padding: size === 'small' ? '8px 10px' : '10px 12px',
                fontSize: size === 'small' ? '13px' : '14px',
                backgroundColor: '#14B8A6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'background-color 0.2s ease',
                fontWeight: '600',
                outline: 'none'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#0F766E'}
              onMouseOut={(e) => e.target.style.backgroundColor = '#14B8A6'}
            >
              Edit
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// Skeleton loading component for EmployeeCard
export const EmployeeCardSkeleton = ({ size = 'medium', variant = 'default' }) => {
  const sizeConfig = {
    small: { padding: '16px' },
    medium: { padding: '20px' },
    large: { padding: '24px' }
  };

  const variantStyles = {
    default: {
      backgroundColor: 'white',
      border: '1px solid #e5e7eb'
    },
    compact: {
      backgroundColor: 'white',
      border: '1px solid #e5e7eb'
    },
    highlighted: {
      backgroundColor: 'white',
      border: '2px solid #e5e7eb'
    },
    minimal: {
      backgroundColor: '#f9fafb',
      border: '1px solid #f3f4f6'
    }
  };

  const config = sizeConfig[size] || sizeConfig.medium;

  return (
    <div style={{
      ...variantStyles[variant],
      padding: config.padding,
      borderRadius: '12px',
      animation: 'pulse 2s ease-in-out infinite'
    }}>
      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}
      </style>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ flex: 1 }}>
          <div style={{
            height: '20px',
            backgroundColor: '#e5e7eb',
            borderRadius: '4px',
            marginBottom: '4px',
            width: '60%'
          }}></div>
          <div style={{
            height: '14px',
            backgroundColor: '#f3f4f6',
            borderRadius: '4px',
            width: '40%'
          }}></div>
        </div>
        <div style={{
          width: '60px',
          height: '24px',
          backgroundColor: '#e5e7eb',
          borderRadius: '12px'
        }}></div>
      </div>
      
      <div style={{ marginBottom: '16px' }}>
        <div style={{
          height: '16px',
          backgroundColor: '#f3f4f6',
          borderRadius: '4px',
          marginBottom: '4px',
          width: '80%'
        }}></div>
        <div style={{
          height: '14px',
          backgroundColor: '#f3f4f6',
          borderRadius: '4px',
          marginBottom: '4px',
          width: '70%'
        }}></div>
        <div style={{
          height: '14px',
          backgroundColor: '#f3f4f6',
          borderRadius: '4px',
          width: '65%'
        }}></div>
      </div>
      
      <div style={{ display: 'flex', gap: '8px' }}>
        <div style={{
          flex: 1,
          height: '36px',
          backgroundColor: '#e5e7eb',
          borderRadius: '6px'
        }}></div>
        <div style={{
          flex: 1,
          height: '36px',
          backgroundColor: '#e5e7eb',
          borderRadius: '6px'
        }}></div>
      </div>
    </div>
  );
};

export default EmployeeCard;