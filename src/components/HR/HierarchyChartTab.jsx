// src/components/HR/HierarchyChartTab.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { formatPositionDisplay, positionRowsToNameSet } from '../../utils/positionCatalog';
import toast from 'react-hot-toast';

const HierarchyChartTab = ({ businessId }) => {
  const [employees, setEmployees] = useState([]);
  const [positions, setPositions] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hierarchyLayers, setHierarchyLayers] = useState([]);
  const [showLayerModal, setShowLayerModal] = useState(false);
  const [editingLayer, setEditingLayer] = useState(null);
  const [layerFormData, setLayerFormData] = useState({
    name: '',
    description: '',
    color: '#4a90e2',
    display_order: 0
  });

  useEffect(() => {
    if (businessId) {
      fetchData();
    }
  }, [businessId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Fetch employees with their positions and roles
      const { data: employeesData, error: employeesError } = await supabase
        .from('users')
        .select(`
          id,
          first_name,
          last_name,
          email,
          position,
          department,
          employee_number,
          is_active,
          business_users!inner(role)
        `)
        .eq('business_users.business_id', businessId)
        .eq('is_active', true)
        .order('first_name');

      if (employeesError) throw employeesError;

      // Fetch positions
      const { data: positionsData, error: positionsError } = await supabase
        .from('positions')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('position_name', { ascending: true });

      if (positionsError) throw positionsError;

      // Fetch roles (table doesn't exist yet, so skip)
      const rolesData = [];

      // Fetch hierarchy layers
      const { data: layersData, error: layersError } = await supabase
        .from('hierarchy_layers')
        .select('*')
        .eq('business_id', businessId)
        .order('display_order');

      if (layersError) {
        console.warn('Hierarchy layers table may not exist yet:', layersError);
      }

      setEmployees(employeesData || []);
      setPositions(positionsData || []);
      setRoles(rolesData);
      setHierarchyLayers(layersData || []);
      
    } catch (error) {
      console.error('Error fetching hierarchy data:', error);
      toast.error('Failed to load hierarchy data');
    } finally {
      setLoading(false);
    }
  };

  const handleAddLayer = () => {
    setEditingLayer(null);
    setLayerFormData({
      name: '',
      description: '',
      color: '#4a90e2',
      display_order: hierarchyLayers.length
    });
    setShowLayerModal(true);
  };

  const handleEditLayer = (layer) => {
    setEditingLayer(layer);
    setLayerFormData({
      name: layer.name,
      description: layer.description || '',
      color: layer.color || '#4a90e2',
      display_order: layer.display_order || 0
    });
    setShowLayerModal(true);
  };

  const handleSaveLayer = async () => {
    if (!layerFormData.name.trim()) {
      toast.error('Please enter a layer name');
      return;
    }

    try {
      const layerData = {
        business_id: businessId,
        name: layerFormData.name.trim(),
        description: layerFormData.description || null,
        color: layerFormData.color,
        display_order: layerFormData.display_order,
        is_active: true
      };

      if (editingLayer) {
        const { error } = await supabase
          .from('hierarchy_layers')
          .update(layerData)
          .eq('id', editingLayer.id);

        if (error) throw error;
        toast.success('Hierarchy layer updated successfully');
      } else {
        const { error } = await supabase
          .from('hierarchy_layers')
          .insert(layerData);

        if (error) throw error;
        toast.success('Hierarchy layer created successfully');
      }

      setShowLayerModal(false);
      fetchData();
    } catch (error) {
      console.error('Error saving hierarchy layer:', error);
      toast.error(error.message || 'Failed to save hierarchy layer');
    }
  };

  const handleDeleteLayer = async (layerId) => {
    if (!confirm('Are you sure you want to delete this hierarchy layer?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('hierarchy_layers')
        .update({ is_active: false })
        .eq('id', layerId);

      if (error) throw error;
      toast.success('Hierarchy layer deleted successfully');
      fetchData();
    } catch (error) {
      console.error('Error deleting hierarchy layer:', error);
      toast.error('Failed to delete hierarchy layer');
    }
  };

  const handleCancelLayer = () => {
    setShowLayerModal(false);
    setEditingLayer(null);
    setLayerFormData({
      name: '',
      description: '',
      color: '#4a90e2',
      display_order: 0
    });
  };

  // Group employees by hierarchy layer
  const getEmployeesByLayer = (layerName) => {
    // For now, match by position or department name
    return employees.filter(emp => {
      const position = emp.position?.toLowerCase() || '';
      const department = emp.department?.toLowerCase() || '';
      const layerNameLower = layerName.toLowerCase();
      return position.includes(layerNameLower) || department.includes(layerNameLower);
    });
  };

  const colorOptions = [
    { name: 'Blue', value: '#4a90e2' },
    { name: 'Red', value: '#dc3545' },
    { name: 'Green', value: '#28a745' },
    { name: 'Purple', value: '#6f42c1' },
    { name: 'Orange', value: '#fd7e14' },
    { name: 'Teal', value: '#008080' },
    { name: 'Pink', value: '#e83e8c' },
    { name: 'Indigo', value: '#6610f2' }
  ];

  const renderLayerModal = () => (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        padding: '24px',
        width: '90%',
        maxWidth: '500px',
        maxHeight: '90vh',
        overflow: 'auto'
      }}>
        <h3 style={{
          margin: '0 0 20px 0',
          fontSize: '18px',
          fontWeight: 'bold',
          color: '#1f2937'
        }}>
          {editingLayer ? 'Edit Hierarchy Layer' : 'Add Hierarchy Layer'}
        </h3>

        <form onSubmit={(e) => { e.preventDefault(); handleSaveLayer(); }}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '600',
              color: TavariStyles.colors.gray700
            }}>
              Layer Name *
            </label>
            <input
              type="text"
              value={layerFormData.name}
              onChange={(e) => setLayerFormData({ ...layerFormData, name: e.target.value })}
              placeholder="e.g., Management, Staff, Interns"
              style={{
                width: '100%',
                padding: '10px 12px',
                border: `1px solid ${TavariStyles.colors.gray300}`,
                borderRadius: '6px',
                fontSize: '14px'
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '600',
              color: TavariStyles.colors.gray700
            }}>
              Description
            </label>
            <textarea
              value={layerFormData.description}
              onChange={(e) => setLayerFormData({ ...layerFormData, description: e.target.value })}
              placeholder="Optional description of this hierarchy layer"
              rows={3}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: `1px solid ${TavariStyles.colors.gray300}`,
                borderRadius: '6px',
                fontSize: '14px',
                resize: 'vertical'
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '600',
              color: TavariStyles.colors.gray700
            }}>
              Color
            </label>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '8px'
            }}>
              {colorOptions.map(color => (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => setLayerFormData({ ...layerFormData, color: color.value })}
                  style={{
                    padding: '8px',
                    backgroundColor: layerFormData.color === color.value ? color.value : 'white',
                    border: `2px solid ${layerFormData.color === color.value ? color.value : '#d1d5db'}`,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '600',
                    color: layerFormData.color === color.value ? 'white' : '#374151'
                  }}
                >
                  {color.name}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '14px',
              fontWeight: '600',
              color: TavariStyles.colors.gray700
            }}>
              Display Order
            </label>
            <input
              type="number"
              value={layerFormData.display_order}
              onChange={(e) => setLayerFormData({ ...layerFormData, display_order: parseInt(e.target.value) || 0 })}
              min="0"
              style={{
                width: '100%',
                padding: '10px 12px',
                border: `1px solid ${TavariStyles.colors.gray300}`,
                borderRadius: '6px',
                fontSize: '14px'
              }}
            />
          </div>

          <div style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'flex-end'
          }}>
            <button
              type="button"
              onClick={handleCancelLayer}
              style={{
                padding: '10px 20px',
                backgroundColor: 'transparent',
                border: `1px solid ${TavariStyles.colors.gray300}`,
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '600',
                color: TavariStyles.colors.gray700,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                padding: '10px 20px',
                backgroundColor: '#008080',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              {editingLayer ? 'Update' : 'Create'} Layer
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '200px',
        fontSize: TavariStyles.typography.fontSize.lg,
        color: TavariStyles.colors.gray600
      }}>
        Loading hierarchy chart...
      </div>
    );
  }

  return (
    <>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        padding: '25px',
        border: '1px solid #e5e7eb'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
          borderBottom: '2px solid #008080',
          paddingBottom: '10px'
        }}>
          <h2 style={{
            margin: 0,
            fontSize: '20px',
            fontWeight: 'bold',
            color: '#1f2937'
          }}>
            Organizational Hierarchy
          </h2>
          <button
            onClick={handleAddLayer}
            style={{
              padding: '8px 16px',
              backgroundColor: '#008080',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            + Add Layer
          </button>
        </div>

        {/* Empty State */}
        {hierarchyLayers.length === 0 ? (
          <div>
            <p style={{
              margin: '0 0 20px 0',
              fontSize: '16px',
              color: '#6b7280',
              textAlign: 'center'
            }}>
              No hierarchy layers created yet. Click "Add Layer" to get started!
            </p>
            <div style={{
              backgroundColor: '#f3f4f6',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '20px',
              textAlign: 'left'
            }}>
              <h3 style={{
                margin: '0 0 12px 0',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151'
              }}>
                How it works:
              </h3>
              <ol style={{
                margin: 0,
                paddingLeft: '20px',
                fontSize: '14px',
                color: '#6b7280',
                lineHeight: '1.6'
              }}>
                <li>Create hierarchy layers (e.g., "Management", "Staff")</li>
                <li>Employees are automatically grouped by their position or department</li>
                <li>Customize colors and display order for each layer</li>
              </ol>
            </div>
          </div>
        ) : (
          <>
            {/* Hierarchy Layers Management */}
            <div style={{ marginBottom: '30px' }}>
              <h3 style={{
                fontSize: '16px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '12px'
              }}>
                Hierarchy Layers
              </h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                gap: '12px'
              }}>
                {hierarchyLayers.map(layer => (
                  <div
                    key={layer.id}
                    style={{
                      border: `2px solid ${layer.color}`,
                      borderRadius: '8px',
                      padding: '12px',
                      backgroundColor: `${layer.color}10`
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: '8px'
                    }}>
                      <h4 style={{
                        margin: 0,
                        fontSize: '14px',
                        fontWeight: '600',
                        color: '#1f2937'
                      }}>
                        {layer.name}
                      </h4>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          onClick={() => handleEditLayer(layer)}
                          style={{
                            padding: '4px 8px',
                            backgroundColor: 'transparent',
                            border: '1px solid #d1d5db',
                            borderRadius: '4px',
                            fontSize: '13px',
                            cursor: 'pointer'
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteLayer(layer.id)}
                          style={{
                            padding: '4px 8px',
                            backgroundColor: 'transparent',
                            border: '1px solid #dc3545',
                            borderRadius: '4px',
                            fontSize: '13px',
                            color: '#dc3545',
                            cursor: 'pointer'
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {layer.description && (
                      <p style={{
                        margin: 0,
                        fontSize: '13px',
                        color: '#6b7280',
                        marginBottom: '8px'
                      }}>
                        {layer.description}
                      </p>
                    )}
                    <div style={{
                      fontSize: '13px',
                      color: '#6b7280'
                    }}>
                      Order: {layer.display_order}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Hierarchy Chart */}
            <div>
              <h3 style={{
                fontSize: '16px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '12px'
              }}>
                Organization Chart
              </h3>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '20px'
              }}>
                {hierarchyLayers
                  .sort((a, b) => a.display_order - b.display_order)
                  .map(layer => {
                    const layerEmployees = getEmployeesByLayer(layer.name);
                    return (
                      <div key={layer.id}>
                        <div style={{
                          backgroundColor: layer.color,
                          color: 'white',
                          padding: '12px 16px',
                          borderRadius: '8px 8px 0 0',
                          fontSize: '16px',
                          fontWeight: '600'
                        }}>
                          {layer.name} ({layerEmployees.length} employees)
                        </div>
                        <div style={{
                          border: `1px solid ${layer.color}`,
                          borderTop: 'none',
                          borderRadius: '0 0 8px 8px',
                          padding: '16px',
                          backgroundColor: 'white'
                        }}>
                          {layerEmployees.length > 0 ? (
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                              gap: '12px'
                            }}>
                              {layerEmployees.map(employee => (
                                <div
                                  key={employee.id}
                                  style={{
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '6px',
                                    padding: '12px',
                                    backgroundColor: '#f9fafb'
                                  }}
                                >
                                  <div style={{
                                    fontWeight: '600',
                                    fontSize: '14px',
                                    color: '#1f2937',
                                    marginBottom: '4px'
                                  }}>
                                    {employee.first_name} {employee.last_name}
                                  </div>
                                  <div style={{
                                    fontSize: '13px',
                                    color: '#6b7280',
                                    marginBottom: '2px'
                                  }}>
                                    {formatPositionDisplay(employee.position, positionNameSet) || 'No position'}
                                  </div>
                                  <div style={{
                                    fontSize: '13px',
                                    color: '#6b7280'
                                  }}>
                                    {employee.email}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{
                              textAlign: 'center',
                              color: '#6b7280',
                              fontSize: '14px',
                              padding: '20px'
                            }}>
                              No employees in this layer
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Layer Modal */}
      {showLayerModal && renderLayerModal()}
    </>
  );
};

export default HierarchyChartTab;
