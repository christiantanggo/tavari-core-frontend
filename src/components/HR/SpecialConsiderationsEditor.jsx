// Special Considerations Editor Component with Sections and Subsections support
import React, { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import TavariCheckbox from '../UI/TavariCheckbox';

const SpecialConsiderationsEditor = ({ 
  type, 
  label, 
  data, 
  enabled, 
  onToggle, 
  onChange,
  disabled 
}) => {
  const [expandedSections, setExpandedSections] = useState(new Set());

  const toggleSection = (sectionIndex) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionIndex)) {
      newExpanded.delete(sectionIndex);
    } else {
      newExpanded.add(sectionIndex);
    }
    setExpandedSections(newExpanded);
  };

  const addSection = () => {
    const newSection = {
      id: `section_${Date.now()}`,
      title: '',
      content: '',
      subsections: []
    };
    onChange({
      ...data,
      enabled: enabled, // Use the enabled prop directly
      sections: [...(data.sections || []), newSection]
    });
  };

  const updateSection = (sectionIndex, field, value) => {
    const updated = { 
      ...data,
      enabled: enabled // Use the enabled prop directly
    };
    updated.sections = [...(updated.sections || [])];
    updated.sections[sectionIndex] = {
      ...updated.sections[sectionIndex],
      [field]: value
    };
    onChange(updated);
  };

  const deleteSection = (sectionIndex) => {
    const updated = { 
      ...data,
      enabled: enabled // Use the enabled prop directly
    };
    updated.sections = (updated.sections || []).filter((_, i) => i !== sectionIndex);
    onChange(updated);
  };

  const addSubsection = (sectionIndex) => {
    const updated = { 
      ...data,
      enabled: enabled // Use the enabled prop directly
    };
    updated.sections = [...(updated.sections || [])];
    if (!updated.sections[sectionIndex].subsections) {
      updated.sections[sectionIndex].subsections = [];
    }
    updated.sections[sectionIndex].subsections.push({
      id: `subsection_${Date.now()}`,
      title: '',
      content: ''
    });
    onChange(updated);
  };

  const updateSubsection = (sectionIndex, subsectionIndex, field, value) => {
    const updated = { 
      ...data,
      enabled: enabled // Use the enabled prop directly
    };
    updated.sections = [...(updated.sections || [])];
    // Create a new section object
    updated.sections[sectionIndex] = {
      ...updated.sections[sectionIndex],
      subsections: [...(updated.sections[sectionIndex].subsections || [])]
    };
    // Create a new subsection object
    updated.sections[sectionIndex].subsections[subsectionIndex] = {
      ...updated.sections[sectionIndex].subsections[subsectionIndex],
      [field]: value
    };
    onChange(updated);
  };

  const deleteSubsection = (sectionIndex, subsectionIndex) => {
    const updated = { 
      ...data,
      enabled: enabled // Use the enabled prop directly
    };
    updated.sections = [...(updated.sections || [])];
    // Create a new section object with filtered subsections
    updated.sections[sectionIndex] = {
      ...updated.sections[sectionIndex],
      subsections: (updated.sections[sectionIndex].subsections || []).filter(
        (_, i) => i !== subsectionIndex
      )
    };
    onChange(updated);
  };

  const styles = {
    considerationContainer: {
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      padding: '16px',
      marginBottom: '16px',
      backgroundColor: '#ffffff'
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      marginBottom: '12px'
    },
    content: {
      marginTop: '12px',
      paddingLeft: '8px'
    },
    sectionsList: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      marginTop: '12px'
    },
    section: {
      border: '1px solid #d1d5db',
      borderRadius: '6px',
      padding: '12px',
      backgroundColor: '#f9fafb'
    },
    sectionHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '8px',
      cursor: 'pointer'
    },
    sectionTitle: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      flex: 1
    },
    sectionActions: {
      display: 'flex',
      gap: '8px'
    },
    sectionTitleInput: {
      flex: 1,
      padding: '6px 8px',
      border: '1px solid #d1d5db',
      borderRadius: '4px',
      fontSize: '14px',
      fontWeight: '600'
    },
    sectionContent: {
      width: '100%',
      padding: '8px',
      border: '1px solid #d1d5db',
      borderRadius: '4px',
      fontSize: '14px',
      minHeight: '80px',
      resize: 'vertical',
      fontFamily: 'inherit',
      marginBottom: '8px'
    },
    subsectionsList: {
      marginTop: '12px',
      paddingLeft: '16px',
      borderLeft: '2px solid #e5e7eb'
    },
    subsection: {
      marginBottom: '12px',
      padding: '8px',
      backgroundColor: '#ffffff',
      borderRadius: '4px',
      border: '1px solid #e5e7eb'
    },
    subsectionHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '6px'
    },
    subsectionTitleInput: {
      flex: 1,
      padding: '4px 6px',
      border: '1px solid #d1d5db',
      borderRadius: '4px',
      fontSize: '13px',
      fontWeight: '500',
      marginRight: '8px'
    },
    subsectionContent: {
      width: '100%',
      padding: '6px',
      border: '1px solid #d1d5db',
      borderRadius: '4px',
      fontSize: '13px',
      minHeight: '60px',
      resize: 'vertical',
      fontFamily: 'inherit'
    },
    button: {
      padding: '6px 12px',
      border: '1px solid #d1d5db',
      borderRadius: '4px',
      backgroundColor: '#ffffff',
      cursor: 'pointer',
      fontSize: '13px',
      display: 'flex',
      alignItems: 'center',
      gap: '4px'
    },
    deleteButton: {
      padding: '6px 12px',
      border: '1px solid #dc2626',
      borderRadius: '4px',
      backgroundColor: '#ffffff',
      color: '#dc2626',
      cursor: 'pointer',
      fontSize: '13px',
      display: 'flex',
      alignItems: 'center',
      gap: '4px'
    },
    addButton: {
      padding: '8px 16px',
      border: '1px solid #008080',
      borderRadius: '4px',
      backgroundColor: '#008080',
      color: '#ffffff',
      cursor: 'pointer',
      fontSize: '13px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      marginTop: '8px'
    }
  };

  return (
    <div style={styles.considerationContainer}>
      <div style={styles.header}>
        <TavariCheckbox
          checked={enabled}
          onChange={onToggle}
          label={label}
          disabled={disabled}
        />
      </div>
      
      {enabled && (
        <div style={styles.content}>
          {(!data.sections || data.sections.length === 0) ? (
            <div style={{ color: '#6b7280', fontSize: '14px', marginBottom: '12px' }}>
              No sections added yet. Click "Add Section" to get started.
            </div>
          ) : (
            <div style={styles.sectionsList}>
              {data.sections.map((section, sectionIndex) => (
                <div key={section.id || sectionIndex} style={styles.section}>
                  <div style={styles.sectionHeader}>
                    <div style={styles.sectionTitle}>
                      <button
                        onClick={() => toggleSection(sectionIndex)}
                        style={{ ...styles.button, border: 'none', background: 'transparent', padding: '4px' }}
                      >
                        {expandedSections.has(sectionIndex) ? (
                          <ChevronUp size={16} />
                        ) : (
                          <ChevronDown size={16} />
                        )}
                      </button>
                      <input
                        type="text"
                        value={section.title || ''}
                        onChange={(e) => updateSection(sectionIndex, 'title', e.target.value)}
                        placeholder="Section Title (e.g., Premium Value, Conditions)"
                        style={styles.sectionTitleInput}
                      />
                    </div>
                    <div style={styles.sectionActions}>
                      <button
                        onClick={() => addSubsection(sectionIndex)}
                        style={styles.button}
                        title="Add Subsection"
                      >
                        <Plus size={14} /> Subsection
                      </button>
                      <button
                        onClick={() => deleteSection(sectionIndex)}
                        style={styles.deleteButton}
                        title="Delete Section"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  
                  {expandedSections.has(sectionIndex) && (
                    <>
                      <textarea
                        value={section.content || ''}
                        onChange={(e) => updateSection(sectionIndex, 'content', e.target.value)}
                        placeholder="Section content..."
                        style={styles.sectionContent}
                        rows={4}
                      />
                      
                      {section.subsections && section.subsections.length > 0 && (
                        <div style={styles.subsectionsList}>
                          {section.subsections.map((subsection, subsectionIndex) => (
                            <div key={subsection.id || subsectionIndex} style={styles.subsection}>
                              <div style={styles.subsectionHeader}>
                                <input
                                  type="text"
                                  value={subsection.title || ''}
                                  onChange={(e) => updateSubsection(sectionIndex, subsectionIndex, 'title', e.target.value)}
                                  placeholder="Subsection Title (e.g., Inventory & Stock Control)"
                                  style={styles.subsectionTitleInput}
                                />
                                <button
                                  onClick={() => deleteSubsection(sectionIndex, subsectionIndex)}
                                  style={styles.deleteButton}
                                  title="Delete Subsection"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                              <textarea
                                value={subsection.content || ''}
                                onChange={(e) => updateSubsection(sectionIndex, subsectionIndex, 'content', e.target.value)}
                                placeholder="Subsection content..."
                                style={styles.subsectionContent}
                                rows={3}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          
          <button
            onClick={addSection}
            style={styles.addButton}
          >
            <Plus size={16} /> Add Section
          </button>
        </div>
      )}
    </div>
  );
};

export default SpecialConsiderationsEditor;

