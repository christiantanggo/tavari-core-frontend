import React, { useState } from 'react';
import { FiFilePlus, FiUploadCloud } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { importSmartwaiverPdfFile } from '../../services/Waivers/SmartwaiverPdfImportService';

const SmartwaiverPdfImportPanel = ({ businessId }) => {
  const [files, setFiles] = useState([]);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState([]);

  const handleFiles = (event) => {
    const next = Array.from(event.target.files || []).filter((f) => /\.pdf$/i.test(f.name));
    setFiles(next);
    setResults([]);
  };

  const handleImport = async () => {
    if (!businessId) {
      toast.error('No business selected');
      return;
    }
    if (files.length === 0) {
      toast.error('Choose at least one Smartwaiver PDF');
      return;
    }

    setImporting(true);
    const nextResults = [];
    let ok = 0;
    let failed = 0;

    for (const file of files) {
      try {
        const imported = await importSmartwaiverPdfFile({ businessId, file });
        ok++;
        nextResults.push({
          file: file.name,
          status: 'ok',
          action: imported.saved?.action || 'saved',
          documentId: imported.parsed.documentId,
          confidence: imported.parsed.parseConfidence
        });
      } catch (error) {
        failed++;
        nextResults.push({
          file: file.name,
          status: 'failed',
          message: error?.message || 'Import failed'
        });
      }
      setResults([...nextResults]);
    }

    setImporting(false);
    if (failed > 0) {
      toast.error(`Imported ${ok}; ${failed} failed`);
    } else {
      toast.success(`Imported ${ok} Smartwaiver PDF${ok === 1 ? '' : 's'}`);
    }
  };

  if (!businessId) return null;

  return (
    <div style={styles.card}>
      <h3 style={styles.title}>
        <FiFilePlus style={{ marginRight: 8, verticalAlign: 'middle' }} />
        Smartwaiver PDF archive import
      </h3>
      <p style={styles.helper}>
        Upload original Smartwaiver PDFs to Tavari. Tavari reads the certificate/text, creates or updates a
        legacy waiver row, uploads the PDF to Supabase Storage, and makes it searchable in the waiver overview.
        For the full 18,000-file archive, use the batch script documented in <code>Waivers/SMARTWAIVER_PDF_IMPORT.md</code>.
      </p>
      <div style={styles.row}>
        <input
          type="file"
          accept="application/pdf,.pdf"
          multiple
          onChange={handleFiles}
          disabled={importing}
          style={styles.fileInput}
        />
        <button
          type="button"
          onClick={handleImport}
          disabled={importing || files.length === 0}
          style={{
            ...styles.button,
            ...(importing || files.length === 0 ? styles.buttonDisabled : {})
          }}
        >
          <FiUploadCloud />
          {importing ? 'Importing…' : `Import ${files.length || ''} PDF${files.length === 1 ? '' : 's'}`.trim()}
        </button>
      </div>
      {files.length > 0 ? (
        <p style={styles.small}>
          Selected {files.length} PDF{files.length === 1 ? '' : 's'}. Browser uploads are best for small batches.
        </p>
      ) : null}
      {results.length > 0 ? (
        <ul style={styles.results}>
          {results.map((r) => (
            <li key={`${r.file}-${r.status}-${r.documentId || r.message}`} style={styles.resultItem}>
              <span style={r.status === 'ok' ? styles.ok : styles.fail}>{r.status === 'ok' ? 'Imported' : 'Failed'}</span>
              <span style={styles.resultFile}>{r.file}</span>
              {r.status === 'ok' ? (
                <span style={styles.resultMeta}>
                  {r.action} • Doc {r.documentId} • confidence {r.confidence}%
                </span>
              ) : (
                <span style={styles.resultMeta}>{r.message}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

const styles = {
  card: {
    maxWidth: 760,
    marginBottom: '1.5rem',
    padding: '1rem',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: 10,
    background: TavariStyles.colors.white
  },
  title: {
    fontSize: TavariStyles.typography.fontSize.lg,
    marginTop: 0,
    marginBottom: TavariStyles.spacing.sm
  },
  helper: {
    color: TavariStyles.colors.gray600,
    fontSize: TavariStyles.typography.fontSize.sm,
    lineHeight: 1.5
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
    marginTop: 12
  },
  fileInput: {
    flex: '1 1 300px'
  },
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    background: TavariStyles.colors.primary,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontWeight: 600
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed'
  },
  small: {
    color: TavariStyles.colors.gray500,
    fontSize: 13,
    marginTop: 8
  },
  results: {
    listStyle: 'none',
    padding: 0,
    margin: '1rem 0 0'
  },
  resultItem: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    padding: '0.45rem 0',
    borderTop: `1px solid ${TavariStyles.colors.gray100 || '#f3f4f6'}`
  },
  ok: {
    color: TavariStyles.colors.success,
    fontWeight: 700
  },
  fail: {
    color: TavariStyles.colors.error,
    fontWeight: 700
  },
  resultFile: {
    fontWeight: 600
  },
  resultMeta: {
    color: TavariStyles.colors.gray600,
    fontSize: 13
  }
};

export default SmartwaiverPdfImportPanel;
