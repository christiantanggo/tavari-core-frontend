// components/Mail/CSVImportModal.jsx
import React, { useState } from 'react';
import { supabase } from '../../supabaseClient';
import { FiX, FiUpload, FiDownload, FiAlertTriangle, FiCheck, FiFileText, FiUsers, FiUserX } from 'react-icons/fi';

const CSVImportModal = ({ isOpen, onClose, onImportComplete, businessId }) => {
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [step, setStep] = useState('upload'); // upload, preview, importing, complete
  const [csvData, setCsvData] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [errors, setErrors] = useState([]);
  const [validRows, setValidRows] = useState([]);
  const [importResults, setImportResults] = useState(null);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [consentMethod, setConsentMethod] = useState('express');
  const [delimiter, setDelimiter] = useState(',');
  const [importMode, setImportMode] = useState('contacts');
  const [overrideExistingUnsubscribed, setOverrideExistingUnsubscribed] = useState(false);
  const [statusSummary, setStatusSummary] = useState({ subscribed: 0, unsubscribed: 0, unknown: 0 });

  const requiredFields = ['email'];
  const optionalFields = ['first_name', 'last_name', 'phone', 'tags', 'source', 'subscribed_lists', 'blocklisted_lists', 'marketing_status'];
  const allFields = [...requiredFields, ...optionalFields];
  const isMarketingStatusImport = importMode === 'marketing_status_sync';

  const getFieldLabel = (field) => {
    const labels = {
      first_name: 'FIRST NAME',
      last_name: 'LAST NAME',
      subscribed_lists: 'SUBSCRIBED LISTS',
      blocklisted_lists: 'BLOCKLISTED LISTS',
      marketing_status: 'MARKETING STATUS'
    };
    return labels[field] || field.replace('_', ' ').toUpperCase();
  };

  const handleFileSelect = (event) => {
    const selectedFile = event.target.files[0];
    const isCsvFile = selectedFile && (
      selectedFile.type === 'text/csv' ||
      selectedFile.type === 'application/vnd.ms-excel' ||
      selectedFile.name?.toLowerCase().endsWith('.csv')
    );

    if (isCsvFile) {
      setFile(selectedFile);
      parseCSV(selectedFile);
    } else {
      alert('Please select a valid CSV file.');
    }
  };

  const parseCSV = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        alert('CSV file must contain at least a header row and one data row.');
        return;
      }

      // Parse headers
      const headerLine = lines[0];
      const detectedDelimiter = detectDelimiter(headerLine);
      const parsedHeaders = parseCSVLine(headerLine, detectedDelimiter).map(h => h.trim().toLowerCase());
      
      // Parse data rows
      const dataRows = lines.slice(1).map((line, index) => {
        const values = parseCSVLine(line, detectedDelimiter);
        const row = {};
        parsedHeaders.forEach((header, i) => {
          row[header] = values[i] || '';
        });
        row._originalIndex = index + 2; // +2 because we start from line 1 and skip header
        return row;
      });

      const detectedStatusImport = parsedHeaders.includes('_subscribed') || parsedHeaders.includes('_blocklisted');
      const isCurrentMarketingFile = file.name === '6056561-69ee5a867219a9467aeb67a1-l6Mcvl.csv';

      setDelimiter(detectedDelimiter);
      setImportMode(detectedStatusImport ? 'marketing_status_sync' : 'contacts');
      setOverrideExistingUnsubscribed(detectedStatusImport && isCurrentMarketingFile);
      setHeaders(parsedHeaders);
      setCsvData(dataRows);
      
      // Auto-map obvious columns
      const autoMapping = {};
      parsedHeaders.forEach(header => {
        const cleanHeader = header.replace(/[^a-z]/g, '');
        if (cleanHeader.includes('email') || cleanHeader === 'email') {
          autoMapping.email = header;
        } else if (cleanHeader.includes('firstname') || cleanHeader === 'firstname') {
          autoMapping.first_name = header;
        } else if (cleanHeader.includes('lastname') || cleanHeader === 'lastname') {
          autoMapping.last_name = header;
        } else if (cleanHeader.includes('phone') || cleanHeader === 'phone') {
          autoMapping.phone = header;
        } else if (cleanHeader.includes('tag') || cleanHeader === 'tags') {
          autoMapping.tags = header;
        } else if (header === '_subscribed' || cleanHeader === 'subscribed') {
          autoMapping.subscribed_lists = header;
        } else if (header === '_blocklisted' || cleanHeader === 'blocklisted') {
          autoMapping.blocklisted_lists = header;
        } else if (cleanHeader.includes('marketingstatus') || cleanHeader.includes('marketingconsent')) {
          autoMapping.marketing_status = header;
        }
      });
      
      setMapping(autoMapping);
      setStep('preview');
    };
    reader.readAsText(file);
  };

  const detectDelimiter = (headerLine) => {
    const commaCount = (headerLine.match(/,/g) || []).length;
    const semicolonCount = (headerLine.match(/;/g) || []).length;
    return semicolonCount > commaCount ? ';' : ',';
  };

  const parseCSVLine = (line, activeDelimiter = delimiter) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === activeDelimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  };

  const getMarketingStatus = (row) => {
    const explicit = String(row.marketing_status || '').trim().toLowerCase();
    if (['yes', 'y', 'true', '1', 'subscribed', 'subscribe', 'opt_in', 'opt-in', 'email_marketing'].includes(explicit)) {
      return 'subscribed';
    }
    if (['no', 'n', 'false', '0', 'unsubscribed', 'unsubscribe', 'opt_out', 'opt-out', 'blocked', 'blocklisted'].includes(explicit)) {
      return 'unsubscribed';
    }

    if (String(row.blocklisted_lists || '').toLowerCase().includes('email_marketing')) return 'unsubscribed';
    if (String(row.subscribed_lists || '').toLowerCase().includes('email_marketing')) return 'subscribed';
    return 'unknown';
  };

  const validateData = () => {
    const newErrors = [];
    const newValidRows = [];
    const nextStatusSummary = { subscribed: 0, unsubscribed: 0, unknown: 0 };
    
    // Check if email column is mapped
    if (!mapping.email) {
      alert('Email column mapping is required.');
      return false;
    }

    csvData.forEach((row, index) => {
      const rowErrors = [];
      const cleanRow = {};
      
      // Validate and clean mapped fields
      allFields.forEach(field => {
        if (mapping[field]) {
          let value = row[mapping[field]];
          
          if (field === 'email') {
            value = value?.trim().toLowerCase();
            if (!value) {
              rowErrors.push('Email is required');
            } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
              rowErrors.push('Invalid email format');
            }
            cleanRow[field] = value;
          } else if (field === 'phone') {
            // Clean and format phone
            const cleaned = value ? value.replace(/\D/g, '') : '';
            if (cleaned.length >= 10) {
              cleanRow[field] = cleaned.length === 10 ? 
                `(${cleaned.slice(0,3)}) ${cleaned.slice(3,6)}-${cleaned.slice(6)}` :
                `+1 (${cleaned.slice(1,4)}) ${cleaned.slice(4,7)}-${cleaned.slice(7,11)}`;
            } else if (cleaned.length > 0) {
              cleanRow[field] = value; // Keep original if can't format
            }
          } else if (field === 'tags') {
            // Parse tags
            cleanRow[field] = value ? 
              value.split(/[,;|]/).map(tag => tag.trim()).filter(tag => tag) : 
              [];
          } else if (field === 'subscribed_lists' || field === 'blocklisted_lists' || field === 'marketing_status') {
            cleanRow[field] = value ? value.trim() : '';
          } else {
            // First name, last name, source
            cleanRow[field] = value ? value.trim() : '';
          }
        }
      });

      // Set defaults
      cleanRow.source = cleanRow.source || 'csv_import';
      cleanRow.business_id = businessId;
      cleanRow._originalIndex = row._originalIndex;

      if (isMarketingStatusImport) {
        cleanRow.marketing_status = getMarketingStatus(cleanRow);
        nextStatusSummary[cleanRow.marketing_status] += 1;
      }

      if (rowErrors.length > 0) {
        newErrors.push({
          row: index + 1,
          line: row._originalIndex,
          errors: rowErrors,
          data: row
        });
      } else {
        newValidRows.push(cleanRow);
      }
    });

    setErrors(newErrors);
    setValidRows(newValidRows);
    setStatusSummary(nextStatusSummary);
    return {
      isValid: true,
      errors: newErrors,
      validRows: newValidRows
    };
  };

  const handleImport = async () => {
    const validation = validateData();
    if (!validation?.isValid) return;
    
    if (validation.validRows.length === 0) {
      alert('No valid rows to import.');
      return;
    }

    if (!consentConfirmed) {
      alert('You must confirm you have marketing consent before importing contacts.');
      return;
    }

    const confirmMessage = isMarketingStatusImport
      ? `Sync marketing status for ${validation.validRows.length} valid contacts?\n\n` +
        `${validation.validRows.filter(row => row.marketing_status === 'subscribed').length} will be marked subscribed/consented.\n` +
        `${validation.validRows.filter(row => row.marketing_status === 'unsubscribed').length} will be marked not subscribed for marketing.\n` +
        `${overrideExistingUnsubscribed ? 'Existing NO/unsubscribed contacts may be changed back to YES for this import.' : 'Existing NO/unsubscribed contacts will remain NO even if the file says YES.'}`
      : `Import ${validation.validRows.length} valid contacts? ${validation.errors.length > 0 ? `(${validation.errors.length} rows will be skipped due to errors)` : ''}`;
    if (!window.confirm(confirmMessage)) return;

    setImporting(true);
    setStep('importing');

    try {
      let successCount = 0;
      let errorCount = 0;
      let duplicateCount = 0;
      let updatedCount = 0;
      let subscribedCount = 0;
      let unsubscribedCount = 0;
      let preservedUnsubscribedCount = 0;
      let skippedStatusCount = 0;
      const importErrors = [];

      // Process in larger backend batches instead of one RPC per row
      const batchSize = 1000;
      for (let i = 0; i < validation.validRows.length; i += batchSize) {
        const batch = validation.validRows.slice(i, i + batchSize);

        try {
          const { data, error } = await supabase.functions.invoke('mail-import-contacts', {
            body: {
              businessId,
              contacts: batch.map((row) => {
                const cleanRow = { ...row };
                delete cleanRow._originalIndex;
                return cleanRow;
              }),
              consentConfirmed: true,
              source: isMarketingStatusImport ? 'marketing_status_csv_import' : 'csv_import',
              consentMethod,
              consentTimestamp: new Date().toISOString(),
              consentText: isMarketingStatusImport ? 'Marketing consent status synced from imported customer marketing CSV.' : null,
              importMode,
              overrideExistingUnsubscribed: isMarketingStatusImport && overrideExistingUnsubscribed,
            }
          });

          if (error) throw error;
          if (!data?.ok) throw new Error(data?.error || 'Import batch failed');

          successCount += data.inserted || 0;
          duplicateCount += data.duplicates || 0;
          updatedCount += data.updated || 0;
          subscribedCount += data.subscribed || 0;
          unsubscribedCount += data.unsubscribed || 0;
          preservedUnsubscribedCount += data.preserved_unsubscribed || 0;
          skippedStatusCount += data.skipped_status || 0;
        } catch (error) {
          console.error('Error importing batch:', error);
          errorCount += batch.length;
          batch.forEach((row) => {
            importErrors.push({
              line: row._originalIndex,
              email: row.email,
              error: error.message
            });
          });
        }
      }

      // Log audit event
      await supabase.from('audit_logs').insert({
        business_id: businessId,
        action: 'csv_import',
        details: { 
          total_rows: csvData.length,
          valid_rows: validation.validRows.length,
          success_count: successCount,
          duplicate_count: duplicateCount,
          updated_count: updatedCount,
          subscribed_count: subscribedCount,
          unsubscribed_count: unsubscribedCount,
          preserved_unsubscribed_count: preservedUnsubscribedCount,
          skipped_status_count: skippedStatusCount,
          import_mode: importMode,
          override_existing_unsubscribed: isMarketingStatusImport && overrideExistingUnsubscribed,
          error_count: errorCount,
          filename: file.name
        },
        created_at: new Date().toISOString()
      });

      setImportResults({
        total: csvData.length,
        valid: validation.validRows.length,
        success: successCount,
        duplicates: duplicateCount,
        updated: updatedCount,
        subscribed: subscribedCount,
        unsubscribed: unsubscribedCount,
        preservedUnsubscribed: preservedUnsubscribedCount,
        skippedStatus: skippedStatusCount,
        mode: importMode,
        errors: errorCount + validation.errors.length,
        importErrors
      });

      setStep('complete');

      if (onImportComplete) {
        onImportComplete(successCount + updatedCount);
      }

    } catch (error) {
      console.error('Import failed:', error);
      alert('Import failed. Please try again.');
      setStep('preview');
    } finally {
      setImporting(false);
    }
  };

  const downloadSampleCSV = () => {
    const sampleData = [
      'email,first_name,last_name,phone,tags',
      'john@example.com,John,Doe,(555) 123-4567,customer',
      'jane@example.com,Jane,Smith,(555) 987-6543,"vip,birthday-party"',
      'mike@example.com,Mike,Johnson,555-555-5555,customer'
    ].join('\n');

    const blob = new Blob([sampleData], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contacts_sample.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const resetImport = () => {
    setFile(null);
    setCsvData([]);
    setHeaders([]);
    setMapping({});
    setErrors([]);
    setValidRows([]);
    setImportResults(null);
    setConsentConfirmed(false);
    setConsentMethod('express');
    setDelimiter(',');
    setImportMode('contacts');
    setOverrideExistingUnsubscribed(false);
    setStatusSummary({ subscribed: 0, unsubscribed: 0, unknown: 0 });
    setStep('upload');
  };

  if (!isOpen) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>Import Contacts from CSV</h2>
          <button style={styles.closeButton} onClick={onClose}>
            <FiX />
          </button>
        </div>

        {step === 'upload' && (
          <div style={styles.content}>
            <div style={styles.uploadSection}>
              <div style={styles.uploadArea}>
                <FiUpload style={styles.uploadIcon} />
                <h3 style={styles.uploadTitle}>Select CSV File</h3>
                <p style={styles.uploadText}>
                  Choose a CSV file containing your contacts. Required column: email
                </p>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                  style={styles.fileInput}
                  id="csvFile"
                />
                <label htmlFor="csvFile" style={styles.fileLabel}>
                  Choose File
                </label>
              </div>

              <div style={styles.sampleSection}>
                <h4 style={styles.sampleTitle}>Sample CSV Format</h4>
                <div style={styles.sampleTable}>
                  <div style={styles.sampleHeader}>
                    <span>email</span>
                    <span>first_name</span>
                    <span>last_name</span>
                    <span>phone</span>
                    <span>tags</span>
                  </div>
                  <div style={styles.sampleRow}>
                    <span>john@example.com</span>
                    <span>John</span>
                    <span>Doe</span>
                    <span>(555) 123-4567</span>
                    <span>customer</span>
                  </div>
                </div>
                <button 
                  style={styles.sampleButton}
                  onClick={downloadSampleCSV}
                >
                  <FiDownload style={styles.buttonIcon} />
                  Download Sample CSV
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div style={styles.content}>
            <div style={styles.previewSection}>
              <h3 style={styles.sectionTitle}>Map CSV Columns</h3>
              <p style={styles.sectionText}>
                Match your CSV columns to contact fields. Email is required.
                {isMarketingStatusImport && ' This file looks like a marketing consent status export.'}
              </p>

              <div style={styles.importModeBox}>
                <div style={styles.importModeHeader}>
                  Import mode: {isMarketingStatusImport ? 'Marketing consent status sync' : 'Contact import'}
                </div>
                <div style={styles.importModeText}>
                  Detected delimiter: <strong>{delimiter === ';' ? 'semicolon (;)' : 'comma (,)'}</strong>
                </div>
                {isMarketingStatusImport && (
                  <div style={styles.importModeText}>
                    The importer will use subscribed/blocklisted fields to decide who can receive marketing email.
                    Transactional email remains separate.
                  </div>
                )}
              </div>

              <div style={styles.mappingGrid}>
                {allFields.map(field => (
                  <div key={field} style={styles.mappingRow}>
                    <label style={styles.mappingLabel}>
                      {getFieldLabel(field)}
                      {requiredFields.includes(field) && <span style={styles.required}>*</span>}
                    </label>
                    <select
                      style={styles.mappingSelect}
                      value={mapping[field] || ''}
                      onChange={(e) => setMapping(prev => ({ ...prev, [field]: e.target.value }))}
                    >
                      <option value="">-- Select Column --</option>
                      {headers.map(header => (
                        <option key={header} value={header}>{header}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div style={styles.previewStats}>
                <div style={styles.statItem}>
                  <FiFileText style={styles.statIcon} />
                  <span>{csvData.length} rows in CSV</span>
                </div>
                {isMarketingStatusImport && (
                  <>
                    <div style={styles.statItem}>
                      <FiCheck style={styles.statIcon} />
                      <span>{statusSummary.subscribed} email marketing YES</span>
                    </div>
                    <div style={styles.statItem}>
                      <FiUserX style={styles.statIcon} />
                      <span>{statusSummary.unsubscribed} email marketing NO</span>
                    </div>
                  </>
                )}
              </div>

              <label style={styles.consentBox}>
                <input
                  type="checkbox"
                  checked={consentConfirmed}
                  onChange={(e) => setConsentConfirmed(e.target.checked)}
                  style={styles.consentCheckbox}
                />
                <span>
                  {isMarketingStatusImport
                    ? 'I confirm this file is the current customer marketing consent status source for this import.'
                    : 'I confirm these contacts have consent to receive marketing emails and may be imported as subscribed contacts.'}
                </span>
              </label>

              {isMarketingStatusImport && (
                <label style={styles.overrideBox}>
                  <input
                    type="checkbox"
                    checked={overrideExistingUnsubscribed}
                    onChange={(e) => setOverrideExistingUnsubscribed(e.target.checked)}
                    style={styles.consentCheckbox}
                  />
                  <span>
                    Override existing NO/unsubscribed contacts when this file says YES.
                    Use this only when the upload is the latest authoritative marketing approval list.
                  </span>
                </label>
              )}

              <div style={styles.consentDetails}>
                <label style={styles.consentLabel}>
                  Consent type to store
                </label>
                <select
                  value={consentMethod}
                  onChange={(e) => setConsentMethod(e.target.value)}
                  style={styles.mappingSelect}
                >
                  <option value="express">Express consent</option>
                  <option value="implied">Implied consent</option>
                </select>
                <p style={styles.consentHelpText}>
                  {isMarketingStatusImport
                    ? 'This value will be written only to contacts marked YES for email marketing and logged for consent tracking.'
                    : 'This value will be written to each imported subscribed contact and logged for consent tracking.'}
                </p>
              </div>

              {errors.length > 0 && (
                <div style={styles.errorsSection}>
                  <h4 style={styles.errorsTitle}>
                    <FiAlertTriangle style={styles.errorIcon} />
                    Validation Errors ({errors.length} rows)
                  </h4>
                  <div style={styles.errorsList}>
                    {errors.slice(0, 10).map((error, index) => (
                      <div key={index} style={styles.errorItem}>
                        <span style={styles.errorRow}>Row {error.row} (Line {error.line}):</span>
                        <span style={styles.errorDetails}>{error.errors.join(', ')}</span>
                      </div>
                    ))}
                    {errors.length > 10 && (
                      <div style={styles.errorMore}>
                        +{errors.length - 10} more errors...
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div style={styles.previewActions}>
                <button 
                  style={styles.backButton}
                  onClick={resetImport}
                >
                  Back to Upload
                </button>
                <button 
                  style={styles.validateButton}
                  onClick={validateData}
                >
                  Validate Data
                </button>
                <button 
                  style={styles.importButton}
                  onClick={handleImport}
                  disabled={!mapping.email || importing || !consentConfirmed}
                >
                  <FiUsers style={styles.buttonIcon} />
                  {isMarketingStatusImport ? 'Sync Marketing Status' : `Import ${validRows.length} Contacts`}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div style={styles.content}>
            <div style={styles.importingSection}>
              <div style={styles.spinner}></div>
              <h3 style={styles.importingTitle}>Importing Contacts...</h3>
              <p style={styles.importingText}>
                Processing {validRows.length} contacts. This may take a moment.
              </p>
            </div>
          </div>
        )}

        {step === 'complete' && importResults && (
          <div style={styles.content}>
            <div style={styles.resultsSection}>
              <div style={styles.successIcon}>
                <FiCheck />
              </div>
              <h3 style={styles.resultsTitle}>Import Complete!</h3>
              
              <div style={styles.resultsGrid}>
                <div style={styles.resultCard}>
                  <div style={styles.resultNumber}>{importResults.success}</div>
                  <div style={styles.resultLabel}>New Contacts</div>
                </div>
                <div style={styles.resultCard}>
                  <div style={styles.resultNumber}>{importResults.updated}</div>
                  <div style={styles.resultLabel}>Existing Updated</div>
                </div>
                {importResults.mode === 'marketing_status_sync' && (
                  <>
                    <div style={styles.resultCard}>
                      <div style={styles.resultNumber}>{importResults.subscribed}</div>
                      <div style={styles.resultLabel}>Marketing YES</div>
                    </div>
                    <div style={styles.resultCard}>
                      <div style={styles.resultNumber}>{importResults.unsubscribed}</div>
                      <div style={styles.resultLabel}>Marketing NO</div>
                    </div>
                    <div style={styles.resultCard}>
                      <div style={styles.resultNumber}>{importResults.preservedUnsubscribed}</div>
                      <div style={styles.resultLabel}>Existing NO Preserved</div>
                    </div>
                  </>
                )}
                <div style={styles.resultCard}>
                  <div style={styles.resultNumber}>{importResults.errors}</div>
                  <div style={styles.resultLabel}>Errors Skipped</div>
                </div>
              </div>

              {importResults.importErrors.length > 0 && (
                <div style={styles.importErrorsSection}>
                  <h4 style={styles.importErrorsTitle}>Import Errors</h4>
                  <div style={styles.importErrorsList}>
                    {importResults.importErrors.slice(0, 5).map((error, index) => (
                      <div key={index} style={styles.importErrorItem}>
                        <span style={styles.importErrorLine}>Line {error.line}:</span>
                        <span style={styles.importErrorEmail}>{error.email}</span>
                        <span style={styles.importErrorMessage}>{error.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={styles.resultsActions}>
                <button 
                  style={styles.doneButton}
                  onClick={onClose}
                >
                  Done
                </button>
                <button 
                  style={styles.importMoreButton}
                  onClick={resetImport}
                >
                  Import More Contacts
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  overlay: {
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
    width: '90%',
    maxWidth: '800px',
    maxHeight: '90vh',
    overflow: 'auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px',
    borderBottom: '1px solid #f0f0f0',
  },
  title: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#333',
    margin: 0,
  },
  closeButton: {
    backgroundColor: 'transparent',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    color: '#666',
    padding: '5px',
  },
  content: {
    padding: '20px',
  },
  uploadSection: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '30px',
  },
  uploadArea: {
    border: '2px dashed #ddd',
    borderRadius: '8px',
    padding: '40px 20px',
    textAlign: 'center',
  },
  uploadIcon: {
    fontSize: '48px',
    color: 'teal',
    marginBottom: '15px',
  },
  uploadTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '8px',
  },
  uploadText: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '20px',
  },
  fileInput: {
    display: 'none',
  },
  fileLabel: {
    backgroundColor: 'teal',
    color: 'white',
    padding: '12px 24px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'inline-block',
  },
  sampleSection: {
    padding: '20px',
    backgroundColor: '#f8f8f8',
    borderRadius: '8px',
  },
  sampleTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '15px',
  },
  sampleTable: {
    marginBottom: '15px',
  },
  sampleHeader: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: '10px',
    padding: '8px 0',
    borderBottom: '1px solid #ddd',
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#666',
  },
  sampleRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: '10px',
    padding: '8px 0',
    fontSize: '12px',
    color: '#333',
  },
  sampleButton: {
    backgroundColor: 'white',
    color: 'teal',
    border: '2px solid teal',
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  buttonIcon: {
    fontSize: '14px',
  },
  previewSection: {
    maxWidth: '600px',
    margin: '0 auto',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '8px',
  },
  sectionText: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '20px',
  },
  mappingGrid: {
    display: 'grid',
    gap: '15px',
    marginBottom: '20px',
  },
  mappingRow: {
    display: 'grid',
    gridTemplateColumns: '150px 1fr',
    gap: '15px',
    alignItems: 'center',
  },
  mappingLabel: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
  },
  required: {
    color: '#f44336',
    marginLeft: '4px',
  },
  mappingSelect: {
    padding: '8px 12px',
    fontSize: '14px',
    border: '2px solid #ddd',
    borderRadius: '6px',
    backgroundColor: 'white',
  },
  previewStats: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '20px',
    marginBottom: '20px',
    padding: '15px',
    backgroundColor: '#f8f8f8',
    borderRadius: '6px',
  },
  importModeBox: {
    marginBottom: '20px',
    padding: '12px',
    backgroundColor: '#eef7f7',
    border: '1px solid #b2dfdb',
    borderRadius: '6px',
  },
  importModeHeader: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#00695c',
    marginBottom: '6px',
  },
  importModeText: {
    fontSize: '16px',
    color: '#355',
    marginTop: '4px',
  },
  statItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
  },
  statIcon: {
    fontSize: '16px',
    color: 'teal',
  },
  consentBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    marginBottom: '20px',
    padding: '12px',
    backgroundColor: '#fff8e1',
    border: '1px solid #f5c86a',
    borderRadius: '6px',
    fontSize: '12px',
    color: '#5d4037',
  },
  overrideBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    marginBottom: '20px',
    padding: '12px',
    backgroundColor: '#ffebee',
    border: '1px solid #ef9a9a',
    borderRadius: '6px',
    fontSize: '12px',
    color: '#7f1d1d',
  },
  consentCheckbox: {
    marginTop: '2px',
  },
  consentDetails: {
    marginBottom: '20px',
    padding: '12px',
    backgroundColor: '#f8f8f8',
    border: '1px solid #ddd',
    borderRadius: '6px',
  },
  consentLabel: {
    display: 'block',
    fontSize: '12px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '8px',
  },
  consentHelpText: {
    margin: '8px 0 0 0',
    fontSize: '14px',
    color: '#666',
  },
  errorsSection: {
    marginBottom: '20px',
    padding: '15px',
    backgroundColor: '#ffebee',
    borderRadius: '6px',
    border: '1px solid #f44336',
  },
  errorsTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#c62828',
    marginBottom: '10px',
  },
  errorIcon: {
    fontSize: '14px',
  },
  errorsList: {
    maxHeight: '200px',
    overflow: 'auto',
  },
  errorItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    marginBottom: '8px',
    padding: '8px',
    backgroundColor: 'white',
    borderRadius: '4px',
  },
  errorRow: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#c62828',
  },
  errorDetails: {
    fontSize: '14px',
    color: '#666',
  },
  errorMore: {
    fontSize: '24px',
    fontStyle: 'italic',
    color: '#666',
    textAlign: 'center',
    marginTop: '10px',
  },
  previewActions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
  },
  backButton: {
    backgroundColor: 'white',
    color: '#666',
    border: '2px solid #ddd',
    borderRadius: '8px',
    padding: '12px 20px',
    fontSize: '20px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  validateButton: {
    backgroundColor: 'white',
    color: 'teal',
    border: '2px solid teal',
    borderRadius: '8px',
    padding: '12px 20px',
    fontSize: '24px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  importButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 20px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  importingSection: {
    textAlign: 'center',
    padding: '40px 20px',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #f0f0f0',
    borderTop: '4px solid teal',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 20px auto',
  },
  importingTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '8px',
  },
  importingText: {
    fontSize: '12px',
    color: '#666',
  },
  resultsSection: {
    textAlign: 'center',
    padding: '20px',
  },
  successIcon: {
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    backgroundColor: '#4caf50',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    margin: '0 auto 20px auto',
  },
  resultsTitle: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '20px',
  },
  resultsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '20px',
    marginBottom: '20px',
  },
  resultCard: {
    padding: '20px',
    backgroundColor: '#f8f8f8',
    borderRadius: '8px',
    textAlign: 'center',
  },
  resultNumber: {
    fontSize: '19px',
    fontWeight: 'bold',
    color: 'teal',
    marginBottom: '5px',
  },
  resultLabel: {
    fontSize: '11px',
    color: '#666',
  },
  importErrorsSection: {
    marginBottom: '20px',
    padding: '15px',
    backgroundColor: '#fff3e0',
    borderRadius: '6px',
    textAlign: 'left',
  },
  importErrorsTitle: {
    fontSize: '13px',
    fontWeight: 'bold',
    color: '#f57c00',
    marginBottom: '10px',
  },
  importErrorsList: {
    maxHeight: '150px',
    overflow: 'auto',
  },
  importErrorItem: {
    display: 'flex',
    gap: '10px',
    marginBottom: '5px',
    fontSize: '10px',
  },
  importErrorLine: {
    fontWeight: 'bold',
    color: '#f57c00',
    minWidth: '60px',
  },
  importErrorEmail: {
    color: '#333',
    minWidth: '150px',
  },
  importErrorMessage: {
    color: '#666',
    flex: 1,
  },
  resultsActions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
  },
  doneButton: {
    backgroundColor: 'teal',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 24px',
    fontSize: '11px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  importMoreButton: {
    backgroundColor: 'white',
    color: 'teal',
    border: '2px solid teal',
    borderRadius: '8px',
    padding: '10px 22px',
    fontSize: '11px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
};

// Add CSS animation for spinner
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;
if (!document.querySelector('#csv-import-styles')) {
  styleSheet.id = 'csv-import-styles';
  document.head.appendChild(styleSheet);
}

export default CSVImportModal;