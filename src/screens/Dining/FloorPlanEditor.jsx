// screens/Dining/FloorPlanEditor.jsx - WITH NEW PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { TavariStyles } from '../../utils/TavariStyles';
import TableMapCanvas from '../../components/Dining/TableMapCanvas';
import { FiPlus, FiSave, FiTrash2, FiArrowLeft, FiSquare, FiCircle, FiUsers, FiLayers, FiBox, FiEdit2, FiLock } from 'react-icons/fi';
import toast from 'react-hot-toast';

const FloorPlanEditor = () => {
  const navigate = useNavigate();
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'FloorPlanEditor'
  });

  // NEW: Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    isOwner, 
    isManager,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  const [tables, setTables] = useState([]);
  const [staticObjects, setStaticObjects] = useState([]);
  const [floorPlan, setFloorPlan] = useState(null);
  const [sections, setSections] = useState([]);
  const [activeSection, setActiveSection] = useState(null);
  const [selectedTable, setSelectedTable] = useState(null);
  const [selectedObject, setSelectedObject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState('tables'); // 'tables' or 'objects'

  // New table form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTable, setNewTable] = useState({
    table_number: '',
    table_name: '',
    capacity: 4,
    shape: 'round',
    width: 100,
    height: 100,
    position_x: 50,
    position_y: 50,
    section_name: ''
  });

  // Edit table form
  const [editingTable, setEditingTable] = useState(null);
  const [editForm, setEditForm] = useState({});

  // New section form
  const [showAddSectionForm, setShowAddSectionForm] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');

  // New object form
  const [showAddObjectForm, setShowAddObjectForm] = useState(false);
  const [newObject, setNewObject] = useState({
    object_type: 'wall',
    label: '',
    width: 150,
    height: 20,
    position_x: 100,
    position_y: 100,
    color: '#cccccc'
  });

  // Permission checks
  const canEditFloorPlan = hasPermission('dining.floorplan.edit');
  const canAddTables = hasPermission('dining.tables.create');
  const canDeleteTables = hasPermission('dining.tables.delete');
  const canViewFloorPlan = hasPermission('dining.floorplan.view');

  // Check permissions on load
  useEffect(() => {
    if (!permissionsLoading && !canEditFloorPlan) {
      toast.error('You do not have permission to edit the floor plan');
      navigate('/dashboard/dining/table-map');
    }
  }, [permissionsLoading, canEditFloorPlan, navigate]);

  useEffect(() => {
    if (auth.selectedBusinessId && !permissionsLoading) {
      loadFloorPlan();
    }
  }, [auth.selectedBusinessId, permissionsLoading]);

  const loadFloorPlan = async () => {
    try {
      setLoading(true);
      
      let { data: planData, error: planError } = await supabase
        .from('dining_floor_plans')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .eq('is_active', true)
        .single();

      if (planError && planError.code === 'PGRST116') {
        const { data: newPlan, error: createError } = await supabase
          .from('dining_floor_plans')
          .insert([{
            business_id: auth.selectedBusinessId,
            name: 'Main Floor',
            canvas_width: 1200,
            canvas_height: 800,
            is_active: true
          }])
          .select()
          .single();

        if (createError) throw createError;
        planData = newPlan;
      } else if (planError) {
        throw planError;
      }

      const { data: tablesData, error: tablesError } = await supabase
        .from('dining_tables')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .order('table_number');

      if (tablesError) throw tablesError;

      const { data: objectsData, error: objectsError } = await supabase
        .from('dining_static_objects')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .order('created_at');

      if (objectsError) throw objectsError;

      setFloorPlan(planData);
      setTables(tablesData || []);
      setStaticObjects(objectsData || []);
      
      const uniqueSections = [...new Set(tablesData?.map(t => t.section_name).filter(Boolean))];
      setSections(uniqueSections.length > 0 ? uniqueSections : ['Main Dining']);
      if (uniqueSections.length > 0) {
        setActiveSection(uniqueSections[0]);
      } else {
        setActiveSection('Main Dining');
      }
      
    } catch (err) {
      console.error('Error loading floor plan:', err);
      toast.error('Error loading floor plan: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddSection = () => {
    if (!newSectionName.trim()) {
      toast.error('Please enter a section name');
      return;
    }
    if (sections.includes(newSectionName.trim())) {
      toast.error('This section already exists');
      return;
    }
    setSections([...sections, newSectionName.trim()]);
    setActiveSection(newSectionName.trim());
    setNewSectionName('');
    setShowAddSectionForm(false);
    toast.success('Section added successfully');
  };

  const handleDeleteSection = (sectionName) => {
    const tablesInSection = tables.filter(t => t.section_name === sectionName);
    if (tablesInSection.length > 0) {
      if (!confirm(`This section has ${tablesInSection.length} table(s). Delete anyway? Tables will be moved to "Main Dining".`)) {
        return;
      }
      tablesInSection.forEach(table => {
        handleUpdateTableSection(table.id, 'Main Dining');
      });
    }
    
    const newSections = sections.filter(s => s !== sectionName);
    setSections(newSections);
    setActiveSection(newSections[0] || 'Main Dining');
    toast.success('Section deleted');
  };

  const handleUpdateTableSection = async (tableId, newSection) => {
    try {
      const { error } = await supabase
        .from('dining_tables')
        .update({ section_name: newSection })
        .eq('id', tableId);

      if (error) throw error;

      setTables(tables.map(t => 
        t.id === tableId ? { ...t, section_name: newSection } : t
      ));
    } catch (err) {
      console.error('Error updating table section:', err);
      toast.error('Error updating table section');
    }
  };

  const handleAddTable = async () => {
    // Check permission
    if (!canAddTables) {
      toast.error('You do not have permission to add tables');
      return;
    }

    if (!newTable.table_number) {
      toast.error('Please enter a table number');
      return;
    }

    const capacity = parseInt(newTable.capacity) || 4;
    const width = parseInt(newTable.width) || 100;
    const height = parseInt(newTable.height) || 100;
    const position_x = parseInt(newTable.position_x) || 50;
    const position_y = parseInt(newTable.position_y) || 50;

    try {
      const tableData = {
        business_id: auth.selectedBusinessId,
        floor_plan_id: floorPlan.id,
        table_number: newTable.table_number,
        table_name: newTable.table_name,
        capacity: capacity,
        shape: newTable.shape,
        width: width,
        height: height,
        position_x: position_x,
        position_y: position_y,
        section_name: activeSection || 'Main Dining',
        z_index: 1
      };

      const { data, error } = await supabase
        .from('dining_tables')
        .insert([tableData])
        .select()
        .single();

      if (error) throw error;

      setTables([...tables, data]);
      setShowAddForm(false);
      setNewTable({
        table_number: '',
        table_name: '',
        capacity: 4,
        shape: 'round',
        width: 100,
        height: 100,
        position_x: 50,
        position_y: 50,
        section_name: ''
      });

      toast.success('Table added successfully!');
    } catch (err) {
      console.error('Error adding table:', err);
      toast.error('Error adding table: ' + err.message);
    }
  };

  const handleStartEdit = (table) => {
    setEditingTable(table.id);
    setEditForm({
      table_number: table.table_number,
      table_name: table.table_name || '',
      capacity: table.capacity,
      shape: table.shape
    });
  };

  const handleSaveEdit = async (tableId) => {
    try {
      const { error } = await supabase
        .from('dining_tables')
        .update({
          table_number: editForm.table_number,
          table_name: editForm.table_name,
          capacity: parseInt(editForm.capacity),
          shape: editForm.shape
        })
        .eq('id', tableId);

      if (error) throw error;

      setTables(tables.map(t => 
        t.id === tableId ? { ...t, ...editForm } : t
      ));
      setEditingTable(null);
      toast.success('Table updated successfully!');
    } catch (err) {
      console.error('Error updating table:', err);
      toast.error('Error updating table: ' + err.message);
    }
  };

  const handleCancelEdit = () => {
    setEditingTable(null);
    setEditForm({});
  };

  const handleAddObject = async () => {
    if (!newObject.object_type) {
      toast.error('Please select an object type');
      return;
    }

    try {
      const objectData = {
        business_id: auth.selectedBusinessId,
        floor_plan_id: floorPlan.id,
        object_type: newObject.object_type,
        label: newObject.label,
        width: parseInt(newObject.width),
        height: parseInt(newObject.height),
        position_x: parseInt(newObject.position_x),
        position_y: parseInt(newObject.position_y),
        color: newObject.color,
        z_index: 0
      };

      const { data, error } = await supabase
        .from('dining_static_objects')
        .insert([objectData])
        .select()
        .single();

      if (error) throw error;

      setStaticObjects([...staticObjects, data]);
      setShowAddObjectForm(false);
      setNewObject({
        object_type: 'wall',
        label: '',
        width: 150,
        height: 20,
        position_x: 100,
        position_y: 100,
        color: '#cccccc'
      });

      toast.success('Object added successfully!');
    } catch (err) {
      console.error('Error adding object:', err);
      toast.error('Error adding object: ' + err.message);
    }
  };

  const handleTableMove = async (movedTable) => {
    try {
      const { error } = await supabase
        .from('dining_tables')
        .update({
          position_x: Math.round(movedTable.position_x),
          position_y: Math.round(movedTable.position_y),
          width: Math.round(movedTable.width),
          height: Math.round(movedTable.height)
        })
        .eq('id', movedTable.id);

      if (error) throw error;

      setTables(tables.map(t => 
        t.id === movedTable.id ? movedTable : t
      ));
    } catch (err) {
      console.error('Error updating table position:', err);
      toast.error('Error updating table position');
    }
  };

  const handleObjectMove = async (movedObject) => {
    try {
      const { error } = await supabase
        .from('dining_static_objects')
        .update({
          position_x: Math.round(movedObject.position_x),
          position_y: Math.round(movedObject.position_y),
          width: Math.round(movedObject.width),
          height: Math.round(movedObject.height)
        })
        .eq('id', movedObject.id);

      if (error) throw error;

      setStaticObjects(staticObjects.map(o => 
        o.id === movedObject.id ? movedObject : o
      ));
    } catch (err) {
      console.error('Error updating object:', err);
      toast.error('Error updating object');
    }
  };

  const handleDeleteTable = async (tableId) => {
    // Check permission
    if (!canDeleteTables) {
      toast.error('You do not have permission to delete tables');
      return;
    }

    if (!confirm('Are you sure you want to delete this table?')) return;

    try {
      const { error } = await supabase
        .from('dining_tables')
        .delete()
        .eq('id', tableId);

      if (error) throw error;

      setTables(tables.filter(t => t.id !== tableId));
      setSelectedTable(null);
      toast.success('Table deleted successfully!');
    } catch (err) {
      console.error('Error deleting table:', err);
      toast.error('Error deleting table: ' + err.message);
    }
  };

  const handleDeleteObject = async (objectId) => {
    if (!confirm('Are you sure you want to delete this object?')) return;

    try {
      const { error } = await supabase
        .from('dining_static_objects')
        .delete()
        .eq('id', objectId);

      if (error) throw error;

      setStaticObjects(staticObjects.filter(o => o.id !== objectId));
      setSelectedObject(null);
      toast.success('Object deleted successfully!');
    } catch (err) {
      console.error('Error deleting object:', err);
      toast.error('Error deleting object: ' + err.message);
    }
  };

  const handleSaveLayout = async () => {
    setSaving(true);
    try {
      toast.success('Layout saved successfully!');
    } catch (err) {
      console.error('Error saving layout:', err);
      toast.error('Error saving layout');
    } finally {
      setSaving(false);
    }
  };

  const filteredTables = tables.filter(t => 
    !activeSection || t.section_name === activeSection
  );

  const filteredObjects = staticObjects.filter(o => 
    !activeSection || o.section_name === activeSection
  );

  // Loading state
  if (loading || permissionsLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>
          <div style={styles.loadingSpinner}></div>
          <p style={styles.loadingText}>Loading floor plan editor...</p>
        </div>
      </div>
    );
  }

  // No access screen
  if (!canEditFloorPlan) {
    return (
      <div style={styles.noAccessContainer}>
        <div style={styles.noAccessCard}>
          <FiLock size={64} style={styles.lockIcon} />
          <h2 style={styles.noAccessTitle}>Access Denied</h2>
          <p style={styles.noAccessText}>
            You do not have permission to edit the floor plan.
          </p>
          <div style={styles.permissionsRequired}>
            <strong>Required Permission:</strong> Edit Floor Plans
          </div>
          <button 
            style={styles.backButton}
            onClick={() => navigate('/dashboard/dining/table-map')}
          >
            Return to Table Map
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <button style={styles.backButton} onClick={() => navigate('/dashboard/dining/table-map')}>
          <FiArrowLeft /> Back to Table Map
        </button>
        <h1 style={styles.title}>Floor Plan Editor</h1>
        <button style={styles.saveButton} onClick={handleSaveLayout} disabled={saving}>
          <FiSave /> {saving ? 'Saving...' : 'Save Layout'}
        </button>
      </div>

      <div style={styles.content}>
        {/* Sidebar */}
        <div style={styles.sidebar}>
          {/* Edit Mode Selector */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Edit Mode</h3>
            <div style={styles.modeButtons}>
              <button
                style={{
                  ...styles.modeButton,
                  ...(editMode === 'tables' ? styles.modeButtonActive : {})
                }}
                onClick={() => setEditMode('tables')}
              >
                <FiUsers /> Tables
              </button>
              <button
                style={{
                  ...styles.modeButton,
                  ...(editMode === 'objects' ? styles.modeButtonActive : {})
                }}
                onClick={() => setEditMode('objects')}
              >
                <FiBox /> Objects
              </button>
            </div>
          </div>

          {/* Sections */}
          <div style={styles.section}>
            <div style={styles.sectionHeader}>
              <h3 style={styles.sectionTitle}>Sections</h3>
              <button
                style={styles.addButton}
                onClick={() => setShowAddSectionForm(!showAddSectionForm)}
              >
                <FiPlus />
              </button>
            </div>

            {showAddSectionForm && (
              <div style={styles.addForm}>
                <input
                  style={styles.input}
                  type="text"
                  placeholder="Section name"
                  value={newSectionName}
                  onChange={(e) => setNewSectionName(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddSection()}
                />
                <button style={styles.saveButton} onClick={handleAddSection}>Add</button>
              </div>
            )}

            <div style={styles.sectionList}>
              {sections.map(section => (
                <div
                  key={section}
                  style={{
                    ...styles.sectionItem,
                    ...(activeSection === section ? styles.sectionItemActive : {})
                  }}
                  onClick={() => setActiveSection(section)}
                >
                  <span>{section}</span>
                  {section !== 'Main Dining' && (
                    <button
                      style={styles.deleteButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSection(section);
                      }}
                    >
                      <FiTrash2 />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Tables Section */}
          {editMode === 'tables' && (
            <div style={styles.section}>
              <div style={styles.sectionHeader}>
                <h3 style={styles.sectionTitle}>Tables</h3>
                <PermissionGate 
                  permission="dining.tables.create"
                  fallback={
                    <button style={styles.addButtonDisabled} disabled title="No permission to add tables">
                      <FiLock size={14} />
                    </button>
                  }
                >
                  <button
                    style={styles.addButton}
                    onClick={() => setShowAddForm(!showAddForm)}
                  >
                    <FiPlus />
                  </button>
                </PermissionGate>
              </div>

              {showAddForm && canAddTables && (
                <div style={styles.addForm}>
                  <input
                    style={styles.input}
                    type="text"
                    placeholder="Table #"
                    value={newTable.table_number}
                    onChange={(e) => setNewTable({...newTable, table_number: e.target.value})}
                  />
                  <input
                    style={styles.input}
                    type="text"
                    placeholder="Table name (optional)"
                    value={newTable.table_name}
                    onChange={(e) => setNewTable({...newTable, table_name: e.target.value})}
                  />
                  <input
                    style={styles.input}
                    type="number"
                    placeholder="Capacity"
                    value={newTable.capacity}
                    onChange={(e) => setNewTable({...newTable, capacity: e.target.value})}
                  />
                  <select
                    style={styles.input}
                    value={newTable.shape}
                    onChange={(e) => setNewTable({...newTable, shape: e.target.value})}
                  >
                    <option value="round">Round</option>
                    <option value="square">Square</option>
                    <option value="rectangle">Rectangle</option>
                  </select>
                  <button style={styles.saveButton} onClick={handleAddTable}>Add Table</button>
                </div>
              )}

              <div style={styles.tableList}>
                {filteredTables.map(table => (
                  <div key={table.id} style={styles.tableItem}>
                    {editingTable === table.id ? (
                      <div style={styles.editForm}>
                        <input
                          style={styles.input}
                          type="text"
                          value={editForm.table_number}
                          onChange={(e) => setEditForm({...editForm, table_number: e.target.value})}
                        />
                        <input
                          style={styles.input}
                          type="text"
                          placeholder="Name"
                          value={editForm.table_name}
                          onChange={(e) => setEditForm({...editForm, table_name: e.target.value})}
                        />
                        <input
                          style={styles.input}
                          type="number"
                          value={editForm.capacity}
                          onChange={(e) => setEditForm({...editForm, capacity: e.target.value})}
                        />
                        <div style={styles.editFormActions}>
                          <button style={styles.saveEditButton} onClick={() => handleSaveEdit(table.id)}>
                            Save
                          </button>
                          <button style={styles.cancelEditButton} onClick={handleCancelEdit}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={styles.tableItemInfo}>
                          <div style={styles.tableItemNumber}>Table {table.table_number}</div>
                          {table.table_name && (
                            <div style={styles.tableItemName}>{table.table_name}</div>
                          )}
                          <div style={styles.tableItemCapacity}>
                            <FiUsers size={12} /> {table.capacity} seats
                          </div>
                        </div>
                        <div style={styles.tableItemActions}>
                          <button style={styles.editButton} onClick={() => handleStartEdit(table)}>
                            <FiEdit2 />
                          </button>
                          <PermissionGate 
                            permission="dining.tables.delete"
                            fallback={
                              <button style={{...styles.deleteButton, opacity: 0.3}} disabled title="No permission to delete">
                                <FiLock size={14} />
                              </button>
                            }
                          >
                            <button style={styles.deleteButton} onClick={() => handleDeleteTable(table.id)}>
                              <FiTrash2 />
                            </button>
                          </PermissionGate>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Objects Section */}
          {editMode === 'objects' && (
            <div style={styles.section}>
              <div style={styles.sectionHeader}>
                <h3 style={styles.sectionTitle}>Objects</h3>
                <button
                  style={styles.addButton}
                  onClick={() => setShowAddObjectForm(!showAddObjectForm)}
                >
                  <FiPlus />
                </button>
              </div>

              {showAddObjectForm && (
                <div style={styles.addForm}>
                  <select
                    style={styles.input}
                    value={newObject.object_type}
                    onChange={(e) => setNewObject({...newObject, object_type: e.target.value})}
                  >
                    <option value="wall">Wall</option>
                    <option value="counter">Counter</option>
                    <option value="bar">Bar</option>
                    <option value="door">Door</option>
                    <option value="window">Window</option>
                  </select>
                  <input
                    style={styles.input}
                    type="text"
                    placeholder="Label (optional)"
                    value={newObject.label}
                    onChange={(e) => setNewObject({...newObject, label: e.target.value})}
                  />
                  <button style={styles.saveButton} onClick={handleAddObject}>Add Object</button>
                </div>
              )}

              <div style={styles.tableList}>
                {filteredObjects.map(obj => (
                  <div key={obj.id} style={styles.tableItem}>
                    <div style={styles.tableItemInfo}>
                      <div style={styles.tableItemNumber}>{obj.object_type}</div>
                      {obj.label && (
                        <div style={styles.tableItemName}>{obj.label}</div>
                      )}
                    </div>
                    <div style={styles.tableItemActions}>
                      <button style={styles.deleteButton} onClick={() => handleDeleteObject(obj.id)}>
                        <FiTrash2 />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Canvas */}
        <div style={styles.canvasWrapper}>
          <div style={styles.instructions}>
            <p>{editMode === 'tables' ? 'Drag tables to move, drag corners to resize' : 'Drag and resize objects'} to position them</p>
          </div>
          <TableMapCanvas
            tables={filteredTables}
            staticObjects={filteredObjects}
            floorPlan={floorPlan}
            activeOrders={[]}
            onTableClick={setSelectedTable}
            onObjectClick={setSelectedObject}
            getTableStatus={() => 'available'}
            readonly={false}
            onTableMove={handleTableMove}
            onObjectMove={handleObjectMove}
          />
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#f5f5f5',
    paddingTop: '80px'
  },

  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: '20px'
  },

  loadingSpinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #f3f3f3',
    borderTop: '4px solid #14B8A6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },

  loadingText: {
    fontSize: '16px',
    color: '#666'
  },

  noAccessContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '40px'
  },

  noAccessCard: {
    backgroundColor: '#fff',
    border: '2px solid #e9ecef',
    borderRadius: '12px',
    padding: '50px',
    maxWidth: '500px',
    textAlign: 'center'
  },

  lockIcon: {
    color: '#dc3545',
    marginBottom: '20px'
  },

  noAccessTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#dc3545',
    marginBottom: '15px'
  },

  noAccessText: {
    fontSize: '16px',
    color: '#666',
    marginBottom: '20px'
  },

  permissionsRequired: {
    backgroundColor: '#f8f9fa',
    padding: '15px',
    borderRadius: '6px',
    marginBottom: '20px',
    fontSize: '14px'
  },

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '24px',
    backgroundColor: '#fff',
    borderBottom: '1px solid #e0e0e0'
  },

  backButton: {
    padding: '8px 16px',
    backgroundColor: '#f5f5f5',
    border: '1px solid #ddd',
    borderRadius: '6px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: '500'
  },

  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    margin: 0
  },

  saveButton: {
    padding: '10px 20px',
    backgroundColor: '#008080',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: '600'
  },

  content: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden'
  },

  sidebar: {
    width: '320px',
    backgroundColor: '#fff',
    borderRight: '1px solid #e0e0e0',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    padding: '24px'
  },

  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },

  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },

  sectionTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    margin: 0,
    color: '#333'
  },

  modeButtons: {
    display: 'flex',
    gap: '8px'
  },

  modeButton: {
    flex: 1,
    padding: '10px',
    backgroundColor: '#f5f5f5',
    border: '1px solid #ddd',
    borderRadius: '6px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    fontSize: '14px',
    fontWeight: '500'
  },

  modeButtonActive: {
    backgroundColor: '#008080',
    color: '#fff',
    borderColor: '#008080'
  },

  addButton: {
    padding: '6px 12px',
    backgroundColor: '#008080',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    fontSize: '16px'
  },

  addButtonDisabled: {
    padding: '6px 12px',
    backgroundColor: '#e9ecef',
    color: '#6c757d',
    border: 'none',
    borderRadius: '4px',
    cursor: 'not-allowed',
    display: 'flex',
    alignItems: 'center',
    fontSize: '14px',
    opacity: 0.6
  },

  addForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px',
    backgroundColor: '#f9f9f9',
    borderRadius: '6px',
    border: '1px solid #e0e0e0'
  },

  input: {
    padding: '8px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px'
  },

  sectionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },

  sectionItem: {
    padding: '10px 12px',
    backgroundColor: '#f5f5f5',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '14px'
  },

  sectionItemActive: {
    backgroundColor: '#008080',
    color: '#fff',
    borderColor: '#008080'
  },

  tableList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '400px',
    overflowY: 'auto'
  },

  tableItem: {
    padding: '12px',
    backgroundColor: '#f9f9f9',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },

  tableItemInfo: {
    flex: 1
  },

  tableItemActive: {
    borderColor: '#008080',
    backgroundColor: '#f0f8f8'
  },

  tableItemNumber: {
    fontSize: '15px',
    fontWeight: 'bold'
  },

  tableItemName: {
    fontSize: '13px',
    color: '#666',
    marginTop: '2px'
  },

  tableItemCapacity: {
    fontSize: '13px',
    color: '#888',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    marginTop: '4px'
  },

  tableItemActions: {
    display: 'flex',
    gap: '8px'
  },

  editButton: {
    padding: '8px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#008080',
    cursor: 'pointer',
    fontSize: '16px'
  },

  deleteButton: {
    padding: '8px',
    backgroundColor: 'transparent',
    border: 'none',
    color: '#dc3545',
    cursor: 'pointer',
    fontSize: '16px'
  },

  editForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '100%'
  },

  editFormActions: {
    display: 'flex',
    gap: '6px'
  },

  saveEditButton: {
    flex: 1,
    padding: '8px',
    backgroundColor: '#008080',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600'
  },

  cancelEditButton: {
    flex: 1,
    padding: '8px',
    backgroundColor: '#f5f5f5',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px'
  },

  canvasWrapper: {
    flex: 1,
    overflow: 'auto',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },

  instructions: {
    padding: '16px',
    backgroundColor: '#e8f5e9',
    borderRadius: '8px',
    border: '1px solid #4caf50',
    textAlign: 'center',
    color: '#2e7d32',
    fontWeight: '500'
  }
};

// Add CSS animation
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;
if (!document.querySelector('#floor-plan-editor-styles')) {
  styleSheet.id = 'floor-plan-editor-styles';
  document.head.appendChild(styleSheet);
}

export default FloorPlanEditor;