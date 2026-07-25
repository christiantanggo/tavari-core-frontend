import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BookOpen, CheckCircle, Clock, ExternalLink, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';

const PortalTraining = () => {
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [business, setBusiness] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [quizAnswers, setQuizAnswers] = useState({});

  const counts = useMemo(() => {
    const pending = assignments.filter((assignment) => !isComplete(assignment)).length;
    const overdue = assignments.filter((assignment) => !isComplete(assignment) && isOverdue(assignment.due_date)).length;
    return { pending, overdue, completed: assignments.length - pending };
  }, [assignments]);

  const loadTraining = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const { data, error } = await supabase.functions.invoke('employee-training-action', {
        body: { action: 'list' }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setBusiness(data.business || null);
      setAssignments(data.assignments || []);
    } catch (error) {
      console.error('[PortalTraining] load failed:', error);
      toast.error(error.message || 'Could not load training');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTraining();
  }, []);

  const updateAssignment = async (assignment, action) => {
    if (action === 'acknowledge') {
      const title = assignment.hr_training_items?.title || 'this training';
      const confirmed = window.confirm(`By acknowledging ${title}, you confirm that you completed and understood the assigned training. Continue?`);
      if (!confirmed) return;
    }

    setSavingId(assignment.id);
    try {
      const { data, error } = await supabase.functions.invoke('employee-training-action', {
        body: {
          action,
          assignment_id: assignment.id,
          quiz_answers: quizAnswers[assignment.id] || {},
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(action === 'start' ? 'Training started' : action === 'complete' ? 'Training marked complete' : 'Training acknowledged');
      await loadTraining({ silent: true });
      window.dispatchEvent(new Event('employee-account-badge-refresh'));
    } catch (error) {
      console.error('[PortalTraining] update failed:', error);
      toast.error(error.message || 'Could not update training');
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return <div style={styles.loading}>Loading training...</div>;
  }

  const pendingAssignments = assignments.filter((assignment) => !isComplete(assignment));
  const completedAssignments = assignments.filter((assignment) => isComplete(assignment));

  return (
    <div style={styles.page}>
      <section style={styles.hero}>
        <div style={styles.eyebrow}>Tavari Employee App</div>
        <h1 style={styles.title}>Training</h1>
        <p style={styles.heroText}>Review assigned training, track due dates, and acknowledge completion.</p>
        {business?.name && <p style={styles.businessName}>{business.name}</p>}
      </section>

      <section style={styles.summaryGrid}>
        <SummaryCard label="Pending" value={counts.pending} tone="pending" />
        <SummaryCard label="Overdue" value={counts.overdue} tone="overdue" />
        <SummaryCard label="Completed" value={counts.completed} tone="complete" />
      </section>

      <section style={styles.sectionHeader}>
        <h2 style={styles.sectionTitle}>Assigned Training</h2>
        <button type="button" style={styles.refreshButton} onClick={() => loadTraining({ silent: true })}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </section>

      {assignments.length === 0 ? (
        <section style={styles.card}>
          <div style={styles.iconWrap}>
            <BookOpen size={28} />
          </div>
          <h2 style={{ marginTop: 0, color: TavariStyles.colors.gray900 }}>No assigned training right now</h2>
          <p style={styles.text}>
            New training modules, acknowledgements, and due dates will appear here when your manager assigns them.
          </p>
        </section>
      ) : (
        <div style={styles.list}>
          {[...pendingAssignments, ...completedAssignments].map((assignment) => (
            <TrainingCard
              key={assignment.id}
              assignment={assignment}
              saving={savingId === assignment.id}
              quizAnswers={quizAnswers[assignment.id] || {}}
              onQuizChange={(questionId, value) => setQuizAnswers((current) => ({
                ...current,
                [assignment.id]: {
                  ...(current[assignment.id] || {}),
                  [questionId]: value,
                },
              }))}
              onAction={updateAssignment}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const TrainingCard = ({ assignment, saving, quizAnswers, onQuizChange, onAction }) => {
  const item = assignment.hr_training_items || {};
  const complete = isComplete(assignment);
  const overdue = !complete && isOverdue(assignment.due_date);
  const requiresAck = item.requires_acknowledgement !== false;
  const needsAcknowledgement = requiresAck && assignment.status === 'completed' && !assignment.acknowledged_at;
  const steps = Array.isArray(item.steps) ? item.steps : [];
  const sections = item.sections || {};
  const quiz = item.quiz || {};
  const quizQuestions = quiz.enabled && Array.isArray(quiz.questions) ? quiz.questions : [];

  return (
    <article style={styles.trainingCard}>
      <div style={styles.trainingTop}>
        <div style={{ minWidth: 0 }}>
          <h3 style={styles.trainingTitle}>{item.title || 'Training'}</h3>
          <div style={styles.metaRow}>
            {assignment.due_date && (
              <span style={{ ...styles.metaPill, ...(overdue ? styles.metaPillOverdue : {}) }}>
                {overdue ? <AlertCircle size={14} /> : <Clock size={14} />}
                Due {formatDate(assignment.due_date)}
              </span>
            )}
          </div>
        </div>
        <span style={{ ...styles.statusPill, ...getStatusStyle(assignment.status, overdue) }}>
          {overdue ? 'Overdue' : formatStatus(assignment.status)}
        </span>
      </div>

      {item.description && <p style={styles.text}>{item.description}</p>}
      {item.content && <div style={styles.contentBox}>{item.content}</div>}
      <TrainingSection title="Overview" section={sections.overview} />
      <TrainingSection title="Objectives" section={sections.objectives} />
      <TrainingSection title="Additional Notes" section={sections.notes} />
      {item.resource_url && (
        <a href={item.resource_url} target="_blank" rel="noreferrer" style={styles.resourceLink}>
          <ExternalLink size={15} />
          Open training resource
        </a>
      )}
      {steps.length > 0 && (
        <div style={styles.stepsWrap}>
          {steps.map((step, index) => (
            <section key={step.id || index} style={styles.stepCard}>
              <div style={styles.stepLabel}>Step {index + 1}{step.is_required !== false ? ' • required' : ''}</div>
              <h4 style={styles.stepTitle}>{step.title || `Step ${index + 1}`}</h4>
              {step.body && <p style={styles.stepBody}>{step.body}</p>}
              {step.image_url && <img src={step.image_url} alt={step.title || 'Training step'} style={styles.stepImage} />}
              {(step.file_url || step.resource_url) && (
                <a href={step.file_url || step.resource_url} target="_blank" rel="noreferrer" style={styles.resourceLink}>
                  <ExternalLink size={15} />
                  Open step resource
                </a>
              )}
            </section>
          ))}
        </div>
      )}
      {quizQuestions.length > 0 && !complete && (
        <div style={styles.quizBox}>
          <h4 style={styles.quizTitle}>Knowledge Check</h4>
          <p style={styles.quizHint}>Passing score: {quiz.passing_score || 80}%</p>
          {quizQuestions.map((question, index) => (
            <label key={question.id || index} style={styles.quizQuestion}>
              <span>{index + 1}. {question.prompt}</span>
              <select
                value={quizAnswers[question.id] || ''}
                onChange={(event) => onQuizChange(question.id, event.target.value)}
                style={styles.quizSelect}
              >
                <option value="">Choose an answer</option>
                {(question.options || []).map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
      {assignment.manager_notes && <div style={styles.managerNotes}>Manager note: {assignment.manager_notes}</div>}

      <div style={styles.actionRow}>
        {assignment.status === 'assigned' && (
          <button type="button" style={styles.secondaryButton} onClick={() => onAction(assignment, 'start')} disabled={saving}>
            Start Training
          </button>
        )}
        {!complete && assignment.status !== 'completed' && (
          <button type="button" style={styles.primaryButton} onClick={() => onAction(assignment, 'complete')} disabled={saving}>
            Mark Complete
          </button>
        )}
        {needsAcknowledgement && (
          <button type="button" style={styles.primaryButton} onClick={() => onAction(assignment, 'acknowledge')} disabled={saving}>
            Acknowledge
          </button>
        )}
        {complete && (
          <span style={styles.completedText}>
            <CheckCircle size={16} />
            Completed {formatDateTime(assignment.acknowledged_at || assignment.completed_at)}
          </span>
        )}
      </div>
    </article>
  );
};

const TrainingSection = ({ title, section }) => {
  if (!section?.text && !section?.image_url) return null;
  return (
    <section style={styles.stepCard}>
      <div style={styles.stepLabel}>{title}</div>
      {section.text && <p style={styles.stepBody}>{section.text}</p>}
      {section.image_url && <img src={section.image_url} alt={title} style={styles.stepImage} />}
    </section>
  );
};

const SummaryCard = ({ label, value, tone }) => (
  <div style={{ ...styles.summaryCard, ...summaryTones[tone] }}>
    <div style={styles.summaryValue}>{value}</div>
    <div style={styles.summaryLabel}>{label}</div>
  </div>
);

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

const summaryTones = {
  pending: { borderColor: '#f59e0b', backgroundColor: '#fffbeb' },
  overdue: { borderColor: '#dc2626', backgroundColor: '#fef2f2' },
  complete: { borderColor: '#16a34a', backgroundColor: '#f0fdf4' },
};

const styles = {
  loading: {
    minHeight: '60vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: TavariStyles.colors.gray600,
  },
  page: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.lg,
    boxSizing: 'border-box',
    overflowX: 'hidden',
  },
  hero: {
    background: `linear-gradient(135deg, ${TavariStyles.colors.primary}, #0f766e)`,
    color: TavariStyles.colors.white,
    borderRadius: '24px',
    padding: TavariStyles.spacing.xl,
    boxShadow: TavariStyles.shadows?.lg || '0 10px 20px rgba(0,0,0,0.15)',
    boxSizing: 'border-box',
  },
  eyebrow: {
    fontSize: TavariStyles.typography.fontSize.sm,
    opacity: 0.85,
    marginBottom: TavariStyles.spacing.xs,
  },
  title: {
    margin: 0,
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: TavariStyles.typography.fontWeight.bold,
  },
  heroText: {
    margin: `${TavariStyles.spacing.sm} 0 0`,
    opacity: 0.9,
    lineHeight: 1.5,
  },
  businessName: {
    margin: `${TavariStyles.spacing.md} 0 0`,
    fontWeight: TavariStyles.typography.fontWeight.bold,
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: TavariStyles.spacing.md,
  },
  summaryCard: {
    border: '1px solid',
    borderRadius: '16px',
    padding: TavariStyles.spacing.lg,
    boxSizing: 'border-box',
  },
  summaryValue: {
    fontSize: '28px',
    fontWeight: 800,
    color: TavariStyles.colors.gray900,
  },
  summaryLabel: {
    color: TavariStyles.colors.gray600,
    fontSize: TavariStyles.typography.fontSize.sm,
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: TavariStyles.spacing.md,
  },
  sectionTitle: {
    margin: 0,
    color: TavariStyles.colors.gray900,
  },
  refreshButton: {
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '999px',
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.gray700,
    padding: '8px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    cursor: 'pointer',
  },
  card: {
    backgroundColor: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: '18px',
    padding: TavariStyles.spacing.xl,
    boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
    boxSizing: 'border-box',
    minWidth: 0,
  },
  iconWrap: {
    width: '52px',
    height: '52px',
    borderRadius: '18px',
    backgroundColor: TavariStyles.colors.primary + '15',
    color: TavariStyles.colors.primary,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: TavariStyles.spacing.md,
  },
  text: {
    color: TavariStyles.colors.gray600,
    lineHeight: 1.6,
  },
  list: {
    display: 'grid',
    gap: TavariStyles.spacing.md,
  },
  trainingCard: {
    backgroundColor: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: '18px',
    padding: TavariStyles.spacing.lg,
    boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
    minWidth: 0,
    boxSizing: 'border-box',
  },
  trainingTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: TavariStyles.spacing.md,
  },
  trainingTitle: {
    margin: 0,
    color: TavariStyles.colors.gray900,
    fontSize: TavariStyles.typography.fontSize.lg,
  },
  metaRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginTop: '8px',
  },
  metaPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    borderRadius: '999px',
    padding: '5px 9px',
    backgroundColor: '#f3f4f6',
    color: TavariStyles.colors.gray700,
    fontSize: '13px',
    fontWeight: 700,
  },
  metaPillOverdue: {
    backgroundColor: '#fee2e2',
    color: '#991b1b',
  },
  statusPill: {
    borderRadius: '999px',
    padding: '6px 10px',
    fontSize: '13px',
    fontWeight: 800,
    textTransform: 'capitalize',
    whiteSpace: 'nowrap',
  },
  contentBox: {
    marginTop: TavariStyles.spacing.md,
    padding: TavariStyles.spacing.md,
    borderRadius: '14px',
    backgroundColor: TavariStyles.colors.gray50,
    color: TavariStyles.colors.gray700,
    whiteSpace: 'pre-wrap',
    lineHeight: 1.5,
  },
  stepsWrap: {
    display: 'grid',
    gap: TavariStyles.spacing.md,
    marginTop: TavariStyles.spacing.md,
  },
  stepCard: {
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: '14px',
    padding: TavariStyles.spacing.md,
    backgroundColor: '#f8fafc',
  },
  stepLabel: {
    color: TavariStyles.colors.primary,
    fontSize: '13px',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  stepTitle: {
    margin: '6px 0',
    color: TavariStyles.colors.gray900,
  },
  stepBody: {
    margin: 0,
    color: TavariStyles.colors.gray700,
    whiteSpace: 'pre-wrap',
    lineHeight: 1.5,
  },
  stepImage: {
    maxWidth: '100%',
    borderRadius: '12px',
    marginTop: TavariStyles.spacing.sm,
    border: `1px solid ${TavariStyles.colors.gray200}`,
  },
  quizBox: {
    marginTop: TavariStyles.spacing.md,
    border: '1px solid #bae6fd',
    borderRadius: '14px',
    padding: TavariStyles.spacing.md,
    backgroundColor: '#f0f9ff',
  },
  quizTitle: {
    margin: 0,
    color: TavariStyles.colors.gray900,
  },
  quizHint: {
    margin: '4px 0 12px',
    color: TavariStyles.colors.gray600,
    fontSize: '13px',
  },
  quizQuestion: {
    display: 'grid',
    gap: '6px',
    marginTop: TavariStyles.spacing.sm,
    color: TavariStyles.colors.gray800,
    fontWeight: 700,
  },
  quizSelect: {
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '10px',
    padding: '10px',
    backgroundColor: TavariStyles.colors.white,
  },
  resourceLink: {
    marginTop: TavariStyles.spacing.md,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    color: TavariStyles.colors.primary,
    fontWeight: 700,
    textDecoration: 'none',
  },
  managerNotes: {
    marginTop: TavariStyles.spacing.md,
    padding: TavariStyles.spacing.md,
    borderRadius: '14px',
    backgroundColor: '#ecfeff',
    color: '#155e75',
  },
  actionRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm,
    marginTop: TavariStyles.spacing.lg,
  },
  primaryButton: {
    border: 'none',
    borderRadius: '12px',
    padding: '10px 14px',
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    fontWeight: 800,
    cursor: 'pointer',
  },
  secondaryButton: {
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '12px',
    padding: '10px 14px',
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.gray800,
    fontWeight: 800,
    cursor: 'pointer',
  },
  completedText: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    color: '#166534',
    fontWeight: 700,
  },
};

export default PortalTraining;

