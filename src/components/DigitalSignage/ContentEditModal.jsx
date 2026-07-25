// src/components/DigitalSignage/ContentEditModal.jsx

import React, { useEffect, useState } from 'react';

import { FiX } from 'react-icons/fi';

import ContentPlayDatesFields from './ContentPlayDatesFields';

import { getDigitalSignageModalStyles } from './digitalSignageModalStyles';

import {

  buildContentPlayDateFields,

  parseContentPlayDates,

  validateContentPlayDates

} from '../../utils/signageContentDates';



const ContentEditModal = ({ content, onClose, onSubmit }) => {

  const [name, setName] = useState('');

  const [description, setDescription] = useState('');

  const [playStartDate, setPlayStartDate] = useState('');

  const [playEndDate, setPlayEndDate] = useState('');

  const [indefinite, setIndefinite] = useState(true);

  const [dateError, setDateError] = useState('');

  const [loading, setLoading] = useState(false);



  useEffect(() => {

    if (!content) return;

    setName(content.content_name || '');

    setDescription(content.description || '');

    const dates = parseContentPlayDates(content);

    setPlayStartDate(dates.playStartDate);

    setPlayEndDate(dates.playEndDate);

    setIndefinite(dates.indefinite);

    setDateError('');

  }, [content?.id]);



  const handleSubmit = async (e) => {

    e.preventDefault();

    const validationError = validateContentPlayDates({ playStartDate, playEndDate, indefinite });

    if (validationError) {

      setDateError(validationError);

      return;

    }



    setLoading(true);

    try {

      await onSubmit({

        name: name.trim(),

        description: description.trim() || null,

        playStartDate,

        playEndDate,

        indefinite,

        ...buildContentPlayDateFields({ playStartDate, playEndDate, indefinite })

      });

    } catch (err) {

      console.error('Error submitting form:', err);

    } finally {

      setLoading(false);

    }

  };



  if (!content) return null;



  const styles = getDigitalSignageModalStyles({ maxWidth: '520px' });



  return (

    <div style={styles.overlay} onClick={onClose}>

      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>

        <div style={styles.header}>

          <div style={styles.headerText}>

            <h2 style={styles.title}>Edit Content</h2>

            <p style={styles.subtitle}>Update name, description, and when this content may play.</p>

          </div>

          <button type="button" style={styles.closeButton} onClick={onClose} aria-label="Close">

            <FiX />

          </button>

        </div>



        <div style={styles.body}>

          <form style={styles.form} onSubmit={handleSubmit}>

            <div style={styles.formGroup}>

              <label style={styles.label}>Content Name *</label>

              <input

                style={styles.input}

                type="text"

                required

                value={name}

                onChange={(e) => setName(e.target.value)}

              />

            </div>



            <div style={styles.formGroup}>

              <label style={styles.label}>Description</label>

              <textarea

                style={styles.textarea}

                value={description}

                onChange={(e) => setDescription(e.target.value)}

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

              <button type="button" style={styles.buttonSecondary} onClick={onClose} disabled={loading}>

                Cancel

              </button>

              <button type="submit" style={styles.buttonPrimary} disabled={loading}>

                {loading ? 'Saving...' : 'Save Changes'}

              </button>

            </div>

          </form>

        </div>

      </div>

    </div>

  );

};



export default ContentEditModal;

