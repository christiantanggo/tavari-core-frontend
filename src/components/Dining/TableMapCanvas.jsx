// C:\TAVARI-FULL-PROJECT\tavari-core-frontend\src\components\Dining\TableMapCanvas.jsx
import React, { useState, useRef, useEffect } from 'react';
import { TavariStyles } from '../../utils/TavariStyles';
import Table from './Table';
import StaticObject from './StaticObject';

const TableMapCanvas = ({ 
  tables, 
  staticObjects = [],
  floorPlan, 
  activeOrders, 
  onTableClick, 
  onObjectClick,
  getTableStatus,
  readonly = false,
  onTableMove = null,
  onObjectMove = null
}) => {
  const canvasRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1200, height: 800 });
  const [draggingTable, setDraggingTable] = useState(null);
  const [draggingObject, setDraggingObject] = useState(null);
  const [resizingTable, setResizingTable] = useState(null);
  const [resizingObject, setResizingObject] = useState(null);
  const [resizeHandle, setResizeHandle] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });

  useEffect(() => {
    if (floorPlan) {
      setCanvasSize({
        width: floorPlan.canvas_width || 1200,
        height: floorPlan.canvas_height || 800
      });
    }
  }, [floorPlan]);

  const handleTableMouseDown = (e, table, handle = null) => {
    if (readonly) return;
    e.stopPropagation();
    
    const rect = canvasRef.current.getBoundingClientRect();
    
    if (handle) {
      // Resize mode
      setResizingTable(table);
      setResizeHandle(handle);
      setResizeStart({
        x: e.clientX,
        y: e.clientY,
        width: table.width || 100,
        height: table.height || 100,
        posX: table.position_x,
        posY: table.position_y
      });
    } else {
      // Drag mode
      const offsetX = e.clientX - rect.left - table.position_x;
      const offsetY = e.clientY - rect.top - table.position_y;
      
      setDraggingTable(table);
      setDragOffset({ x: offsetX, y: offsetY });
    }
  };

  const handleObjectMouseDown = (e, object, handle = null) => {
    if (readonly) return;
    e.stopPropagation();
    
    const rect = canvasRef.current.getBoundingClientRect();
    
    if (handle) {
      // Resize mode
      setResizingObject(object);
      setResizeHandle(handle);
      setResizeStart({
        x: e.clientX,
        y: e.clientY,
        width: object.width,
        height: object.height,
        posX: object.position_x,
        posY: object.position_y
      });
    } else {
      // Drag mode
      const offsetX = e.clientX - rect.left - object.position_x;
      const offsetY = e.clientY - rect.top - object.position_y;
      
      setDraggingObject(object);
      setDragOffset({ x: offsetX, y: offsetY });
    }
  };

  const handleMouseMove = (e) => {
    if (readonly) return;
    
    const rect = canvasRef.current.getBoundingClientRect();

    // Handle table dragging
    if (draggingTable) {
      const newX = Math.max(0, Math.min(e.clientX - rect.left - dragOffset.x, canvasSize.width - (draggingTable.width || 100)));
      const newY = Math.max(0, Math.min(e.clientY - rect.top - dragOffset.y, canvasSize.height - (draggingTable.height || 100)));
      
      setDraggingTable({
        ...draggingTable,
        position_x: newX,
        position_y: newY
      });
    }

    // Handle object dragging
    if (draggingObject) {
      const newX = Math.max(0, Math.min(e.clientX - rect.left - dragOffset.x, canvasSize.width - draggingObject.width));
      const newY = Math.max(0, Math.min(e.clientY - rect.top - dragOffset.y, canvasSize.height - draggingObject.height));
      
      setDraggingObject({
        ...draggingObject,
        position_x: newX,
        position_y: newY
      });
    }

    // Handle table resizing
    if (resizingTable && resizeHandle) {
      const deltaX = e.clientX - resizeStart.x;
      const deltaY = e.clientY - resizeStart.y;
      
      let newWidth = resizeStart.width;
      let newHeight = resizeStart.height;
      let newX = resizeStart.posX;
      let newY = resizeStart.posY;

      switch (resizeHandle) {
        case 'se': // Southeast (bottom-right)
          newWidth = Math.max(60, Math.min(resizeStart.width + deltaX, canvasSize.width - resizeStart.posX));
          newHeight = Math.max(60, Math.min(resizeStart.height + deltaY, canvasSize.height - resizeStart.posY));
          break;
        case 'sw': // Southwest (bottom-left)
          newWidth = Math.max(60, resizeStart.width - deltaX);
          newHeight = Math.max(60, Math.min(resizeStart.height + deltaY, canvasSize.height - resizeStart.posY));
          newX = Math.min(resizeStart.posX + deltaX, resizeStart.posX + resizeStart.width - 60);
          break;
        case 'ne': // Northeast (top-right)
          newWidth = Math.max(60, Math.min(resizeStart.width + deltaX, canvasSize.width - resizeStart.posX));
          newHeight = Math.max(60, resizeStart.height - deltaY);
          newY = Math.min(resizeStart.posY + deltaY, resizeStart.posY + resizeStart.height - 60);
          break;
        case 'nw': // Northwest (top-left)
          newWidth = Math.max(60, resizeStart.width - deltaX);
          newHeight = Math.max(60, resizeStart.height - deltaY);
          newX = Math.min(resizeStart.posX + deltaX, resizeStart.posX + resizeStart.width - 60);
          newY = Math.min(resizeStart.posY + deltaY, resizeStart.posY + resizeStart.height - 60);
          break;
      }

      setResizingTable({
        ...resizingTable,
        width: newWidth,
        height: newHeight,
        position_x: newX,
        position_y: newY
      });
    }

    // Handle object resizing
    if (resizingObject && resizeHandle) {
      const deltaX = e.clientX - resizeStart.x;
      const deltaY = e.clientY - resizeStart.y;
      
      let newWidth = resizeStart.width;
      let newHeight = resizeStart.height;
      let newX = resizeStart.posX;
      let newY = resizeStart.posY;

      switch (resizeHandle) {
        case 'se':
          newWidth = Math.max(40, Math.min(resizeStart.width + deltaX, canvasSize.width - resizeStart.posX));
          newHeight = Math.max(40, Math.min(resizeStart.height + deltaY, canvasSize.height - resizeStart.posY));
          break;
        case 'sw':
          newWidth = Math.max(40, resizeStart.width - deltaX);
          newHeight = Math.max(40, Math.min(resizeStart.height + deltaY, canvasSize.height - resizeStart.posY));
          newX = Math.min(resizeStart.posX + deltaX, resizeStart.posX + resizeStart.width - 40);
          break;
        case 'ne':
          newWidth = Math.max(40, Math.min(resizeStart.width + deltaX, canvasSize.width - resizeStart.posX));
          newHeight = Math.max(40, resizeStart.height - deltaY);
          newY = Math.min(resizeStart.posY + deltaY, resizeStart.posY + resizeStart.height - 40);
          break;
        case 'nw':
          newWidth = Math.max(40, resizeStart.width - deltaX);
          newHeight = Math.max(40, resizeStart.height - deltaY);
          newX = Math.min(resizeStart.posX + deltaX, resizeStart.posX + resizeStart.width - 40);
          newY = Math.min(resizeStart.posY + deltaY, resizeStart.posY + resizeStart.height - 40);
          break;
        case 'e':
          newWidth = Math.max(40, Math.min(resizeStart.width + deltaX, canvasSize.width - resizeStart.posX));
          break;
        case 'w':
          newWidth = Math.max(40, resizeStart.width - deltaX);
          newX = Math.min(resizeStart.posX + deltaX, resizeStart.posX + resizeStart.width - 40);
          break;
        case 'n':
          newHeight = Math.max(40, resizeStart.height - deltaY);
          newY = Math.min(resizeStart.posY + deltaY, resizeStart.posY + resizeStart.height - 40);
          break;
        case 's':
          newHeight = Math.max(40, Math.min(resizeStart.height + deltaY, canvasSize.height - resizeStart.posY));
          break;
      }

      setResizingObject({
        ...resizingObject,
        width: newWidth,
        height: newHeight,
        position_x: newX,
        position_y: newY
      });
    }
  };

  const handleMouseUp = () => {
    if (draggingTable && onTableMove) {
      onTableMove(draggingTable);
    }
    if (resizingTable && onTableMove) {
      onTableMove(resizingTable);
    }
    if (draggingObject && onObjectMove) {
      onObjectMove(draggingObject);
    }
    if (resizingObject && onObjectMove) {
      onObjectMove(resizingObject);
    }
    
    setDraggingTable(null);
    setResizingTable(null);
    setDraggingObject(null);
    setResizingObject(null);
    setResizeHandle(null);
    setDragOffset({ x: 0, y: 0 });
  };

  const getTableOrder = (table) => {
    return activeOrders.find(order => order.table_id === table.id);
  };

  const renderTables = () => {
    const tablesToRender = draggingTable
      ? tables.map(t => t.id === draggingTable.id ? draggingTable : t)
      : resizingTable
      ? tables.map(t => t.id === resizingTable.id ? resizingTable : t)
      : tables;

    return tablesToRender.map((table) => {
      const status = getTableStatus(table);
      const order = getTableOrder(table);
      const isDragging = draggingTable?.id === table.id;
      const isResizing = resizingTable?.id === table.id;

      return (
        <Table
          key={table.id}
          table={table}
          status={status}
          order={order}
          isDragging={isDragging}
          isResizing={isResizing}
          readonly={readonly}
          onClick={() => !isDragging && !isResizing && onTableClick(table)}
          onMouseDown={(e, handle) => handleTableMouseDown(e, table, handle)}
        />
      );
    });
  };

  const renderStaticObjects = () => {
    const objectsToRender = draggingObject
      ? staticObjects.map(o => o.id === draggingObject.id ? draggingObject : o)
      : resizingObject
      ? staticObjects.map(o => o.id === resizingObject.id ? resizingObject : o)
      : staticObjects;

    return objectsToRender.map((obj) => {
      const isDragging = draggingObject?.id === obj.id;
      const isResizing = resizingObject?.id === obj.id;

      return (
        <StaticObject
          key={obj.id}
          object={obj}
          isDragging={isDragging}
          isResizing={isResizing}
          readonly={readonly}
          onClick={() => !isDragging && !isResizing && onObjectClick && onObjectClick(obj)}
          onMouseDown={(e, handle) => handleObjectMouseDown(e, obj, handle)}
        />
      );
    });
  };

  return (
    <div
      ref={canvasRef}
      style={{
        ...styles.canvas,
        width: canvasSize.width,
        height: canvasSize.height,
        cursor: draggingTable || draggingObject ? 'grabbing' : 'default'
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div style={styles.grid} />
      
      {/* Render static objects first (background layer) */}
      {renderStaticObjects()}
      
      {/* Render tables on top */}
      {renderTables()}
      
      {floorPlan?.name && (
        <div style={styles.floorLabel}>
          {floorPlan.name}
        </div>
      )}
    </div>
  );
};

const styles = {
  canvas: {
    position: 'relative',
    backgroundColor: '#fafafa',
    backgroundImage: `
      linear-gradient(rgba(0,0,0,0.02) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0,0,0,0.02) 1px, transparent 1px)
    `,
    backgroundSize: '20px 20px',
    margin: '20px auto',
    border: '2px solid #e0e0e0',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    overflow: 'hidden'
  },
  grid: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none'
  },
  floorLabel: {
    position: 'absolute',
    top: '16px',
    left: '16px',
    padding: '8px 16px',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    color: '#333',
    border: '1px solid #ddd',
    pointerEvents: 'none',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  }
};

export default TableMapCanvas;