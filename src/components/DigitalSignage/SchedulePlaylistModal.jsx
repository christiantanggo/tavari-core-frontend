// Assign content to a schedule playlist (playback order)

import React, { useEffect, useMemo, useState } from 'react';

import { FiArrowDown, FiArrowUp, FiImage, FiPlus, FiSearch, FiTrash2, FiVideo, FiX } from 'react-icons/fi';

import { TavariStyles } from '../../utils/TavariStyles';

import { resolveDigitalSignagePreviewUrlMap } from '../../utils/digitalSignageContentUrl';
import TavariCheckbox from '../UI/TavariCheckbox';
import { getDigitalSignageModalStyles } from './digitalSignageModalStyles';



const DEFAULT_SLIDE_SECONDS = 8;



function mapLoadedItem(row) {

  const content = row.content || {};

  const fallbackDuration = content.duration_seconds || DEFAULT_SLIDE_SECONDS;

  return {

    key: row.id || `${row.content_id}-${row.display_order}`,

    contentId: row.content_id,

    contentName: content.content_name || 'Untitled',

    contentType: content.content_type || 'image',

    durationSeconds: row.duration_seconds ?? fallbackDuration

  };

}



function contentIcon(type) {

  if (type === 'video') return <FiVideo />;

  return <FiImage />;

}



function ContentPreviewThumb({ item, previewUrl, style }) {

  if (item.content_type === 'image' && previewUrl) {

    return <img src={previewUrl} alt={item.content_name} style={style} />;

  }

  if (item.content_type === 'video' && previewUrl) {

    return (

      <video

        src={previewUrl}

        muted

        playsInline

        preload="metadata"

        style={style}

      />

    );

  }

  return (

    <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>

      {contentIcon(item.content_type)}

    </div>

  );

}



/**

 * @param {{ schedule: object, contentLibrary?: Array, loadScheduleItems: function, onSave: function, onClose: function }} props

 */

const SchedulePlaylistModal = ({

  schedule,

  contentLibrary = [],

  loadScheduleItems,

  onSave,

  onClose

}) => {

  const [items, setItems] = useState([]);

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  const [librarySearch, setLibrarySearch] = useState('');

  const [shufflePlaylist, setShufflePlaylist] = useState(() => !!schedule?.shuffle_playlist);

  const [thumbByContentId, setThumbByContentId] = useState({});



  const activeLibrary = useMemo(

    () => (contentLibrary || []).filter((c) => c.is_active !== false),

    [contentLibrary]

  );



  useEffect(() => {

    let cancelled = false;

    (async () => {

      const next = await resolveDigitalSignagePreviewUrlMap(activeLibrary);

      if (!cancelled) setThumbByContentId(next);

    })();

    return () => {

      cancelled = true;

    };

  }, [activeLibrary]);



  useEffect(() => {

    let cancelled = false;

    (async () => {

      if (!schedule?.id) return;

      setLoading(true);

      try {

        const rows = await loadScheduleItems(schedule.id);

        if (!cancelled) {

          setItems((rows || []).map(mapLoadedItem));

        }

      } catch (err) {

        console.error(err);

      } finally {

        if (!cancelled) setLoading(false);

      }

    })();

    return () => {

      cancelled = true;

    };

  }, [schedule?.id, loadScheduleItems]);



  useEffect(() => {

    setShufflePlaylist(!!schedule?.shuffle_playlist);

  }, [schedule?.id, schedule?.shuffle_playlist]);



  const usedContentIds = useMemo(() => new Set(items.map((i) => i.contentId)), [items]);



  const filteredLibrary = useMemo(() => {

    const q = librarySearch.trim().toLowerCase();

    if (!q) return activeLibrary;

    return activeLibrary.filter((c) => {

      const name = String(c.content_name || '').toLowerCase();

      const type = String(c.content_type || '').toLowerCase();

      return name.includes(q) || type.includes(q);

    });

  }, [activeLibrary, librarySearch]);



  const base = getDigitalSignageModalStyles({ maxWidth: '1180px' });

  const styles = {

    ...base,

    body: {

      ...base.body,

      display: 'flex',

      flexDirection: 'column',

      minHeight: 0,

      overflow: 'hidden'

    },

    form: {

      ...base.form,

      flex: '1 1 auto',

      minHeight: 0,

      gap: 0

    },

    columns: {

      display: 'grid',

      gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',

      gap: TavariStyles.spacing.lg,

      flex: '1 1 auto',

      minHeight: 0,

      alignItems: 'stretch'

    },

    column: {

      display: 'flex',

      flexDirection: 'column',

      minHeight: 0,

      minWidth: 0,

      border: `1px solid ${TavariStyles.colors.gray200}`,

      borderRadius: TavariStyles.borderRadius.md,

      backgroundColor: TavariStyles.colors.gray50,

      overflow: 'hidden'

    },

    columnHeader: {

      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,

      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,

      backgroundColor: TavariStyles.colors.white,

      flexShrink: 0

    },

    columnTitle: {

      margin: 0,

      fontSize: TavariStyles.typography.fontSize.base,

      fontWeight: TavariStyles.typography.fontWeight.semibold,

      color: TavariStyles.colors.gray800

    },

    columnHint: {

      margin: `${TavariStyles.spacing.xs} 0 0`,

      fontSize: TavariStyles.typography.fontSize.xs,

      color: TavariStyles.colors.gray600,

      lineHeight: 1.4

    },

    shuffleRow: {

      marginTop: TavariStyles.spacing.sm,

      paddingTop: TavariStyles.spacing.sm,

      borderTop: `1px solid ${TavariStyles.colors.gray200}`

    },

    columnScroll: {

      flex: '1 1 auto',

      minHeight: 0,

      overflowY: 'auto',

      padding: TavariStyles.spacing.md

    },

    searchWrap: {

      display: 'flex',

      alignItems: 'center',

      gap: TavariStyles.spacing.sm,

      marginTop: TavariStyles.spacing.sm

    },

    searchInput: {

      ...base.input,

      flex: 1,

      margin: 0

    },

    libraryGrid: {

      display: 'grid',

      gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',

      gap: TavariStyles.spacing.sm

    },

    libraryCard: {

      display: 'flex',

      flexDirection: 'column',

      border: `1px solid ${TavariStyles.colors.gray200}`,

      borderRadius: TavariStyles.borderRadius.md,

      backgroundColor: TavariStyles.colors.white,

      overflow: 'hidden',

      cursor: 'pointer',

      textAlign: 'left',

      padding: 0,

      transition: 'border-color 0.15s, box-shadow 0.15s'

    },

    libraryCardDisabled: {

      cursor: 'default',

      opacity: 0.55

    },

    libraryThumb: {

      width: '100%',

      aspectRatio: '16 / 10',

      objectFit: 'cover',

      backgroundColor: TavariStyles.colors.gray100,

      display: 'block'

    },

    libraryCardBody: {

      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,

      position: 'relative'

    },

    libraryCardTitle: {

      margin: 0,

      fontSize: TavariStyles.typography.fontSize.xs,

      fontWeight: TavariStyles.typography.fontWeight.medium,

      color: TavariStyles.colors.gray800,

      overflow: 'hidden',

      textOverflow: 'ellipsis',

      whiteSpace: 'nowrap'

    },

    libraryCardMeta: {

      margin: `${TavariStyles.spacing.xs} 0 0`,

      fontSize: '13px',

      color: TavariStyles.colors.gray500,

      textTransform: 'capitalize'

    },

    addBadge: {

      position: 'absolute',

      top: TavariStyles.spacing.xs,

      right: TavariStyles.spacing.xs,

      width: '22px',

      height: '22px',

      borderRadius: TavariStyles.borderRadius.full,

      backgroundColor: TavariStyles.colors.primary,

      color: TavariStyles.colors.white,

      display: 'flex',

      alignItems: 'center',

      justifyContent: 'center',

      boxShadow: TavariStyles.shadows.sm

    },

    inPlaylistBadge: {

      marginTop: TavariStyles.spacing.xs,

      fontSize: '13px',

      fontWeight: TavariStyles.typography.fontWeight.semibold,

      color: TavariStyles.colors.success || '#059669'

    },

    playlist: {

      display: 'flex',

      flexDirection: 'column',

      gap: TavariStyles.spacing.sm

    },

    playlistItem: {

      display: 'grid',

      gridTemplateColumns: 'auto 56px 1fr auto auto',

      gap: TavariStyles.spacing.sm,

      alignItems: 'center',

      padding: TavariStyles.spacing.sm,

      border: `1px solid ${TavariStyles.colors.gray200}`,

      borderRadius: TavariStyles.borderRadius.md,

      backgroundColor: TavariStyles.colors.white

    },

    playlistThumb: {

      width: '56px',

      height: '36px',

      objectFit: 'cover',

      borderRadius: TavariStyles.borderRadius.sm,

      backgroundColor: TavariStyles.colors.gray100

    },

    orderBadge: {

      width: '24px',

      height: '24px',

      borderRadius: TavariStyles.borderRadius.full,

      backgroundColor: TavariStyles.colors.gray100,

      color: TavariStyles.colors.gray700,

      display: 'flex',

      alignItems: 'center',

      justifyContent: 'center',

      fontSize: TavariStyles.typography.fontSize.xs,

      fontWeight: TavariStyles.typography.fontWeight.semibold,

      flexShrink: 0

    },

    itemTitle: {

      fontSize: TavariStyles.typography.fontSize.sm,

      fontWeight: TavariStyles.typography.fontWeight.medium,

      color: TavariStyles.colors.gray800,

      margin: 0,

      overflow: 'hidden',

      textOverflow: 'ellipsis',

      whiteSpace: 'nowrap'

    },

    itemMeta: {

      fontSize: TavariStyles.typography.fontSize.xs,

      color: TavariStyles.colors.gray600,

      margin: `${TavariStyles.spacing.xs} 0 0`,

      display: 'flex',

      alignItems: 'center',

      gap: TavariStyles.spacing.xs,

      textTransform: 'capitalize'

    },

    durationWrap: {

      display: 'flex',

      flexDirection: 'column',

      gap: '2px',

      minWidth: '72px'

    },

    durationLabel: {

      fontSize: '13px',

      color: TavariStyles.colors.gray600,

      fontWeight: TavariStyles.typography.fontWeight.medium

    },

    durationInput: {

      ...base.input,

      width: '72px',

      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,

      fontSize: TavariStyles.typography.fontSize.sm

    },

    iconBtn: {

      ...base.buttonSecondary,

      padding: TavariStyles.spacing.xs,

      minWidth: '32px',

      height: '32px',

      display: 'inline-flex',

      alignItems: 'center',

      justifyContent: 'center'

    },

    itemActions: {

      display: 'flex',

      gap: '4px',

      alignItems: 'center'

    },

    emptyColumn: {

      textAlign: 'center',

      padding: TavariStyles.spacing.xl,

      color: TavariStyles.colors.gray600,

      fontSize: TavariStyles.typography.fontSize.sm,

      lineHeight: 1.5

    },

    actions: {

      ...base.actions,

      flexShrink: 0,

      marginTop: TavariStyles.spacing.lg

    }

  };



  const handleAddContent = (picked) => {

    if (!picked?.id || usedContentIds.has(picked.id)) return;

    setItems((prev) => [

      ...prev,

      {

        key: `new-${picked.id}-${Date.now()}`,

        contentId: picked.id,

        contentName: picked.content_name,

        contentType: picked.content_type,

        durationSeconds: picked.duration_seconds || DEFAULT_SLIDE_SECONDS

      }

    ]);

  };



  const moveItem = (index, direction) => {

    setItems((prev) => {

      const next = [...prev];

      const target = index + direction;

      if (target < 0 || target >= next.length) return prev;

      [next[index], next[target]] = [next[target], next[index]];

      return next;

    });

  };



  const removeItem = (index) => {

    setItems((prev) => prev.filter((_, i) => i !== index));

  };



  const updateDuration = (index, value) => {

    const parsed = parseInt(value, 10);

    setItems((prev) =>

      prev.map((item, i) =>

        i === index

          ? { ...item, durationSeconds: Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SLIDE_SECONDS }

          : item

      )

    );

  };



  const handleSubmit = async (e) => {

    e.preventDefault();

    if (!schedule?.id) return;

    setSaving(true);

    try {

      await onSave(

        schedule.id,

        items.map(({ contentId, durationSeconds }) => ({

          contentId,

          durationSeconds: durationSeconds || null

        })),

        { shufflePlaylist }

      );

      onClose();

    } catch (err) {

      console.error(err);

    } finally {

      setSaving(false);

    }

  };



  if (!schedule) return null;



  return (

    <div style={styles.overlay} onClick={onClose}>

      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>

        <div style={styles.header}>

          <div style={styles.headerText}>

            <h2 style={styles.title}>Playlist: {schedule.schedule_name}</h2>

            <p style={styles.subtitle}>

              Build the playlist on the left and add content from the library on the right. When shuffle is enabled,

              screens play items in random order instead of the list order below.

            </p>

          </div>

          <button type="button" style={styles.closeButton} onClick={onClose} aria-label="Close">

            <FiX />

          </button>

        </div>



        <div style={styles.body}>

          <form style={styles.form} onSubmit={handleSubmit}>

            <div style={styles.columns}>

              <div style={styles.column}>

                <div style={styles.columnHeader}>

                  <h3 style={styles.columnTitle}>Playlist ({items.length})</h3>

                  <p style={styles.columnHint}>

                    {shufflePlaylist

                      ? 'Order below is for reference only — screens shuffle playback randomly.'

                      : 'Use arrows to set playback order. Set seconds per slide (default 8).'}

                  </p>

                  <div style={styles.shuffleRow}>

                    <TavariCheckbox

                      id="schedule-playlist-shuffle"

                      checked={shufflePlaylist}

                      onChange={(checked) => setShufflePlaylist(checked)}

                      label="Shuffle playback (random order on screens)"

                    />

                  </div>

                </div>

                <div style={styles.columnScroll}>

                  {loading ? (

                    <p style={styles.emptyColumn}>Loading playlist…</p>

                  ) : items.length === 0 ? (

                    <div style={styles.emptyColumn}>

                      <p style={{ margin: 0 }}>No content yet.</p>

                      <p style={{ margin: `${TavariStyles.spacing.sm} 0 0` }}>

                        Click items in the library on the right to add them.

                      </p>

                    </div>

                  ) : (

                    <div style={styles.playlist}>

                      {items.map((item, index) => {

                        const libRow = activeLibrary.find((c) => c.id === item.contentId);

                        const previewUrl = thumbByContentId[item.contentId];

                        return (

                          <div key={item.key} style={styles.playlistItem}>

                            <span style={styles.orderBadge}>{index + 1}</span>

                            {libRow ? (

                              <ContentPreviewThumb

                                item={libRow}

                                previewUrl={previewUrl}

                                style={styles.playlistThumb}

                              />

                            ) : (

                              <div style={styles.playlistThumb}>{contentIcon(item.contentType)}</div>

                            )}

                            <div style={{ minWidth: 0 }}>

                              <p style={styles.itemTitle}>{item.contentName}</p>

                              <p style={styles.itemMeta}>

                                {contentIcon(item.contentType)}

                                {item.contentType}

                              </p>

                            </div>

                            <div style={styles.durationWrap}>

                              <span style={styles.durationLabel}>Sec</span>

                              <input

                                type="number"

                                min="1"

                                max="600"

                                style={styles.durationInput}

                                value={item.durationSeconds}

                                onChange={(e) => updateDuration(index, e.target.value)}

                              />

                            </div>

                            <div style={styles.itemActions}>

                              <button

                                type="button"

                                style={styles.iconBtn}

                                onClick={() => moveItem(index, -1)}

                                disabled={shufflePlaylist || index === 0}

                                aria-label="Move up"

                              >

                                <FiArrowUp />

                              </button>

                              <button

                                type="button"

                                style={styles.iconBtn}

                                onClick={() => moveItem(index, 1)}

                                disabled={shufflePlaylist || index === items.length - 1}

                                aria-label="Move down"

                              >

                                <FiArrowDown />

                              </button>

                              <button

                                type="button"

                                style={{ ...styles.iconBtn, color: TavariStyles.colors.danger }}

                                onClick={() => removeItem(index)}

                                aria-label="Remove"

                              >

                                <FiTrash2 />

                              </button>

                            </div>

                          </div>

                        );

                      })}

                    </div>

                  )}

                </div>

              </div>



              <div style={styles.column}>

                <div style={styles.columnHeader}>

                  <h3 style={styles.columnTitle}>Content library ({activeLibrary.length})</h3>

                  <p style={styles.columnHint}>Click a tile to add it to the playlist.</p>

                  <div style={styles.searchWrap}>

                    <FiSearch style={{ color: TavariStyles.colors.gray400, flexShrink: 0 }} />

                    <input

                      type="search"

                      style={styles.searchInput}

                      placeholder="Search content…"

                      value={librarySearch}

                      onChange={(e) => setLibrarySearch(e.target.value)}

                    />

                  </div>

                </div>

                <div style={styles.columnScroll}>

                  {activeLibrary.length === 0 ? (

                    <div style={styles.emptyColumn}>

                      <p style={{ margin: 0 }}>No content uploaded yet.</p>

                      <p style={{ margin: `${TavariStyles.spacing.sm} 0 0` }}>

                        Upload content in the Content tab first.

                      </p>

                    </div>

                  ) : filteredLibrary.length === 0 ? (

                    <p style={styles.emptyColumn}>No content matches your search.</p>

                  ) : (

                    <div style={styles.libraryGrid}>

                      {filteredLibrary.map((c) => {

                        const inPlaylist = usedContentIds.has(c.id);

                        const previewUrl = thumbByContentId[c.id];

                        return (

                          <button

                            key={c.id}

                            type="button"

                            style={{

                              ...styles.libraryCard,

                              ...(inPlaylist ? styles.libraryCardDisabled : {})

                            }}

                            onClick={() => handleAddContent(c)}

                            disabled={inPlaylist}

                            title={inPlaylist ? `${c.content_name} (already in playlist)` : `Add ${c.content_name}`}

                          >

                            <ContentPreviewThumb

                              item={c}

                              previewUrl={previewUrl}

                              style={styles.libraryThumb}

                            />

                            <div style={styles.libraryCardBody}>

                              {!inPlaylist ? (

                                <span style={styles.addBadge} aria-hidden>

                                  <FiPlus size={14} />

                                </span>

                              ) : null}

                              <p style={styles.libraryCardTitle}>{c.content_name}</p>

                              <p style={styles.libraryCardMeta}>{c.content_type}</p>

                              {inPlaylist ? <span style={styles.inPlaylistBadge}>In playlist</span> : null}

                            </div>

                          </button>

                        );

                      })}

                    </div>

                  )}

                </div>

              </div>

            </div>



            <div style={styles.actions}>

              <button type="button" style={styles.buttonSecondary} onClick={onClose} disabled={saving}>

                Cancel

              </button>

              <button type="submit" style={styles.buttonPrimary} disabled={saving || loading}>

                {saving ? 'Saving…' : 'Save playlist'}

              </button>

            </div>

          </form>

        </div>

      </div>

    </div>

  );

};



export default SchedulePlaylistModal;

