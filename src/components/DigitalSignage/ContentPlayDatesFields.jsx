import React from 'react';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';

/**
 * Start/end play dates for signage content (end optional when indefinite).
 */
const ContentPlayDatesFields = ({
  playStartDate,
  playEndDate,
  indefinite,
  onPlayStartDateChange,
  onPlayEndDateChange,
  onIndefiniteChange,
  error = '',
  styles = {}
}) => {
  const fieldStyles = {
    row: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: TavariStyles.spacing.md,
      ...styles.row
    },
    formGroup: styles.formGroup,
    label: styles.label,
    input: styles.input,
    helpText: styles.helpText,
    errorText: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.danger,
      margin: `${TavariStyles.spacing.xs} 0 0`
    },
    checkboxWrap: {
      marginTop: TavariStyles.spacing.sm
    }
  };

  return (
    <div style={fieldStyles.formGroup}>
      <label style={fieldStyles.label}>Play dates</label>
      <p style={fieldStyles.helpText}>
        Controls when this content appears on screens. Applies everywhere it is scheduled, even on
        multiple screens.
      </p>
      <div style={fieldStyles.row}>
        <div style={fieldStyles.formGroup}>
          <label style={fieldStyles.label}>Start date</label>
          <input
            style={fieldStyles.input}
            type="date"
            value={playStartDate}
            onChange={(e) => onPlayStartDateChange(e.target.value)}
          />
        </div>
        <div style={fieldStyles.formGroup}>
          <label style={fieldStyles.label}>End date</label>
          <input
            style={fieldStyles.input}
            type="date"
            value={playEndDate}
            disabled={indefinite}
            onChange={(e) => onPlayEndDateChange(e.target.value)}
          />
        </div>
      </div>
      <div style={fieldStyles.checkboxWrap}>
        <TavariCheckbox
          id="content-play-indefinite"
          checked={indefinite}
          onChange={(checked) => {
            onIndefiniteChange(checked);
            if (checked) onPlayEndDateChange('');
          }}
          label="Indefinite (no end date)"
        />
      </div>
      {error ? <p style={fieldStyles.errorText}>{error}</p> : null}
    </div>
  );
};

export default ContentPlayDatesFields;
