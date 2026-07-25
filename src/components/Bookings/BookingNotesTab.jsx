import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FiEdit2, FiTrash2 } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import bookingService from '../../services/Bookings/BookingService';
import { TavariStyles } from '../../utils/TavariStyles';
import { formatDateTimeForBusiness } from '../../utils/businessDateFormat';
import SecurityUtils from '../../Security/SecurityUtils';

const cardStyle = {
  backgroundColor: 'white',
  padding: '24px',
  borderRadius: '12px',
  border: '1px solid #e5e7eb',
  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
};

const fieldLabelStyle = {
  fontSize: '13px',
  color: TavariStyles.colors.gray600,
  marginBottom: '6px',
  fontWeight: '600',
};

function resolveUserLabel(userId, userNames) {
  if (!userId) return 'Staff';
  return userNames[userId] || 'Staff user';
}

const BookingNotesTab = ({
  bookingId,
  businessId,
  businessTimezone,
  authUserId,
  canManageNotes,
  onNotesChanged,
}) => {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userNames, setUserNames] = useState({});
  const [newNoteText, setNewNoteText] = useState('');
  const [savingNew, setSavingNew] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [savingEditId, setSavingEditId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const loadNotes = useCallback(async () => {
    if (!bookingId || !businessId) return;
    setLoading(true);
    try {
      bookingService.setBusinessId(businessId);
      const rows = await bookingService.listBookingNotes(bookingId);
      setNotes(rows || []);
    } catch (error) {
      console.error('Error loading booking notes:', error);
      toast.error('Could not load notes');
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [bookingId, businessId]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const userIds = useMemo(() => {
    const ids = new Set();
    for (const note of notes) {
      if (note.created_by) ids.add(note.created_by);
      if (note.updated_by) ids.add(note.updated_by);
    }
    return [...ids];
  }, [notes]);

  useEffect(() => {
    if (!userIds.length) {
      setUserNames({});
      return undefined;
    }

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', userIds);

      if (cancelled) return;
      if (error) {
        console.warn('[BookingNotesTab] user lookup:', error.message);
        return;
      }

      const map = {};
      for (const user of data || []) {
        const fromName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
        map[user.id] = fromName || (user.email && String(user.email).trim()) || user.id;
      }
      setUserNames(map);
    })();

    return () => {
      cancelled = true;
    };
  }, [userIds]);

  const getAuditContext = async () => {
    let updatedIp = null;
    try {
      updatedIp = await SecurityUtils.getClientIP();
    } catch {
      updatedIp = null;
    }
    return {
      updatedBy: authUserId || null,
      updatedIp,
    };
  };

  const handleAddNote = async () => {
    const text = newNoteText.trim();
    if (!text) {
      toast.error('Enter a note before saving');
      return;
    }
    if (!canManageNotes) return;

    setSavingNew(true);
    try {
      const audit = await getAuditContext();
      await bookingService.createBookingNote(bookingId, text, authUserId, audit);
      setNewNoteText('');
      toast.success('Note added');
      await loadNotes();
      onNotesChanged?.();
    } catch (error) {
      console.error('Error adding booking note:', error);
      toast.error(error?.message || 'Could not save note');
    } finally {
      setSavingNew(false);
    }
  };

  const startEdit = (note) => {
    setEditingNoteId(note.id);
    setEditingText(note.note_text || '');
  };

  const cancelEdit = () => {
    setEditingNoteId(null);
    setEditingText('');
  };

  const handleSaveEdit = async (noteId) => {
    const text = editingText.trim();
    if (!text) {
      toast.error('Note cannot be empty');
      return;
    }

    setSavingEditId(noteId);
    try {
      const audit = await getAuditContext();
      await bookingService.updateBookingNote(noteId, text, authUserId, audit);
      cancelEdit();
      toast.success('Note updated');
      await loadNotes();
      onNotesChanged?.();
    } catch (error) {
      console.error('Error updating booking note:', error);
      toast.error(error?.message || 'Could not update note');
    } finally {
      setSavingEditId(null);
    }
  };

  const handleDelete = async (noteId) => {
    if (!window.confirm('Delete this note?')) return;

    setDeletingId(noteId);
    try {
      const audit = await getAuditContext();
      await bookingService.deleteBookingNote(noteId, authUserId, audit);
      if (editingNoteId === noteId) cancelEdit();
      toast.success('Note deleted');
      await loadNotes();
      onNotesChanged?.();
    } catch (error) {
      console.error('Error deleting booking note:', error);
      toast.error(error?.message || 'Could not delete note');
    } finally {
      setDeletingId(null);
    }
  };

  const canModifyNote = (note) => {
    if (!canManageNotes) return false;
    if (!authUserId) return false;
    return note.created_by === authUserId;
  };

  const renderMeta = (note) => {
    const author = resolveUserLabel(note.created_by, userNames);
    const createdAt = note.created_at
      ? formatDateTimeForBusiness(note.created_at, businessTimezone)
      : '—';
    const wasEdited = note.updated_at
      && note.created_at
      && new Date(note.updated_at).getTime() > new Date(note.created_at).getTime() + 1000;

    if (wasEdited) {
      const editor = resolveUserLabel(note.updated_by || note.created_by, userNames);
      const editedAt = formatDateTimeForBusiness(note.updated_at, businessTimezone);
      return `Added by ${author} · ${createdAt} · Edited by ${editor} · ${editedAt}`;
    }

    return `Added by ${author} · ${createdAt}`;
  };

  return (
    <div style={cardStyle}>
      <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '20px', marginTop: 0 }}>
        Notes
      </h2>

      {canManageNotes ? (
        <div style={{ marginBottom: '24px' }}>
          <div style={fieldLabelStyle}>Add a note</div>
          <textarea
            value={newNoteText}
            onChange={(event) => setNewNoteText(event.target.value)}
            rows={4}
            placeholder="Type a note for other staff…"
            style={{
              width: '100%',
              padding: '12px',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              fontSize: '14px',
              lineHeight: 1.5,
              resize: 'vertical',
              boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />
          <button
            type="button"
            onClick={handleAddNote}
            disabled={savingNew || !newNoteText.trim()}
            style={{
              marginTop: '10px',
              padding: '10px 18px',
              backgroundColor: newNoteText.trim() ? TavariStyles.colors.primary : '#d1d5db',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: savingNew || !newNoteText.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {savingNew ? 'Saving…' : 'Save note'}
          </button>
        </div>
      ) : null}

      {loading ? (
        <div style={{ color: TavariStyles.colors.gray600, fontSize: '14px' }}>Loading notes…</div>
      ) : notes.length === 0 ? (
        <div style={{ color: TavariStyles.colors.gray600, fontSize: '14px' }}>
          No notes on this booking yet.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '12px' }}>
          {notes.map((note) => {
            const isEditing = editingNoteId === note.id;
            const showActions = canModifyNote(note);

            return (
              <div
                key={note.id}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  padding: '14px',
                  backgroundColor: '#fafafa',
                }}
              >
                {isEditing ? (
                  <>
                    <textarea
                      value={editingText}
                      onChange={(event) => setEditingText(event.target.value)}
                      rows={4}
                      style={{
                        width: '100%',
                        padding: '10px',
                        border: '1px solid #d1d5db',
                        borderRadius: '8px',
                        fontSize: '14px',
                        lineHeight: 1.5,
                        resize: 'vertical',
                        boxSizing: 'border-box',
                        fontFamily: 'inherit',
                        marginBottom: '10px',
                      }}
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(note.id)}
                        disabled={savingEditId === note.id || !editingText.trim()}
                        style={{
                          padding: '8px 14px',
                          backgroundColor: TavariStyles.colors.primary,
                          color: '#fff',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {savingEditId === note.id ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        style={{
                          padding: '8px 14px',
                          backgroundColor: '#fff',
                          color: '#374151',
                          border: '1px solid #d1d5db',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div
                      style={{
                        fontSize: '14px',
                        color: TavariStyles.colors.gray900,
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.5,
                        marginBottom: '10px',
                      }}
                    >
                      {note.note_text}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '12px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, lineHeight: 1.4 }}>
                        {renderMeta(note)}
                      </div>
                      {showActions ? (
                        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                          <button
                            type="button"
                            onClick={() => startEdit(note)}
                            title="Edit note"
                            style={{
                              padding: '6px 10px',
                              border: '1px solid #d1d5db',
                              borderRadius: '6px',
                              background: '#fff',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '13px',
                              color: '#374151',
                            }}
                          >
                            <FiEdit2 size={14} />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(note.id)}
                            disabled={deletingId === note.id}
                            title="Delete note"
                            style={{
                              padding: '6px 10px',
                              border: '1px solid #fecaca',
                              borderRadius: '6px',
                              background: '#fff',
                              cursor: deletingId === note.id ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '13px',
                              color: '#ef4444',
                            }}
                          >
                            <FiTrash2 size={14} />
                            {deletingId === note.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BookingNotesTab;
