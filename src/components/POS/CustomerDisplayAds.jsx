import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { useBusiness } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import SecurityWrapper from '../../Security/SecurityWrapper';
import SecurityUtils from '../../Security/SecurityUtils';
import TavariStyles from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import toast from 'react-hot-toast';
import { openCustomerDisplayWindow } from '../../utils/openCustomerDisplayWindow';
import {
  CUSTOMER_DISPLAY_AD_FULLSCREEN,
  CUSTOMER_DISPLAY_AD_HALF_SCREEN,
  normalizeCustomerDisplayAdType,
  isCustomerDisplayAdHalfScreen
} from '../../constants/customerDisplayAds';
import { adPassesCustomerDisplaySchedule } from '../../utils/customerDisplayAdSchedule';

/**
 * Comp-CustomerDisplayAds - Customer Display Advertisement Management
 * Purpose: Manage customer-facing display advertisements with settings and date controls
 * Built following Tavari Build Standards
 */
const CompCustomerDisplayAds = () => {
  const { business } = useBusiness();
  const { hasPermission, userRole, loading: permissionsLoading } = usePermissions();
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAd, setEditingAd] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [deploying, setDeploying] = useState(false);
  // Removed global settings - now handled per-ad
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    image_url: '',
    promo_code: '',
    display_order: 0,
    is_active: true,
    ad_type: CUSTOMER_DISPLAY_AD_FULLSCREEN,
    start_date: new Date().toISOString().split('T')[0],
    end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days from now
    indefinite_dates: false, // New: indefinite checkbox
    display_duration: 5, // Changed to seconds (5 seconds default)
    auto_rotate: true,
    show_promo_code: true,
    // New: Day/time scheduling
    schedule_days: [], // Array of days (0=Sunday, 1=Monday, etc.)
    schedule_start_time: '09:00', // Default 9 AM
    schedule_end_time: '17:00', // Default 5 PM
    schedule_all_day: false // New: all day checkbox
  });

  useEffect(() => {
    if (business?.id) loadAds();
  }, [business?.id]);

  // Removed global settings functions - now handled per-ad

  const handleDeployChanges = async () => {
    setDeploying(true);
    
    try {
      // Force refresh the ads to get latest data
      await loadAds();
      
      // Show success message
      alert('✅ Changes deployed successfully! Customer displays will update within 30 seconds.');
    } catch (error) {
      console.error('Deploy failed:', error);
      alert('❌ Error deploying changes: ' + error.message);
    } finally {
      setDeploying(false);
    }
  };

  const loadAds = async () => {
    try {
      if (!business?.id) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('customer_display_ads')
        .select('*')
        .eq('business_id', business.id)
        .order('display_order', { ascending: true });

      if (error) {
        console.error('Error loading ads:', error);
        throw error;
      }

      if (data && Array.isArray(data)) {
        setAds(data);
      } else {
        setAds([]);
      }
    } catch (error) {
      console.error('Failed to load ads:', error);
      setAds([]);
    } finally {
      setLoading(false);
    }
  };

  const uploadImage = async (file) => {
    try {
      
      // Security: Check permissions first
      if (!hasPermission('manage_ads')) {
        throw new Error('Insufficient permissions to upload images');
      }

      // Security: Validate file
      if (!file || !file.name) {
        throw new Error('Invalid file provided for upload');
      }

      // Security: File type validation
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        throw new Error('Invalid file type. Only images (JPEG, PNG, GIF, WebP) are allowed');
      }

      // Security: File size validation (max 10MB)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        throw new Error('File too large. Maximum size is 10MB');
      }

      // Security: Filename validation
      const xssCheck = SecurityUtils.checkForXSS(file.name);
      if (!xssCheck.safe) {
        throw new Error(`Invalid filename: ${xssCheck.threat} detected`);
      }
      
      const sqlCheck = SecurityUtils.checkForSQLInjection(file.name);
      if (!sqlCheck.safe) {
        throw new Error(`Invalid filename: ${sqlCheck.threat} detected`);
      }

      if (!business?.id) {
        throw new Error('Business ID required for image upload');
      }

      const fileExt = file.name.split('.').pop();
      if (!fileExt) {
        throw new Error('File must have a valid extension');
      }

      // Security: Sanitize filename
      const sanitizedFileName = SecurityUtils.sanitizeString(file.name);
      const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
      const filePath = `customer-display-ads/${business.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('images')
        .upload(filePath, file);

      if (uploadError) {
        console.error('Upload failed:', uploadError);
        throw uploadError;
      }

      const { data } = supabase.storage
        .from('images')
        .getPublicUrl(filePath);

      return data.publicUrl;
    } catch (error) {
      console.error('Image upload failed:', error);
      throw error;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setUploading(true);
    
    try {
      
      // Security: Check permissions
      if (!hasPermission('manage_ads')) {
        throw new Error('Insufficient permissions to manage ads');
      }

      // Security: Input validation
      const titleXssCheck = SecurityUtils.checkForXSS(formData.title);
      if (!titleXssCheck.safe) {
        throw new Error(`Invalid title: ${titleXssCheck.threat} detected`);
      }
      
      const titleSqlCheck = SecurityUtils.checkForSQLInjection(formData.title);
      if (!titleSqlCheck.safe) {
        throw new Error(`Invalid title: ${titleSqlCheck.threat} detected`);
      }

      if (formData.description) {
        const descXssCheck = SecurityUtils.checkForXSS(formData.description);
        if (!descXssCheck.safe) {
          throw new Error(`Invalid description: ${descXssCheck.threat} detected`);
        }
        
        const descSqlCheck = SecurityUtils.checkForSQLInjection(formData.description);
        if (!descSqlCheck.safe) {
          throw new Error(`Invalid description: ${descSqlCheck.threat} detected`);
        }
      }

      if (formData.promo_code) {
        const promoXssCheck = SecurityUtils.checkForXSS(formData.promo_code);
        if (!promoXssCheck.safe) {
          throw new Error(`Invalid promo code: ${promoXssCheck.threat} detected`);
        }
        
        const promoSqlCheck = SecurityUtils.checkForSQLInjection(formData.promo_code);
        if (!promoSqlCheck.safe) {
          throw new Error(`Invalid promo code: ${promoSqlCheck.threat} detected`);
        }
      }

      // Defensive validation
      if (!business?.id) {
        throw new Error('Business ID is required to save ads');
      }

      if (!formData.title || formData.title.trim() === '') {
        throw new Error('Ad title is required');
      }

      if (!formData.image_url && !imageFile) {
        throw new Error('Either image file or image URL is required');
      }

      let imageUrl = formData.image_url;
      
      // Upload new image if file is selected
      if (imageFile) {
        console.log('📤 CompCustomerDisplayAds: Uploading image file...');
        imageUrl = await uploadImage(imageFile);
      }

      const adData = {
        ...formData,
        image_url: imageUrl,
        business_id: business.id,
        title: formData.title.trim(),
        description: formData.description?.trim() || '',
        promo_code: formData.promo_code?.trim() || '',
        ad_type: normalizeCustomerDisplayAdType(formData.ad_type)
      };

      console.log(`💾 CompCustomerDisplayAds: ${editingAd ? 'Updating' : 'Creating'} ad: ${adData.title}`);

      if (editingAd) {
        // Update existing ad
        const { error } = await supabase
          .from('customer_display_ads')
          .update(adData)
          .eq('id', editingAd.id);

        if (error) {
          console.error('❌ CompCustomerDisplayAds: Update failed:', error);
          throw error;
        }
        console.log('✅ CompCustomerDisplayAds: Ad updated successfully');
      } else {
        // Create new ad
        const { error } = await supabase
          .from('customer_display_ads')
          .insert([adData]);

        if (error) {
          console.error('❌ CompCustomerDisplayAds: Insert failed:', error);
          throw error;
        }
        console.log('✅ CompCustomerDisplayAds: Ad created successfully');
      }

      setShowAddModal(false);
      setEditingAd(null);
      setFormData({
        title: '',
        description: '',
        image_url: '',
        promo_code: '',
        display_order: 0,
        is_active: true,
        ad_type: CUSTOMER_DISPLAY_AD_FULLSCREEN,
        start_date: new Date().toISOString().split('T')[0],
        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        indefinite_dates: false,
        display_duration: 5,
        auto_rotate: true,
        show_promo_code: true,
        schedule_days: [],
        schedule_start_time: '09:00',
        schedule_end_time: '17:00',
        schedule_all_day: false
      });
      setImageFile(null);
      setImagePreview(null);
      loadAds();
    } catch (error) {
      console.error('❌ CompCustomerDisplayAds: Ad submission failed:', error);
      alert(`Error saving ad: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleEdit = (ad) => {
    setEditingAd(ad);
    setFormData({
      ...ad,
      ad_type: normalizeCustomerDisplayAdType(ad.ad_type),
      start_date: ad.start_date || new Date().toISOString().split('T')[0],
      end_date: ad.end_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    });
    setImagePreview(ad.image_url);
    setImageFile(null);
    setShowAddModal(true);
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setImagePreview(e.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this ad?')) return;

    try {
      const { error } = await supabase
        .from('customer_display_ads')
        .delete()
        .eq('id', id);

      if (error) throw error;
      loadAds();
    } catch (error) {
      console.error('Error deleting ad:', error);
      alert('Error deleting ad: ' + error.message);
    }
  };

  const toggleActive = async (ad) => {
    try {
      const { error } = await supabase
        .from('customer_display_ads')
        .update({ is_active: !ad.is_active })
        .eq('id', ad.id);

      if (error) throw error;
      loadAds();
    } catch (error) {
      console.error('Error updating ad:', error);
      alert('Error updating ad: ' + error.message);
    }
  };

  // Security: Check permissions
  if (permissionsLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading permissions...</div>
      </div>
    );
  }

  if (!hasPermission('view_ads')) {
    return (
      <div style={styles.container}>
        <div style={styles.accessDenied}>
          <h2>Access Denied</h2>
          <p>You don't have permission to view customer display ads.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading ads...</div>
      </div>
    );
  }

  return (
    <SecurityWrapper
      componentName="CompCustomerDisplayAds"
      enableRateLimiting={true}
      enableDeviceTracking={true}
      enableInputValidation={true}
      enableAuditLogging={true}
      sensitiveComponent={true}
      securityLevel="high"
      autoBlock={true}
    >
      <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Customer Display Ads</h1>
        <p style={styles.syncNote}>
          The paired customer display app uses your <strong>sync token</strong> (not staff login) to load ads.
          <strong> Ad Type</strong> (<code>idle</code> vs <code>transaction</code>), dates, and schedule below use the
          same rules as the kiosk. Cards marked <em>Eligible on kiosk now</em> pass those filters; inactive ads never
          appear on the customer screen.
        </p>
        <div style={styles.headerButtons}>
          {hasPermission('manage_ads') && (
            <button
              style={styles.deployButton}
              onClick={handleDeployChanges}
              disabled={deploying}
            >
              {deploying ? '🔄 Deploying...' : '🚀 Deploy Changes'}
            </button>
          )}
          <button
            style={styles.fullscreenButton}
            onClick={async () => {
              const result = await openCustomerDisplayWindow({ tryFullscreen: true });
              if (!result.ok && result.reason === 'popup_blocked') {
                toast.error(
                  'Pop-up blocked. Allow pop-ups for this site to open the customer display.'
                );
              }
            }}
          >
            🖥️ Open Customer Display
          </button>
          {hasPermission('manage_ads') && (
            <button
              style={styles.addButton}
              onClick={() => setShowAddModal(true)}
            >
              Add New Ad
            </button>
          )}
        </div>
      </div>

      <div style={styles.adsGrid}>
        {ads.map((ad) => (
          <div key={ad.id} style={styles.adCard}>
            <div style={styles.adImageContainer}>
              <img
                src={ad.image_url}
                alt={ad.title}
                style={styles.adImage}
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'block';
                }}
              />
              <div style={styles.placeholderImage}>
                No Image
              </div>
            </div>
            
            <div style={styles.adContent}>
              <h3 style={styles.adTitle}>{ad.title}</h3>
              <p style={styles.adDescription}>{ad.description}</p>
              {ad.promo_code && (
                <div style={styles.promoCode}>
                  <strong>Promo:</strong> {ad.promo_code}
                </div>
              )}
              <div style={styles.adMeta}>
                <span style={styles.displayOrder}>Order: {ad.display_order}</span>
                <span style={styles.adType}>
                  {isCustomerDisplayAdHalfScreen(ad)
                    ? '🛒 Transaction (Half-Width)'
                    : '🖥️ Idle (Full-Screen)'}
                </span>
                <span style={ad.is_active ? styles.activeStatus : styles.inactiveStatus}>
                  {ad.is_active ? 'Active' : 'Inactive'}
                </span>
                {ad.is_active && adPassesCustomerDisplaySchedule(ad) ? (
                  <span style={styles.kioskLiveBadge}>Eligible on kiosk now</span>
                ) : ad.is_active ? (
                  <span style={styles.kioskScheduleMuted}>Outside schedule / date window</span>
                ) : null}
              </div>
            </div>

            <div style={styles.adActions}>
              {hasPermission('manage_ads') && (
                <>
                  <button
                    style={styles.actionButton}
                    onClick={() => handleEdit(ad)}
                  >
                    Edit
                  </button>
                  <button
                    style={styles.actionButton}
                    onClick={() => toggleActive(ad)}
                  >
                    {ad.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    style={{...styles.actionButton, ...styles.deleteButton}}
                    onClick={() => handleDelete(ad.id)}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h2>{editingAd ? 'Edit Ad' : 'Add New Ad'}</h2>
              <button
                style={styles.closeButton}
                onClick={() => {
                  setShowAddModal(false);
                  setEditingAd(null);
                  setFormData({
                    title: '',
                    description: '',
                    image_url: '',
                    promo_code: '',
                    display_order: 0,
                    is_active: true,
                    start_date: new Date().toISOString().split('T')[0],
                    end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
                  });
                }}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit} style={styles.form}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({...formData, title: e.target.value})}
                  style={styles.input}
                  required
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  style={styles.textarea}
                  rows={3}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Ad Type *</label>
                <select
                  value={normalizeCustomerDisplayAdType(formData.ad_type)}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      ad_type: normalizeCustomerDisplayAdType(e.target.value)
                    })
                  }
                  style={styles.select}
                  required
                >
                  <option value={CUSTOMER_DISPLAY_AD_FULLSCREEN}>
                    Idle Ads (Full-Screen)
                  </option>
                  <option value={CUSTOMER_DISPLAY_AD_HALF_SCREEN}>
                    Transaction Ads (Half-Width)
                  </option>
                </select>
                <div style={styles.helpText}>
                  <strong>Idle Ads:</strong> Display full-screen when no transaction is active<br/>
                  <strong>Transaction Ads:</strong> Display half-width during transactions
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Image Upload *</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  style={styles.fileInput}
                />
                {imagePreview && (
                  <div style={styles.imagePreview}>
                    <img src={imagePreview} alt="Preview" style={styles.previewImage} />
                  </div>
                )}
                <div style={styles.orDivider}>OR</div>
                <input
                  type="url"
                  placeholder="Enter image URL"
                  value={formData.image_url}
                  onChange={(e) => setFormData({...formData, image_url: e.target.value})}
                  style={styles.input}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Promo Code</label>
                <input
                  type="text"
                  value={formData.promo_code}
                  onChange={(e) => setFormData({...formData, promo_code: e.target.value})}
                  style={styles.input}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Display Order</label>
                <input
                  type="number"
                  value={formData.display_order}
                  onChange={(e) => setFormData({...formData, display_order: parseInt(e.target.value) || 0})}
                  style={styles.input}
                />
              </div>

              <div style={styles.formGroup}>
                <TavariCheckbox
                  checked={formData.indefinite_dates}
                  onChange={(checked) => setFormData({...formData, indefinite_dates: checked})}
                  label="Indefinite (No End Date)"
                  size="md"
                />
                <div style={styles.helpText}>Check this to run the ad indefinitely without an end date</div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Start Date</label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({...formData, start_date: e.target.value})}
                  style={styles.input}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>End Date</label>
                <input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({...formData, end_date: e.target.value})}
                  style={styles.input}
                  disabled={formData.indefinite_dates}
                />
                {formData.indefinite_dates && (
                  <div style={styles.helpText}>End date disabled - ad will run indefinitely</div>
                )}
              </div>

              <div style={styles.formGroup}>
                <TavariCheckbox
                  checked={formData.is_active}
                  onChange={(checked) => setFormData({...formData, is_active: checked})}
                  label="Active"
                  size="md"
                />
              </div>

              {/* Per-Ad Display Settings */}
              <div style={styles.sectionHeader}>
                <h3 style={styles.sectionTitle}>Display Settings</h3>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Display Duration (seconds)</label>
                <input
                  type="number"
                  value={formData.display_duration}
                  onChange={(e) => setFormData({...formData, display_duration: parseInt(e.target.value) || 5})}
                  style={styles.input}
                  min="1"
                  max="60"
                />
                <div style={styles.helpText}>How long this ad displays (1-60 seconds)</div>
              </div>

              <div style={styles.formGroup}>
                <TavariCheckbox
                  checked={formData.auto_rotate}
                  onChange={(checked) => setFormData({...formData, auto_rotate: checked})}
                  label="Auto Rotate"
                  size="md"
                />
                <div style={styles.helpText}>Include this ad in automatic rotation</div>
              </div>

              <div style={styles.formGroup}>
                <TavariCheckbox
                  checked={formData.show_promo_code}
                  onChange={(checked) => setFormData({...formData, show_promo_code: checked})}
                  label="Show Promo Code"
                  size="md"
                />
                <div style={styles.helpText}>Display promo code on this ad</div>
              </div>

              {/* Day/Time Scheduling Section */}
              <div style={styles.sectionHeader}>
                <h3 style={styles.sectionTitle}>Schedule Settings</h3>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Days of Week</label>
                <div style={styles.daySelector}>
                  {[
                    { value: 0, label: 'Sun' },
                    { value: 1, label: 'Mon' },
                    { value: 2, label: 'Tue' },
                    { value: 3, label: 'Wed' },
                    { value: 4, label: 'Thu' },
                    { value: 5, label: 'Fri' },
                    { value: 6, label: 'Sat' }
                  ].map(day => (
                    <label key={day.value} style={styles.dayOption}>
                      <input
                        type="checkbox"
                        checked={formData.schedule_days.includes(day.value)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormData({
                              ...formData,
                              schedule_days: [...formData.schedule_days, day.value]
                            });
                          } else {
                            setFormData({
                              ...formData,
                              schedule_days: formData.schedule_days.filter(d => d !== day.value)
                            });
                          }
                        }}
                        style={styles.dayCheckbox}
                      />
                      {day.label}
                    </label>
                  ))}
                </div>
                <div style={styles.helpText}>Select which days this ad should run (leave empty for all days)</div>
              </div>

              <div style={styles.formGroup}>
                <TavariCheckbox
                  checked={formData.schedule_all_day}
                  onChange={(checked) => setFormData({...formData, schedule_all_day: checked})}
                  label="All Day"
                  size="md"
                />
                <div style={styles.helpText}>Run this ad all day on selected days</div>
              </div>

              {!formData.schedule_all_day && (
                <>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Start Time</label>
                    <input
                      type="time"
                      value={formData.schedule_start_time}
                      onChange={(e) => setFormData({...formData, schedule_start_time: e.target.value})}
                      style={styles.input}
                    />
                    <div style={styles.helpText}>What time to start showing this ad</div>
                  </div>

                  <div style={styles.formGroup}>
                    <label style={styles.label}>End Time</label>
                    <input
                      type="time"
                      value={formData.schedule_end_time}
                      onChange={(e) => setFormData({...formData, schedule_end_time: e.target.value})}
                      style={styles.input}
                    />
                    <div style={styles.helpText}>What time to stop showing this ad</div>
                  </div>
                </>
              )}

              <div style={styles.formActions}>
                <button
                  type="button"
                  style={styles.cancelButton}
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingAd(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={styles.saveButton}
                  disabled={uploading}
                >
                  {uploading ? 'Uploading...' : (editingAd ? 'Update' : 'Create') + ' Ad'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Removed global settings modal - now handled per-ad */}
      </div>
    </SecurityWrapper>
  );
};

const styles = {
  container: {
    padding: '20px', // Tavari Build Standards: 20px edge padding
    paddingTop: '60px', // Additional top padding to clear the header
    maxWidth: '1200px',
    margin: '0 auto',
    minHeight: '100vh',
  },
  loading: {
    textAlign: 'center',
    fontSize: '18px',
    color: TavariStyles.colors.gray600,
    padding: '40px',
  },
  accessDenied: {
    textAlign: 'center',
    padding: '40px',
    backgroundColor: TavariStyles.colors.error + '10',
    borderRadius: '8px',
    border: `1px solid ${TavariStyles.colors.error}`,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '16px',
    marginBottom: '30px',
    paddingBottom: '20px',
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
  },
  syncNote: {
    margin: '10px 0 0 0',
    fontSize: '14px',
    lineHeight: 1.5,
    color: TavariStyles.colors.gray600,
    maxWidth: '720px',
  },
  headerButtons: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
  },
  settingsButton: {
    // Tavari Build Standards: White button with teal border + dark grey text
    backgroundColor: TavariStyles.colors.white,
    border: `2px solid ${TavariStyles.colors.primary}`,
    color: TavariStyles.colors.gray700,
    padding: '12px 24px',
    borderRadius: '8px',
    fontWeight: 'bold',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: TavariStyles.colors.gray800,
    margin: 0,
  },
  addButton: {
    // Tavari Build Standards: Full-width solid teal with white bold text
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    padding: '12px 24px',
    borderRadius: '8px',
    fontWeight: 'bold',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  deployButton: {
    // Tavari Build Standards: Full-width solid teal with white bold text
    backgroundColor: TavariStyles.colors.success,
    color: TavariStyles.colors.white,
    border: 'none',
    padding: '12px 24px',
    borderRadius: '8px',
    fontWeight: 'bold',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  fullscreenButton: {
    // Tavari Build Standards: Full-width solid teal with white bold text
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    padding: '12px 24px',
    borderRadius: '8px',
    fontWeight: 'bold',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  adsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '20px',
  },
  adCard: {
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: '8px',
    overflow: 'hidden',
    backgroundColor: 'white',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  adImageContainer: {
    position: 'relative',
    height: '200px',
    backgroundColor: TavariStyles.colors.gray100,
  },
  adImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  placeholderImage: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    color: TavariStyles.colors.gray500,
    fontSize: '16px',
    display: 'none',
  },
  adContent: {
    padding: '16px',
  },
  adTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    marginBottom: '8px',
    color: TavariStyles.colors.gray800,
  },
  adDescription: {
    fontSize: '14px',
    color: TavariStyles.colors.gray600,
    marginBottom: '12px',
    lineHeight: 1.4,
  },
  promoCode: {
    fontSize: '14px',
    color: TavariStyles.colors.success,
    fontWeight: 'bold',
    marginBottom: '12px',
  },
  adMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center',
    fontSize: '13px',
  },
  displayOrder: {
    color: TavariStyles.colors.gray500,
  },
  adType: {
    color: TavariStyles.colors.primary,
    fontWeight: 'bold',
    fontSize: '13px',
  },
  activeStatus: {
    color: TavariStyles.colors.success,
    fontWeight: 'bold',
  },
  inactiveStatus: {
    color: TavariStyles.colors.danger,
    fontWeight: 'bold',
  },
  kioskLiveBadge: {
    backgroundColor: '#ecfdf5',
    color: '#047857',
    fontWeight: 'bold',
    padding: '4px 8px',
    borderRadius: '6px',
    fontSize: '11px',
  },
  kioskScheduleMuted: {
    color: TavariStyles.colors.gray500,
    fontSize: '11px',
    fontStyle: 'italic',
  },
  adActions: {
    display: 'flex',
    gap: '8px',
    padding: '16px',
    borderTop: `1px solid ${TavariStyles.colors.gray200}`,
  },
  actionButton: {
    flex: 1,
    padding: '8px 12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '4px',
    backgroundColor: 'white',
    color: TavariStyles.colors.gray700,
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  deleteButton: {
    color: TavariStyles.colors.danger,
    borderColor: TavariStyles.colors.danger,
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '24px',
    maxWidth: '500px',
    width: '90%',
    maxHeight: '80vh',
    overflow: 'auto',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    paddingBottom: '16px',
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    cursor: 'pointer',
    color: TavariStyles.colors.gray500,
    padding: '0',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    fontWeight: 'bold',
    color: TavariStyles.colors.gray700,
    fontSize: '14px',
  },
  input: {
    padding: '12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: 'inherit',
  },
  textarea: {
    padding: '12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: 'inherit',
    resize: 'vertical',
  },
  select: {
    padding: '12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: 'inherit',
    backgroundColor: TavariStyles.colors.white,
    cursor: 'pointer',
  },
  helpText: {
    fontSize: '13px',
    color: TavariStyles.colors.gray600,
    marginTop: '6px',
    lineHeight: '1.4',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    color: TavariStyles.colors.gray700,
  },
  checkbox: {
    width: '16px',
    height: '16px',
  },
  formActions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
    marginTop: '20px',
  },
  cancelButton: {
    padding: '12px 24px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '4px',
    backgroundColor: 'white',
    color: TavariStyles.colors.gray700,
    cursor: 'pointer',
  },
  saveButton: {
    padding: '12px 24px',
    border: 'none',
    borderRadius: '4px',
    backgroundColor: TavariStyles.colors.primary,
    color: 'white',
    cursor: 'pointer',
  },
  fileInput: {
    width: '100%',
    padding: '12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: 'inherit',
    backgroundColor: 'white',
  },
  imagePreview: {
    marginTop: '12px',
    textAlign: 'center',
  },
  previewImage: {
    maxWidth: '200px',
    maxHeight: '150px',
    objectFit: 'cover',
    borderRadius: '4px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
  },
  orDivider: {
    textAlign: 'center',
    margin: '12px 0',
    color: TavariStyles.colors.gray500,
    fontSize: '14px',
    fontWeight: 'bold',
  },
  sectionHeader: {
    marginTop: '24px',
    marginBottom: '16px',
    paddingTop: '16px',
    borderTop: `1px solid ${TavariStyles.colors.gray200}`,
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: TavariStyles.colors.gray800,
    margin: 0,
  },
  daySelector: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
    marginTop: '8px',
  },
  dayOption: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    cursor: 'pointer',
    padding: '8px 12px',
    borderRadius: '6px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    backgroundColor: TavariStyles.colors.white,
    transition: 'all 0.2s ease',
    fontSize: '14px',
    fontWeight: '500',
  },
  dayCheckbox: {
    margin: 0,
    cursor: 'pointer',
  },
};

export default CompCustomerDisplayAds;
