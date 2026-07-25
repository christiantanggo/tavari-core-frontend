// src/screens/DigitalSignage/AdManagementScreen.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { FiImage, FiPlus, FiTrash2, FiEye, FiEyeOff, FiCalendar } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import useDigitalSignage from '../../hooks/useDigitalSignage';
import AdFormModal from '../../components/DigitalSignage/AdFormModal';
import KioskAdScheduleModal from '../../components/DigitalSignage/KioskAdScheduleModal';
import WaiverSettingsService from '../../services/Waivers/WaiverSettingsService';
import { supabase } from '../../supabaseClient';
import { formatKioskAdScheduleSummary } from '../../utils/kioskIdleAdSchedule';
import { resolveDigitalSignagePreviewUrlMap } from '../../utils/digitalSignageContentUrl';
import toast from 'react-hot-toast';
import {
  clampKioskAdSlideSeconds,
  DEFAULT_KIOSK_AD_SLIDE_SECONDS,
  MIN_KIOSK_AD_SLIDE_SECONDS,
  MAX_KIOSK_AD_SLIDE_SECONDS
} from '../../constants/waiverKioskIdleAds';

const KIOSK_AD_FOLDER = 'waiver-kiosk-ads';
const KIOSK_AD_TAG = 'waiver-kiosk-ad';

const AdManagementScreen = ({ embedded = false }) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [scheduleModalAd, setScheduleModalAd] = useState(null);
  const [businessTimezone, setBusinessTimezone] = useState('America/Toronto');
  const [thumbByAdId, setThumbByAdId] = useState({});
  const [kioskSlideInput, setKioskSlideInput] = useState(String(DEFAULT_KIOSK_AD_SLIDE_SECONDS));
  const [kioskSlideLoading, setKioskSlideLoading] = useState(false);

  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'AdManagementScreen'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();
  const {
    ads,
    loading,
    error,
    loadAds,
    uploadContent,
    createAd,
    updateAd,
    deleteAd
  } = useDigitalSignage();

  useEffect(() => {
    if (!auth.selectedBusinessId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('businesses')
        .select('timezone')
        .eq('id', auth.selectedBusinessId)
        .maybeSingle();
      if (cancelled) return;
      if (!error && data?.timezone) {
        setBusinessTimezone(String(data.timezone).trim());
      } else {
        setBusinessTimezone('America/Toronto');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.selectedBusinessId]);

  useEffect(() => {
    if (auth.selectedBusinessId) {
      loadAds();
    }
  }, [auth.selectedBusinessId, loadAds]);

  useEffect(() => {
    if (!auth.selectedBusinessId) return;
    let cancelled = false;
    (async () => {
      try {
        WaiverSettingsService.setBusinessId(auth.selectedBusinessId);
        const s = await WaiverSettingsService.getGlobalSettings();
        if (!cancelled) {
          const v = clampKioskAdSlideSeconds(
            s?.waiver_kiosk_ad_slide_seconds ?? DEFAULT_KIOSK_AD_SLIDE_SECONDS
          );
          setKioskSlideInput(String(v));
        }
      } catch (e) {
        console.error('[AdManagementScreen] kiosk slide setting load:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.selectedBusinessId]);

  const canManage = hasPermission('digital_signage.ads.edit') || hasElevatedPrivileges();

  const kioskAds = useMemo(() => {
    return (ads || []).filter((ad) => {
      const folderPath = ad?.content?.folder_path;
      const tags = Array.isArray(ad?.content?.tags) ? ad.content.tags : [];
      return folderPath === KIOSK_AD_FOLDER || tags.includes(KIOSK_AD_TAG);
    });
  }, [ads]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await resolveDigitalSignagePreviewUrlMap(kioskAds, {
        getContent: (ad) => ad?.content,
        getId: (ad) => ad.id
      });
      if (!cancelled) setThumbByAdId(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [kioskAds]);

  const handleCreate = async ({ name, isActive, file }) => {
    try {
      const uploadedContent = await uploadContent(file, {
        name,
        contentType: 'image',
        folderPath: KIOSK_AD_FOLDER,
        tags: [KIOSK_AD_TAG]
      });

      await createAd({
        name,
        type: 'local',
        contentId: uploadedContent.id,
        status: isActive ? 'active' : 'draft'
      });

      setShowCreateModal(false);
    } catch (err) {
      console.error('Failed to upload kiosk image:', err);
    }
  };

  const handleDelete = async (adId) => {
    if (!window.confirm('Delete this kiosk image?')) return;

    try {
      await deleteAd(adId);
    } catch (err) {
      console.error('Failed to delete kiosk image:', err);
    }
  };

  const handleToggleVisibility = async (ad) => {
    try {
      await updateAd(ad.id, { status: ad.status === 'active' ? 'draft' : 'active' });
    } catch (err) {
      console.error('Failed to update kiosk image:', err);
    }
  };

  const handleSaveSchedule = async (adId, payload) => {
    await updateAd(adId, payload);
  };

  const handleSaveKioskSlideSeconds = async () => {
    if (!auth.selectedBusinessId) return;
    const parsed = parseInt(String(kioskSlideInput).trim(), 10);
    const v = clampKioskAdSlideSeconds(Number.isFinite(parsed) ? parsed : DEFAULT_KIOSK_AD_SLIDE_SECONDS);
    setKioskSlideLoading(true);
    try {
      WaiverSettingsService.setBusinessId(auth.selectedBusinessId);
      await WaiverSettingsService.updateSetting('waiver_kiosk_ad_slide_seconds', v);
      setKioskSlideInput(String(v));
      toast.success('Time between slides saved for waiver kiosks.');
    } catch (err) {
      console.error(err);
      toast.error(err?.message || 'Could not save slide timing.');
    } finally {
      setKioskSlideLoading(false);
    }
  };

  const getStatusColor = (status) => {
    return status === 'active' ? TavariStyles.colors.success : TavariStyles.colors.gray500;
  };

  const styles = {
    container: {
      width: '100%',
      padding: embedded ? 0 : TavariStyles.spacing.xl
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.xl
    },
    headingBlock: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    title: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      margin: 0
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray600,
      lineHeight: 1.5,
      margin: 0
    },
    button: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius.md,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.lg}`,
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      whiteSpace: 'nowrap'
    },
    helperCard: {
      backgroundColor: TavariStyles.colors.gray50,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius.lg,
      padding: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.lg
    },
    helperText: {
      margin: 0,
      color: TavariStyles.colors.gray700,
      fontSize: TavariStyles.typography.fontSize.base,
      lineHeight: 1.5
    },
    timingCard: {
      backgroundColor: TavariStyles.colors.white,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius.lg,
      padding: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.lg,
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'flex-end',
      gap: TavariStyles.spacing.md
    },
    timingLabel: {
      display: 'block',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.xs
    },
    timingInput: {
      width: '100px',
      padding: TavariStyles.spacing.sm,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      fontSize: TavariStyles.typography.fontSize.base
    },
    timingHint: {
      margin: 0,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      flex: '1 1 220px',
      lineHeight: 1.45
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
      gap: TavariStyles.spacing.lg
    },
    card: {
      backgroundColor: TavariStyles.colors.white,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius.lg,
      boxShadow: TavariStyles.shadows.sm,
      overflow: 'hidden'
    },
    cardBody: {
      padding: TavariStyles.spacing.lg
    },
    cardTopRow: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.sm
    },
    cardTextCol: {
      flex: '1 1 auto',
      minWidth: 0,
      textAlign: 'left'
    },
    cardThumb: {
      flexShrink: 0,
      width: '88px',
      height: '88px',
      borderRadius: TavariStyles.borderRadius.md,
      objectFit: 'cover',
      backgroundColor: TavariStyles.colors.gray100,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    cardThumbPlaceholder: {
      flexShrink: 0,
      width: '88px',
      height: '88px',
      borderRadius: TavariStyles.borderRadius.md,
      backgroundColor: TavariStyles.colors.gray100,
      border: `1px dashed ${TavariStyles.colors.gray300}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: TavariStyles.colors.gray400
    },
    cardHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.xs
    },
    cardTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      margin: 0
    },
    statusBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.full,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    cardMeta: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      margin: 0
    },
    cardScheduleLine: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray700,
      margin: `${TavariStyles.spacing.xs} 0 0 0`,
      lineHeight: 1.45
    },
    cardActions: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.sm,
      marginTop: TavariStyles.spacing.md
    },
    secondaryButton: {
      flex: '1 1 100px',
      minWidth: '88px',
      backgroundColor: TavariStyles.colors.gray100,
      color: TavariStyles.colors.gray700,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.md,
      cursor: 'pointer',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      fontSize: TavariStyles.typography.fontSize.base,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TavariStyles.spacing.xs
    },
    dangerButton: {
      flex: '1 1 100px',
      minWidth: '88px',
      backgroundColor: TavariStyles.colors.errorBg,
      color: TavariStyles.colors.errorText,
      border: `1px solid ${TavariStyles.colors.errorBg}`,
      borderRadius: TavariStyles.borderRadius.md,
      cursor: 'pointer',
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      fontSize: TavariStyles.typography.fontSize.base,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TavariStyles.spacing.xs
    },
    emptyState: {
      textAlign: 'center',
      padding: TavariStyles.spacing['4xl'],
      color: TavariStyles.colors.gray600,
      backgroundColor: TavariStyles.colors.gray50,
      border: `1px dashed ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.lg
    }
  };

  const contentView = (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headingBlock}>
          <h1 style={styles.title}>
            <FiImage />
            Waiver Kiosk Images
          </h1>
          <p style={styles.subtitle}>
            Upload images for the waiver kiosks to display between guest uses.
          </p>
        </div>

        {canManage ? (
          <button style={styles.button} onClick={() => setShowCreateModal(true)}>
            <FiPlus />
            Upload Image
          </button>
        ) : null}
      </div>

      <div style={styles.helperCard}>
        <p style={styles.helperText}>
          This tab is now a simple image manager. Upload an image, decide whether it should
          be visible right away, and remove it when you no longer want it shown.
        </p>
      </div>

      <div style={styles.timingCard}>
        <div>
          <label htmlFor="waiverKioskSlideSeconds" style={styles.timingLabel}>
            Seconds between slides (attract screen)
          </label>
          <input
            id="waiverKioskSlideSeconds"
            type="number"
            min={MIN_KIOSK_AD_SLIDE_SECONDS}
            max={MAX_KIOSK_AD_SLIDE_SECONDS}
            value={kioskSlideInput}
            onChange={(e) => setKioskSlideInput(e.target.value)}
            style={styles.timingInput}
            disabled={!canManage || kioskSlideLoading}
          />
        </div>
        {canManage ? (
          <button
            type="button"
            style={styles.button}
            onClick={handleSaveKioskSlideSeconds}
            disabled={kioskSlideLoading}
          >
            {kioskSlideLoading ? 'Saving…' : 'Save timing'}
          </button>
        ) : null}
        <p style={styles.timingHint}>
          Used on waiver kiosks when multiple images are active. Guests can also use arrows and
          dots on the attract screen. Allowed range: {MIN_KIOSK_AD_SLIDE_SECONDS}–
          {MAX_KIOSK_AD_SLIDE_SECONDS} seconds.
        </p>
      </div>

      {loading ? <div>Loading kiosk images...</div> : null}
      {error ? <div style={{ color: TavariStyles.colors.danger }}>Error: {error}</div> : null}

      {!loading && kioskAds.length === 0 ? (
        <div style={styles.emptyState}>
          <FiImage size={54} style={{ marginBottom: TavariStyles.spacing.md, opacity: 0.35 }} />
          <h3>No kiosk images uploaded yet</h3>
          <p>Upload an image and it will be available for the waiver kiosks.</p>
        </div>
      ) : null}

      {!loading && kioskAds.length > 0 ? (
        <div style={styles.grid}>
          {kioskAds.map((ad) => (
            <div key={ad.id} style={styles.card}>
              <div style={styles.cardBody}>
                <div style={styles.cardTopRow}>
                  <div style={styles.cardTextCol}>
                    <div style={styles.cardHeader}>
                      <h3 style={styles.cardTitle}>{ad.ad_name}</h3>
                      <span
                        style={{
                          ...styles.statusBadge,
                          color: getStatusColor(ad.status),
                          backgroundColor: `${getStatusColor(ad.status)}20`
                        }}
                      >
                        {ad.status === 'active' ? 'Visible' : 'Hidden'}
                      </span>
                    </div>
                    <p style={styles.cardMeta}>
                      Uploaded{' '}
                      {new Date(ad.created_at).toLocaleString('en-CA', {
                        timeZone: businessTimezone,
                        dateStyle: 'medium',
                        timeStyle: 'short'
                      })}
                    </p>
                    <p style={styles.cardScheduleLine}>
                      <strong>Schedule:</strong> {formatKioskAdScheduleSummary(ad)}
                    </p>
                  </div>
                  {thumbByAdId[ad.id] ? (
                    <img
                      src={thumbByAdId[ad.id]}
                      alt=""
                      style={styles.cardThumb}
                      draggable={false}
                    />
                  ) : (
                    <div style={styles.cardThumbPlaceholder} aria-hidden>
                      <FiImage size={28} />
                    </div>
                  )}
                </div>

                {canManage ? (
                  <div style={styles.cardActions}>
                    <button
                      type="button"
                      style={styles.secondaryButton}
                      onClick={() => handleToggleVisibility(ad)}
                    >
                      {ad.status === 'active' ? <FiEyeOff /> : <FiEye />}
                      {ad.status === 'active' ? 'Hide' : 'Show'}
                    </button>
                    <button
                      type="button"
                      style={styles.secondaryButton}
                      onClick={() => setScheduleModalAd(ad)}
                    >
                      <FiCalendar />
                      Schedule
                    </button>
                    <button
                      type="button"
                      style={styles.dangerButton}
                      onClick={() => handleDelete(ad.id)}
                    >
                      <FiTrash2 />
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {showCreateModal ? (
        <AdFormModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreate}
        />
      ) : null}

      {scheduleModalAd ? (
        <KioskAdScheduleModal
          ad={scheduleModalAd}
          businessTimezone={businessTimezone}
          onClose={() => setScheduleModalAd(null)}
          onSave={handleSaveSchedule}
        />
      ) : null}
    </div>
  );

  if (embedded) {
    return contentView;
  }

  return (
    <SecurityWrapper>
      <POSAuthWrapper>
        <PermissionGate permission="digital_signage.ads.view">
          {contentView}
        </PermissionGate>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default AdManagementScreen;



