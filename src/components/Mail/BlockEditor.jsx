// components/Mail/BlockEditor.jsx
import React from 'react';
import ImageUpload from './ImageUpload';
import SocialButtons from './SocialButtons';
import { styles } from '../../styles/Mail/CampaignBuilder.styles';
import {
  FiMove, FiCopy, FiTrash2, FiAlignLeft, FiAlignCenter, FiAlignRight, FiLink
} from 'react-icons/fi';

const BlockEditor = ({
  block,
  index,
  businessId,
  onUpdate,
  onDuplicate,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  isDraggedOver
}) => {
  const insertDynamicField = (field) => {
    const dynamicFields = {
      first_name: '{{First Name}}',
      last_name: '{{Last Name}}',
      email: '{{Email}}',
      full_name: '{{Full Name}}'
    };

    onUpdate(block.id, {
      content: (prev) => {
        const currentContent = prev || '';
        return currentContent + ' ' + dynamicFields[field];
      }
    });
  };

  const renderBlockEditor = () => {
    switch (block.type) {
      case 'text':
        return (
          <div>
            <textarea
              style={styles.textEditor}
              value={block.content || ''}
              onChange={(e) => onUpdate(block.id, { content: e.target.value })}
              placeholder="Enter your text content..."
              rows={4}
            />
            <div style={styles.textControls}>
              <div style={styles.dynamicFields}>
                <span style={styles.dynamicFieldsLabel}>Insert:</span>
                {[
                  { key: 'first_name', label: 'First Name' },
                  { key: 'last_name', label: 'Last Name' },
                  { key: 'full_name', label: 'Full Name' },
                  { key: 'email', label: 'Email' }
                ].map(field => (
                  <button
                    key={field.key}
                    style={styles.dynamicFieldButton}
                    onClick={() => insertDynamicField(field.key)}
                  >
                    {field.label}
                  </button>
                ))}
              </div>
              <div style={styles.alignmentButtons}>
                {['left', 'center', 'right'].map(align => (
                  <button
                    key={align}
                    style={{
                      ...styles.alignmentButton,
                      ...(block.settings.textAlign === align ? styles.activeAlignment : {})
                    }}
                    onClick={() => onUpdate(block.id, {
                      settings: { ...block.settings, textAlign: align }
                    })}
                  >
                    {align === 'left' && <FiAlignLeft />}
                    {align === 'center' && <FiAlignCenter />}
                    {align === 'right' && <FiAlignRight />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );

      case 'heading':
        return (
          <div>
            <input
              type="text"
              style={styles.headingEditor}
              value={block.content || ''}
              onChange={(e) => onUpdate(block.id, { content: e.target.value })}
              placeholder="Enter heading text..."
            />
            <div style={styles.headingControls}>
              <select
                style={styles.headingLevelSelect}
                value={block.settings.level}
                onChange={(e) => onUpdate(block.id, {
                  settings: { ...block.settings, level: e.target.value }
                })}
              >
                <option value="h1">H1 - Large</option>
                <option value="h2">H2 - Medium</option>
                <option value="h3">H3 - Small</option>
              </select>
              <div style={styles.alignmentButtons}>
                {['left', 'center', 'right'].map(align => (
                  <button
                    key={align}
                    style={{
                      ...styles.alignmentButton,
                      ...(block.settings.textAlign === align ? styles.activeAlignment : {})
                    }}
                    onClick={() => onUpdate(block.id, {
                      settings: { ...block.settings, textAlign: align }
                    })}
                  >
                    {align === 'left' && <FiAlignLeft />}
                    {align === 'center' && <FiAlignCenter />}
                    {align === 'right' && <FiAlignRight />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );

      case 'button':
        return (
          <div style={styles.buttonEditor}>
            <input
              type="text"
              style={styles.input}
              placeholder="Button text"
              value={block.content.text}
              onChange={(e) => onUpdate(block.id, {
                content: { ...block.content, text: e.target.value }
              })}
            />
            <input
              type="url"
              style={styles.input}
              placeholder="Button URL (https://...)"
              value={block.content.url}
              onChange={(e) => onUpdate(block.id, {
                content: { ...block.content, url: e.target.value }
              })}
            />
            {block.content.url && (
              <div style={styles.testButtonContainer}>
                <button
                  type="button"
                  style={styles.testButton}
                  onClick={() => window.open(block.content.url, '_blank')}
                >
                  <FiLink style={styles.buttonIcon} />
                  Test Button Link
                </button>
              </div>
            )}
          </div>
        );

      case 'image':
        return (
          <div style={styles.imageEditor}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Upload Image</label>
              <ImageUpload
                currentImage={block.content.src}
                onImageSelect={(url, filename) => {
                  onUpdate(block.id, {
                    content: {
                      ...block.content,
                      src: url,
                      alt: filename || block.content.alt
                    }
                  });
                }}
                businessId={businessId}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Alt Text (for accessibility)</label>
              <input
                type="text"
                style={styles.input}
                placeholder="Describe this image..."
                value={block.content.alt}
                onChange={(e) => onUpdate(block.id, {
                  content: { ...block.content, alt: e.target.value }
                })}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Link URL (optional)</label>
              <input
                type="url"
                style={styles.input}
                placeholder="https://example.com (optional)"
                value={block.content.url || ''}
                onChange={(e) => onUpdate(block.id, {
                  content: { ...block.content, url: e.target.value }
                })}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Image Alignment</label>
              <select
                style={styles.select}
                value={block.content.alignment}
                onChange={(e) => onUpdate(block.id, {
                  content: { ...block.content, alignment: e.target.value }
                })}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Image Width</label>
              <select
                style={styles.select}
                value={block.content.width}
                onChange={(e) => onUpdate(block.id, {
                  content: { ...block.content, width: e.target.value }
                })}
              >
                <option value="100%">Full Width</option>
                <option value="75%">75% Width</option>
                <option value="50%">Half Width</option>
                <option value="25%">Quarter Width</option>
                <option value="200px">Small (200px)</option>
                <option value="400px">Medium (400px)</option>
              </select>
            </div>
            {block.content.src && (
              <div style={styles.imagePreviewContainer}>
                <label style={styles.label}>Preview:</label>
                <div style={{ textAlign: block.content.alignment }}>
                  {block.content.url ? (
                    <div>
                      <img
                        src={block.content.src}
                        alt={block.content.alt || 'Preview'}
                        style={{
                          maxWidth: block.content.width,
                          width: block.content.width,
                          height: 'auto',
                          borderRadius: block.settings.borderRadius || '0px',
                          border: '1px solid #ddd',
                          cursor: 'pointer'
                        }}
                        onClick={() => window.open(block.content.url, '_blank')}
                      />
                      <div style={styles.linkIndicator}>
                        <FiLink style={{ fontSize: '12px', marginRight: '4px' }} />
                        Click image to test link: {block.content.url}
                      </div>
                    </div>
                  ) : (
                    <img
                      src={block.content.src}
                      alt={block.content.alt || 'Preview'}
                      style={{
                        maxWidth: block.content.width,
                        width: block.content.width,
                        height: 'auto',
                        borderRadius: block.settings.borderRadius || '0px',
                        border: '1px solid #ddd'
                      }}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        );

      case 'divider':
        return (
          <div style={styles.dividerEditor}>
            <select
              style={styles.select}
              value={block.content.style}
              onChange={(e) => onUpdate(block.id, {
                content: { ...block.content, style: e.target.value }
              })}
            >
              <option value="solid">Solid Line</option>
              <option value="dashed">Dashed Line</option>
              <option value="dotted">Dotted Line</option>
            </select>
            <input
              type="color"
              style={styles.colorInput}
              value={block.content.color}
              onChange={(e) => onUpdate(block.id, {
                content: { ...block.content, color: e.target.value }
              })}
            />
          </div>
        );

      case 'social':
        return (
          <div style={styles.socialEditor}>
            <SocialButtons
              platforms={block.content.platforms}
              size={block.settings.size}
              spacing={block.settings.spacing}
              alignment={block.settings.alignment}
              onPlatformChange={(newPlatforms) => {
                onUpdate(block.id, {
                  content: { ...block.content, platforms: newPlatforms }
                });
              }}
              isEditor={true}
            />
            <div style={styles.socialSettings}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Alignment</label>
                <select
                  style={styles.select}
                  value={block.settings.alignment}
                  onChange={(e) => onUpdate(block.id, {
                    settings: { ...block.settings, alignment: e.target.value }
                  })}
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Button Size</label>
                <select
                  style={styles.select}
                  value={block.settings.size}
                  onChange={(e) => onUpdate(block.id, {
                    settings: { ...block.settings, size: e.target.value }
                  })}
                >
                  <option value="24px">Small</option>
                  <option value="32px">Medium</option>
                  <option value="40px">Large</option>
                </select>
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Button Spacing</label>
                <select
                  style={styles.select}
                  value={block.settings.spacing}
                  onChange={(e) => onUpdate(block.id, {
                    settings: { ...block.settings, spacing: e.target.value }
                  })}
                >
                  <option value="5px">Tight</option>
                  <option value="10px">Normal</option>
                  <option value="15px">Loose</option>
                </select>
              </div>
            </div>
          </div>
        );

      case 'columns':
        return (
          <div style={styles.columnsEditor}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Two Column Layout</label>
              <div style={styles.columnsContainer}>
                <div style={styles.columnEditor}>
                  <label style={styles.columnLabel}>Left Column</label>
                  <textarea
                    style={styles.columnTextarea}
                    value={block.content.column1 || ''}
                    onChange={(e) => onUpdate(block.id, {
                      content: { ...block.content, column1: e.target.value }
                    })}
                    placeholder="Left column content..."
                    rows={4}
                  />
                </div>
                <div style={styles.columnEditor}>
                  <label style={styles.columnLabel}>Right Column</label>
                  <textarea
                    style={styles.columnTextarea}
                    value={block.content.column2 || ''}
                    onChange={(e) => onUpdate(block.id, {
                      content: { ...block.content, column2: e.target.value }
                    })}
                    placeholder="Right column content..."
                    rows={4}
                  />
                </div>
              </div>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Column Gap</label>
              <select
                style={styles.select}
                value={block.settings.gap}
                onChange={(e) => onUpdate(block.id, {
                  settings: { ...block.settings, gap: e.target.value }
                })}
              >
                <option value="10px">Small Gap</option>
                <option value="20px">Medium Gap</option>
                <option value="30px">Large Gap</option>
              </select>
            </div>
          </div>
        );

      case 'spacer':
        return (
          <div style={styles.spacerEditor}>
            <label style={styles.label}>Height:</label>
            <input
              type="range"
              min="10"
              max="100"
              value={parseInt(block.content.height)}
              onChange={(e) => onUpdate(block.id, {
                content: { ...block.content, height: e.target.value + 'px' }
              })}
              style={styles.rangeInput}
            />
            <span style={styles.rangeValue}>{block.content.height}</span>
          </div>
        );

      default:
        return (
          <div style={styles.placeholderBlock}>
            <p>Block type "{block.type}" editor not implemented yet</p>
          </div>
        );
    }
  };

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, block.id, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={(e) => onDrop(e, index)}
      style={{
        ...styles.contentBlock,
        ...(isDraggedOver ? styles.dragOverBlock : {})
      }}
    >
      <div style={styles.blockHeader}>
        <div style={styles.blockInfo}>
          <FiMove style={styles.dragHandle} />
          <span style={styles.blockType}>{block.type.charAt(0).toUpperCase() + block.type.slice(1)}</span>
        </div>
        <div style={styles.blockActions}>
          <button
            style={styles.blockActionButton}
            onClick={() => onDuplicate(block.id)}
            title="Duplicate"
          >
            <FiCopy />
          </button>
          <button
            style={styles.blockActionButton}
            onClick={() => onRemove(block.id)}
            title="Delete"
          >
            <FiTrash2 />
          </button>
        </div>
      </div>
      <div style={styles.blockContent}>
        {renderBlockEditor()}
      </div>
    </div>
  );
};

export default BlockEditor;