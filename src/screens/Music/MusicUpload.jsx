// src/screens/Music/MusicUpload.jsx - WITH PERMISSION SYSTEM INTEGRATION
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiUpload, FiMusic, FiCheck, FiX, FiAlertCircle, FiLock } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';

// Tavari Build Standards - Required imports
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useSecurityContext } from '../../Security/useSecurityContext';

// Permission system integration
import { usePermissions } from '../../hooks/usePermissions';
import toast from 'react-hot-toast';
import TavariCheckbox from '../../components/UI/TavariCheckbox';

/**
 * Music Upload - Upload MP3 files to music library
 * Integrates with Tavari permission system for access control
 */
const MusicUpload = () => {
  const navigate = useNavigate();

  // Tavari standardized authentication
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'MusicUpload'
  });

  // Permission system integration
  const { 
    hasPermission, 
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Tavari standardized security
  // DISABLED device tracking to prevent AudioContext errors
  const security = useSecurityContext({
    enableRateLimiting: true,
    enableDeviceTracking: false, // DISABLED - prevents AudioContext errors
    enableInputValidation: true,
    enableAuditLogging: true,
    componentName: 'MusicUpload',
    sensitiveComponent: false
  });

  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadQueue, setUploadQueue] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Permission check based on permissionRegistry.js
  const canUpload = hasPermission('music.library.upload') || hasElevatedPrivileges();

  // File size limit (50MB)
  const MAX_FILE_SIZE = 50 * 1024 * 1024;

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canUpload) {
      toast.error('You do not have permission to upload music');
      navigate('/dashboard/music/library');
    }
  }, [permissionsLoading, canUpload, navigate]);

  // Handle file selection with validation
  const handleFileSelect = (files) => {
    if (!canUpload) {
      toast.error('You do not have permission to upload music');
      return;
    }

    const fileArray = Array.from(files);
    const validFiles = [];
    const errors = [];

    fileArray.forEach(file => {
      // Check file type
      const isMP3 = file.type === 'audio/mp3' || 
                    file.type === 'audio/mpeg' || 
                    file.name.toLowerCase().endsWith('.mp3');
      
      if (!isMP3) {
        errors.push(`${file.name}: Not an MP3 file`);
        return;
      }

      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: File too large (max 50MB)`);
        return;
      }

      validFiles.push(file);
    });

    // Show errors if any
    if (errors.length > 0) {
      toast.error(`${errors.length} file(s) filtered out:\n${errors.slice(0, 3).join('\n')}`, {
        duration: 5000
      });
    }

    if (validFiles.length === 0) {
      return;
    }

    // Create upload queue entries
    const newUploads = validFiles.map(file => ({
      id: Date.now() + Math.random(),
      file,
      name: file.name.replace('.mp3', ''),
      artist: '',
      includeInShuffle: true,
      status: 'pending', // pending, uploading, success, error
      progress: 0,
      error: null
    }));

    setUploadQueue(prev => [...prev, ...newUploads]);
    toast.success(`${validFiles.length} file(s) added to queue`);
  };

  // Handle drag and drop
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    
    if (!canUpload) {
      toast.error('You do not have permission to upload music');
      return;
    }

    const files = e.dataTransfer.files;
    handleFileSelect(files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    if (canUpload) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  // Handle file input click
  const handleFileInputChange = (e) => {
    handleFileSelect(e.target.files);
  };

  // Update track info
  const updateTrackInfo = (id, field, value) => {
    setUploadQueue(prev => prev.map(track => 
      track.id === id ? { ...track, [field]: value } : track
    ));
  };

  // Remove track from queue
  const removeTrack = (id) => {
    setUploadQueue(prev => prev.filter(track => track.id !== id));
  };

  // Upload files to Supabase with permission check
  const uploadFiles = async () => {
    // Permission check
    if (!canUpload) {
      toast.error('You do not have permission to upload music');
      return;
    }

    if (!auth.selectedBusinessId) {
      toast.error('Please select a business first');
      return;
    }

    // Rate limiting check
    const rateLimitResult = await security.checkRateLimit?.('music_upload', 10, 60000);
    if (rateLimitResult && !rateLimitResult.allowed) {
      toast.error('Upload rate limit exceeded. Please wait before uploading more files.');
      return;
    }

    setIsUploading(true);
    let successCount = 0;
    let errorCount = 0;

    for (const track of uploadQueue) {
      if (track.status !== 'pending') continue;

      try {
        // Update status to uploading
        setUploadQueue(prev => prev.map(t => 
          t.id === track.id ? { ...t, status: 'uploading', progress: 0 } : t
        ));

        // Create unique filename with sanitized name
        const sanitizedFileName = track.file.name
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .replace(/\s+/g, '_')
          .toLowerCase();
        
        const fileName = `${auth.selectedBusinessId}/${Date.now()}_${sanitizedFileName}`;
        
        // Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('music-files')
          .upload(fileName, track.file, {
            onUploadProgress: (progress) => {
              const percent = (progress.loaded / progress.total) * 100;
              setUploadQueue(prev => prev.map(t => 
                t.id === track.id ? { ...t, progress: percent } : t
              ));
            }
          });

        if (uploadError) throw uploadError;

        // Get file duration
        const audio = new Audio();
        audio.src = URL.createObjectURL(track.file);
        
        const duration = await new Promise((resolve) => {
          audio.addEventListener('loadedmetadata', () => {
            resolve(Math.round(audio.duration));
          });
          audio.addEventListener('error', () => {
            resolve(0);
          });
          setTimeout(() => resolve(0), 5000); // Timeout after 5 seconds
        });

        // Get file size
        const fileSize = track.file.size;

        // Insert into database
        const { error: dbError } = await supabase
          .from('music_tracks')
          .insert({
            title: track.name || track.file.name.replace('.mp3', ''),
            artist: track.artist || null,
            file_path: uploadData.path,
            duration: duration,
            file_size: fileSize,
            include_in_shuffle: track.includeInShuffle,
            business_id: auth.selectedBusinessId,
            uploaded_by: auth.authUser.id
          });

        if (dbError) throw dbError;

        // Security logging
        await security.logSecurityEvent?.('track_uploaded', {
          track_title: track.name,
          file_size: fileSize,
          duration: duration,
          uploaded_by: auth.authUser.id,
          business_id: auth.selectedBusinessId
        }, 'low');

        // Update status to success
        setUploadQueue(prev => prev.map(t => 
          t.id === track.id ? { ...t, status: 'success', progress: 100 } : t
        ));

        successCount++;

      } catch (error) {
        console.error('Upload error:', error);
        setUploadQueue(prev => prev.map(t => 
          t.id === track.id ? { 
            ...t, 
            status: 'error', 
            error: error.message 
          } : t
        ));
        errorCount++;
      }
    }

    setIsUploading(false);

    // Show summary
    if (successCount > 0) {
      toast.success(`Successfully uploaded ${successCount} track(s)`);
    }
    if (errorCount > 0) {
      toast.error(`Failed to upload ${errorCount} track(s)`);
    }
  };

  // Clear completed uploads
  const clearCompleted = () => {
    const completedCount = uploadQueue.filter(track => 
      track.status === 'success' || track.status === 'error'
    ).length;
    
    setUploadQueue(prev => prev.filter(track => 
      track.status !== 'success' && track.status !== 'error'
    ));

    if (completedCount > 0) {
      toast.success(`Cleared ${completedCount} completed item(s)`);
    }
  };

  const styles = {
    container: {
      ...TavariStyles.layout.container,
      maxWidth: '800px',
      margin: '0 auto'
    },
    header: {
      textAlign: 'center',
      marginBottom: TavariStyles.spacing['4xl'],
      paddingBottom: TavariStyles.spacing.xl,
      borderBottom: `2px solid ${TavariStyles.colors.gray200}`
    },
    headerIcon: {
      color: TavariStyles.colors.primary,
      marginBottom: TavariStyles.spacing.md
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      margin: `${TavariStyles.spacing.md} 0`
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600,
      margin: 0
    },
    uploadArea: {
      borderStyle: 'dashed',
      borderWidth: '3px',
      borderColor: TavariStyles.colors.primary,
      borderRadius: TavariStyles.borderRadius.lg,
      padding: '60px 20px',
      textAlign: 'center',
      cursor: canUpload ? 'pointer' : 'not-allowed',
      transition: TavariStyles.transitions.normal,
      marginBottom: TavariStyles.spacing['4xl'],
      backgroundColor: TavariStyles.colors.gray50,
      opacity: canUpload ? 1 : 0.5
    },
    uploadAreaDragOver: {
      borderColor: TavariStyles.colors.info,
      backgroundColor: TavariStyles.colors.infoBg,
      transform: 'scale(1.02)'
    },
    uploadIcon: {
      color: TavariStyles.colors.primary,
      marginBottom: TavariStyles.spacing.lg
    },
    uploadTitle: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      margin: `0 0 ${TavariStyles.spacing.md} 0`
    },
    uploadDescription: {
      fontSize: TavariStyles.typography.fontSize.md,
      color: TavariStyles.colors.gray600,
      margin: 0
    },
    queueSection: {
      marginBottom: TavariStyles.spacing['4xl']
    },
    queueHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.lg,
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.md
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      margin: 0
    },
    queueActions: {
      display: 'flex',
      gap: TavariStyles.spacing.md
    },
    uploadButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary
    },
    clearButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary
    },
    trackList: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.md
    },
    trackItem: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.lg,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.md
    },
    trackInfo: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.md,
      flex: 1,
      minWidth: '300px'
    },
    trackStatus: {
      width: '30px',
      height: '30px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    spinner: {
      width: '20px',
      height: '20px',
      border: `2px solid ${TavariStyles.colors.gray200}`,
      borderTop: `2px solid ${TavariStyles.colors.primary}`,
      borderRadius: '50%',
      animation: 'spin 1s linear infinite'
    },
    trackDetails: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm,
      flex: 1
    },
    trackInput: {
      ...TavariStyles.components.form.input,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    trackActions: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.md
    },
    progressBar: {
      width: '100px',
      height: '8px',
      backgroundColor: TavariStyles.colors.gray200,
      borderRadius: TavariStyles.borderRadius.full,
      overflow: 'hidden'
    },
    progressFill: {
      height: '100%',
      backgroundColor: TavariStyles.colors.primary,
      transition: TavariStyles.transitions.normal
    },
    errorMessage: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      color: TavariStyles.colors.error,
      fontSize: TavariStyles.typography.fontSize.xs,
      maxWidth: '150px'
    },
    removeButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.danger,
      ...TavariStyles.components.button.sizes.sm,
      minWidth: 'auto',
      padding: TavariStyles.spacing.sm
    },
    instructionsSection: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl
    },
    instructionsTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      margin: `0 0 ${TavariStyles.spacing.md} 0`
    },
    instructionsList: {
      margin: 0,
      paddingLeft: TavariStyles.spacing.xl,
      color: TavariStyles.colors.gray600,
      lineHeight: TavariStyles.typography.lineHeight.relaxed
    },
    loading: {
      ...TavariStyles.layout.flexCenter,
      minHeight: '400px',
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600
    },
    accessDenied: {
      textAlign: 'center',
      padding: '60px 20px',
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      marginTop: TavariStyles.spacing['4xl']
    }
  };

  // Show loading while permissions are being checked
  if (permissionsLoading || !auth.isReady) {
    return (
      <POSAuthWrapper
        componentName="MusicUpload"
        requiredRoles={['manager', 'owner']}
      >
        <SecurityWrapper
          componentName="MusicUpload"
          sensitiveComponent={false}
        >
          <div style={styles.loading}>
            {permissionsLoading ? 'Loading permissions...' : 'Loading...'}
          </div>
        </SecurityWrapper>
      </POSAuthWrapper>
    );
  }

  // Show access denied if no permission
  if (!canUpload) {
    return (
      <POSAuthWrapper
        componentName="MusicUpload"
        requiredRoles={['manager', 'owner']}
      >
        <SecurityWrapper
          componentName="MusicUpload"
          sensitiveComponent={false}
        >
          <div style={styles.container}>
            <div style={styles.accessDenied}>
              <FiLock size={64} style={{ color: TavariStyles.colors.error, marginBottom: TavariStyles.spacing.lg }} />
              <h2 style={{ fontSize: TavariStyles.typography.fontSize['2xl'], fontWeight: TavariStyles.typography.fontWeight.bold, marginBottom: TavariStyles.spacing.md }}>
                Access Denied
              </h2>
              <p style={{ fontSize: TavariStyles.typography.fontSize.md, color: TavariStyles.colors.gray600, marginBottom: TavariStyles.spacing.lg }}>
                You do not have permission to upload music to the library.
              </p>
              <button 
                onClick={() => navigate('/dashboard/music/library')}
                style={styles.uploadButton}
              >
                Back to Music Library
              </button>
            </div>
          </div>
        </SecurityWrapper>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper
      componentName="MusicUpload"
      requiredRoles={['manager', 'owner']}
    >
      <SecurityWrapper
        componentName="MusicUpload"
        sensitiveComponent={false}
        enableRateLimiting={true}
        enableAuditLogging={true}
      >
        <div style={styles.container}>
          <div style={styles.header}>
            <FiUpload size={48} style={styles.headerIcon} />
            <h1 style={styles.title}>Upload Music</h1>
            <p style={styles.subtitle}>
              Add MP3 files to your music library for {auth.businessData?.name || 'your business'}
            </p>
          </div>

          {/* Upload Area */}
          <div
            style={{
              ...styles.uploadArea,
              ...(isDragOver ? styles.uploadAreaDragOver : {})
            }}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => canUpload && fileInputRef.current?.click()}
          >
            <FiUpload size={48} style={styles.uploadIcon} />
            <h3 style={styles.uploadTitle}>
              {isDragOver ? 'Drop your MP3 files here' : 'Drag & drop MP3 files here'}
            </h3>
            <p style={styles.uploadDescription}>
              or click to browse and select files
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".mp3,audio/mp3,audio/mpeg"
              onChange={handleFileInputChange}
              style={{ display: 'none' }}
            />
          </div>

          {/* Upload Queue */}
          {uploadQueue.length > 0 && (
            <div style={styles.queueSection}>
              <div style={styles.queueHeader}>
                <h2 style={styles.sectionTitle}>Upload Queue ({uploadQueue.length} files)</h2>
                <div style={styles.queueActions}>
                  {uploadQueue.some(t => t.status === 'pending') && (
                    <button
                      style={styles.uploadButton}
                      onClick={uploadFiles}
                      disabled={isUploading}
                    >
                      {isUploading ? 'Uploading...' : 'Upload All'}
                    </button>
                  )}
                  {uploadQueue.some(t => t.status === 'success' || t.status === 'error') && (
                    <button
                      style={styles.clearButton}
                      onClick={clearCompleted}
                    >
                      Clear Completed
                    </button>
                  )}
                </div>
              </div>

              <div style={styles.trackList}>
                {uploadQueue.map(track => (
                  <div key={track.id} style={styles.trackItem}>
                    <div style={styles.trackInfo}>
                      <div style={styles.trackStatus}>
                        {track.status === 'pending' && <FiMusic size={20} color={TavariStyles.colors.gray600} />}
                        {track.status === 'uploading' && <div style={styles.spinner} />}
                        {track.status === 'success' && <FiCheck size={20} color={TavariStyles.colors.success} />}
                        {track.status === 'error' && <FiX size={20} color={TavariStyles.colors.error} />}
                      </div>
                      
                      <div style={styles.trackDetails}>
                        <input
                          style={styles.trackInput}
                          type="text"
                          placeholder="Song title *"
                          value={track.name}
                          onChange={(e) => updateTrackInfo(track.id, 'name', e.target.value)}
                          disabled={track.status !== 'pending'}
                        />
                        <input
                          style={styles.trackInput}
                          type="text"
                          placeholder="Artist name"
                          value={track.artist}
                          onChange={(e) => updateTrackInfo(track.id, 'artist', e.target.value)}
                          disabled={track.status !== 'pending'}
                        />
                        <TavariCheckbox
                          checked={track.includeInShuffle}
                          onChange={(checked) => updateTrackInfo(track.id, 'includeInShuffle', checked)}
                          disabled={track.status !== 'pending'}
                          label="Include in shuffle"
                          size="sm"
                        />
                      </div>
                    </div>

                    <div style={styles.trackActions}>
                      {track.status === 'uploading' && (
                        <div style={styles.progressBar}>
                          <div 
                            style={{
                              ...styles.progressFill,
                              width: `${track.progress}%`
                            }}
                          />
                        </div>
                      )}
                      {track.status === 'error' && (
                        <div style={styles.errorMessage}>
                          <FiAlertCircle size={16} />
                          {track.error}
                        </div>
                      )}
                      {track.status === 'pending' && (
                        <button
                          style={styles.removeButton}
                          onClick={() => removeTrack(track.id)}
                        >
                          <FiX size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Instructions */}
          <div style={styles.instructionsSection}>
            <h3 style={styles.instructionsTitle}>Upload Instructions</h3>
            <ul style={styles.instructionsList}>
              <li>Only MP3 files are supported</li>
              <li>Maximum file size: 50MB per file</li>
              <li>Fill in song title and artist for better organization</li>
              <li>Uncheck "Include in shuffle" for announcements or special tracks</li>
              <li>Files will be organized by business automatically</li>
              <li>All uploads are logged for security purposes</li>
            </ul>
          </div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

// Add CSS for spinner animation
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;
if (!document.head.querySelector('style[data-spinner]')) {
  styleSheet.setAttribute('data-spinner', 'true');
  document.head.appendChild(styleSheet);
}

export default MusicUpload;