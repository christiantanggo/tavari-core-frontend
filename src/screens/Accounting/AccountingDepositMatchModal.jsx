import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { FiPlus, FiTrash2 } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { useErpNextAccounts } from '../../hooks/useErpNextAccounts';
import { formatAccountingDateLabel, getCurrentBusinessDate } from '../../utils/businessDateFormat';

const MATCH_WINDOW_DAYS = 21;

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const formatMoney = (n) => `$${round2(n).toFixed(2)}`;
const formatDate = (value) => formatAccountingDateLabel(value);

function addDays(dateOnly, days) {
  const m = String(dateOnly || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(dateOnly || '').slice(0, 10);
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return date.toISOString().slice(0, 10);
}

function buildManualLine() {
  return {
    id: crypto.randomUUID(),
    line_type: 'manual_adjustment',
    description: '',
    matched_amount: '',
    metadata: {}
  };
}

function buildGroupMap({
  batches,
  batchItems,
  allMatchLines,
  currentDepositId
}) {
  const batchById = new Map((batches || []).map((batch) => [batch.id, batch]));
  const byKey = new Map();

  for (const item of batchItems || []) {
    const batch = batchById.get(item.batch_id);
    if (!batch) continue;
    const gross = round2(Number(item.amount || 0) + Number(item.tax_amount || 0));
    const relatedLines = (allMatchLines || []).filter((line) => line.batch_item_id === item.id);
    const selectedOnCurrentDeposit = round2(
      relatedLines
        .filter((line) => line.deposit_id === currentDepositId)
        .reduce((sum, line) => sum + Number(line.matched_amount || 0), 0)
    );
    const consumedByOtherDeposits = round2(
      relatedLines
        .filter((line) => line.deposit_id !== currentDepositId)
        .reduce((sum, line) => sum + Number(line.matched_amount || 0), 0)
    );
    const available = round2(Math.max(0, gross - consumedByOtherDeposits));
    if (available <= 0 && selectedOnCurrentDeposit <= 0) continue;

    const bucketKey = item.source_bucket_key || `${item.source_type || 'unknown'}:${batch.id}`;
    const bucketLabel = item.source_bucket_label || item.source_type || 'Source';
    const groupKey = `${batch.id}::${bucketKey}`;
    const existing = byKey.get(groupKey) || {
      id: groupKey,
      batch_id: batch.id,
      batch_date: batch.batch_date,
      batch_status: batch.status,
      batch_erpnext_journal_entry_id: batch.erpnext_journal_entry_id || null,
      bucket_key: bucketKey,
      bucket_label: bucketLabel,
      source_type: item.source_type || null,
      available_amount: 0,
      selected_amount: 0,
      item_rows: []
    };

    existing.available_amount = round2(existing.available_amount + available);
    existing.selected_amount = round2(existing.selected_amount + selectedOnCurrentDeposit);
    existing.item_rows.push({
      id: item.id,
      batch_id: batch.id,
      source_type: item.source_type || null,
      source_id: item.source_id || null,
      source_bucket_key: bucketKey,
      source_bucket_label: bucketLabel,
      gross_amount: gross,
      revenue_amount: round2(item.amount || 0),
      tax_amount: round2(item.tax_amount || 0),
      max_allocatable: available,
      current_selected: selectedOnCurrentDeposit,
      source_metadata: item.source_metadata || {}
    });
    byKey.set(groupKey, existing);
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.batch_date === b.batch_date) return a.bucket_label.localeCompare(b.bucket_label);
    return String(b.batch_date).localeCompare(String(a.batch_date));
  });
}

function expandBatchAllocations(groups) {
  const lines = [];

  for (const group of groups || []) {
    let remaining = round2(Number(group.selected_amount || 0));
    if (remaining <= 0) continue;

    for (const item of group.item_rows || []) {
      if (remaining <= 0) break;
      const maxAllocatable = round2(item.max_allocatable || 0);
      if (maxAllocatable <= 0) continue;

      const piece = round2(Math.min(maxAllocatable, remaining));
      if (piece <= 0) continue;

      const ratio = item.gross_amount > 0 ? piece / item.gross_amount : 0;
      const revenueAmount = round2(item.revenue_amount * ratio);
      const taxAmount = round2(piece - revenueAmount);

      lines.push({
        line_type: 'batch_item',
        batch_id: item.batch_id,
        batch_item_id: item.id,
        source_type: item.source_type,
        source_id: item.source_id,
        source_bucket_key: item.source_bucket_key,
        source_bucket_label: item.source_bucket_label,
        description: `${formatDate(group.batch_date)} - ${group.bucket_label}`,
        matched_amount: piece,
        revenue_amount: revenueAmount,
        tax_amount: taxAmount,
        metadata: item.source_metadata || {}
      });

      remaining = round2(remaining - piece);
    }

    if (remaining > 0.009) {
      throw new Error(`Not enough available source amount left for ${group.bucket_label} on ${group.batch_date}. Refresh and try again.`);
    }
  }

  return lines;
}

const AccountingDepositMatchModal = ({
  businessId,
  transaction,
  defaultBankAccount = '',
  onClose,
  onSaved
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deposit, setDeposit] = useState(null);
  const [depositForm, setDepositForm] = useState({
    deposit_mode: 'sales_deposit',
    deposit_date: transaction?.transaction_date || getCurrentBusinessDate(),
    bank_account_erpnext: defaultBankAccount || '',
    total_amount: Math.abs(Number(transaction?.amount) || 0),
    counterpart_account_erpnext: '',
    notes: ''
  });
  const [candidateGroups, setCandidateGroups] = useState([]);
  const [manualLines, setManualLines] = useState([]);
  const { accounts: erpnextAccounts } = useErpNextAccounts(businessId);
  const bankAmount = round2(depositForm.total_amount || Math.abs(Number(transaction?.amount) || 0));

  const totalMatchedAmount = useMemo(() => {
    if (depositForm.deposit_mode === 'other_deposit') {
      return bankAmount;
    }
    const groupTotal = candidateGroups.reduce((sum, group) => sum + Number(group.selected_amount || 0), 0);
    const manualTotal = manualLines.reduce((sum, line) => sum + Number(line.matched_amount || 0), 0);
    return round2(groupTotal + manualTotal);
  }, [bankAmount, candidateGroups, depositForm.deposit_mode, manualLines]);
  const difference = round2(bankAmount - totalMatchedAmount);

  const loadWorkspace = useCallback(async () => {
    if (!businessId || !transaction?.id) return;
    setLoading(true);
    try {
      const depositId = transaction.matched_deposit_id || null;
      const windowStart = addDays(transaction.transaction_date || getCurrentBusinessDate(), -MATCH_WINDOW_DAYS);
      const windowEnd = addDays(transaction.transaction_date || getCurrentBusinessDate(), MATCH_WINDOW_DAYS);

      const [depositRes, batchesRes] = await Promise.all([
        depositId
          ? supabase
              .from('accounting_deposits')
              .select('id, deposit_date, total_amount, bank_account_erpnext, status, notes')
              .eq('id', depositId)
              .eq('business_id', businessId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from('accounting_sales_batches')
          .select('id, batch_date, status, erpnext_journal_entry_id')
          .eq('business_id', businessId)
          .gte('batch_date', windowStart)
          .lte('batch_date', windowEnd)
          .in('status', ['draft', 'posted'])
          .order('batch_date', { ascending: false })
      ]);

      if (depositRes.error) throw depositRes.error;
      if (batchesRes.error) throw batchesRes.error;

      const nextDeposit = depositRes.data || null;
      setDeposit(nextDeposit);
      if (nextDeposit) {
        setDepositForm({
          deposit_mode: 'sales_deposit',
          deposit_date: nextDeposit.deposit_date || transaction.transaction_date || getCurrentBusinessDate(),
          bank_account_erpnext: nextDeposit.bank_account_erpnext || defaultBankAccount || '',
          total_amount: Math.abs(Number(nextDeposit.total_amount) || 0),
          counterpart_account_erpnext: '',
          notes: nextDeposit.notes || ''
        });
      }

      const batchIds = (batchesRes.data || []).map((batch) => batch.id);
      const itemsRes = batchIds.length > 0
        ? await supabase
            .from('accounting_sales_batch_items')
            .select('id, batch_id, source_type, source_id, amount, tax_amount, source_bucket_key, source_bucket_label, source_metadata')
            .in('batch_id', batchIds)
        : { data: [], error: null };
      if (itemsRes.error) throw itemsRes.error;

      const batchItemIds = (itemsRes.data || []).map((item) => item.id);
      const matchLinesRes = batchItemIds.length > 0 || nextDeposit?.id
        ? await supabase
            .from('accounting_deposit_match_lines')
            .select('id, deposit_id, batch_item_id, line_type, description, matched_amount, metadata')
            .eq('business_id', businessId)
            .or([
              batchItemIds.length > 0 ? `batch_item_id.in.(${batchItemIds.join(',')})` : null,
              nextDeposit?.id ? `deposit_id.eq.${nextDeposit.id}` : null
            ].filter(Boolean).join(','))
        : { data: [], error: null };
      if (matchLinesRes.error) throw matchLinesRes.error;

      const groupedCandidates = buildGroupMap({
        batches: batchesRes.data || [],
        batchItems: itemsRes.data || [],
        allMatchLines: matchLinesRes.data || [],
        currentDepositId: nextDeposit?.id || null
      });
      setCandidateGroups(groupedCandidates);

      const existingManualLines = (matchLinesRes.data || [])
        .filter((line) => line.deposit_id === nextDeposit?.id && line.line_type !== 'batch_item')
        .map((line) => ({
          id: line.id,
          line_type: line.line_type,
          description: line.description || '',
          matched_amount: Number(line.matched_amount || 0),
          metadata: line.metadata || {}
        }));
      setManualLines(existingManualLines);
      const counterpartLine = existingManualLines.find((line) => line?.metadata?.counterpart_account_erpnext);
      if (counterpartLine) {
        setDepositForm((prev) => ({
          ...prev,
          deposit_mode: 'other_deposit',
          counterpart_account_erpnext: counterpartLine.metadata.counterpart_account_erpnext || ''
        }));
      }
    } catch (error) {
      toast.error(error?.message || 'Failed to load deposit matching workspace');
    } finally {
      setLoading(false);
    }
  }, [businessId, defaultBankAccount, transaction]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  const updateGroupAmount = (groupId, value) => {
    setCandidateGroups((prev) =>
      prev.map((group) => {
        if (group.id !== groupId) return group;
        const numericValue = value === '' ? '' : round2(Number(value));
        if (numericValue === '') return { ...group, selected_amount: '' };
        const safeValue = Math.max(0, Math.min(group.available_amount, Number.isFinite(numericValue) ? numericValue : 0));
        return { ...group, selected_amount: safeValue };
      })
    );
  };

  const toggleGroup = (groupId, checked) => {
    setCandidateGroups((prev) =>
      prev.map((group) =>
        group.id === groupId
          ? { ...group, selected_amount: checked ? group.available_amount : 0 }
          : group
      )
    );
  };

  const updateManualLine = (lineId, field, value) => {
    setManualLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        return {
          ...line,
          [field]: field === 'matched_amount' ? value : value
        };
      })
    );
  };

  const regenerateDailyBatch = async () => {
    if (!businessId || !depositForm.deposit_date) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('accounting-daily-batch', {
        body: {
          business_id: businessId,
          batch_date: depositForm.deposit_date,
          backfill_days: 1
        }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Rebuilt daily batch candidates for ${depositForm.deposit_date}.`);
      await loadWorkspace();
    } catch (error) {
      toast.error(error?.message || 'Failed to build the daily batch for this date');
    } finally {
      setSaving(false);
    }
  };

  const persistDepositMatch = async ({ shouldPost = false, repairOnly = false } = {}) => {
    if (!businessId || !transaction?.id) return;
    if (!depositForm.deposit_date) {
      toast.error('Choose the deposit date first.');
      return;
    }
    if (!depositForm.bank_account_erpnext) {
      toast.error('Choose the bank account this deposit belongs to.');
      return;
    }
    if (bankAmount <= 0) {
      toast.error('Deposit amount must be greater than zero.');
      return;
    }
    if (depositForm.deposit_mode === 'other_deposit' && !depositForm.counterpart_account_erpnext) {
      toast.error('Choose the other-side account for this non-sales deposit.');
      return;
    }
    if ((shouldPost || repairOnly) && Math.abs(difference) > 0.009) {
      toast.error('Match the selected sources to the bank amount before approving.');
      return;
    }
    if (repairOnly && deposit?.status !== 'posted') {
      toast.error('Repair is only available for deposits that were already posted on the bank side.');
      return;
    }

    setSaving(true);
    try {
      const batchLines = depositForm.deposit_mode === 'sales_deposit' ? expandBatchAllocations(candidateGroups) : [];
      const normalizedManualLines = depositForm.deposit_mode === 'other_deposit'
        ? [{
            line_type: 'manual_adjustment',
            description: String(transaction?.description || transaction?.payee || 'Other deposit / transfer').trim(),
            matched_amount: bankAmount,
            revenue_amount: 0,
            tax_amount: 0,
            metadata: {
              counterpart_account_erpnext: depositForm.counterpart_account_erpnext,
              deposit_mode: 'other_deposit'
            }
          }]
        : manualLines
            .map((line) => ({
              line_type: line.line_type,
              description: String(line.description || '').trim() || 'Manual adjustment',
              matched_amount: round2(Number(line.matched_amount || 0)),
              revenue_amount: 0,
              tax_amount: 0,
              metadata: line.metadata || {}
            }))
            .filter((line) => Math.abs(line.matched_amount) > 0.009);
      const allLines = [...batchLines, ...normalizedManualLines];

      let depositId = deposit?.id || null;
      if (!depositId) {
        const { data: insertedDeposit, error: insertError } = await supabase
          .from('accounting_deposits')
          .insert({
            business_id: businessId,
            deposit_date: depositForm.deposit_date,
            total_amount: bankAmount,
            bank_account_erpnext: depositForm.bank_account_erpnext,
            notes: depositForm.notes || null,
            source: 'bank_import',
            status: 'draft'
          })
          .select('id, status')
          .single();
        if (insertError) throw insertError;
        depositId = insertedDeposit.id;
        setDeposit(insertedDeposit);
      } else {
        const { error: updateDepositError } = await supabase
          .from('accounting_deposits')
          .update({
            deposit_date: depositForm.deposit_date,
            total_amount: bankAmount,
            bank_account_erpnext: depositForm.bank_account_erpnext,
            notes: depositForm.notes || null,
            source: 'bank_import'
          })
          .eq('id', depositId)
          .eq('business_id', businessId);
        if (updateDepositError) throw updateDepositError;
      }

      const { data: existingDepositBatches, error: existingDepositBatchesError } = await supabase
        .from('accounting_deposit_batches')
        .select('batch_id')
        .eq('deposit_id', depositId);
      if (existingDepositBatchesError) throw existingDepositBatchesError;
      const previousBatchIds = (existingDepositBatches || []).map((row) => row.batch_id);
      const nextBatchIds = Array.from(new Set(batchLines.map((line) => line.batch_id).filter(Boolean)));

      if (previousBatchIds.length > 0) {
        await supabase
          .from('accounting_sales_batches')
          .update({ deposit_id: null })
          .in('id', previousBatchIds)
          .eq('deposit_id', depositId);
      }
      await supabase.from('accounting_deposit_batches').delete().eq('deposit_id', depositId);
      await supabase.from('accounting_deposit_match_lines').delete().eq('deposit_id', depositId);

      if (nextBatchIds.length > 0) {
        const { error: depositBatchInsertError } = await supabase
          .from('accounting_deposit_batches')
          .insert(nextBatchIds.map((batchId) => ({ deposit_id: depositId, batch_id: batchId })));
        if (depositBatchInsertError) throw depositBatchInsertError;

        const { error: linkBatchError } = await supabase
          .from('accounting_sales_batches')
          .update({ deposit_id: depositId })
          .in('id', nextBatchIds);
        if (linkBatchError) throw linkBatchError;
      }

      if (allLines.length > 0) {
        const { error: insertLinesError } = await supabase
          .from('accounting_deposit_match_lines')
          .insert(
            allLines.map((line) => ({
              business_id: businessId,
              deposit_id: depositId,
              ...line
            }))
          );
        if (insertLinesError) throw insertLinesError;
      }

      const { error: bankTxUpdateError } = await supabase
        .from('accounting_bank_transactions')
        .update({
          matched_deposit_id: depositId,
          status: shouldPost ? 'posted' : repairOnly ? 'posted' : 'matched'
        })
        .eq('id', transaction.id);
      if (bankTxUpdateError) throw bankTxUpdateError;

      if (repairOnly) {
        const draftBatchIds = Array.from(new Set(
          candidateGroups
            .filter((group) => Number(group.selected_amount || 0) > 0 && group.batch_status === 'draft')
            .map((group) => group.batch_id)
            .filter(Boolean)
        ));
        for (const batchId of draftBatchIds) {
          const { data, error } = await supabase.functions.invoke('accounting-post-batch', {
            body: { business_id: businessId, batch_id: batchId }
          });
          if (error) throw error;
          if (data?.error) throw new Error(data.error);
        }
        toast.success('Missing revenue side repaired. Existing bank deposit was kept intact.');
      } else if (shouldPost) {
        const { data, error } = await supabase.functions.invoke('accounting-post-deposit', {
          body: { business_id: businessId, deposit_id: depositId }
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        const { error: finalizeBankTxError } = await supabase
          .from('accounting_bank_transactions')
          .update({
            status: 'posted',
            erpnext_journal_entry_id: data?.erpnext_journal_entry_id || null
          })
          .eq('id', transaction.id);
        if (finalizeBankTxError) throw finalizeBankTxError;

        toast.success('Deposit matched and posted to ERPNext.');
      } else {
        toast.success('Deposit match saved as a draft.');
      }

      await onSaved?.();
    } catch (error) {
      toast.error(error?.message || 'Failed to save deposit match');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modalCard}>
        <div style={styles.headerRow}>
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: '1.125rem' }}>Review sale / deposit from transaction</h3>
            <p style={styles.subtleText}>
              Match this bank credit against one or more sales buckets, carryover lines, cash deposited later, or manual adjustments.
            </p>
          </div>
          <button type="button" onClick={onClose} style={styles.secondaryButton} disabled={saving}>
            Close
          </button>
        </div>

        <div style={styles.summaryCard}>
          <div style={{ fontSize: 13, marginBottom: 4 }}><strong>Payee:</strong> {transaction?.payee || '—'}</div>
          <div style={{ fontSize: 13, marginBottom: 4 }}><strong>Description:</strong> {transaction?.description || '—'}</div>
          <div style={{ fontSize: 13 }}><strong>Imported amount:</strong> {formatMoney(transaction?.amount || 0)}</div>
        </div>

        {loading ? (
          <p style={styles.subtleText}>Loading matching workspace...</p>
        ) : (
          <>
            <div style={styles.formGrid}>
              <label style={styles.fieldLabel}>
                <span>Deposit type</span>
                <select
                  value={depositForm.deposit_mode}
                  onChange={(e) => setDepositForm((prev) => ({ ...prev, deposit_mode: e.target.value }))}
                  style={styles.input}
                >
                  <option value="sales_deposit">Sales deposit</option>
                  <option value="other_deposit">Other deposit / transfer</option>
                </select>
              </label>
              <label style={styles.fieldLabel}>
                <span>Deposit date</span>
                <input
                  type="date"
                  value={depositForm.deposit_date}
                  onChange={(e) => setDepositForm((prev) => ({ ...prev, deposit_date: e.target.value }))}
                  style={styles.input}
                />
              </label>
              <label style={styles.fieldLabel}>
                <span>Deposit amount</span>
                <input
                  type="number"
                  step="0.01"
                  value={depositForm.total_amount}
                  onChange={(e) => setDepositForm((prev) => ({ ...prev, total_amount: e.target.value }))}
                  style={styles.input}
                />
              </label>
            </div>

            <label style={styles.fieldLabel}>
              <span>Bank account</span>
              <select
                value={depositForm.bank_account_erpnext}
                onChange={(e) => setDepositForm((prev) => ({ ...prev, bank_account_erpnext: e.target.value }))}
                style={styles.input}
              >
                <option value="">Select bank account</option>
                {erpnextAccounts.map((account) => (
                  <option key={account} value={account}>{account}</option>
                ))}
              </select>
            </label>

            {depositForm.deposit_mode === 'other_deposit' && (
              <label style={styles.fieldLabel}>
                <span>Other-side account</span>
                <select
                  value={depositForm.counterpart_account_erpnext}
                  onChange={(e) => setDepositForm((prev) => ({ ...prev, counterpart_account_erpnext: e.target.value }))}
                  style={styles.input}
                >
                  <option value="">Select counterpart account</option>
                  {erpnextAccounts
                    .filter((account) => account !== depositForm.bank_account_erpnext)
                    .map((account) => (
                      <option key={account} value={account}>{account}</option>
                    ))}
                </select>
              </label>
            )}

            <label style={styles.fieldLabel}>
              <span>Notes</span>
              <textarea
                value={depositForm.notes}
                onChange={(e) => setDepositForm((prev) => ({ ...prev, notes: e.target.value }))}
                style={{ ...styles.input, minHeight: 72, resize: 'vertical' }}
                placeholder="Optional notes about this deposit"
              />
            </label>

            {depositForm.deposit_mode === 'sales_deposit' ? (
              <>
                <section style={{ marginTop: 20 }}>
                  <div style={styles.sectionHeader}>
                    <div>
                      <h4 style={styles.sectionTitle}>Candidate source buckets</h4>
                      <p style={styles.subtleText}>Select one or more buckets and edit the matched amount if this deposit only covers part of the bucket.</p>
                    </div>
                    <button type="button" onClick={regenerateDailyBatch} style={styles.secondaryButton} disabled={saving}>
                      Build daily batch for date
                    </button>
                  </div>

                  {candidateGroups.length === 0 ? (
                    <p style={styles.subtleText}>No nearby sales buckets were found. You can still add manual lines below.</p>
                  ) : (
                    <div style={styles.tableWrap}>
                      <table style={styles.table}>
                        <thead>
                          <tr>
                            <th style={styles.th}>Use</th>
                            <th style={styles.th}>Date</th>
                            <th style={styles.th}>Bucket</th>
                            <th style={styles.th}>Batch status</th>
                            <th style={{ ...styles.th, textAlign: 'right' }}>Available</th>
                            <th style={{ ...styles.th, textAlign: 'right' }}>Matched</th>
                          </tr>
                        </thead>
                        <tbody>
                          {candidateGroups.map((group) => (
                            <tr key={group.id}>
                              <td style={styles.td}>
                                <input
                                  type="checkbox"
                                  checked={Number(group.selected_amount || 0) > 0}
                                  onChange={(e) => toggleGroup(group.id, e.target.checked)}
                                />
                              </td>
                              <td style={styles.td}>{formatDate(group.batch_date)}</td>
                              <td style={styles.td}>{group.bucket_label}</td>
                              <td style={styles.td}>{group.batch_status}</td>
                              <td style={{ ...styles.td, textAlign: 'right' }}>{formatMoney(group.available_amount)}</td>
                              <td style={{ ...styles.td, textAlign: 'right' }}>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max={group.available_amount}
                                  value={group.selected_amount}
                                  onChange={(e) => updateGroupAmount(group.id, e.target.value)}
                                  style={{ ...styles.input, width: 120, textAlign: 'right' }}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section style={{ marginTop: 20 }}>
                  <div style={styles.sectionHeader}>
                    <div>
                      <h4 style={styles.sectionTitle}>Manual lines</h4>
                      <p style={styles.subtleText}>Use these for carryover, cash deposited later, or any manual adjustment needed to balance the statement amount.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setManualLines((prev) => [...prev, buildManualLine()])}
                      style={styles.primaryButton}
                    >
                      <FiPlus /> Add line
                    </button>
                  </div>

                  {manualLines.length === 0 ? (
                    <p style={styles.subtleText}>No manual lines added.</p>
                  ) : (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {manualLines.map((line) => (
                        <div key={line.id} style={styles.manualLineCard}>
                          <select
                            value={line.line_type}
                            onChange={(e) => updateManualLine(line.id, 'line_type', e.target.value)}
                            style={{ ...styles.input, minWidth: 180 }}
                          >
                            <option value="manual_adjustment">Manual adjustment</option>
                            <option value="undeposited_carryover">Undeposited carryover</option>
                            <option value="cash_deposit">Cash deposited later</option>
                          </select>
                          <input
                            value={line.description}
                            onChange={(e) => updateManualLine(line.id, 'description', e.target.value)}
                            style={{ ...styles.input, flex: 1 }}
                            placeholder="Description"
                          />
                          <input
                            type="number"
                            step="0.01"
                            value={line.matched_amount}
                            onChange={(e) => updateManualLine(line.id, 'matched_amount', e.target.value)}
                            style={{ ...styles.input, width: 120, textAlign: 'right' }}
                            placeholder="0.00"
                          />
                          <button
                            type="button"
                            onClick={() => setManualLines((prev) => prev.filter((entry) => entry.id !== line.id))}
                            style={styles.iconButton}
                            title="Remove line"
                          >
                            <FiTrash2 />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            ) : (
              <section style={{ marginTop: 20 }}>
                <div style={styles.summaryCard}>
                  <div style={{ fontSize: 13, marginBottom: 4 }}>
                    <strong>Other deposit / transfer:</strong> this will debit the selected bank account and credit the selected counterpart account.
                  </div>
                  <div style={{ fontSize: 13 }}>
                    No sales revenue or HST will be posted from this deposit.
                  </div>
                </div>
              </section>
            )}

            <div style={styles.footerSummary}>
              <div style={styles.footerRow}>
                <span>Bank amount</span>
                <strong>{formatMoney(bankAmount)}</strong>
              </div>
              <div style={styles.footerRow}>
                <span>Matched total</span>
                <strong>{formatMoney(totalMatchedAmount)}</strong>
              </div>
              <div style={styles.footerRow}>
                <span>Difference</span>
                <strong style={{ color: Math.abs(difference) > 0.009 ? '#b45309' : '#059669' }}>{formatMoney(difference)}</strong>
              </div>
            </div>

            <div style={styles.actionsRow}>
              <button type="button" onClick={() => persistDepositMatch({ shouldPost: false })} style={styles.secondaryButton} disabled={saving}>
                {saving ? 'Saving...' : depositForm.deposit_mode === 'other_deposit' ? 'Save draft deposit' : 'Save draft match'}
              </button>
              {deposit?.status === 'posted' ? (
                <button
                  type="button"
                  onClick={() => persistDepositMatch({ repairOnly: true })}
                  style={styles.primaryButton}
                  disabled={saving || depositForm.deposit_mode === 'other_deposit'}
                  title={depositForm.deposit_mode === 'other_deposit' ? 'Revenue repair only applies to sales deposits' : undefined}
                >
                  {saving ? 'Repairing...' : 'Repair revenue side'}
                </button>
              ) : (
                <button type="button" onClick={() => persistDepositMatch({ shouldPost: true })} style={styles.primaryButton} disabled={saving}>
                  {saving ? 'Posting...' : depositForm.deposit_mode === 'other_deposit' ? 'Approve deposit' : 'Approve and post'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const styles = {
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(17, 24, 39, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    zIndex: 2000
  },
  modalCard: {
    width: '100%',
    maxWidth: 980,
    maxHeight: '92vh',
    overflowY: 'auto',
    background: '#fff',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 24px 48px rgba(0, 0, 0, 0.18)',
    boxSizing: 'border-box'
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16
  },
  summaryCard: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 10,
    background: '#f8fafc',
    border: '1px solid #e5e7eb'
  },
  subtleText: {
    margin: 0,
    fontSize: 13,
    color: TavariStyles?.colors?.gray600 || '#6b7280'
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12,
    marginBottom: 12
  },
  fieldLabel: {
    display: 'grid',
    gap: 6,
    fontSize: 14,
    fontWeight: 500,
    marginBottom: 12
  },
  input: {
    width: '100%',
    maxWidth: '100%',
    padding: '8px 12px',
    border: `1px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
    borderRadius: 8,
    fontSize: 14,
    background: '#fff',
    boxSizing: 'border-box'
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12
  },
  sectionTitle: {
    margin: '0 0 4px',
    fontSize: 16
  },
  tableWrap: {
    overflowX: 'auto',
    border: '1px solid #e5e7eb',
    borderRadius: 10
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: 760
  },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    fontSize: 13,
    borderBottom: '1px solid #e5e7eb',
    background: '#f8fafc'
  },
  td: {
    padding: '10px 12px',
    fontSize: 13,
    borderTop: '1px solid #f1f5f9'
  },
  manualLineCard: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
    padding: 12,
    borderRadius: 10,
    border: '1px solid #e5e7eb',
    background: '#fff'
  },
  footerSummary: {
    marginTop: 20,
    padding: 12,
    borderRadius: 10,
    border: '1px solid #e5e7eb',
    background: '#f8fafc'
  },
  footerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    fontSize: 14,
    padding: '4px 0'
  },
  actionsRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
    flexWrap: 'wrap'
  },
  primaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '8px 14px',
    background: TavariStyles?.colors?.primary || '#008080',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14
  },
  secondaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '8px 14px',
    background: '#fff',
    color: TavariStyles?.colors?.gray700 || '#374151',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14
  },
  iconButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderRadius: 8,
    border: '1px solid #d1d5db',
    background: '#fff',
    cursor: 'pointer'
  }
};

export default AccountingDepositMatchModal;
