import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  FileQuestion,
  PlayCircle,
  ExternalLink,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { deleteTrainingWithManagerPin } from '../../helpers/deleteTrainingWithManagerPin';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'overdue', label: 'Overdue' },
];

const TASK_TRAINING_MEDIA_BUCKET = 'task-training-media';

const EMPTY_STEP = {
  title: '',
  body: '',
  resource_url: '',
  image_url: '',
  file_url: '',
  uploadFile: null,
  uploadType: '',
  is_required: true,
};

const EMPTY_QUIZ_OPTION = {
  text: '',
  isCorrect: false,
};

const EMPTY_QUIZ_QUESTION = {
  prompt: '',
  options: [
    { ...EMPTY_QUIZ_OPTION },
    { ...EMPTY_QUIZ_OPTION },
  ],
  is_required: true,
};

const EMPTY_FORM = {
  title: '',
  overview: { text: '', image_url: '', uploadFile: null },
  objectives: { text: '', image_url: '', uploadFile: null },
  notes: { text: '', image_url: '', uploadFile: null },
  requires_acknowledgement: true,
  auto_assign_new_hires: false,
  kiosk_sign_in_required: false,
  steps: [{ ...EMPTY_STEP, title: 'Step 1' }],
  quiz: {
    enabled: false,
    passing_score: 80,
    questions: [],
  },
  task_manager_enabled: false,
  task_link_mode: 'create_task',
  task_link_target: '',
  task_manager_task_id: '',
  task_category_id: '',
  task_priority: 'medium',
  task_requires_completion: true,
};

const TrainingCenter = ({ businessId }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [trainingItems, setTrainingItems] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [taskCategories, setTaskCategories] = useState([]);
  const [taskLinkOptions, setTaskLinkOptions] = useState({ tasks: [], templates: [] });
  const [taskLinkOptionsLoading, setTaskLinkOptionsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingTrainingId, setEditingTrainingId] = useState(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedTrainingId, setSelectedTrainingId] = useState('');
  const [selectedEmployees, setSelectedEmployees] = useState([]);
  const [assignDueDate, setAssignDueDate] = useState('');
  const [assignNotes, setAssignNotes] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [previewTrainingItem, setPreviewTrainingItem] = useState(null);

  const filteredAssignments = useMemo(() => {
    if (statusFilter === 'all') return assignments;
    if (statusFilter === 'overdue') {
      return assignments.filter((assignment) => !isComplete(assignment) && isOverdue(assignment.due_date));
    }
    return assignments.filter((assignment) => assignment.status === statusFilter);
  }, [assignments, statusFilter]);

  const stats = useMemo(() => {
    const pending = assignments.filter((assignment) => !isComplete(assignment)).length;
    const overdue = assignments.filter((assignment) => !isComplete(assignment) && isOverdue(assignment.due_date)).length;
    return {
      modules: trainingItems.length,
      assigned: assignments.length,
      pending,
      overdue,
      completed: assignments.length - pending,
    };
  }, [assignments, trainingItems.length]);

  useEffect(() => {
    if (!businessId) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([loadEmployees(), loadTrainingItems(), loadAssignments(), loadTaskCategories()]);
    } catch (error) {
      console.error('Error loading training center:', error);
      toast.error(error.message || 'Failed to load training');
    } finally {
      setLoading(false);
    }
  };

  const loadTaskCategories = async () => {
    const { data, error } = await supabase
      .from('task_manager_categories')
      .select('id, name')
      .eq('business_id', businessId)
      .neq('is_active', false)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error && error.code !== '42P01') throw error;
    setTaskCategories(data || []);
  };

  const loadTaskLinkOptions = async () => {
    if (!businessId) return;
    setTaskLinkOptionsLoading(true);
    try {
      const [taskResult, templateResult] = await Promise.all([
        supabase
          .from('task_manager_tasks')
          .select('id, title, status, due_at, scheduled_for, template_id, assignment_scope')
          .eq('business_id', businessId)
          .in('status', ['backlog', 'to_do', 'in_progress', 'blocked', 'incomplete'])
          .order('created_at', { ascending: false })
          .limit(200),
        supabase
          .from('task_manager_templates')
          .select('id, title, status, schedule_times, recurrence_type')
          .eq('business_id', businessId)
          .eq('status', 'active')
          .order('title', { ascending: true })
      ]);

      if (taskResult.error && taskResult.error.code !== '42P01') throw taskResult.error;
      if (templateResult.error && templateResult.error.code !== '42P01') throw templateResult.error;

      setTaskLinkOptions({
        tasks: taskResult.error ? [] : (taskResult.data || []),
        templates: templateResult.error ? [] : (templateResult.data || [])
      });
    } finally {
      setTaskLinkOptionsLoading(false);
    }
  };

  const loadEmployees = async () => {
    const { data, error } = await supabase
      .from('business_users')
      .select(`
        user_id,
        role,
        users!business_users_user_id_fkey (
          id,
          full_name,
          email,
          employment_status,
          status
        )
      `)
      .eq('business_id', businessId);

    if (error) throw error;

    const rows = (data || [])
      .map((row) => row.users ? { ...row.users, role: row.role } : null)
      .filter((employee) => employee && !isTerminated(employee))
      .sort((a, b) => String(a.full_name || a.email || '').localeCompare(String(b.full_name || b.email || '')));

    setEmployees(rows);
  };

  const loadTrainingItems = async () => {
    const { data, error } = await supabase
      .from('hr_training_items')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) throw error;
    setTrainingItems(data || []);
    setSelectedTrainingId((current) => current || data?.[0]?.id || '');
  };

  const loadAssignments = async () => {
    const { data, error } = await supabase
      .from('hr_training_assignments')
      .select(`
        id,
        business_id,
        training_item_id,
        employee_id,
        status,
        due_date,
        assigned_at,
        started_at,
        completed_at,
        acknowledged_at,
        employee_notes,
        manager_notes,
        updated_at,
        users!hr_training_assignments_employee_id_fkey (
          id,
          full_name,
          email,
          employment_status,
          status
        ),
        hr_training_items!hr_training_assignments_training_item_id_fkey (
          id,
          title,
          steps,
          quiz,
          task_manager_enabled,
          requires_acknowledgement
        )
      `)
      .eq('business_id', businessId)
      .neq('status', 'cancelled')
      .order('assigned_at', { ascending: false });

    if (error) throw error;
    setAssignments((data || []).filter((assignment) => !isTerminated(assignment.users || {})));
  };

  const openCreateModal = async () => {
    setEditingTrainingId(null);
    setForm({ ...EMPTY_FORM, steps: [{ ...EMPTY_STEP, title: 'Step 1' }] });
    setShowFormModal(true);
    await loadTaskLinkOptions();
  };

  const openEditModal = async (item) => {
    setEditingTrainingId(item.id);
    setForm(trainingItemToForm(item));
    setShowFormModal(true);
    await loadTaskLinkOptions();
  };

  const closeFormModal = () => {
    setShowFormModal(false);
    setEditingTrainingId(null);
    setForm({ ...EMPTY_FORM, steps: [{ ...EMPTY_STEP, title: 'Step 1' }] });
  };

  const saveTraining = async (event) => {
    event.preventDefault();
    if (!form.title.trim()) {
      toast.error('Add a training title');
      return;
    }
    if (form.task_manager_enabled && form.task_link_mode === 'existing_task' && !parseTaskLinkTarget(form.task_link_target).id) {
      toast.error('Choose an existing task or template');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const sections = await buildTrainingSections(form, businessId);
      const steps = await buildTrainingSteps(form.steps, businessId);
      const quiz = buildQuizPayload(form.quiz);
      const taskLink = parseTaskLinkTarget(form.task_link_target);
      const payload = {
        title: form.title.trim(),
        description: cleanText(form.overview?.text),
        content: cleanText(form.notes?.text),
        resource_url: null,
        sections: {
          ...sections,
          _task_manager_template_id: taskLink.type === 'template' ? taskLink.id : null
        },
        steps,
        quiz,
        requires_acknowledgement: form.requires_acknowledgement,
        auto_assign_new_hires: form.auto_assign_new_hires === true,
        kiosk_sign_in_required: form.kiosk_sign_in_required === true,
        task_manager_enabled: form.task_manager_enabled,
        task_link_mode: form.task_manager_enabled ? form.task_link_mode : 'create_task',
        task_manager_task_id: form.task_manager_enabled && form.task_link_mode === 'existing_task' && taskLink.type === 'task'
          ? taskLink.id
          : null,
        task_category_id: form.task_manager_enabled && form.task_link_mode === 'create_task' ? form.task_category_id || null : null,
        task_priority: form.task_priority || 'medium',
        task_requires_completion: form.task_manager_enabled ? form.task_requires_completion : false,
        updated_at: new Date().toISOString(),
      };

      if (editingTrainingId) {
        const { error } = await supabase
          .from('hr_training_items')
          .update(payload)
          .eq('id', editingTrainingId)
          .eq('business_id', businessId);
        if (error) throw error;
        toast.success('Training module updated');
      } else {
        const { error } = await supabase
          .from('hr_training_items')
          .insert({
            ...payload,
            business_id: businessId,
            created_by: user?.id,
          });
        if (error) throw error;
        toast.success('Training module created');
      }

      closeFormModal();
      await loadTrainingItems();
    } catch (error) {
      console.error('Error saving training:', error);
      toast.error(error.message || 'Failed to save training');
    } finally {
      setSaving(false);
    }
  };

  const assignTraining = async (event) => {
    event.preventDefault();
    if (!selectedTrainingId) {
      toast.error('Choose a training module');
      return;
    }
    if (selectedEmployees.length === 0) {
      toast.error('Choose at least one employee');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const selectedTraining = trainingItems.find((item) => item.id === selectedTrainingId);
      const rows = selectedEmployees.map((employeeId) => ({
        business_id: businessId,
        training_item_id: selectedTrainingId,
        employee_id: employeeId,
        due_date: assignDueDate || null,
        manager_notes: cleanText(assignNotes),
        assigned_by: user?.id,
        status: 'assigned',
        updated_at: new Date().toISOString(),
      }));

      const { data: upsertedAssignments, error } = await supabase
        .from('hr_training_assignments')
        .upsert(rows, { onConflict: 'training_item_id,employee_id' })
        .select('id, employee_id, task_manager_task_id');

      if (error) throw error;

      if (selectedTraining?.task_manager_enabled) {
        for (const assignment of upsertedAssignments || []) {
          if (!assignment.task_manager_task_id) {
            const templateId = selectedTraining.sections?._task_manager_template_id || null;
            if (selectedTraining.task_link_mode === 'existing_task' && templateId) {
              await attachTrainingToExistingTemplate({
                assignment,
                trainingItem: selectedTraining,
                templateId,
                userId: user?.id || null,
              });
            } else if (selectedTraining.task_link_mode === 'existing_task' && selectedTraining.task_manager_task_id) {
              await attachTrainingToExistingTask({
                assignment,
                trainingItem: selectedTraining,
                userId: user?.id || null,
              });
            } else {
              await createTaskManagerTrainingTask({
                assignment,
                trainingItem: selectedTraining,
                dueDate: assignDueDate,
                notes: assignNotes,
                userId: user?.id || null,
              });
            }
          }
        }
      }

      toast.success('Training assigned');
      setShowAssignModal(false);
      setSelectedEmployees([]);
      setAssignDueDate('');
      setAssignNotes('');
      await loadAssignments();
    } catch (error) {
      console.error('Error assigning training:', error);
      toast.error(error.message || 'Failed to assign training');
    } finally {
      setSaving(false);
    }
  };

  const cancelAssignment = async (assignment) => {
    const confirmed = window.confirm('Cancel this training assignment?');
    if (!confirmed) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('hr_training_assignments')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', assignment.id)
        .eq('business_id', businessId);

      if (error) throw error;
      toast.success('Training assignment cancelled');
      await loadAssignments();
    } catch (error) {
      console.error('Error cancelling assignment:', error);
      toast.error(error.message || 'Failed to cancel assignment');
    } finally {
      setSaving(false);
    }
  };

  const deleteTrainingModule = async (item) => {
    setSaving(true);
    try {
      const deleted = await deleteTrainingWithManagerPin({ businessId, trainingItem: item });
      if (deleted) {
        await Promise.all([loadTrainingItems(), loadAssignments()]);
      }
    } catch (error) {
      console.error('Error deleting training:', error);
      toast.error(error.message || 'Failed to delete training');
    } finally {
      setSaving(false);
    }
  };

  const toggleEmployee = (employeeId) => {
    setSelectedEmployees((current) => (
      current.includes(employeeId)
        ? current.filter((id) => id !== employeeId)
        : [...current, employeeId]
    ));
  };

  if (loading) return <div style={styles.empty}>Loading training center...</div>;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>HR Training</div>
          <h2 style={styles.title}>Training Center</h2>
          <p style={styles.subtitle}>Build multi-step training with uploads, quizzes, task assignments, and completion acknowledgements.</p>
        </div>
        <div style={styles.headerActions}>
          <button type="button" style={styles.secondaryButton} onClick={openCreateModal}>
            <Plus size={16} />
            New Training
          </button>
          <button type="button" style={styles.primaryButton} onClick={() => setShowAssignModal(true)} disabled={trainingItems.length === 0}>
            <Users size={16} />
            Assign Training
          </button>
        </div>
      </div>

      <div style={styles.statsGrid}>
        <StatCard label="Modules" value={stats.modules} />
        <StatCard label="Assigned" value={stats.assigned} />
        <StatCard label="Pending" value={stats.pending} />
        <StatCard label="Overdue" value={stats.overdue} danger />
        <StatCard label="Completed" value={stats.completed} success />
      </div>

      <section style={styles.panel}>
        <h3 style={styles.panelTitle}>Training Modules</h3>
        {trainingItems.length === 0 ? (
          <div style={styles.empty}>No training modules yet. Create one to start assigning training.</div>
        ) : (
          <div style={styles.moduleGrid}>
            {trainingItems.map((item) => (
              <article key={item.id} style={styles.moduleCard}>
                <BookOpen size={22} style={{ color: TavariStyles.colors.primary, flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h4 style={styles.moduleTitle}>{item.title}</h4>
                  {item.description && <p style={styles.moduleDescription}>{item.description}</p>}
                  <p style={styles.moduleMeta}>{item.requires_acknowledgement ? 'Acknowledgement required' : 'Completion only'}</p>
                  <div style={styles.badgeRow}>
                    {Array.isArray(item.steps) && item.steps.length > 0 && <MiniBadge label={`${item.steps.length} steps`} />}
                    {item.quiz?.enabled && <MiniBadge label="Quiz" />}
                    {item.task_manager_enabled && <MiniBadge label="Task Manager" />}
                    {item.auto_assign_new_hires && <MiniBadge label="Auto new hire" />}
                    {item.kiosk_sign_in_required && <MiniBadge label="Kiosk sign-in" />}
                  </div>
                </div>
                <div style={styles.moduleActions}>
                  <button type="button" style={styles.testModuleButton} onClick={() => setPreviewTrainingItem(item)} title="Preview training as employees see it">
                    <PlayCircle size={16} />
                    Test Training
                  </button>
                  <button type="button" style={styles.editModuleButton} onClick={() => openEditModal(item)} title="Edit training module">
                    <Pencil size={16} />
                    Edit
                  </button>
                  <button type="button" style={styles.deleteModuleButton} onClick={() => deleteTrainingModule(item)} title="Delete training module" disabled={saving}>
                    <Trash2 size={16} />
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section style={styles.panel}>
        <div style={styles.listHeader}>
          <h3 style={styles.panelTitle}>Assignment Tracking</h3>
          <div style={styles.filters}>
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setStatusFilter(filter.value)}
                style={{
                  ...styles.filterButton,
                  ...(statusFilter === filter.value ? styles.filterButtonActive : {})
                }}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {filteredAssignments.length === 0 ? (
          <div style={styles.empty}>No training assignments found.</div>
        ) : (
          <div style={styles.assignmentGrid}>
            {filteredAssignments.map((assignment) => {
              const complete = isComplete(assignment);
              const overdue = !complete && isOverdue(assignment.due_date);
              return (
                <article key={assignment.id} style={styles.assignmentCard}>
                  <div style={styles.cardTop}>
                    <div>
                      <h4 style={styles.assignmentTitle}>{assignment.hr_training_items?.title || 'Training'}</h4>
                      <p style={styles.employeeName}>{assignment.users?.full_name || assignment.users?.email || 'Employee'}</p>
                    </div>
                    <span style={{ ...styles.statusPill, ...getStatusStyle(assignment.status, overdue) }}>
                      {overdue ? 'Overdue' : formatStatus(assignment.status)}
                    </span>
                  </div>
                  {assignment.due_date && <p style={styles.detail}>Due {formatDate(assignment.due_date)}</p>}
                  {assignment.completed_at && <p style={styles.detail}>Completed {formatDateTime(assignment.completed_at)}</p>}
                  {assignment.acknowledged_at && <p style={styles.detail}>Acknowledged {formatDateTime(assignment.acknowledged_at)}</p>}
                  {assignment.employee_notes && <p style={styles.notes}>Employee note: {assignment.employee_notes}</p>}
                  {assignment.manager_notes && <p style={styles.notes}>Manager note: {assignment.manager_notes}</p>}
                  {!complete && (
                    <button type="button" style={styles.cancelButton} onClick={() => cancelAssignment(assignment)} disabled={saving}>
                      Cancel Assignment
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {showFormModal && (
        <div style={styles.modalOverlay}>
          <form style={styles.largeModal} onSubmit={saveTraining}>
            <ModalHeader
              title={editingTrainingId ? 'Edit Training Module' : 'New Training Module'}
              onClose={closeFormModal}
            />
            <Field label="Title" value={form.title} onChange={(value) => setForm((current) => ({ ...current, title: value }))} required />
            <RichSectionEditor
              label="Overview"
              section={form.overview}
              onChange={(section) => setForm((current) => ({ ...current, overview: section }))}
            />
            <RichSectionEditor
              label="Objectives"
              section={form.objectives}
              onChange={(section) => setForm((current) => ({ ...current, objectives: section }))}
            />
            <RichSectionEditor
              label="Additional Text / Notes"
              section={form.notes}
              onChange={(section) => setForm((current) => ({ ...current, notes: section }))}
            />
            <TrainingStepsBuilder form={form} setForm={setForm} />
            <QuizBuilder form={form} setForm={setForm} />
            <TaskManagerOptions
              form={form}
              setForm={setForm}
              taskCategories={taskCategories}
              taskLinkOptions={taskLinkOptions}
              taskLinkOptionsLoading={taskLinkOptionsLoading}
              onRefreshTaskLinkOptions={loadTaskLinkOptions}
            />
            <TavariCheckbox
              checked={form.requires_acknowledgement}
              onChange={(checked) => setForm((current) => ({ ...current, requires_acknowledgement: checked }))}
              label="Require employee acknowledgement"
              style={{ marginTop: '12px' }}
            />
            <TavariCheckbox
              checked={form.auto_assign_new_hires}
              onChange={(checked) => setForm((current) => ({
                ...current,
                auto_assign_new_hires: checked,
                kiosk_sign_in_required: checked && current.task_link_mode === 'create_task'
                  ? (current.kiosk_sign_in_required || true)
                  : current.kiosk_sign_in_required,
              }))}
              label="Auto-assign to new employees when they join"
              style={{ marginTop: '8px' }}
            />
            {form.auto_assign_new_hires && (
              <TavariCheckbox
                checked={form.kiosk_sign_in_required}
                onChange={(checked) => setForm((current) => ({ ...current, kiosk_sign_in_required: checked }))}
                label="Require at task kiosk sign-in (before work queue)"
                style={{ marginTop: '8px', marginLeft: '20px' }}
              />
            )}
            <div style={styles.modalActions}>
              <button type="button" style={styles.secondaryButton} onClick={closeFormModal}>Cancel</button>
              <button type="submit" style={styles.primaryButton} disabled={saving}>
                {saving ? 'Saving...' : editingTrainingId ? 'Save Changes' : 'Create Training'}
              </button>
            </div>
          </form>
        </div>
      )}

      {previewTrainingItem && (
        <TrainingPreviewModal
          item={previewTrainingItem}
          onClose={() => setPreviewTrainingItem(null)}
        />
      )}

      {showAssignModal && (
        <div style={styles.modalOverlay}>
          <form style={styles.modal} onSubmit={assignTraining}>
            <ModalHeader title="Assign Training" onClose={() => setShowAssignModal(false)} />
            <label style={styles.label}>Training Module</label>
            <select value={selectedTrainingId} onChange={(event) => setSelectedTrainingId(event.target.value)} style={styles.input}>
              {trainingItems.map((item) => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
            </select>
            <Field label="Due Date" type="date" value={assignDueDate} onChange={setAssignDueDate} />
            <TextArea label="Manager Notes" value={assignNotes} onChange={setAssignNotes} />
            <div style={styles.employeePicker}>
              {employees.map((employee) => (
                <TavariCheckbox
                  key={employee.id}
                  checked={selectedEmployees.includes(employee.id)}
                  onChange={() => toggleEmployee(employee.id)}
                  label={employee.full_name || employee.email}
                />
              ))}
            </div>
            <div style={styles.modalActions}>
              <button type="button" style={styles.secondaryButton} onClick={() => setShowAssignModal(false)}>Cancel</button>
              <button type="submit" style={styles.primaryButton} disabled={saving}>{saving ? 'Assigning...' : 'Assign Training'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ label, value, danger, success }) => (
  <div style={{ ...styles.statCard, ...(danger ? styles.statDanger : {}), ...(success ? styles.statSuccess : {}) }}>
    <div style={styles.statValue}>{value}</div>
    <div style={styles.statLabel}>{label}</div>
  </div>
);

const MiniBadge = ({ label }) => (
  <span style={styles.miniBadge}>{label}</span>
);

const TrainingPreviewModal = ({ item, onClose }) => {
  const sections = item?.sections || {};
  const steps = sortTrainingSteps(item?.steps);
  const quiz = item?.quiz || {};
  const quizQuestions = quiz.enabled && Array.isArray(quiz.questions) ? quiz.questions : [];

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div
        style={styles.previewModal}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="training-preview-title"
      >
        <ModalHeader title="Test Training" onClose={onClose} />
        <p style={styles.previewBanner}>
          Manager preview — this matches what employees see. Nothing is saved or assigned.
        </p>

        <div style={styles.previewBody}>
          <h2 id="training-preview-title" style={styles.previewTitle}>{item.title}</h2>
          {item.description && <p style={styles.previewDescription}>{item.description}</p>}

          <PreviewSection title="Overview" section={sections.overview} />
          <PreviewSection title="Objectives" section={sections.objectives} />

          {steps.length > 0 && (
            <div style={styles.previewStepsWrap}>
              <h3 style={styles.previewSectionHeading}>Steps</h3>
              {steps.map((step, index) => (
                <section key={step.id || index} style={styles.previewStepCard}>
                  <div style={styles.previewStepLabel}>
                    Step {index + 1}{step.is_required !== false ? ' • required' : ''}
                  </div>
                  <h4 style={styles.previewStepTitle}>{step.title || `Step ${index + 1}`}</h4>
                  {step.body && <p style={styles.previewStepBody}>{step.body}</p>}
                  {step.image_url && (
                    <img src={step.image_url} alt={step.title || 'Training step'} style={styles.previewStepImage} />
                  )}
                  {(step.file_url || step.resource_url) && (
                    <a href={step.file_url || step.resource_url} target="_blank" rel="noreferrer" style={styles.previewResourceLink}>
                      <ExternalLink size={15} />
                      Open step resource
                    </a>
                  )}
                </section>
              ))}
            </div>
          )}

          <PreviewSection title="Notes" section={sections.notes} />

          {item.resource_url && (
            <a href={item.resource_url} target="_blank" rel="noreferrer" style={styles.previewResourceLink}>
              <ExternalLink size={15} />
              Open training resource
            </a>
          )}

          {quizQuestions.length > 0 && (
            <div style={styles.previewQuizBox}>
              <h3 style={styles.previewSectionHeading}>Knowledge Check</h3>
              <p style={styles.previewQuizHint}>Passing score: {quiz.passing_score || 80}%</p>
              {quizQuestions.map((question, index) => (
                <div key={question.id || index} style={styles.previewQuizQuestion}>
                  <strong>{index + 1}. {question.prompt}</strong>
                  <ul style={styles.previewQuizOptions}>
                    {(question.options || []).map((option, optionIndex) => {
                      const label = typeof option === 'string' ? option : (option?.text || '');
                      if (!label) return null;
                      return <li key={optionIndex}>{label}</li>;
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {item.requires_acknowledgement !== false && (
            <div style={styles.previewAckBox}>
              Read all steps, then confirm you understand this training.
              <button type="button" style={styles.previewAckButton} disabled>
                I have read and understand
              </button>
            </div>
          )}
        </div>

        <div style={styles.modalActions}>
          <button type="button" style={styles.secondaryButton} onClick={onClose}>Close Preview</button>
        </div>
      </div>
    </div>
  );
};

const PreviewSection = ({ title, section }) => {
  if (!section?.text && !section?.image_url) return null;
  return (
    <section style={styles.previewStepCard}>
      <div style={styles.previewStepLabel}>{title}</div>
      {section.text && <p style={styles.previewStepBody}>{section.text}</p>}
      {section.image_url && (
        <img src={section.image_url} alt={title} style={styles.previewStepImage} />
      )}
    </section>
  );
};

const sortTrainingSteps = (steps) => {
  if (!Array.isArray(steps)) return [];
  return [...steps].sort((a, b) => (Number(a?.order) || 9999) - (Number(b?.order) || 9999));
};

const ModalHeader = ({ title, onClose }) => (
  <div style={styles.modalHeader}>
    <h3 style={styles.modalTitle}>{title}</h3>
    <button type="button" onClick={onClose} style={styles.iconButton}>
      <X size={20} />
    </button>
  </div>
);

const Field = ({ label, value, onChange, type = 'text', required = false }) => (
  <div>
    <label style={styles.label}>{label}</label>
    <input type={type} value={value} onChange={(event) => onChange(event.target.value)} style={styles.input} required={required} />
  </div>
);

const TextArea = ({ label, value, onChange, rows = 4 }) => (
  <div>
    <label style={styles.label}>{label}</label>
    <textarea value={value} onChange={(event) => onChange(event.target.value)} style={styles.textarea} rows={rows} />
  </div>
);

const RichSectionEditor = ({ label, section, onChange }) => (
  <section style={styles.builderSection}>
    <div style={styles.builderHeader}>
      <div>
        <h4 style={styles.builderTitle}>{label}</h4>
        <p style={styles.builderHint}>Add written content and an optional image for this section.</p>
      </div>
    </div>
    <TextArea
      label={`${label} Text`}
      value={section?.text || ''}
      onChange={(value) => onChange({ ...(section || {}), text: value })}
      rows={4}
    />
    <label style={styles.label}>{label} Image</label>
    <input
      type="file"
      accept="image/*"
      onChange={(event) => onChange({ ...(section || {}), uploadFile: event.target.files?.[0] || null })}
      style={styles.fileInput}
    />
    {section?.uploadFile && <p style={styles.uploadName}>{section.uploadFile.name}</p>}
    {section?.image_url && !section?.uploadFile && (
      <div style={styles.existingAsset}>
        <img src={section.image_url} alt={`${label} preview`} style={styles.existingImagePreview} />
        <button
          type="button"
          style={styles.removeAssetButton}
          onClick={() => onChange({ ...(section || {}), image_url: '', uploadFile: null })}
        >
          Remove image
        </button>
      </div>
    )}
  </section>
);

const TrainingStepsBuilder = ({ form, setForm }) => {
  const updateStep = (index, patch) => {
    setForm((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) => (stepIndex === index ? { ...step, ...patch } : step)),
    }));
  };

  const addStep = () => {
    setForm((current) => ({
      ...current,
      steps: [...current.steps, { ...EMPTY_STEP, title: `Step ${current.steps.length + 1}` }],
    }));
  };

  const removeStep = (index) => {
    setForm((current) => ({
      ...current,
      steps: current.steps.filter((_, stepIndex) => stepIndex !== index),
    }));
  };

  const moveStep = (index, direction) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= form.steps.length) return;
    const copy = [...form.steps];
    [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
    setForm((current) => ({ ...current, steps: copy }));
  };

  return (
    <section style={styles.builderSection}>
      <div style={styles.builderHeader}>
        <div>
          <h4 style={styles.builderTitle}>Training Steps</h4>
          <p style={styles.builderHint}>Add text, links, images, or documents in the exact order employees should complete them.</p>
        </div>
      </div>

      <div style={styles.stepList}>
        {form.steps.map((step, index) => (
          <article key={index} style={styles.stepCard}>
            <div style={styles.stepHeader}>
              <strong>Step {index + 1}</strong>
              <div style={styles.stepActions}>
                <button type="button" style={styles.iconButton} onClick={() => moveStep(index, -1)} disabled={index === 0}><ArrowUp size={16} /></button>
                <button type="button" style={styles.iconButton} onClick={() => moveStep(index, 1)} disabled={index === form.steps.length - 1}><ArrowDown size={16} /></button>
                <button type="button" style={styles.iconButton} onClick={() => removeStep(index)} disabled={form.steps.length === 1}><Trash2 size={16} /></button>
              </div>
            </div>
            <Field label="Step Title" value={step.title} onChange={(value) => updateStep(index, { title: value })} />
            <TextArea label="Step Text / Instructions" value={step.body} onChange={(value) => updateStep(index, { body: value })} rows={4} />
            <Field label="Step Link (optional)" value={step.resource_url} onChange={(value) => updateStep(index, { resource_url: value })} />
            <label style={styles.label}>Image or document upload</label>
            <input
              type="file"
              accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt"
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                updateStep(index, {
                  uploadFile: file,
                  uploadType: file?.type?.startsWith('image/') ? 'image' : 'file',
                });
              }}
              style={styles.fileInput}
            />
            {step.uploadFile && <p style={styles.uploadName}>{step.uploadFile.name}</p>}
            {!step.uploadFile && step.image_url && (
              <div style={styles.existingAsset}>
                <img src={step.image_url} alt={`Step ${index + 1} image`} style={styles.existingImagePreview} />
                <button type="button" style={styles.removeAssetButton} onClick={() => updateStep(index, { image_url: '', uploadType: '' })}>
                  Remove image
                </button>
              </div>
            )}
            {!step.uploadFile && !step.image_url && step.file_url && (
              <div style={styles.existingAsset}>
                <a href={step.file_url} target="_blank" rel="noreferrer" style={styles.existingFileLink}>View attached document</a>
                <button type="button" style={styles.removeAssetButton} onClick={() => updateStep(index, { file_url: '', uploadType: '' })}>
                  Remove document
                </button>
              </div>
            )}
            <TavariCheckbox
              checked={step.is_required !== false}
              onChange={(checked) => updateStep(index, { is_required: checked })}
              label="Required step"
              style={{ marginTop: '12px' }}
            />
          </article>
        ))}
      </div>

      <button type="button" style={{ ...styles.secondaryButton, marginTop: '12px' }} onClick={addStep}>
        <Plus size={15} />
        Add Step
      </button>
    </section>
  );
};

const QuizBuilder = ({ form, setForm }) => {
  const quiz = form.quiz || EMPTY_FORM.quiz;
  const setQuiz = (patch) => setForm((current) => ({ ...current, quiz: { ...current.quiz, ...patch } }));
  const questions = quiz.questions || [];

  const updateQuestion = (index, patch) => {
    setQuiz({
      questions: questions.map((question, qIndex) => qIndex === index ? { ...question, ...patch } : question),
    });
  };

  const updateOption = (questionIndex, optionIndex, patch) => {
    const options = questions[questionIndex]?.options || [];
    updateQuestion(questionIndex, {
      options: options.map((option, oIndex) => {
        if (oIndex !== optionIndex) {
          return patch.isCorrect ? { ...option, isCorrect: false } : option;
        }
        return { ...option, ...patch };
      }),
    });
  };

  const addOption = (questionIndex) => {
    const options = questions[questionIndex]?.options || [];
    updateQuestion(questionIndex, {
      options: [...options, { ...EMPTY_QUIZ_OPTION }],
    });
  };

  const removeOption = (questionIndex, optionIndex) => {
    const options = questions[questionIndex]?.options || [];
    if (options.length <= 2) return;
    updateQuestion(questionIndex, {
      options: options.filter((_, oIndex) => oIndex !== optionIndex),
    });
  };

  return (
    <section style={styles.builderSection}>
      <div style={styles.builderHeader}>
        <div>
          <h4 style={styles.builderTitle}>Optional Quiz</h4>
          <p style={styles.builderHint}>Add a knowledge check employees can answer before acknowledging completion.</p>
        </div>
        <TavariCheckbox
          checked={quiz.enabled}
          onChange={(checked) => setQuiz({ enabled: checked })}
          label="Enable quiz"
        />
      </div>

      {quiz.enabled && (
        <div style={styles.stepList}>
          <Field label="Passing Score (%)" type="number" value={String(quiz.passing_score || 80)} onChange={(value) => setQuiz({ passing_score: Number(value) || 80 })} />
          {questions.map((question, index) => {
            const options = question.options || [{ ...EMPTY_QUIZ_OPTION }, { ...EMPTY_QUIZ_OPTION }];
            return (
              <article key={index} style={styles.stepCard}>
                <div style={styles.stepHeader}>
                  <strong>Question {index + 1}</strong>
                  <button type="button" style={styles.iconButton} onClick={() => setQuiz({ questions: questions.filter((_, qIndex) => qIndex !== index) })}>
                    <Trash2 size={16} />
                  </button>
                </div>
                <TextArea label="Question" value={question.prompt} onChange={(value) => updateQuestion(index, { prompt: value })} rows={2} />
                <label style={styles.label}>Answer Options</label>
                <p style={styles.builderHint}>Enter each answer below and check the box on the right to mark the correct one.</p>
                <div style={styles.quizOptionsList}>
                  {options.map((option, optionIndex) => (
                    <div key={optionIndex} style={styles.quizOptionRow}>
                      <input
                        type="text"
                        value={option.text || ''}
                        onChange={(event) => updateOption(index, optionIndex, { text: event.target.value })}
                        placeholder={`Answer ${optionIndex + 1}`}
                        style={styles.quizOptionInput}
                      />
                      <div style={styles.quizOptionCorrect}>
                        <span style={styles.quizCorrectLabel}>Correct</span>
                        <TavariCheckbox
                          checked={option.isCorrect === true}
                          onChange={(checked) => updateOption(index, optionIndex, { isCorrect: checked })}
                          size="sm"
                        />
                        {options.length > 2 && (
                          <button type="button" style={styles.iconButton} onClick={() => removeOption(index, optionIndex)} title="Remove answer">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" style={styles.quizAddOptionButton} onClick={() => addOption(index)}>
                  <Plus size={14} />
                  Add Answer
                </button>
              </article>
            );
          })}
          <button type="button" style={styles.secondaryButton} onClick={() => setQuiz({ questions: [...questions, { ...EMPTY_QUIZ_QUESTION, options: [{ ...EMPTY_QUIZ_OPTION }, { ...EMPTY_QUIZ_OPTION }] }] })}>
            <FileQuestion size={15} />
            Add Question
          </button>
        </div>
      )}
    </section>
  );
};

const TaskManagerOptions = ({
  form,
  setForm,
  taskCategories,
  taskLinkOptions,
  taskLinkOptionsLoading,
  onRefreshTaskLinkOptions
}) => (
  <section style={styles.builderSection}>
    <div style={styles.builderHeader}>
      <div>
        <h4 style={styles.builderTitle}>Task Manager Integration</h4>
        <p style={styles.builderHint}>Create a Task Manager assignment when this training is assigned.</p>
      </div>
      <TavariCheckbox
        checked={form.task_manager_enabled}
        onChange={(checked) => setForm((current) => ({ ...current, task_manager_enabled: checked }))}
        label="Create task assignments"
      />
    </div>
    {form.task_manager_enabled && (
      <>
        <div style={styles.inlineGrid}>
          <label style={styles.radioCard}>
            <input
              type="radio"
              checked={form.task_link_mode === 'create_task'}
              onChange={() => setForm((current) => ({ ...current, task_link_mode: 'create_task', task_link_target: '' }))}
            />
            Create a task when assigned
          </label>
          <label style={styles.radioCard}>
            <input
              type="radio"
              checked={form.task_link_mode === 'existing_task'}
              onChange={() => setForm((current) => ({ ...current, task_link_mode: 'existing_task' }))}
            />
            Attach this training to an existing task
          </label>
        </div>

        {form.task_link_mode === 'existing_task' ? (
          <div>
            <div style={styles.taskLinkHeader}>
              <label style={styles.label}>Existing Task or Template</label>
              <button type="button" style={styles.secondaryButton} onClick={onRefreshTaskLinkOptions} disabled={taskLinkOptionsLoading}>
                {taskLinkOptionsLoading ? 'Refreshing...' : 'Refresh list'}
              </button>
            </div>
            <select
              value={form.task_link_target}
              onChange={(event) => setForm((current) => ({ ...current, task_link_target: event.target.value }))}
              style={styles.input}
            >
              <option value="">Choose a task or template</option>
              {taskLinkOptions.tasks.length > 0 && (
                <optgroup label="Tasks">
                  {taskLinkOptions.tasks.map((task) => (
                    <option key={`task-${task.id}`} value={`task:${task.id}`}>
                      {formatTaskLinkOptionLabel(task)}
                    </option>
                  ))}
                </optgroup>
              )}
              {taskLinkOptions.templates.length > 0 && (
                <optgroup label="Recurring templates">
                  {taskLinkOptions.templates.map((template) => (
                    <option key={`template-${template.id}`} value={`template:${template.id}`}>
                      {formatTemplateLinkOptionLabel(template)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {!taskLinkOptionsLoading && taskLinkOptions.tasks.length === 0 && taskLinkOptions.templates.length === 0 && (
              <p style={styles.builderHint}>No open Task Manager tasks or active templates found. Create them in Task Manager, then click Refresh list.</p>
            )}
          </div>
        ) : (
          <div style={styles.inlineGrid}>
            <div>
              <label style={styles.label}>Task Category</label>
              <select value={form.task_category_id} onChange={(event) => setForm((current) => ({ ...current, task_category_id: event.target.value }))} style={styles.input}>
                <option value="">Training / uncategorized</option>
                {taskCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </div>
            <div>
              <label style={styles.label}>Priority</label>
              <select value={form.task_priority} onChange={(event) => setForm((current) => ({ ...current, task_priority: event.target.value }))} style={styles.input}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
        )}
      </>
    )}
  </section>
);

const cleanText = (value) => {
  const text = String(value || '').trim();
  return text || null;
};

const parseTaskLinkTarget = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return { type: null, id: null };
  const [type, id] = raw.split(':');
  if ((type === 'task' || type === 'template') && id) return { type, id };
  return { type: null, id: null };
};

const formatTaskLinkOptionLabel = (task) => {
  const scope = task.assignment_scope === 'assigned' ? 'Assigned' : 'Facility';
  const status = String(task.status || '').replace('_', ' ');
  return `${task.title} (${scope} · ${status})`;
};

const formatTemplateLinkOptionLabel = (template) => {
  const times = Array.isArray(template.schedule_times) ? template.schedule_times.filter(Boolean) : [];
  const timeLabel = times.length ? ` · ${times.slice(0, 2).join(', ')}${times.length > 2 ? '…' : ''}` : '';
  return `${template.title} (Template${timeLabel})`;
};

async function insertTrainingResourcesForTarget({ trainingItem, userId, taskId = null, templateId = null }) {
  if (!trainingItem?.id) return;
  const { error: resourceError } = await supabase.from('task_manager_training_resources').insert(
    [{
      business_id: trainingItem.business_id,
      task_id: taskId,
      template_id: templateId,
      hr_training_item_id: trainingItem.id,
      title: trainingItem.title,
      resource_type: 'text',
      resource_url: null,
      content: trainingItem.description || trainingItem.content || null,
      is_required: true,
      created_by: userId,
    }]
  );
  if (resourceError) throw resourceError;
}

const trainingItemToForm = (item) => {
  const sections = item?.sections || {};
  return {
    title: item?.title || '',
    overview: {
      text: sections.overview?.text || item?.description || '',
      image_url: sections.overview?.image_url || '',
      uploadFile: null,
    },
    objectives: {
      text: sections.objectives?.text || '',
      image_url: sections.objectives?.image_url || '',
      uploadFile: null,
    },
    notes: {
      text: sections.notes?.text || item?.content || '',
      image_url: sections.notes?.image_url || '',
      uploadFile: null,
    },
    requires_acknowledgement: item?.requires_acknowledgement !== false,
    auto_assign_new_hires: item?.auto_assign_new_hires === true,
    kiosk_sign_in_required: item?.kiosk_sign_in_required === true,
    steps: mapStepsFromItem(item),
    quiz: mapQuizFromItem(item?.quiz),
    task_manager_enabled: item?.task_manager_enabled === true,
    task_link_mode: item?.task_link_mode || 'create_task',
    task_link_target: item?.task_manager_task_id
      ? `task:${item.task_manager_task_id}`
      : item?.sections?._task_manager_template_id
        ? `template:${item.sections._task_manager_template_id}`
        : '',
    task_manager_task_id: item?.task_manager_task_id || '',
    task_category_id: item?.task_category_id || '',
    task_priority: item?.task_priority || 'medium',
    task_requires_completion: item?.task_requires_completion !== false,
  };
};

const mapStepsFromItem = (item) => {
  const steps = Array.isArray(item?.steps) ? item.steps : [];
  if (steps.length === 0) return [{ ...EMPTY_STEP, title: 'Step 1' }];
  return steps.map((step, index) => ({
    id: step.id,
    title: step.title || `Step ${index + 1}`,
    body: step.body || '',
    resource_url: step.resource_url || '',
    image_url: step.image_url || '',
    file_url: step.file_url || '',
    uploadFile: null,
    uploadType: step.image_url ? 'image' : step.file_url ? 'file' : '',
    is_required: step.is_required !== false,
  }));
};

const mapQuizFromItem = (quiz) => {
  if (!quiz?.enabled) {
    return { enabled: false, passing_score: 80, questions: [] };
  }

  return {
    enabled: true,
    passing_score: Number(quiz.passing_score) || 80,
    questions: (quiz.questions || []).map((question) => {
      const storedOptions = Array.isArray(question.options) ? question.options : [];
      const correctAnswer = String(question.correct_answer || '').trim().toLowerCase();
      const options = storedOptions.length >= 2
        ? storedOptions.map((option) => {
            const text = typeof option === 'string' ? option : (option?.text || '');
            return {
              text,
              isCorrect: Boolean(correctAnswer && text.trim().toLowerCase() === correctAnswer),
            };
          })
        : [{ ...EMPTY_QUIZ_OPTION }, { ...EMPTY_QUIZ_OPTION }];

      return {
        id: question.id,
        prompt: question.prompt || '',
        options,
        is_required: question.is_required !== false,
      };
    }),
  };
};

const isTerminated = (employee) => String(employee.employment_status || employee.status || '').toLowerCase().includes('terminated');
const isComplete = (assignment) => ['completed', 'acknowledged'].includes(assignment.status) && (!assignment.hr_training_items?.requires_acknowledgement || assignment.acknowledged_at);
const isOverdue = (date) => Boolean(date && new Date(`${date}T23:59:59`) < new Date());
const formatStatus = (value) => String(value || 'assigned').replace(/_/g, ' ');
const formatDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const formatDateTime = (value) => value ? new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const getStatusStyle = (status, overdue) => {
  if (overdue) return { backgroundColor: '#fee2e2', color: '#991b1b' };
  return {
    assigned: { backgroundColor: '#dbeafe', color: '#1d4ed8' },
    in_progress: { backgroundColor: '#fef3c7', color: '#92400e' },
    completed: { backgroundColor: '#dcfce7', color: '#166534' },
    acknowledged: { backgroundColor: '#dcfce7', color: '#166534' },
  }[status] || { backgroundColor: '#e5e7eb', color: '#374151' };
};

const uploadTrainingImage = async (businessId, file, sectionKey) => {
  if (!file) return null;
  const safeName = String(file.name || `${sectionKey}-image`)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
  const path = `${businessId}/hr-training/${sectionKey}/${crypto.randomUUID()}_${safeName}`;
  const { error: uploadError } = await supabase.storage
    .from(TASK_TRAINING_MEDIA_BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    });
  if (uploadError) throw uploadError;
  const { data: urlData } = supabase.storage.from(TASK_TRAINING_MEDIA_BUCKET).getPublicUrl(path);
  return urlData?.publicUrl || null;
};

const buildTrainingSections = async (form, businessId) => {
  const entries = [
    ['overview', form.overview],
    ['objectives', form.objectives],
    ['notes', form.notes],
  ];
  const sections = {};
  for (const [key, section] of entries) {
    sections[key] = {
      text: cleanText(section?.text),
      image_url: cleanText(section?.image_url) || await uploadTrainingImage(businessId, section?.uploadFile, key),
    };
  }
  return sections;
};

const buildTrainingSteps = async (steps, businessId) => {
  const normalized = [];
  for (const [index, step] of (steps || []).entries()) {
    let imageUrl = cleanText(step.image_url);
    let fileUrl = cleanText(step.file_url);

    if (step.uploadFile) {
      const safeName = String(step.uploadFile.name || `training-step-${index + 1}`)
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 120);
      const path = `${businessId}/hr-training/${crypto.randomUUID()}_${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from(TASK_TRAINING_MEDIA_BUCKET)
        .upload(path, step.uploadFile, {
          cacheControl: '3600',
          upsert: false,
          contentType: step.uploadFile.type || undefined,
        });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from(TASK_TRAINING_MEDIA_BUCKET).getPublicUrl(path);
      if (step.uploadType === 'image') imageUrl = urlData?.publicUrl || '';
      else fileUrl = urlData?.publicUrl || '';
    }

    if (step.title || step.body || step.resource_url || imageUrl || fileUrl) {
      normalized.push({
        id: step.id || crypto.randomUUID(),
        order: normalized.length + 1,
        title: cleanText(step.title) || `Step ${index + 1}`,
        body: cleanText(step.body),
        resource_url: cleanText(step.resource_url),
        image_url: imageUrl,
        file_url: fileUrl,
        is_required: step.is_required !== false,
      });
    }
  }
  return normalized;
};

const buildQuizPayload = (quiz) => {
  if (!quiz?.enabled) return { enabled: false, questions: [] };
  const questions = (quiz.questions || [])
    .map((question) => {
      const optionRows = Array.isArray(question.options) ? question.options : [];
      const options = optionRows.map((option) => cleanText(option?.text)).filter(Boolean);
      const correctOption = optionRows.find((option) => option?.isCorrect && cleanText(option?.text));
      return {
        id: question.id || crypto.randomUUID(),
        prompt: cleanText(question.prompt),
        type: 'multiple_choice',
        options,
        correct_answer: correctOption ? cleanText(correctOption.text) : null,
        is_required: question.is_required !== false,
      };
    })
    .filter((question) => question.prompt);
  return {
    enabled: questions.length > 0,
    passing_score: Number(quiz.passing_score) || 80,
    questions,
  };
};

const dueDateToIso = (date) => {
  if (!date) return null;
  return new Date(`${date}T17:00:00`).toISOString();
};

async function createTaskManagerTrainingTask({ assignment, trainingItem, dueDate, notes, userId }) {
  const categoryName = trainingItem.task_category_id ? null : 'Training';
  const { data: task, error: taskError } = await supabase
    .from('task_manager_tasks')
    .insert({
      business_id: trainingItem.business_id,
      title: `Training: ${trainingItem.title}`,
      description: cleanText(trainingItem.description) || cleanText(trainingItem.content),
      category_id: trainingItem.task_category_id || null,
      category: categoryName,
      priority: trainingItem.task_priority || 'medium',
      assignment_scope: 'assigned',
      assigned_to: assignment.employee_id,
      due_at: dueDateToIso(dueDate),
      available_at: new Date().toISOString(),
      instructions: cleanText(notes) || `Complete HR training: ${trainingItem.title}`,
      checklist: [{ label: 'Review all training steps' }, { label: 'Complete HR training acknowledgement' }],
      requires_notes: false,
      requires_photo: false,
      peer_review_required: false,
      review_status: 'not_required',
      created_by: userId,
    })
    .select('id')
    .single();

  if (taskError) throw taskError;

  await insertTrainingResourcesForTarget({ trainingItem, userId, taskId: task.id, templateId: null });

  const { error: updateError } = await supabase
    .from('hr_training_assignments')
    .update({ task_manager_task_id: task.id, updated_at: new Date().toISOString() })
    .eq('id', assignment.id);
  if (updateError) throw updateError;
}

async function attachTrainingToExistingTask({ assignment, trainingItem, userId }) {
  const taskId = trainingItem.task_manager_task_id;
  if (!taskId) throw new Error('Choose an existing task for this training');

  await insertTrainingResourcesForTarget({ trainingItem, userId, taskId, templateId: null });

  const { error: updateError } = await supabase
    .from('hr_training_assignments')
    .update({ task_manager_task_id: taskId, updated_at: new Date().toISOString() })
    .eq('id', assignment.id);
  if (updateError) throw updateError;
}

async function attachTrainingToExistingTemplate({ assignment, trainingItem, templateId, userId }) {
  if (!templateId) throw new Error('Choose an existing template for this training');

  await insertTrainingResourcesForTarget({ trainingItem, userId, taskId: null, templateId });

  const { error: updateError } = await supabase
    .from('hr_training_assignments')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', assignment.id);
  if (updateError) throw updateError;
}

const styles = {
  container: { padding: '24px', backgroundColor: '#f8fafc', minHeight: '640px' },
  header: { display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start', marginBottom: '18px', flexWrap: 'wrap' },
  eyebrow: { fontSize: '13px', letterSpacing: '0.08em', textTransform: 'uppercase', color: TavariStyles.colors.primary, fontWeight: 800 },
  title: { margin: '4px 0', fontSize: '26px', color: TavariStyles.colors.gray900 },
  subtitle: { margin: 0, color: TavariStyles.colors.gray600 },
  headerActions: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
  primaryButton: { border: 'none', borderRadius: '12px', padding: '10px 14px', backgroundColor: TavariStyles.colors.primary, color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 800, cursor: 'pointer' },
  secondaryButton: { border: '1px solid #d1d5db', borderRadius: '12px', padding: '10px 14px', backgroundColor: 'white', color: TavariStyles.colors.gray800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 800, cursor: 'pointer' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '18px' },
  statCard: { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '16px', padding: '16px' },
  statDanger: { borderColor: '#fecaca', backgroundColor: '#fef2f2' },
  statSuccess: { borderColor: '#bbf7d0', backgroundColor: '#f0fdf4' },
  statValue: { fontSize: '28px', fontWeight: 800, color: TavariStyles.colors.gray900 },
  statLabel: { color: TavariStyles.colors.gray600, fontSize: '13px' },
  panel: { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '18px', padding: '18px', marginBottom: '18px' },
  panelTitle: { margin: 0, color: TavariStyles.colors.gray900 },
  moduleGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px', marginTop: '14px' },
  moduleCard: { display: 'flex', gap: '12px', border: '1px solid #e5e7eb', borderRadius: '14px', padding: '14px', minWidth: 0, alignItems: 'flex-start' },
  moduleActions: { display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 },
  testModuleButton: { border: `1px solid ${TavariStyles.colors.primary}`, borderRadius: '10px', padding: '8px 10px', backgroundColor: '#ecfeff', color: '#155e75', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 700, cursor: 'pointer', flexShrink: 0 },
  editModuleButton: { border: '1px solid #d1d5db', borderRadius: '10px', padding: '8px 10px', backgroundColor: 'white', color: TavariStyles.colors.gray700, display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 700, cursor: 'pointer', flexShrink: 0 },
  deleteModuleButton: { border: '1px solid #fecaca', borderRadius: '10px', padding: '8px 10px', backgroundColor: '#fef2f2', color: '#991b1b', display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 700, cursor: 'pointer', flexShrink: 0 },
  moduleTitle: { margin: 0, color: TavariStyles.colors.gray900 },
  moduleDescription: { margin: '6px 0 0', color: TavariStyles.colors.gray600, lineHeight: 1.45 },
  moduleMeta: { margin: '8px 0 0', color: TavariStyles.colors.gray500, fontSize: '13px', fontWeight: 700 },
  badgeRow: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginTop: '8px' },
  miniBadge: { display: 'inline-flex', borderRadius: '999px', padding: '4px 8px', backgroundColor: '#ecfeff', color: '#155e75', fontSize: '11px', fontWeight: 800 },
  listHeader: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '14px' },
  filters: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  filterButton: { border: '1px solid #d1d5db', backgroundColor: 'white', color: TavariStyles.colors.gray700, borderRadius: '999px', padding: '8px 12px', fontWeight: 700, cursor: 'pointer' },
  filterButtonActive: { backgroundColor: TavariStyles.colors.primary, borderColor: TavariStyles.colors.primary, color: 'white' },
  assignmentGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px' },
  assignmentCard: { border: '1px solid #e5e7eb', borderRadius: '16px', padding: '16px', backgroundColor: '#fff' },
  cardTop: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' },
  assignmentTitle: { margin: 0, color: TavariStyles.colors.gray900 },
  employeeName: { margin: '5px 0 0', color: TavariStyles.colors.gray600 },
  statusPill: { borderRadius: '999px', padding: '6px 10px', fontSize: '13px', fontWeight: 800, textTransform: 'capitalize', whiteSpace: 'nowrap' },
  detail: { margin: '8px 0 0', color: TavariStyles.colors.gray700, fontSize: '14px' },
  notes: { margin: '10px 0 0', padding: '10px', borderRadius: '12px', backgroundColor: '#f8fafc', color: TavariStyles.colors.gray700 },
  cancelButton: { marginTop: '12px', border: '1px solid #fecaca', borderRadius: '12px', padding: '9px 12px', backgroundColor: '#fff1f2', color: '#be123c', fontWeight: 800, cursor: 'pointer' },
  empty: { padding: '28px', textAlign: 'center', borderRadius: '16px', backgroundColor: 'white', border: '1px solid #e5e7eb', color: TavariStyles.colors.gray600 },
  modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', zIndex: 9999 },
  modal: { width: 'min(640px, 100%)', maxHeight: '90vh', overflowY: 'auto', backgroundColor: 'white', borderRadius: '18px', padding: '20px', boxSizing: 'border-box' },
  largeModal: { width: 'min(980px, 100%)', maxHeight: '92vh', overflowY: 'auto', backgroundColor: 'white', borderRadius: '18px', padding: '20px', boxSizing: 'border-box' },
  previewModal: { width: 'min(760px, 100%)', maxHeight: '92vh', overflowY: 'auto', backgroundColor: 'white', borderRadius: '18px', padding: '20px', boxSizing: 'border-box' },
  previewBanner: { margin: '0 0 14px', padding: '10px 12px', borderRadius: '12px', backgroundColor: '#eff6ff', color: '#1e40af', fontSize: '13px', fontWeight: 600 },
  previewBody: { display: 'grid', gap: '12px' },
  previewTitle: { margin: 0, color: TavariStyles.colors.gray900, fontSize: '23px' },
  previewDescription: { margin: 0, color: TavariStyles.colors.gray600, lineHeight: 1.5 },
  previewSectionHeading: { margin: '0 0 8px', color: TavariStyles.colors.gray900, fontSize: '16px' },
  previewStepsWrap: { display: 'grid', gap: '10px' },
  previewStepCard: { padding: '14px', borderRadius: '14px', border: '1px solid #e5e7eb', backgroundColor: '#f8fafc' },
  previewStepLabel: { fontSize: '11px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: TavariStyles.colors.gray500, marginBottom: '6px' },
  previewStepTitle: { margin: '0 0 8px', color: TavariStyles.colors.gray900, fontSize: '15px' },
  previewStepBody: { margin: 0, color: TavariStyles.colors.gray700, lineHeight: 1.55, whiteSpace: 'pre-wrap' },
  previewStepImage: { display: 'block', maxWidth: '100%', marginTop: '10px', borderRadius: '10px', border: '1px solid #e5e7eb' },
  previewResourceLink: { display: 'inline-flex', alignItems: 'center', gap: '6px', color: TavariStyles.colors.primary, fontWeight: 700, textDecoration: 'none' },
  previewQuizBox: { padding: '14px', borderRadius: '14px', border: '1px solid #e5e7eb', backgroundColor: '#fff' },
  previewQuizHint: { margin: '0 0 10px', color: TavariStyles.colors.gray600, fontSize: '13px' },
  previewQuizQuestion: { marginBottom: '12px', color: TavariStyles.colors.gray800 },
  previewQuizOptions: { margin: '8px 0 0', paddingLeft: '20px', color: TavariStyles.colors.gray700 },
  previewAckBox: { padding: '14px', borderRadius: '14px', border: '1px solid #fde68a', backgroundColor: '#fffbeb', color: '#92400e', display: 'grid', gap: '10px' },
  previewAckButton: { border: 'none', borderRadius: '12px', padding: '10px 14px', backgroundColor: '#d1d5db', color: '#6b7280', fontWeight: 800, cursor: 'not-allowed', justifySelf: 'start' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '14px' },
  modalTitle: { margin: 0, color: TavariStyles.colors.gray900 },
  iconButton: { border: 'none', backgroundColor: 'transparent', cursor: 'pointer', color: TavariStyles.colors.gray700 },
  label: { display: 'block', margin: '12px 0 6px', fontWeight: 700, color: TavariStyles.colors.gray700, fontSize: '13px' },
  input: { width: '100%', border: '1px solid #d1d5db', borderRadius: '12px', padding: '11px 12px', boxSizing: 'border-box', fontSize: '15px' },
  textarea: { width: '100%', border: '1px solid #d1d5db', borderRadius: '12px', padding: '11px 12px', boxSizing: 'border-box', fontSize: '15px', resize: 'vertical' },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', color: TavariStyles.colors.gray700, fontWeight: 700 },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px', flexWrap: 'wrap' },
  employeePicker: { marginTop: '12px', display: 'grid', gap: '8px', maxHeight: '220px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '10px' },
  employeeOption: { display: 'flex', alignItems: 'center', gap: '8px', color: TavariStyles.colors.gray800 },
  builderSection: { marginTop: '18px', padding: '16px', borderRadius: '16px', border: '1px solid #e5e7eb', backgroundColor: '#f8fafc' },
  builderHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' },
  builderTitle: { margin: 0, color: TavariStyles.colors.gray900 },
  builderHint: { margin: '4px 0 0', color: TavariStyles.colors.gray600, fontSize: '13px' },
  taskLinkHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '6px' },
  stepList: { display: 'grid', gap: '12px' },
  stepCard: { padding: '14px', borderRadius: '14px', border: '1px solid #e5e7eb', backgroundColor: 'white' },
  stepHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' },
  stepActions: { display: 'flex', gap: '6px' },
  fileInput: { display: 'block', width: '100%', border: '1px dashed #cbd5e1', borderRadius: '12px', padding: '10px', backgroundColor: 'white', boxSizing: 'border-box' },
  uploadName: { margin: '6px 0 0', color: TavariStyles.colors.gray600, fontSize: '13px' },
  existingAsset: { marginTop: '8px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
  existingImagePreview: { maxWidth: '160px', maxHeight: '100px', borderRadius: '10px', border: '1px solid #e5e7eb', objectFit: 'cover' },
  existingFileLink: { color: TavariStyles.colors.primary, fontWeight: 700, fontSize: '13px' },
  removeAssetButton: { border: '1px solid #fecaca', borderRadius: '8px', padding: '6px 10px', backgroundColor: '#fff1f2', color: '#be123c', fontWeight: 700, cursor: 'pointer', fontSize: '13px' },
  inlineGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' },
  radioCard: { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', border: '1px solid #d1d5db', borderRadius: '12px', backgroundColor: 'white', fontWeight: 800, color: TavariStyles.colors.gray800 },
  quizOptionsList: { display: 'grid', gap: '8px', marginTop: '6px' },
  quizOptionRow: { display: 'flex', alignItems: 'center', gap: '10px' },
  quizOptionInput: { flex: 1, border: '1px solid #d1d5db', borderRadius: '12px', padding: '10px 12px', fontSize: '15px', boxSizing: 'border-box' },
  quizOptionCorrect: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 },
  quizCorrectLabel: { fontSize: '13px', fontWeight: 700, color: TavariStyles.colors.gray500, whiteSpace: 'nowrap' },
  quizAddOptionButton: { marginTop: '8px', border: '1px dashed #cbd5e1', borderRadius: '10px', padding: '8px 12px', backgroundColor: 'white', color: TavariStyles.colors.gray700, display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 700, cursor: 'pointer' },
};

export default TrainingCenter;
