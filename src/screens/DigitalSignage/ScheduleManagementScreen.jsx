// src/screens/DigitalSignage/ScheduleManagementScreen.jsx
import React, { useState, useEffect } from 'react';
import { FiCalendar, FiPlus, FiEdit, FiTrash2, FiClock, FiMonitor, FiList } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import toast from 'react-hot-toast';
import useDigitalSignage from '../../hooks/useDigitalSignage';
import ScheduleFormModal from '../../components/DigitalSignage/ScheduleFormModal';
import SchedulePlaylistModal from '../../components/DigitalSignage/SchedulePlaylistModal';
import { isWaiverKioskSchedule } from '../../constants/digitalSignageSchedules';

const ScheduleManagementScreen = ({ embedded = false }) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [playlistSchedule, setPlaylistSchedule] = useState(null);

  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'ScheduleManagementScreen'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();

  const {
    schedules,
    screens,
    content,
    loading,
    error,
    loadSchedules,
    loadScreens,
    loadContent,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    checkScheduleConflicts,
    loadScheduleItems,
    replaceScheduleItems
  } = useDigitalSignage();

  useEffect(() => {
    if (auth.selectedBusinessId) {
      loadSchedules();
      loadScreens();
      loadContent();
    }
  }, [auth.selectedBusinessId]);

  const canCreate = hasPermission('digital_signage.schedules.edit') || hasElevatedPrivileges();
  const canEdit = hasPermission('digital_signage.schedules.edit') || hasElevatedPrivileges();
  const canDelete = hasPermission('digital_signage.schedules.edit') || hasElevatedPrivileges();

  const mapScheduleFormToDb = (formData) => ({
    schedule_name: formData.name,
    schedule_type: formData.type,
    start_date: formData.startDate || null,
    end_date: formData.endDate || null,
    start_time: formData.startTime || null,
    end_time: formData.endTime || null,
    days_of_week: formData.daysOfWeek?.length ? formData.daysOfWeek : null,
    priority: formData.priority || 1,
    apply_to_screens: formData.screenIds?.length ? formData.screenIds : []
  });

  const handleCreate = async (scheduleData) => {
    try {
      await createSchedule(scheduleData);
      setShowCreateModal(false);
    } catch (err) {
      toast.error(`Failed to create schedule: ${err.message}`);
    }
  };

  const handleUpdate = async (scheduleData) => {
    if (!selectedSchedule?.id) return;
    try {
      await updateSchedule(selectedSchedule.id, mapScheduleFormToDb(scheduleData));
      setSelectedSchedule(null);
    } catch (err) {
      toast.error(`Failed to update schedule: ${err.message}`);
    }
  };

  const closeScheduleModal = () => {
    setShowCreateModal(false);
    setSelectedSchedule(null);
  };

  const formatScheduleTime = (schedule) => {
    if (!schedule.start_time || !schedule.end_time) return 'All day';
    return `${schedule.start_time} - ${schedule.end_time}`;
  };

  const formatDaysOfWeek = (days) => {
    if (!days || days.length === 0) return 'Every day';
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days.map(d => dayNames[d]).join(', ');
  };

  const getPlaylistCount = (schedule) => {
    const nested = schedule?.digital_signage_schedule_items;
    if (Array.isArray(nested) && nested[0]?.count != null) {
      return nested[0].count;
    }
    return 0;
  };

  const handleSavePlaylist = async (scheduleId, items, options = {}) => {
    await replaceScheduleItems(scheduleId, items, options);
  };

  const styles = {
    container: {
      ...TavariStyles.layouts.container,
      padding: embedded ? 0 : TavariStyles.spacing.xl,
      paddingTop: embedded ? 0 : undefined
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.xl
    },
    title: {
      ...TavariStyles.typography.heading.h1
    },
    button: {
      ...TavariStyles.components.button.primary,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: TavariStyles.spacing.lg
    },
    card: {
      ...TavariStyles.components.card,
      padding: TavariStyles.spacing.lg
    },
    cardHeader: {
      marginBottom: TavariStyles.spacing.md
    },
    cardTitle: {
      ...TavariStyles.typography.heading.h3,
      marginBottom: TavariStyles.spacing.xs
    },
    cardMeta: {
      ...TavariStyles.typography.body,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.xs,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
    },
    statusBadge: {
      display: 'inline-flex',
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.full,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      backgroundColor: `${TavariStyles.colors.success}20`,
      color: TavariStyles.colors.success
    },
    cardActions: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.sm,
      marginTop: TavariStyles.spacing.md
    },
    playlistButton: {
      ...TavariStyles.components.button.primary,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    actionButton: {
      ...TavariStyles.components.button.secondary,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`
    },
    emptyState: {
      textAlign: 'center',
      padding: TavariStyles.spacing['4xl'],
      color: TavariStyles.colors.gray600
    },
    waiverCard: {
      border: `2px solid ${TavariStyles.colors.primary}`,
      backgroundColor: `${TavariStyles.colors.primary}08`
    },
    waiverBadge: {
      display: 'inline-flex',
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.full,
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      backgroundColor: `${TavariStyles.colors.primary}20`,
      color: TavariStyles.colors.primary,
      marginBottom: TavariStyles.spacing.sm
    },
    waiverHint: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      lineHeight: 1.45,
      margin: `${TavariStyles.spacing.sm} 0 0`
    }
  };

  const regularSchedules = schedules.filter((s) => !isWaiverKioskSchedule(s));
  const waiverSchedule = schedules.find((s) => isWaiverKioskSchedule(s));

  const renderScheduleCard = (schedule, { isWaiver = false } = {}) => (
    <div key={schedule.id} style={{ ...styles.card, ...(isWaiver ? styles.waiverCard : {}) }}>
      <div style={styles.cardHeader}>
        <h3 style={styles.cardTitle}>{schedule.schedule_name}</h3>
        <div style={styles.statusBadge}>
          {schedule.is_active ? 'Active' : 'Inactive'}
        </div>
      </div>

      {isWaiver ? (
        <>
          <span style={styles.waiverBadge}>Default · All waiver kiosks</span>
          <p style={styles.waiverHint}>
            Idle/attract images on waiver signing kiosks. Add content from the library — play start and
            end dates on each item control when it appears.
          </p>
        </>
      ) : (
        <>
          <div style={styles.cardMeta}>
            <FiClock />
            {formatScheduleTime(schedule)}
          </div>
          <div style={styles.cardMeta}>
            <FiCalendar />
            {formatDaysOfWeek(schedule.days_of_week)}
          </div>
          {schedule.apply_to_screens && schedule.apply_to_screens.length > 0 && (
            <div style={styles.cardMeta}>
              <FiMonitor />
              {schedule.apply_to_screens.length} screen(s)
            </div>
          )}
        </>
      )}

      <div style={styles.cardMeta}>
        <FiList />
        {getPlaylistCount(schedule)} content item(s) in playlist
      </div>

      {canEdit && (
        <div style={styles.cardActions}>
          <button
            type="button"
            style={styles.playlistButton}
            onClick={() => setPlaylistSchedule(schedule)}
          >
            <FiList /> Manage Playlist
          </button>
          {!isWaiver && (
            <>
              <button
                type="button"
                style={styles.actionButton}
                onClick={() => setSelectedSchedule(schedule)}
              >
                <FiEdit /> Edit
              </button>
              {canDelete && (
                <button
                  type="button"
                  style={{ ...styles.actionButton, color: TavariStyles.colors.danger }}
                  onClick={async () => {
                    if (window.confirm('Are you sure you want to delete this schedule?')) {
                      try {
                        await deleteSchedule(schedule.id);
                        toast.success('Schedule deleted successfully');
                      } catch (err) {
                        toast.error(err?.message || `Failed to delete schedule`);
                      }
                    }
                  }}
                >
                  <FiTrash2 /> Delete
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );

  const contentView = (
    <div style={styles.container}>
            <div style={styles.header}>
              <h1 style={styles.title}>
                <FiCalendar style={{ marginRight: TavariStyles.spacing.sm, verticalAlign: 'middle' }} />
                Schedules
              </h1>
              {canCreate && (
                <button
                  style={styles.button}
                  onClick={() => setShowCreateModal(true)}
                >
                  <FiPlus /> Create Schedule
                </button>
              )}
            </div>

            {loading && <div>Loading schedules...</div>}
            {error && <div style={{ color: TavariStyles.colors.danger }}>Error: {error}</div>}

            {!loading && schedules.length === 0 && (
              <div style={styles.emptyState}>
                <FiCalendar size={64} style={{ marginBottom: TavariStyles.spacing.lg, opacity: 0.3 }} />
                <h3>No schedules yet</h3>
                <p>The Waiver Kiosks schedule will appear automatically when schedules load.</p>
              </div>
            )}

            {!loading && schedules.length > 0 && (
              <>
                <div style={styles.grid}>
                  {waiverSchedule ? renderScheduleCard(waiverSchedule, { isWaiver: true }) : null}
                  {regularSchedules.map((schedule) => renderScheduleCard(schedule))}
                </div>
                {waiverSchedule && regularSchedules.length === 0 && canCreate && (
                  <div style={{ ...styles.emptyState, paddingTop: TavariStyles.spacing.xl }}>
                    <p style={{ margin: 0 }}>
                      Create additional schedules to assign content to digital signage screens.
                    </p>
                    <button
                      style={{ ...styles.button, marginTop: TavariStyles.spacing.lg }}
                      onClick={() => setShowCreateModal(true)}
                    >
                      <FiPlus /> Create Screen Schedule
                    </button>
                  </div>
                )}
              </>
            )}

            {(showCreateModal || selectedSchedule) && (
              <ScheduleFormModal
                schedule={selectedSchedule}
                onClose={closeScheduleModal}
                onSubmit={selectedSchedule ? handleUpdate : handleCreate}
                screens={screens}
                checkConflicts={checkScheduleConflicts}
              />
            )}

            {playlistSchedule && (
              <SchedulePlaylistModal
                schedule={playlistSchedule}
                contentLibrary={content}
                loadScheduleItems={loadScheduleItems}
                onSave={handleSavePlaylist}
                onClose={() => setPlaylistSchedule(null)}
              />
            )}
    </div>
  );

  if (embedded) {
    return contentView;
  }

  return (
    <SecurityWrapper>
      <POSAuthWrapper>
        <PermissionGate permission="digital_signage.schedules.view">
          {contentView}
        </PermissionGate>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default ScheduleManagementScreen;

