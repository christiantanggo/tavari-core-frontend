// src/components/DigitalSignage/ContentUploadModal.jsx

import React, { useState } from 'react';

import { FiX, FiUpload, FiFile } from 'react-icons/fi';

import { TavariStyles } from '../../utils/TavariStyles';

import ContentPlayDatesFields from './ContentPlayDatesFields';

import { getDigitalSignageModalStyles } from './digitalSignageModalStyles';

import { buildContentPlayDateFields, validateContentPlayDates } from '../../utils/signageContentDates';



const ContentUploadModal = ({ onClose, onSubmit }) => {

  const [file, setFile] = useState(null);

  const [metadata, setMetadata] = useState({

    name: '',

    description: '',

    tags: [],

    folderPath: null

  });

  const [playStartDate, setPlayStartDate] = useState('');

  const [playEndDate, setPlayEndDate] = useState('');

  const [indefinite, setIndefinite] = useState(true);

  const [dateError, setDateError] = useState('');

  const [uploading, setUploading] = useState(false);

  const [uploadProgress, setUploadProgress] = useState(0);



  const handleFileSelect = (e) => {

    const selectedFile = e.target.files[0];

    if (selectedFile) {

      setFile(selectedFile);

      if (!metadata.name) {

        setMetadata({

          ...metadata,

          name: selectedFile.name.replace(/\.[^/.]+$/, '')

        });

      }

    }

  };



  const handleSubmit = async (e) => {

    e.preventDefault();

    if (!file) {

      alert('Please select a file');

      return;

    }



    const validationError = validateContentPlayDates({ playStartDate, playEndDate, indefinite });

    if (validationError) {

      setDateError(validationError);

      return;

    }



    setUploading(true);

    try {

      await onSubmit(

        file,

        {

          ...metadata,

          playStartDate,

          playEndDate,

          indefinite,

          ...buildContentPlayDateFields({ playStartDate, playEndDate, indefinite })

        },

        (progress) => {

          setUploadProgress(progress);

        }

      );

    } catch (err) {

      console.error('Upload error:', err);

    } finally {

      setUploading(false);

      setUploadProgress(0);

    }

  };



  const base = getDigitalSignageModalStyles({ maxWidth: '600px' });

  const styles = {

    ...base,

    fileInput: { display: 'none' },

    fileButton: {

      ...base.buttonSecondary,

      display: 'flex',

      alignItems: 'center',

      gap: TavariStyles.spacing.sm,

      justifyContent: 'center',

      padding: TavariStyles.spacing.lg,

      border: `2px dashed ${TavariStyles.colors.gray300}`,

      backgroundColor: TavariStyles.colors.gray50,

      width: '100%',

      boxSizing: 'border-box'

    },

    fileInfo: {

      ...base.helpText,

      display: 'flex',

      alignItems: 'center',

      marginTop: TavariStyles.spacing.xs

    },

    progressBar: {

      width: '100%',

      height: '8px',

      backgroundColor: TavariStyles.colors.gray200,

      borderRadius: TavariStyles.borderRadius.full,

      overflow: 'hidden',

      marginTop: TavariStyles.spacing.sm

    },

    progressFill: {

      height: '100%',

      backgroundColor: TavariStyles.colors.primary,

      transition: 'width 0.3s'

    }

  };



  return (

    <div style={styles.overlay} onClick={onClose}>

      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>

        <div style={styles.header}>

          <div style={styles.headerText}>

            <h2 style={styles.title}>Upload Content</h2>

          </div>

          <button type="button" style={styles.closeButton} onClick={onClose} aria-label="Close">

            <FiX />

          </button>

        </div>



        <div style={styles.body}>

          <form style={styles.form} onSubmit={handleSubmit}>

            <div style={styles.formGroup}>

              <label style={styles.label}>File *</label>

              <input

                type="file"

                id="file-input"

                style={styles.fileInput}

                onChange={handleFileSelect}

                accept="image/*,video/*,text/html"

              />

              <label htmlFor="file-input" style={styles.fileButton}>

                <FiUpload /> {file ? 'Change File' : 'Select File'}

              </label>

              {file && (

                <div style={styles.fileInfo}>

                  <FiFile style={{ marginRight: TavariStyles.spacing.xs }} />

                  {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)

                </div>

              )}

              {uploading && (

                <div style={styles.progressBar}>

                  <div style={{ ...styles.progressFill, width: `${uploadProgress}%` }} />

                </div>

              )}

            </div>



            <div style={styles.formGroup}>

              <label style={styles.label}>Content Name *</label>

              <input

                style={styles.input}

                type="text"

                required

                value={metadata.name}

                onChange={(e) => setMetadata({ ...metadata, name: e.target.value })}

                placeholder="My Content"

              />

            </div>



            <div style={styles.formGroup}>

              <label style={styles.label}>Description</label>

              <textarea

                style={styles.textarea}

                value={metadata.description}

                onChange={(e) => setMetadata({ ...metadata, description: e.target.value })}

                placeholder="Optional description..."

              />

            </div>



            <ContentPlayDatesFields

              playStartDate={playStartDate}

              playEndDate={playEndDate}

              indefinite={indefinite}

              onPlayStartDateChange={setPlayStartDate}

              onPlayEndDateChange={setPlayEndDate}

              onIndefiniteChange={setIndefinite}

              error={dateError}

              styles={styles}

            />



            <div style={styles.actions}>

              <button

                type="button"

                style={styles.buttonSecondary}

                onClick={onClose}

                disabled={uploading}

              >

                Cancel

              </button>

              <button

                type="submit"

                style={styles.buttonPrimary}

                disabled={uploading || !file}

              >

                {uploading ? `Uploading... ${Math.round(uploadProgress)}%` : 'Upload'}

              </button>

            </div>

          </form>

        </div>

      </div>

    </div>

  );

};



export default ContentUploadModal;

