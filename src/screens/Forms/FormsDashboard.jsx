import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FiAlertTriangle, FiCheckCircle, FiClipboard, FiEdit2, FiFileText, FiPlus, FiPrinter, FiSettings, FiTrash2, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { useModuleEnabled } from '../../hooks/useModuleEnabled';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import FormsCompleteTab from '../../components/Forms/FormsCompleteTab';
import { formatZonedDateTime } from '../../helpers/taskManagerSchedule';
import { formatYesNoValue } from '../../utils/formsFieldValidation';
import { formatMaintenanceLabel, formatUrgencyLabel } from '../../utils/formsEscalation';
import { TavariStyles } from '../../utils/TavariStyles';
import ModuleSettingsTabContent from '../../components/Modules/ModuleSettingsTabContent';

const TABS = [
  { id: 'complete', label: 'Complete', icon: FiCheckCircle },
  { id: 'forms', label: 'Forms', icon: FiClipboard },
  { id: 'submissions', label: 'Submissions & Alerts', icon: FiAlertTriangle },
  { id: 'print', label: 'Weekly Print', icon: FiPrinter },
  { id: 'settings', label: 'Settings', icon: FiSettings }
];

const EMPTY_FORM = {
  title: '',
  description: '',
  alert_employee_id: '',
  fields: [createEmptyField('number')]
};

const FIELD_TYPE_HELP = {
  number: 'For readings like temperature or counts. Set min/max to flag out-of-range values for review.',
  text: 'Short text answer — names, locations, short notes.',
  textarea: 'Longer notes or comments.',
  yes_no: 'Staff pick Yes, No, or N/A from a dropdown. Set the expected answer to trigger alerts when a different answer is chosen.',
  select: 'Staff pick one option from your list — use for Good/Fair/Poor, locations, etc.',
  checkbox: 'Single checkmark — checked means yes; unchecked means no.'
};

const parseSelectOptionsText = (text) => String(text || '')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [value, label] = line.includes('|') ? line.split('|').map((part) => part.trim()) : [line, line];
    return { value: value || line, label: label || value || line };
  });

const formatSelectOptionsText = (options = []) => (Array.isArray(options) ? options : [])
  .map((option) => {
    if (typeof option === 'string') return option;
    const value = option?.value ?? '';
    const label = option?.label ?? value;
    return value && label && value !== label ? `${value}|${label}` : (label || value);
  })
  .filter(Boolean)
  .join('\n');

function createEmptyField(fieldType = 'number') {
  return {
    field_key: '',
    field_label: '',
    field_type: fieldType,
    is_required: true,
    min: '',
    max: '',
    unit: fieldType === 'number' ? '°F' : '',
    optionsText: '',
    correctAnswer: fieldType === 'yes_no' ? '' : undefined
  };
}

const buildFieldKey = (label, existingKey = '') => {
  if (existingKey) return existingKey;
  return label.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^\w]/g, '');
};

/** Assign stable, unique field_key values within a form before insert/update. */
const ensureUniqueFieldKeys = (fields) => {
  const used = new Set();
  return fields.map((field, idx) => {
    const preferred = (field.field_key || buildFieldKey(field.field_label) || `field_${idx + 1}`).trim();
    const base = preferred || `field_${idx + 1}`;
    let key = base;
    let suffix = 2;
    while (used.has(key)) {
      key = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(key);
    return { ...field, field_key: key };
  });
};

const mapDbFieldToDraft = (field) => ({
  id: field.id,
  field_key: field.field_key,
  field_label: field.field_label,
  field_type: field.field_type,
  is_required: !!field.is_required,
  min: field.validation_rules?.min ?? '',
  max: field.validation_rules?.max ?? '',
  unit: field.validation_rules?.unit ?? '',
  optionsText: formatSelectOptionsText(field.field_options?.options),
  correctAnswer: field.validation_rules?.correct_answer ?? ''
});

const mapDraftFieldToRow = (field, formTemplateId, idx) => {
  const isNumber = field.field_type === 'number';
  const isSelect = field.field_type === 'select';
  const isYesNo = field.field_type === 'yes_no';

  return {
    form_template_id: formTemplateId,
    field_key: field.field_key || buildFieldKey(field.field_label) || `field_${idx + 1}`,
    field_label: field.field_label.trim(),
    field_type: field.field_type || 'number',
    is_required: !!field.is_required,
    display_order: idx,
    field_options: isSelect ? { options: parseSelectOptionsText(field.optionsText) } : {},
    validation_rules: isNumber
      ? {
          min: field.min !== '' && field.min != null ? Number(field.min) : null,
          max: field.max !== '' && field.max != null ? Number(field.max) : null,
          unit: field.unit || null,
          flag_out_of_range: true
        }
      : isYesNo
        ? {
            correct_answer: field.correctAnswer || null,
            flag_incorrect: true
          }
        : {}
  };
};

const formatPersonName = (user) =>
  user?.full_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Unknown';

const getSubmissionTaskTitle = (submission) =>
  submission.task?.title || submission.task_template?.title || submission.form_template?.title || 'Form submission';

const getSubmissionDueAt = (submission) =>
  submission.task?.due_at || submission.scheduled_for || submission.task?.scheduled_for || null;

const FormsDashboard = () => {
  const { selectedBusinessId, businessData } = useBusinessContext();
  const { userRole, authUser } = usePOSAuth();
  const { isEnabled, loading: moduleLoading } = useModuleEnabled('forms');
  const [activeTab, setActiveTab] = useState('complete');
  const [forms, setForms] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [isAlertRecipient, setIsAlertRecipient] = useState(false);
  const [accessChecked, setAccessChecked] = useState(false);
  const [formDraft, setFormDraft] = useState(EMPTY_FORM);
  const [editingFormId, setEditingFormId] = useState(null);
  const [loadingEditId, setLoadingEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [printFormId, setPrintFormId] = useState('');
  const [printStart, setPrintStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [printEnd, setPrintEnd] = useState(() => new Date().toISOString().slice(0, 10));

  const canManage = ['owner', 'manager', 'admin'].includes(userRole);
  const businessTimezone = businessData?.timezone || 'America/Toronto';
  const formatDateTime = useCallback(
    (iso) => (iso ? formatZonedDateTime(iso, businessTimezone) : '—'),
    [businessTimezone]
  );
  const canAccessModule = !!(isEnabled && selectedBusinessId && authUser?.id);
  const visibleTabs = useMemo(() => {
    if (canManage) return TABS;
    if (isAlertRecipient) return TABS.filter((tab) => tab.id === 'complete' || tab.id === 'submissions');
    return TABS.filter((tab) => tab.id === 'complete');
  }, [canManage, isAlertRecipient]);

  useEffect(() => {
    if (!selectedBusinessId || !authUser?.id || !isEnabled) {
      setAccessChecked(true);
      return;
    }
    if (canManage) {
      setIsAlertRecipient(false);
      setAccessChecked(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('forms_templates')
        .select('id')
        .eq('business_id', selectedBusinessId)
        .eq('alert_employee_id', authUser.id)
        .limit(1);
      if (cancelled) return;
      if (error && error.code !== '42703') {
        toast.error(error.message);
      }
      setIsAlertRecipient((data || []).length > 0);
      setAccessChecked(true);
    })();
    return () => { cancelled = true; };
  }, [selectedBusinessId, authUser?.id, isEnabled, canManage]);

  const loadEmployees = useCallback(async () => {
    if (!selectedBusinessId) return;
    const { data, error } = await supabase
      .from('business_users')
      .select('users!business_users_user_id_fkey(id, full_name, first_name, last_name, employment_status)')
      .eq('business_id', selectedBusinessId);
    if (error) throw error;
    const list = (data || [])
      .map((row) => row.users)
      .filter((user) => user && user.employment_status !== 'terminated')
      .map((user) => ({
        id: user.id,
        name: user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Staff'
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    setEmployees(list);
  }, [selectedBusinessId]);

  const load = useCallback(async () => {
    if (!selectedBusinessId) return;
    const formsRes = await supabase
      .from('forms_templates')
      .select('*')
      .eq('business_id', selectedBusinessId)
      .order('title');
    if (formsRes.error) throw formsRes.error;
    setForms(formsRes.data || []);
    if (!printFormId && formsRes.data?.[0]) setPrintFormId(formsRes.data[0].id);

    if (!canManage && !isAlertRecipient) {
      setSubmissions([]);
      setAlerts([]);
      return;
    }

    const [subsRes, alertsRes] = await Promise.all([
      supabase
        .from('forms_submissions')
        .select(`
          *,
          users:employee_id(full_name, first_name, last_name),
          task:task_id(title, due_at, scheduled_for),
          task_template:task_template_id(title),
          form_template:form_template_id(title)
        `)
        .eq('business_id', selectedBusinessId)
        .order('submitted_at', { ascending: false })
        .limit(200),
      supabase.from('forms_manager_alerts').select('*, notify_user:notify_employee_id(full_name, first_name, last_name)').eq('business_id', selectedBusinessId).is('acknowledged_at', null).order('created_at', { ascending: false })
    ]);
    if (subsRes.error) throw subsRes.error;
    if (alertsRes.error) throw alertsRes.error;
    setSubmissions(subsRes.data || []);
    setAlerts(alertsRes.data || []);
  }, [selectedBusinessId, printFormId, canManage, isAlertRecipient]);

  useEffect(() => {
    if (selectedBusinessId && canManage && isEnabled) loadEmployees().catch((e) => toast.error(e.message));
  }, [selectedBusinessId, canManage, isEnabled, loadEmployees]);

  useEffect(() => {
    if (selectedBusinessId && canAccessModule && accessChecked) load().catch((e) => toast.error(e.message));
  }, [selectedBusinessId, canAccessModule, accessChecked, isAlertRecipient, load]);

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(visibleTabs[0]?.id || 'complete');
    }
  }, [visibleTabs, activeTab]);

  const addField = () => {
    setFormDraft((prev) => ({
      ...prev,
      fields: [...prev.fields, createEmptyField('number')]
    }));
  };

  const removeField = (idx) => {
    setFormDraft((prev) => ({
      ...prev,
      fields: prev.fields.length <= 1 ? prev.fields : prev.fields.filter((_, i) => i !== idx)
    }));
  };

  const resetFormEditor = () => {
    setEditingFormId(null);
    setFormDraft(EMPTY_FORM);
  };

  const startEditForm = async (form) => {
    setLoadingEditId(form.id);
    try {
      const { data: fields, error } = await supabase
        .from('forms_fields')
        .select('*')
        .eq('form_template_id', form.id)
        .order('display_order')
        .order('created_at');
      if (error) throw error;

      setEditingFormId(form.id);
      setFormDraft({
        title: form.title || '',
        description: form.description || '',
        alert_employee_id: form.alert_employee_id || '',
        fields: (fields || []).length
          ? fields.map(mapDbFieldToDraft)
          : [createEmptyField('number')]
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      toast.error(err.message || 'Could not load form');
    } finally {
      setLoadingEditId(null);
    }
  };

  const saveForm = async (e) => {
    e.preventDefault();
    if (!formDraft.title.trim()) {
      toast.error('Form title is required');
      return;
    }

    const labeledFields = formDraft.fields.filter((f) => f.field_label.trim());
    const fieldsToSave = ensureUniqueFieldKeys(labeledFields);
    const invalidSelectField = fieldsToSave.find(
      (field) => field.field_type === 'select' && parseSelectOptionsText(field.optionsText).length === 0
    );
    if (invalidSelectField) {
      toast.error(`Add at least one dropdown option for "${invalidSelectField.field_label.trim()}"`);
      return;
    }

    const fieldRows = fieldsToSave.map((f, idx) => mapDraftFieldToRow(f, editingFormId, idx));

    if (!fieldRows.length) {
      toast.error('Add at least one field');
      return;
    }

    setSaving(true);
    try {
      if (editingFormId) {
        const { error: templateError } = await supabase
          .from('forms_templates')
          .update({
            title: formDraft.title.trim(),
            description: formDraft.description.trim() || null,
            alert_employee_id: formDraft.alert_employee_id || null,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingFormId)
          .eq('business_id', selectedBusinessId);
        if (templateError) throw templateError;

        const { data: existingFields, error: existingError } = await supabase
          .from('forms_fields')
          .select('id')
          .eq('form_template_id', editingFormId);
        if (existingError) throw existingError;

        const keepIds = new Set(fieldsToSave.filter((f) => f.id).map((f) => f.id));
        const deleteIds = (existingFields || []).map((f) => f.id).filter((id) => !keepIds.has(id));
        if (deleteIds.length) {
          const { error: deleteError } = await supabase.from('forms_fields').delete().in('id', deleteIds);
          if (deleteError) throw deleteError;
        }

        for (let idx = 0; idx < fieldsToSave.length; idx += 1) {
          const draftField = fieldsToSave[idx];
          const row = fieldRows[idx];

          if (draftField.id) {
            const { error: updateError } = await supabase
              .from('forms_fields')
              .update(row)
              .eq('id', draftField.id)
              .eq('form_template_id', editingFormId);
            if (updateError) throw updateError;
          } else {
            const { error: insertError } = await supabase.from('forms_fields').insert(row);
            if (insertError) throw insertError;
          }
        }

        toast.success('Form updated');
        resetFormEditor();
      } else {
        const { data: template, error } = await supabase.from('forms_templates').insert({
          business_id: selectedBusinessId,
          title: formDraft.title.trim(),
          description: formDraft.description.trim() || null,
          alert_employee_id: formDraft.alert_employee_id || null,
          status: 'active'
        }).select('id').single();
        if (error) throw error;

        const createRows = fieldRows.map((row) => ({ ...row, form_template_id: template.id }));
        const { error: fieldError } = await supabase.from('forms_fields').insert(createRows);
        if (fieldError) throw fieldError;

        toast.success('Form created');
        resetFormEditor();
      }

      await load();
    } catch (err) {
      toast.error(err.message || 'Failed to save form');
    } finally {
      setSaving(false);
    }
  };

  const acknowledgeAlert = async (alertId) => {
    const { error } = await supabase.from('forms_manager_alerts').update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: (await supabase.auth.getUser()).data.user?.id
    }).eq('id', alertId);
    if (error) toast.error(error.message);
    else {
      toast.success('Alert acknowledged');
      load();
    }
  };

  const printReport = () => {
    const filtered = submissions.filter((s) => {
      if (s.form_template_id !== printFormId) return false;
      const day = s.submitted_at?.slice(0, 10);
      return day >= printStart && day <= printEnd;
    });
    const formTitle = forms.find((f) => f.id === printFormId)?.title || 'Form Log';
    const win = window.open('', '_blank');
    if (!win) {
      toast.error('Allow pop-ups to print');
      return;
    }
    const rows = filtered.map((s) => {
      const name = s.users?.full_name || [s.users?.first_name, s.users?.last_name].filter(Boolean).join(' ') || 'Staff';
      const responses = Object.entries(s.responses || {}).map(([k, v]) => `${k}: ${v}`).join('; ');
      return `<tr><td>${new Date(s.submitted_at).toLocaleString()}</td><td>${name}</td><td>${responses}</td><td>${s.requires_manager_review ? 'Review' : 'OK'}</td></tr>`;
    }).join('');
    win.document.write(`
      <html><head><title>${formTitle} — ${printStart} to ${printEnd}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:8px;text-align:left}h1{font-size: 20px}</style>
      </head><body>
      <h1>${businessData?.name || 'Business'} — ${formTitle}</h1>
      <p>${printStart} through ${printEnd}</p>
      <table><thead><tr><th>Submitted</th><th>Employee</th><th>Readings</th><th>Status</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">No submissions in range</td></tr>'}</tbody></table>
      <script>window.print();</script></body></html>`);
    win.document.close();
  };

  const kioskFillUrl = (formId) =>
    `${window.location.origin}/forms/fill/${formId}?business=${encodeURIComponent(selectedBusinessId || '')}`;

  if (moduleLoading || !accessChecked) return <div style={styles.centered}>Loading…</div>;
  if (!isEnabled) return <div style={styles.centered}>Tavari Forms is not enabled for this business.</div>;
  if (!canAccessModule) return <div style={styles.centered}>Sign in and select a business to use Tavari Forms.</div>;

  return (
    <div style={styles.page}>
      <TavariModuleHeader
        title="Tavari Forms"
        description="Operational checklists and compliance logs — separate from waivers."
        actionLabel={canManage ? '+ New Form' : undefined}
        actionIcon={canManage ? <FiPlus size={18} /> : null}
        onAction={canManage ? () => setActiveTab('forms') : undefined}
      />
      <TavariTabSystemComponent tabs={visibleTabs} activeTab={activeTab} onTabChange={setActiveTab} mode="state" />

      {activeTab === 'complete' && (
        <FormsCompleteTab
          businessId={selectedBusinessId}
          businessTimezone={businessData?.timezone}
          forms={forms}
          onSubmitted={load}
        />
      )}

      {activeTab === 'forms' && canManage && (
        <div style={styles.grid}>
          <section style={styles.panel}>
            <div style={styles.panelHeader}>
              <h2 style={styles.panelTitle}>{editingFormId ? 'Edit form' : 'Create form'}</h2>
              {editingFormId && (
                <button type="button" style={styles.linkBtn} onClick={resetFormEditor}>
                  <FiX style={{ verticalAlign: 'middle' }} /> Cancel edit
                </button>
              )}
            </div>
            <form onSubmit={saveForm} style={styles.form}>
              <label style={styles.field}>
                <span>Form title</span>
                <input value={formDraft.title} onChange={(e) => setFormDraft({ ...formDraft, title: e.target.value })} required style={styles.input} placeholder="Cooler & Freezer Temperature Log" />
              </label>
              <label style={styles.field}>
                <span>Description</span>
                <textarea value={formDraft.description} onChange={(e) => setFormDraft({ ...formDraft, description: e.target.value })} style={styles.textarea} />
              </label>
              <label style={styles.field}>
                <span>Alert employee when out of range</span>
                <select
                  value={formDraft.alert_employee_id}
                  onChange={(e) => setFormDraft({ ...formDraft, alert_employee_id: e.target.value })}
                  style={styles.input}
                >
                  <option value="">Managers (default — dashboard + email)</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
                <span style={styles.muted}>This person will see the alert in Submissions &amp; Alerts, receive an email, and can acknowledge it.</span>
              </label>
              <h3 style={styles.subTitle}>Fields</h3>
              {formDraft.fields.map((field, idx) => (
                <div key={field.id || `new-${idx}`} style={styles.fieldCard}>
                  <div style={styles.fieldCardHeader}>
                    <span style={styles.fieldCardTitle}>Field {idx + 1}</span>
                    {formDraft.fields.length > 1 && (
                      <button type="button" style={styles.iconBtn} onClick={() => removeField(idx)} title="Remove field">
                        <FiTrash2 />
                      </button>
                    )}
                  </div>
                  <input placeholder="Label (e.g. Walk-in Cooler)" value={field.field_label} style={styles.input} onChange={(e) => {
                    const fields = [...formDraft.fields];
                    fields[idx] = { ...fields[idx], field_label: e.target.value };
                    setFormDraft({ ...formDraft, fields });
                  }} />
                  <label style={styles.field}>
                    <span>Field type</span>
                    <select value={field.field_type} style={styles.input} onChange={(e) => {
                      const fields = [...formDraft.fields];
                      fields[idx] = createEmptyField(e.target.value);
                      fields[idx] = {
                        ...fields[idx],
                        id: field.id,
                        field_key: field.field_key,
                        field_label: field.field_label,
                        is_required: field.is_required
                      };
                      setFormDraft({ ...formDraft, fields });
                    }}>
                      <option value="number">Number (temperature, counts)</option>
                      <option value="yes_no">Yes / No / N/A</option>
                      <option value="select">Dropdown (pick one)</option>
                      <option value="text">Short text</option>
                      <option value="textarea">Notes (long text)</option>
                      <option value="checkbox">Checkbox</option>
                    </select>
                    <span style={styles.muted}>{FIELD_TYPE_HELP[field.field_type] || ''}</span>
                  </label>
                  {field.field_type === 'number' && (
                    <div style={styles.row3}>
                      <input placeholder="Min" type="number" step="any" value={field.min} style={styles.input} onChange={(e) => {
                        const fields = [...formDraft.fields];
                        fields[idx] = { ...fields[idx], min: e.target.value };
                        setFormDraft({ ...formDraft, fields });
                      }} />
                      <input placeholder="Max" type="number" step="any" value={field.max} style={styles.input} onChange={(e) => {
                        const fields = [...formDraft.fields];
                        fields[idx] = { ...fields[idx], max: e.target.value };
                        setFormDraft({ ...formDraft, fields });
                      }} />
                      <input placeholder="Unit (e.g. °F)" value={field.unit} style={styles.input} onChange={(e) => {
                        const fields = [...formDraft.fields];
                        fields[idx] = { ...fields[idx], unit: e.target.value };
                        setFormDraft({ ...formDraft, fields });
                      }} />
                    </div>
                  )}
                  {field.field_type === 'yes_no' && (
                    <label style={styles.field}>
                      <span>Expected answer (triggers alert if different)</span>
                      <select
                        value={field.correctAnswer || ''}
                        style={styles.input}
                        onChange={(e) => {
                          const fields = [...formDraft.fields];
                          fields[idx] = { ...fields[idx], correctAnswer: e.target.value };
                          setFormDraft({ ...formDraft, fields });
                        }}
                      >
                        <option value="">No expected answer — no alert</option>
                        <option value="yes">Yes is correct</option>
                        <option value="no">No is correct</option>
                        <option value="na">N/A is correct</option>
                      </select>
                      <span style={styles.muted}>If staff pick a different answer, the submission is saved and the designated reviewer is alerted.</span>
                    </label>
                  )}
                  {field.field_type === 'select' && (
                    <label style={styles.field}>
                      <span>Dropdown options</span>
                      <textarea
                        value={field.optionsText}
                        onChange={(e) => {
                          const fields = [...formDraft.fields];
                          fields[idx] = { ...fields[idx], optionsText: e.target.value };
                          setFormDraft({ ...formDraft, fields });
                        }}
                        style={styles.textarea}
                        placeholder={'One option per line\nGood\nFair\nPoor\n\nOptional value|label:\nyes|Pass\nno|Fail'}
                      />
                      <span style={styles.muted}>Staff will pick one option when completing the form.</span>
                    </label>
                  )}
                  <TavariCheckbox label="Required" checked={field.is_required} onChange={(checked) => {
                    const fields = [...formDraft.fields];
                    fields[idx] = { ...fields[idx], is_required: checked };
                    setFormDraft({ ...formDraft, fields });
                  }} />
                </div>
              ))}
              <button type="button" style={styles.secondaryBtn} onClick={addField}><FiPlus /> Add field</button>
              <div style={styles.formActions}>
                <button type="submit" style={styles.primaryBtn} disabled={saving}>
                  {saving ? 'Saving…' : editingFormId ? 'Save changes' : 'Save form'}
                </button>
                {editingFormId && (
                  <button type="button" style={styles.secondaryBtn} disabled={saving} onClick={resetFormEditor}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </section>
          <section style={styles.panel}>
            <h2 style={styles.panelTitle}>Your forms</h2>
            {forms.length === 0 ? <p style={styles.muted}>No forms yet.</p> : forms.map((f) => (
              <div key={f.id} style={{ ...styles.listItem, ...(editingFormId === f.id ? styles.listItemActive : {}) }}>
                <div style={styles.listItemHeader}>
                  <strong>{f.title}</strong>
                  <button
                    type="button"
                    style={styles.secondaryBtn}
                    disabled={loadingEditId === f.id || saving}
                    onClick={() => startEditForm(f)}
                  >
                    <FiEdit2 style={{ verticalAlign: 'middle' }} /> {loadingEditId === f.id ? 'Loading…' : 'Edit'}
                  </button>
                </div>
                {f.alert_employee_id && (
                  <p style={styles.muted}>
                    Alerts: {employees.find((e) => e.id === f.alert_employee_id)?.name || 'Designated employee'}
                  </p>
                )}
                <code style={styles.code}>{kioskFillUrl(f.id)}</code>
                <p style={styles.muted}>Link this form on a task template in Task Manager, or use standalone on a tablet.</p>
              </div>
            ))}
          </section>
        </div>
      )}

      {activeTab === 'submissions' && (canManage || isAlertRecipient) && (
        <div style={styles.grid}>
          <section style={styles.panel}>
            <h2 style={styles.panelTitle}>Review alerts ({alerts.length})</h2>
            {alerts.length === 0 ? <p style={styles.muted}>No open alerts.</p> : alerts.map((a) => {
              const notifyName = a.notify_user?.full_name
                || [a.notify_user?.first_name, a.notify_user?.last_name].filter(Boolean).join(' ')
                || null;
              const outOfRange = Array.isArray(a.details?.out_of_range_fields) ? a.details.out_of_range_fields : [];
              return (
              <div key={a.id} style={styles.alertItem}>
                <strong>{a.alert_type.replace(/_/g, ' ')}</strong>
                <p>{a.message}</p>
                {notifyName && <p style={styles.muted}>Designated reviewer: {notifyName}</p>}
                {outOfRange.length > 0 && (
                  <ul style={styles.alertList}>
                    {outOfRange.map((field) => {
                      const escalation = field.escalation || {};
                      return (
                      <li key={field.field_key}>
                        {field.field_label}: {field.value}
                        {field.unit ? ` ${field.unit}` : ''}
                        {field.issue_type === 'incorrect_answer' ? (
                          <span> (expected {formatYesNoValue(field.expected)}, got {formatYesNoValue(field.value)})</span>
                        ) : (field.min != null || field.max != null) ? (
                          <span> (range: {field.min ?? '—'} to {field.max ?? '—'})</span>
                        ) : null}
                        {escalation.location && (
                          <div style={styles.alertEscalation}>
                            <div>Location: {escalation.location}</div>
                            <div>Urgency: {formatUrgencyLabel(escalation.urgency)}</div>
                            <div>Maintenance request: {formatMaintenanceLabel(escalation.submit_maintenance_request)}</div>
                            <div>Action taken: {escalation.action_taken}</div>
                            {(escalation.photo_urls || []).map((url, index) => (
                              <div key={url}><a href={url} target="_blank" rel="noreferrer">Photo {index + 1}</a></div>
                            ))}
                            {(escalation.video_urls || []).map((url, index) => (
                              <div key={url}><a href={url} target="_blank" rel="noreferrer">Video {index + 1}</a></div>
                            ))}
                          </div>
                        )}
                      </li>
                    );})}
                  </ul>
                )}
                <button type="button" style={styles.secondaryBtn} onClick={() => acknowledgeAlert(a.id)}>Acknowledge</button>
              </div>
            );})}
          </section>
          <section style={styles.panel}>
            <h2 style={styles.panelTitle}>Recent submissions</h2>
            {submissions.length === 0 ? <p style={styles.muted}>No submissions yet.</p> : submissions.slice(0, 30).map((s) => (
              <div key={s.id} style={styles.listItem}>
                <strong style={styles.submissionTaskTitle}>{getSubmissionTaskTitle(s)}</strong>
                <div style={styles.submissionMeta}>
                  <div style={styles.submissionMetaRow}>
                    <span style={styles.metaLabel}>Due</span>
                    <span>{formatDateTime(getSubmissionDueAt(s))}</span>
                  </div>
                  <div style={styles.submissionMetaRow}>
                    <span style={styles.metaLabel}>Submitted</span>
                    <span>{formatDateTime(s.submitted_at)}</span>
                  </div>
                  <div style={styles.submissionMetaRow}>
                    <span style={styles.metaLabel}>Completed by</span>
                    <span>{formatPersonName(s.users)}</span>
                  </div>
                </div>
                <pre style={styles.pre}>{JSON.stringify(s.responses, null, 2)}</pre>
                <div style={styles.badgeRow}>
                  {s.manager_override && <span style={styles.badge}>Manager override</span>}
                  {s.requires_manager_review && <span style={styles.badgeWarn}>Review pending</span>}
                </div>
              </div>
            ))}
          </section>
        </div>
      )}

      {activeTab === 'print' && canManage && (
        <section style={styles.panel}>
          <h2 style={styles.panelTitle}><FiFileText style={{ verticalAlign: 'middle' }} /> Weekly filing print</h2>
          <div style={styles.row3}>
            <label style={styles.field}>
              <span>Form</span>
              <select value={printFormId} onChange={(e) => setPrintFormId(e.target.value)} style={styles.input}>
                {forms.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
              </select>
            </label>
            <label style={styles.field}>
              <span>From</span>
              <input type="date" value={printStart} onChange={(e) => setPrintStart(e.target.value)} style={styles.input} />
            </label>
            <label style={styles.field}>
              <span>To</span>
              <input type="date" value={printEnd} onChange={(e) => setPrintEnd(e.target.value)} style={styles.input} />
            </label>
          </div>
          <button type="button" style={styles.primaryBtn} onClick={printReport}>Print log</button>
        </section>
      )}

      {activeTab === 'settings' && canManage && (
        <ModuleSettingsTabContent moduleKey="forms" />
      )}
    </div>
  );
};

const styles = {
  page: { padding: '20px', paddingTop: '80px', maxWidth: 1200, margin: '0 auto', boxSizing: 'border-box', minHeight: '100vh', backgroundColor: '#f9fafb' },
  centered: { padding: 48, textAlign: 'center' },
  grid: { display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', marginTop: 20 },
  panel: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 },
  panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 },
  panelTitle: { margin: 0, fontSize: 18 },
  linkBtn: { background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13, padding: 0 },
  subTitle: { margin: '16px 0 8px', fontSize: 15 },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldCard: { border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 },
  fieldCardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  fieldCardTitle: { fontSize: 13, fontWeight: 700, color: '#374151' },
  iconBtn: { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' },
  formActions: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  input: { padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 14 },
  textarea: { padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d5db', minHeight: 70 },
  row3: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 },
  primaryBtn: { background: TavariStyles.colors.primary || '#008080', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 18px', fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start' },
  secondaryBtn: { background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 10, padding: '10px 14px', cursor: 'pointer', alignSelf: 'flex-start' },
  listItem: { border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 10 },
  listItemActive: { borderColor: '#0f766e', boxShadow: '0 0 0 1px #0f766e' },
  listItemHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 },
  alertItem: { border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 10, padding: 12, marginBottom: 10 },
  alertList: { margin: '8px 0 0', paddingLeft: 18, fontSize: 13, color: '#7f1d1d' },
  alertEscalation: { marginTop: 8, padding: 10, borderRadius: 8, background: '#fff7ed', border: '1px solid #fed7aa', color: '#7c2d12', lineHeight: 1.5 },
  code: { display: 'block', fontSize: 13, wordBreak: 'break-all', marginTop: 8, color: '#0f766e' },
  muted: { color: '#6b7280', fontSize: 13 },
  submissionTaskTitle: { display: 'block', fontSize: 15, marginBottom: 8 },
  submissionMeta: { margin: '0 0 10px', display: 'grid', gap: 6 },
  submissionMetaRow: { display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, fontSize: 13, alignItems: 'baseline' },
  metaLabel: { color: '#6b7280', fontWeight: 600 },
  badgeRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  pre: { fontSize: 13, background: '#f9fafb', padding: 8, borderRadius: 8, overflow: 'auto' },
  badge: { display: 'inline-block', background: '#dbeafe', color: '#1e40af', padding: '2px 8px', borderRadius: 999, fontSize: 13, marginRight: 6 },
  badgeWarn: { display: 'inline-block', background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 999, fontSize: 13 }
};

export default FormsDashboard;
