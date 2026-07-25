// C:\TAVARI-FULL-PROJECT\tavari-core-frontend\src\components\Dining\Table.jsx
import React from 'react';
import { FiUsers, FiClock, FiDollarSign } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';

const Table = ({ 
  table, 
  status, 
  order, 
  isDragging,
  isResizing,
  readonly, 
  onClick, 
  onMouseDown 
}) => {
  const getStatusColor = () => {
    switch (status) {
      case 'available':
        return {
          bg: '#e8f5e9',
          border: '#4caf50',
          text: '#2e7d32'
        };
      case 'occupied':
        return {
          bg: '#fff3e0',
          border: '#ff9800',
          text: '#e65100'
        };
      case 'reserved':
        return {
          bg: '#e3f2fd',
          border: '#2196f3',
          text: '#0d47a1'
        };
      default:
        return {
          bg: TavariStyles.colors.gray100,
          border: TavariStyles.colors.gray400,
          text: TavariStyles.colors.gray700
        };
    }
  };

  const colors = getStatusColor();
  
  // Different shapes based on table type
  const getTableShape = () => {
    switch (table.shape || 'round') {
      case 'round':
        return { borderRadius: '50%' };
      case 'square':
        return { borderRadius: '8px' };
      case 'rectangle':
        return { 
          borderRadius: '8px'
        };
      default:
        return { borderRadius: '50%' };
    }
  };

  const formatCurrency = (amount) => {
    return `$${(amount || 0).toFixed(2)}`;
  };

  const getElapsedTime = () => {
    if (!order?.created_at) return null;
    const minutes = Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000);
    return `${minutes}m`;
  };

  const handleMouseDown = (e, handle = null) => {
    e.preventDefault();
    e.stopPropagation();
    onMouseDown(e, handle);
  };

  return (
    <div
      style={{
        ...styles.table,
        ...getTableShape(),
        backgroundColor: colors.bg,
        borderColor: colors.border,
        width: table.width || 100,
        height: table.height || 100,
        left: table.position_x,
        top: table.position_y,
        cursor: readonly ? 'pointer' : 'grab',
        opacity: isDragging || isResizing ? 0.7 : 1,
        transform: isDragging || isResizing ? 'scale(1.05)' : 'scale(1)',
        zIndex: isDragging || isResizing ? 1000 : table.z_index || 1,
        border: isResizing ? `3px dashed ${colors.border}` : `3px solid ${colors.border}`
      }}
      onClick={onClick}
      onMouseDown={(e) => handleMouseDown(e)}
    >
      {/* Table Number */}
      <div style={{...styles.tableNumber, color: colors.text}}>
        {table.table_number}
      </div>
      
      {/* Table Name */}
      {table.table_name && (
        <div style={{...styles.tableName, color: colors.text}}>
          {table.table_name}
        </div>
      )}
      
      {/* Capacity */}
      <div style={{...styles.capacity, color: colors.text}}>
        <FiUsers size={12} />
        <span>{table.capacity || 4}</span>
      </div>
      
      {/* Order Info (if occupied) */}
      {status === 'occupied' && order && (
        <div style={styles.orderInfo}>
          <div style={styles.orderDetail}>
            <FiClock size={10} />
            <span>{getElapsedTime()}</span>
          </div>
          <div style={styles.orderDetail}>
            <FiDollarSign size={10} />
            <span>{formatCurrency(order.subtotal)}</span>
          </div>
        </div>
      )}
      
      {/* Status Badge */}
      <div style={{
        ...styles.statusBadge,
        backgroundColor: colors.border,
        color: '#fff'
      }}>
        {status.toUpperCase()}
      </div>
      
      {/* Server Assignment */}
      {table.assigned_server_id && (
        <div style={{...styles.serverBadge, backgroundColor: colors.border}}>
          Server {table.assigned_server_id.slice(-3)}
        </div>
      )}

      {/* Resize Handles (only show when not readonly) */}
      {!readonly && (
        <>
          {/* Corner handles */}
          <div 
            style={{...styles.resizeHandle, ...styles.handleSE}} 
            onMouseDown={(e) => handleMouseDown(e, 'se')}
          />
          <div 
            style={{...styles.resizeHandle, ...styles.handleSW}} 
            onMouseDown={(e) => handleMouseDown(e, 'sw')}
          />
          <div 
            style={{...styles.resizeHandle, ...styles.handleNE}} 
            onMouseDown={(e) => handleMouseDown(e, 'ne')}
          />
          <div 
            style={{...styles.resizeHandle, ...styles.handleNW}} 
            onMouseDown={(e) => handleMouseDown(e, 'nw')}
          />
        </>
      )}
    </div>
  );
};

const styles = {
  table: {
    position: 'absolute',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
    userSelect: 'none',
    boxShadow: TavariStyles.shadows.md,
    padding: TavariStyles.spacing.sm,
    gap: '2px'
  },
  tableNumber: {
    fontSize: '25px',
    fontWeight: TavariStyles.typography.fontWeight.bold,
    lineHeight: '1'
  },
  tableName: {
    fontSize: '13px',
    fontWeight: TavariStyles.typography.fontWeight.medium,
    textAlign: 'center',
    lineHeight: '1'
  },
  capacity: {
    display: 'flex',
    alignItems: 'center',
    gap: '3px',
    fontSize: '13px',
    fontWeight: TavariStyles.typography.fontWeight.medium
  },
  orderInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    marginTop: '4px',
    width: '100%'
  },
  orderDetail: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    fontSize: '11px',
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: '#666'
  },
  statusBadge: {
    position: 'absolute',
    top: '-8px',
    right: '-8px',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: TavariStyles.typography.fontWeight.bold,
    letterSpacing: '0.5px',
    boxShadow: TavariStyles.shadows.sm
  },
  serverBadge: {
    position: 'absolute',
    bottom: '-8px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: '#fff',
    boxShadow: TavariStyles.shadows.sm,
    whiteSpace: 'nowrap'
  },
  resizeHandle: {
    position: 'absolute',
    width: '10px',
    height: '10px',
    backgroundColor: '#008080',
    border: '2px solid #fff',
    borderRadius: '50%',
    zIndex: 10
  },
  // Corner handles
  handleNW: {
    top: '-5px',
    left: '-5px',
    cursor: 'nw-resize'
  },
  handleNE: {
    top: '-5px',
    right: '-5px',
    cursor: 'ne-resize'
  },
  handleSE: {
    bottom: '-5px',
    right: '-5px',
    cursor: 'se-resize'
  },
  handleSW: {
    bottom: '-5px',
    left: '-5px',
    cursor: 'sw-resize'
  }
};

export default Table;