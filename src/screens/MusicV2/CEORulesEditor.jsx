// screens/MusicV2/CEORulesEditor.jsx
// Customer Experience Optimizer - Rules editor

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiPlus, FiSave, FiTrash2, FiEdit2, FiZap } from 'react-icons/fi';
import { useBusiness } from '../../contexts/BusinessContext';
import { supabase } from '../../supabaseClient';
import { ceoEngine } from '../../services/music-v2/CEOEngine';
import toast from 'react-hot-toast';

const CEORulesEditor = () => {
  const navigate = useNavigate();
  const { business } = useBusiness();
  const [location, setLocation] = useState(null);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState(null);

  const conditionTypes = [
    { 
      value: 'time_range', 
      label: 'Time Range', 
      description: 'Apply during specific hours (e.g., 9 AM - 5 PM)',
      example: '9 AM to 5 PM every day'
    },
    { 
      value: 'day_of_week', 
      label: 'Day of Week', 
      description: 'Apply on specific days',
      example: 'Weekends only'
    },
    { 
      value: 'day_and_time', 
      label: 'Day + Time', 
      description: 'Apply on specific days during specific hours',
      example: 'Friday 6 PM - 9 PM'
    }
  ];

  const playlistTypes = [
    { value: 'upbeat', label: 'Upbeat' },
    { value: 'background', label: 'Background' },
    { value: 'upscale', label: 'Upscale' }
  ];

  const adFrequencyOptions = [
    { value: null, label: 'Use Default' },
    { value: 'zero_ads', label: 'No Ads' },
    { value: 'one_per_8', label: '1 Ad Every 8 Songs' },
    { value: 'one_per_7', label: '1 Ad Every 7 Songs' },
    { value: 'one_per_6', label: '1 Ad Every 6 Songs' },
    { value: 'one_per_5', label: '1 Ad Every 5 Songs' },
    { value: 'one_per_4', label: '1 Ad Every 4 Songs' },
    { value: 'one_per_3', label: '1 Ad Every 3 Songs' }
  ];

  const daysOfWeek = [
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' }
  ];

  useEffect(() => {
    if (business?.id) {
      loadData();
    }
  }, [business?.id]);

  const loadData = async () => {
    try {
      // Load location
      const { data: locationData, error: locationError } = await supabase
        .from('music_v2_locations')
        .select('*')
        .eq('business_id', business.id)
        .maybeSingle();

      if (locationError && locationError.code !== 'PGRST116') {
        throw locationError;
      }

      if (locationData) {
        setLocation(locationData);
      }

      // Load CEO rules
      if (locationData) {
        const loadedRules = await ceoEngine.loadRules(locationData.id);
        setRules(loadedRules);
      }

      setLoading(false);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load rules');
      setLoading(false);
    }
  };

  const handleCreateRule = async (ruleData) => {
    if (!location) {
      toast.error('Location not found');
      return;
    }

    setSaving(true);
    try {
      if (editingRule) {
        await ceoEngine.updateRule(editingRule.id, ruleData);
        toast.success('Rule updated successfully!');
      } else {
        await ceoEngine.createRule(location.id, ruleData);
        toast.success('Rule created successfully!');
      }
      setShowRuleModal(false);
      setEditingRule(null);
      await loadData();
    } catch (error) {
      console.error('Error saving rule:', error);
      toast.error('Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRule = async (ruleId) => {
    if (!window.confirm('Are you sure you want to delete this rule?')) {
      return;
    }

    try {
      await ceoEngine.deleteRule(ruleId);
      toast.success('Rule deleted successfully!');
      await loadData();
    } catch (error) {
      console.error('Error deleting rule:', error);
      toast.error('Failed to delete rule');
    }
  };

  const handleEditRule = (rule) => {
    setEditingRule(rule);
    setShowRuleModal(true);
  };

  const formatCondition = (rule) => {
    const condition = rule.condition_value;
    
    switch (rule.condition_type) {
      case 'time_range':
        return `${formatHour(condition.start_hour || 0)} - ${formatHour(condition.end_hour || 23)} (All Days)`;
      
      case 'day_of_week':
        const days = (condition.days || []).map(d => daysOfWeek.find(dw => dw.value === d)?.label).filter(Boolean);
        return days.length > 0 ? days.join(', ') : 'No days selected';
      
      case 'day_and_time':
        const selectedDays = (condition.days || []).map(d => daysOfWeek.find(dw => dw.value === d)?.label).filter(Boolean);
        return `${selectedDays.join(', ')}: ${formatHour(condition.start_hour || 0)} - ${formatHour(condition.end_hour || 23)}`;
      
      default:
        return 'Unknown condition';
    }
  };

  const formatHour = (hour) => {
    if (hour === 0) return '12 AM';
    if (hour < 12) return `${hour} AM`;
    if (hour === 12) return '12 PM';
    return `${hour - 12} PM`;
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div>Loading rules...</div>
      </div>
    );
  }

  if (!location) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div>Location not found. Please go back to the dashboard.</div>
        <button
          onClick={() => navigate('/dashboard/music-v2/dashboard')}
          style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <button
        onClick={() => navigate('/dashboard/music-v2/dashboard')}
        style={{
          marginBottom: '1rem',
          padding: '0.5rem 1rem',
          backgroundColor: '#6c757d',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}
      >
        <FiArrowLeft /> Back to Dashboard
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FiZap style={{ color: '#ffc107' }} />
            Customer Experience Optimizer
          </h1>
          <p style={{ color: '#666' }}>
            Create automatic rules to optimize music and ads based on time, day, or business hours.
            Rules are evaluated in priority order (higher priority first).
          </p>
        </div>
        <button
          onClick={() => {
            setEditingRule(null);
            setShowRuleModal(true);
          }}
          style={{
            padding: '0.75rem 1.5rem',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontWeight: 'bold'
          }}
        >
          <FiPlus /> Create Rule
        </button>
      </div>

      {/* Rules List */}
      {rules.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '3rem',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          border: '2px dashed #ddd'
        }}>
          <FiZap style={{ fontSize: '3rem', color: '#ffc107', marginBottom: '1rem' }} />
          <p style={{ fontSize: '1.25rem', color: '#666', marginBottom: '1rem' }}>
            No optimization rules configured
          </p>
          <p style={{ color: '#999', marginBottom: '1.5rem' }}>
            Create rules to automatically adjust playlists and ad frequency based on time of day, day of week, or business hours.
          </p>
          <button
            onClick={() => {
              setEditingRule(null);
              setShowRuleModal(true);
            }}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            + Create Your First Rule
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {rules.map((rule, index) => (
            <div
              key={rule.id}
              style={{
                border: '1px solid #ddd',
                borderRadius: '8px',
                padding: '1.5rem',
                backgroundColor: '#fff',
                position: 'relative'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1.25rem' }}>{rule.rule_name}</h3>
                    <span style={{
                      padding: '0.25rem 0.75rem',
                      backgroundColor: '#e7f3ff',
                      color: '#007bff',
                      borderRadius: '12px',
                      fontSize: '0.875rem',
                      fontWeight: 'bold'
                    }}>
                      Priority: {rule.priority}
                    </span>
                  </div>
                  <div style={{ color: '#666', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
                    <strong>When:</strong> {formatCondition(rule)}
                  </div>
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
                    gap: '0.75rem',
                    fontSize: '0.875rem'
                  }}>
                    <div>
                      <strong>Playlist:</strong> {playlistTypes.find(p => p.value === rule.action_playlist_type)?.label || 'N/A'}
                    </div>
                    {rule.action_ad_frequency && (
                      <div>
                        <strong>Ad Frequency:</strong> {adFrequencyOptions.find(a => a.value === rule.action_ad_frequency)?.label || 'N/A'}
                      </div>
                    )}
                    {rule.action_content_rating && (
                      <div>
                        <strong>Content Rating:</strong> {rule.action_content_rating}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => handleEditRule(rule)}
                    style={{
                      padding: '0.5rem',
                      backgroundColor: '#007bff',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                    title="Edit rule"
                  >
                    <FiEdit2 />
                  </button>
                  <button
                    onClick={() => handleDeleteRule(rule.id)}
                    style={{
                      padding: '0.5rem',
                      backgroundColor: '#dc3545',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                    title="Delete rule"
                  >
                    <FiTrash2 />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rule Modal */}
      {showRuleModal && (
        <RuleModal
          location={location}
          conditionTypes={conditionTypes}
          playlistTypes={playlistTypes}
          adFrequencyOptions={adFrequencyOptions}
          daysOfWeek={daysOfWeek}
          editingRule={editingRule}
          onClose={() => {
            setShowRuleModal(false);
            setEditingRule(null);
          }}
          onSave={handleCreateRule}
          saving={saving}
        />
      )}

      {/* Help Section */}
      <div style={{
        marginTop: '2rem',
        padding: '1rem',
        backgroundColor: '#fffbf0',
        borderRadius: '8px',
        border: '1px solid #ffc107'
      }}>
        <h3 style={{ marginTop: 0, marginBottom: '0.5rem' }}>💡 How CEO Rules Work</h3>
        <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#666', fontSize: '0.875rem' }}>
          <li>Rules are evaluated in <strong>priority order</strong> (higher priority = evaluated first)</li>
          <li>When a rule's condition matches, its actions are applied</li>
          <li>Only the <strong>first matching rule</strong> is applied</li>
          <li>Rules can override schedule blocks for automatic optimization</li>
          <li>Example: "Weekend mornings → Kids-safe playlist + light ads"</li>
        </ul>
      </div>
    </div>
  );
};

// Rule Modal Component
const RuleModal = ({ 
  location, 
  conditionTypes, 
  playlistTypes, 
  adFrequencyOptions, 
  daysOfWeek,
  editingRule,
  onClose, 
  onSave,
  saving 
}) => {
  const [formData, setFormData] = useState({
    rule_name: editingRule?.rule_name || '',
    condition_type: editingRule?.condition_type || 'time_range',
    condition_value: editingRule?.condition_value || {},
    action_playlist_type: editingRule?.action_playlist_type || 'background',
    action_ad_frequency: editingRule?.action_ad_frequency || null,
    action_content_rating: editingRule?.action_content_rating || null,
    priority: editingRule?.priority || 0
  });

  const handleConditionChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      condition_value: {
        ...prev.condition_value,
        [field]: value
      }
    }));
  };

  const handleDayToggle = (dayValue) => {
    const currentDays = formData.condition_value.days || [];
    const newDays = currentDays.includes(dayValue)
      ? currentDays.filter(d => d !== dayValue)
      : [...currentDays, dayValue];
    
    handleConditionChange('days', newDays);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!formData.rule_name.trim()) {
      toast.error('Please enter a rule name');
      return;
    }

    // Validate condition based on type
    if (formData.condition_type === 'day_of_week' || formData.condition_type === 'day_and_time') {
      if (!formData.condition_value.days || formData.condition_value.days.length === 0) {
        toast.error('Please select at least one day');
        return;
      }
    }

    onSave(formData);
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: '#fff',
        borderRadius: '8px',
        padding: '2rem',
        maxWidth: '700px',
        width: '90%',
        maxHeight: '90vh',
        overflow: 'auto'
      }}>
        <h2 style={{ marginTop: 0, marginBottom: '1.5rem' }}>
          {editingRule ? 'Edit Rule' : 'Create New Rule'}
        </h2>

        <form onSubmit={handleSubmit}>
          {/* Rule Name */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
              Rule Name *
            </label>
            <input
              type="text"
              value={formData.rule_name}
              onChange={(e) => setFormData({ ...formData, rule_name: e.target.value })}
              placeholder="e.g., Weekend Mornings, Dinner Service, After Hours"
              required
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '4px',
                border: '1px solid #ddd'
              }}
            />
          </div>

          {/* Priority */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
              Priority (Higher = Evaluated First)
            </label>
            <input
              type="number"
              value={formData.priority}
              onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
              min="0"
              max="100"
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '4px',
                border: '1px solid #ddd'
              }}
            />
            <div style={{ fontSize: '0.875rem', color: '#666', marginTop: '0.25rem' }}>
              Rules with higher priority are checked first. Default: 0
            </div>
          </div>

          {/* Condition Type */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
              Condition Type *
            </label>
            <select
              value={formData.condition_type}
              onChange={(e) => {
                setFormData({ 
                  ...formData, 
                  condition_type: e.target.value,
                  condition_value: {} // Reset condition value when type changes
                });
              }}
              required
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: '4px',
                border: '1px solid #ddd'
              }}
            >
              {conditionTypes.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
            <div style={{ fontSize: '0.875rem', color: '#666', marginTop: '0.25rem' }}>
              {conditionTypes.find(t => t.value === formData.condition_type)?.description}
            </div>
          </div>

          {/* Condition Value - Time Range */}
          {formData.condition_type === 'time_range' && (
            <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Time Range (All Days)
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.875rem', marginBottom: '0.25rem', display: 'block' }}>Start Hour</label>
                  <select
                    value={formData.condition_value.start_hour || 0}
                    onChange={(e) => handleConditionChange('start_hour', parseInt(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #ddd'
                    }}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>
                        {i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i - 12} PM`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.875rem', marginBottom: '0.25rem', display: 'block' }}>End Hour</label>
                  <select
                    value={formData.condition_value.end_hour || 23}
                    onChange={(e) => handleConditionChange('end_hour', parseInt(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #ddd'
                    }}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>
                        {i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i - 12} PM`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Condition Value - Day of Week */}
          {formData.condition_type === 'day_of_week' && (
            <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Select Days *
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {daysOfWeek.map(day => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => handleDayToggle(day.value)}
                    style={{
                      padding: '0.5rem 1rem',
                      backgroundColor: (formData.condition_value.days || []).includes(day.value) ? '#007bff' : '#fff',
                      color: (formData.condition_value.days || []).includes(day.value) ? '#fff' : '#333',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: (formData.condition_value.days || []).includes(day.value) ? 'bold' : 'normal'
                    }}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Condition Value - Day and Time */}
          {formData.condition_type === 'day_and_time' && (
            <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Select Days *
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                {daysOfWeek.map(day => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => handleDayToggle(day.value)}
                    style={{
                      padding: '0.5rem 1rem',
                      backgroundColor: (formData.condition_value.days || []).includes(day.value) ? '#007bff' : '#fff',
                      color: (formData.condition_value.days || []).includes(day.value) ? '#fff' : '#333',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: (formData.condition_value.days || []).includes(day.value) ? 'bold' : 'normal'
                    }}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.875rem', marginBottom: '0.25rem', display: 'block' }}>Start Hour</label>
                  <select
                    value={formData.condition_value.start_hour || 0}
                    onChange={(e) => handleConditionChange('start_hour', parseInt(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #ddd'
                    }}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>
                        {i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i - 12} PM`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.875rem', marginBottom: '0.25rem', display: 'block' }}>End Hour</label>
                  <select
                    value={formData.condition_value.end_hour || 23}
                    onChange={(e) => handleConditionChange('end_hour', parseInt(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #ddd'
                    }}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>
                        {i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i - 12} PM`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '1rem' }}>Actions (What to Apply)</h3>
            
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Playlist Type *
              </label>
              <select
                value={formData.action_playlist_type}
                onChange={(e) => setFormData({ ...formData, action_playlist_type: e.target.value })}
                required
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  borderRadius: '4px',
                  border: '1px solid #ddd'
                }}
              >
                {playlistTypes.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Ad Frequency (Optional)
              </label>
              <select
                value={formData.action_ad_frequency || ''}
                onChange={(e) => setFormData({ ...formData, action_ad_frequency: e.target.value || null })}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  borderRadius: '4px',
                  border: '1px solid #ddd'
                }}
              >
                {adFrequencyOptions.map(opt => (
                  <option key={opt.value || 'default'} value={opt.value || ''}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                Content Rating (Optional)
              </label>
              <select
                value={formData.action_content_rating || ''}
                onChange={(e) => setFormData({ ...formData, action_content_rating: e.target.value || null })}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  borderRadius: '4px',
                  border: '1px solid #ddd'
                }}
              >
                <option value="">Use Default</option>
                <option value="kids_safe">Kids Safe</option>
                <option value="family">Family</option>
                <option value="general">General</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1,
                fontWeight: 'bold'
              }}
            >
              {saving ? 'Saving...' : editingRule ? 'Update Rule' : 'Create Rule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CEORulesEditor;


