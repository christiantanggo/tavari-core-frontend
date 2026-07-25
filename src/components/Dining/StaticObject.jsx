// C:\TAVARI-FULL-PROJECT\tavari-core-frontend\src\components\Dining\StaticObject.jsx
import React from 'react';

const StaticObject = ({ 
  object, 
  isDragging, 
  isResizing,
  readonly, 
  onClick, 
  onMouseDown 
}) => {
  const handleMouseDown = (e, handle = null) => {
    e.preventDefault();
    e.stopPropagation();
    onMouseDown(e, handle);
  };

  return (
    <div
      style={{
        ...styles.object,
        width: object.width,
        height: object.height,
        left: object.position_x,
        top: object.position_y,
        backgroundColor: object.color || '#8B4513',
        cursor: readonly ? 'default' : 'grab',
        opacity: isDragging || isResizing ? 0.7 : 1,
        transform: isDragging || isResizing ? 'scale(1.02)' : 'scale(1)',
        zIndex: object.z_index || 0,
        border: isResizing ? '2px dashed #008080' : '2px solid rgba(0,0,0,0.2)'
      }}
      onClick={onClick}
      onMouseDown={(e) => handleMouseDown(e)}
    >
      {/* Object Label */}
      <div style={styles.label}>
        {object.object_name}
      </div>

      {/* Resize Handles (only show when not readonly) */}
      {!readonly && (
        <>
          {/* Corner handles */}
          <div 
            style={{...styles.resizeHandle, ...styles.handleNW}} 
            onMouseDown={(e) => handleMouseDown(e, 'nw')}
          />
          <div 
            style={{...styles.resizeHandle, ...styles.handleNE}} 
            onMouseDown={(e) => handleMouseDown(e, 'ne')}
          />
          <div 
            style={{...styles.resizeHandle, ...styles.handleSE}} 
            onMouseDown={(e) => handleMouseDown(e, 'se')}
          />
          <div 
            style={{...styles.resizeHandle, ...styles.handleSW}} 
            onMouseDown={(e) => handleMouseDown(e, 'sw')}
          />

          {/* Edge handles */}
          <div 
            style={{...styles.resizeHandle, ...styles.handleN}} 
            onMouseDown={(e) => handleMouseDown(e, 'n')}
          />
          <div 
            style={{...styles.resizeHandle, ...styles.handleE}} 
            onMouseDown={(e) => handleMouseDown(e, 'e')}
          />
          <div 
            style={{...styles.resizeHandle, ...styles.handleS}} 
            onMouseDown={(e) => handleMouseDown(e, 's')}
          />
          <div 
            style={{...styles.resizeHandle, ...styles.handleW}} 
            onMouseDown={(e) => handleMouseDown(e, 'w')}
          />
        </>
      )}

      {/* Dimensions display */}
      <div style={styles.dimensions}>
        {object.width} × {object.height}
      </div>
    </div>
  );
};

const styles = {
  object: {
    position: 'absolute',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
    userSelect: 'none',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    borderRadius: '4px'
  },
  label: {
    color: '#fff',
    fontSize: '14px',
    fontWeight: 'bold',
    textAlign: 'center',
    textShadow: '1px 1px 2px rgba(0,0,0,0.5)',
    pointerEvents: 'none',
    padding: '4px'
  },
  dimensions: {
    position: 'absolute',
    bottom: '4px',
    right: '4px',
    fontSize: '10px',
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: '2px 6px',
    borderRadius: '3px',
    pointerEvents: 'none'
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
  },
  // Edge handles
  handleN: {
    top: '-5px',
    left: '50%',
    transform: 'translateX(-50%)',
    cursor: 'n-resize'
  },
  handleE: {
    right: '-5px',
    top: '50%',
    transform: 'translateY(-50%)',
    cursor: 'e-resize'
  },
  handleS: {
    bottom: '-5px',
    left: '50%',
    transform: 'translateX(-50%)',
    cursor: 's-resize'
  },
  handleW: {
    left: '-5px',
    top: '50%',
    transform: 'translateY(-50%)',
    cursor: 'w-resize'
  }
};

export default StaticObject;