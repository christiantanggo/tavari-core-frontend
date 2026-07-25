import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiX, FiSend } from 'react-icons/fi';
import { useAIChat } from '../contexts/AIChatContext';
import { useBusinessContext } from '../contexts/BusinessContext';
import { useBookingDetailModal } from '../contexts/BookingDetailModalContext';
import { useAiChatNavigationContext } from '../hooks/useAiChatNavigationContext';
import { navigateFromAiChat } from '../utils/aiChatNavigation';
import {
  printCamperRegistrationByDocumentId,
  resolveStaffLinkById,
} from '../utils/aiChatActionExecutor';
import AiChatMessageContent from './AiChatMessageContent';
import AiChatLinkCard from './AiChatLinkCard';
import { TavariStyles } from '../utils/TavariStyles';

const primary = TavariStyles?.colors?.primary || '#008080';
const gray200 = TavariStyles?.colors?.gray200 || '#e5e7eb';
const gray600 = TavariStyles?.colors?.gray600 || '#4b5563';
const gray700 = TavariStyles?.colors?.gray700 || '#374151';

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
    zIndex: 1098,
    opacity: 0,
    pointerEvents: 'none',
    transition: 'opacity 0.2s',
  },
  overlayVisible: { opacity: 1, pointerEvents: 'auto' },
  panel: {
    position: 'fixed',
    top: 0,
    right: 0,
    width: 'min(420px, 100vw)',
    height: '100vh',
    backgroundColor: '#fff',
    boxShadow: '-4px 0 20px rgba(0,0,0,0.15)',
    zIndex: 1099,
    display: 'flex',
    flexDirection: 'column',
    transform: 'translateX(100%)',
    transition: 'transform 0.25s ease-out',
  },
  panelOpen: { transform: 'translateX(0)' },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: `1px solid ${gray200}`,
    flexShrink: 0,
  },
  title: { fontSize: 16, fontWeight: 600, color: gray700, margin: 0 },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 4,
    color: gray600,
    display: 'flex',
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  message: {
    maxWidth: '90%',
    padding: '10px 14px',
    borderRadius: 12,
    fontSize: 14,
    lineHeight: 1.5,
  },
  userMsg: { alignSelf: 'flex-end', backgroundColor: primary, color: '#fff' },
  assistantMsg: { alignSelf: 'flex-start', backgroundColor: gray200, color: gray700 },
  inputWrap: {
    padding: 16,
    borderTop: `1px solid ${gray200}`,
    flexShrink: 0,
  },
  inputRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-end',
  },
  textarea: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    padding: '10px 14px',
    fontSize: 14,
    border: `1px solid ${gray200}`,
    borderRadius: 8,
    resize: 'none',
    fontFamily: 'inherit',
  },
  sendBtn: {
    flexShrink: 0,
    width: 44,
    height: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: primary,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  clearBtn: {
    background: 'none',
    border: 'none',
    color: gray600,
    fontSize: 13,
    cursor: 'pointer',
    padding: '4px 0',
    marginTop: 8,
  },
  choiceBtn: {
    display: 'block',
    width: '100%',
    marginTop: 8,
    padding: '8px 12px',
    backgroundColor: primary,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'left',
  },
};

export default function AIChatPanel() {
  const {
    isOpen,
    close,
    messages,
    loading,
    sendMessage,
    clearMessages,
    setNavigationContext,
    setActionRuntime,
    patchAssistantMessage,
  } = useAIChat();
  const { selectedBusinessId } = useBusinessContext();
  const { openBookingDetail, bookingDetailModalId } = useBookingDetailModal();
  const navigationContext = useAiChatNavigationContext();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    setNavigationContext({ ...navigationContext, businessId: selectedBusinessId });
  }, [navigationContext, selectedBusinessId, setNavigationContext]);

  useEffect(() => {
    setActionRuntime({
      businessId: selectedBusinessId,
      navigate,
      close,
      openBookingDetail,
      openBookingId: bookingDetailModalId,
    });
  }, [selectedBusinessId, navigate, close, openBookingDetail, bookingDetailModalId, setActionRuntime]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const t = input.trim();
    if (!t || loading) return;
    setInput('');
    sendMessage(t, {
      pathname: navigationContext.pathname,
      module: navigationContext.module,
      screen: navigationContext.screen,
      businessId: selectedBusinessId,
      openBookingId: bookingDetailModalId || null,
    });
  };

  const handleNavigateFromChat = (path, linkLabel, messageContent) => {
    navigateFromAiChat(navigate, path, linkLabel, messageContent);
    close();
  };

  const handleChoice = async (messageIndex, choice) => {
    if (choice?.choiceType === 'booking_guest_list' && choice?.bookingId && openBookingDetail) {
      openBookingDetail(choice.bookingId, { initialTab: 'guest-list' });
      patchAssistantMessage(messageIndex, {
        content: `Opened the Guest list tab for ${choice.label}.`,
        choices: undefined,
      });
      close();
      return;
    }

    if (choice?.choiceType === 'waiver_link' && choice?.templateKey) {
      const linkId = choice.waiverLinkKind || choice.linkId || 'waiver_signing';
      const { ok, copied, resolved, content, choices } = await resolveStaffLinkById(
        selectedBusinessId,
        linkId,
        choice.templateKey
      );
      if (choices?.length) {
        patchAssistantMessage(messageIndex, {
          content: 'Which waiver template link should I copy?',
          choices,
        });
        return;
      }
      if (!ok || !resolved) {
        patchAssistantMessage(messageIndex, {
          content: content || resolved?.error || 'Could not build that waiver link.',
          choices: undefined,
        });
        return;
      }
      const copyNote = copied ? 'Copied to your clipboard.' : 'Use Copy URL below.';
      patchAssistantMessage(messageIndex, {
        content: `Here’s the **${resolved.label}** link (${copyNote})`,
        choices: undefined,
        linkCards: [
          {
            id: resolved.id || linkId,
            label: resolved.label,
            description: resolved.description,
            url: resolved.url,
          },
        ],
      });
      return;
    }

    if (choice?.choiceType === 'link' && choice?.linkId) {
      if (WAIVER_LINK_IDS.has(choice.linkId)) {
        const { ok, copied, resolved, content, choices } = await resolveStaffLinkById(
          selectedBusinessId,
          choice.linkId
        );
        if (choices?.length) {
          patchAssistantMessage(messageIndex, {
            content: 'Which waiver template link should I copy?',
            choices,
          });
          return;
        }
        if (!ok || !resolved) {
          patchAssistantMessage(messageIndex, {
            content: content || 'Could not build that waiver link.',
            choices: undefined,
          });
          return;
        }
        const copyNote = copied ? 'Copied to your clipboard.' : 'Use Copy URL below.';
        patchAssistantMessage(messageIndex, {
          content: `Here’s the **${resolved.label}** link (${copyNote})`,
          choices: undefined,
          linkCards: [
            {
              id: resolved.id || choice.linkId,
              label: resolved.label,
              description: resolved.description,
              url: resolved.url,
            },
          ],
        });
        return;
      }

      const { ok, copied, resolved } = await resolveStaffLinkById(
        selectedBusinessId,
        choice.linkId
      );
      if (!ok || !resolved) {
        patchAssistantMessage(messageIndex, {
          content: resolved?.error || 'Could not build that link.',
          choices: undefined,
        });
        return;
      }
      const copyNote = copied ? 'Copied to your clipboard.' : 'Use Copy URL below.';
      patchAssistantMessage(messageIndex, {
        content: `Here’s the **${resolved.label}** link (${copyNote})`,
        choices: undefined,
        linkCards: [
          {
            id: resolved.id,
            label: resolved.label,
            description: resolved.description,
            url: resolved.url,
          },
        ],
      });
      return;
    }

    if (!selectedBusinessId || !choice?.documentId) return;
    const ok = await printCamperRegistrationByDocumentId(selectedBusinessId, choice.documentId);
    if (ok) {
      patchAssistantMessage(messageIndex, {
        content: `Print dialog opened for ${choice.label}. Click Print in the browser window to finish.`,
        choices: undefined,
      });
      close();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        style={{ ...styles.overlay, ...styles.overlayVisible }}
        onClick={close}
        onKeyDown={(e) => e.key === 'Escape' && close()}
        role="button"
        tabIndex={0}
        aria-label="Close chat"
      />
      <div style={{ ...styles.panel, ...styles.panelOpen }} role="dialog" aria-label="AI Chat">
        <div style={styles.header}>
          <h3 style={styles.title}>Tavari AI Help</h3>
          <button type="button" style={styles.closeBtn} onClick={close} aria-label="Close">
            <FiX size={20} />
          </button>
        </div>
        <div style={styles.messages}>
          {messages.length === 0 && (
            <p style={{ fontSize: 13, color: gray600, margin: 0 }}>
              Ask where to find features, accounting/HST questions, copy shareable links (booking
              portal, guest list, kiosks), or tasks like{' '}
              <em>“Print the camp registration form for [camper name]”</em>.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                ...styles.message,
                ...(m.role === 'user' ? styles.userMsg : styles.assistantMsg),
              }}
            >
              <AiChatMessageContent
                content={m.content}
                isUser={m.role === 'user'}
                onNavigate={handleNavigateFromChat}
              />
              {m.role === 'assistant' && m.linkCards?.length > 0 && (
                <div>
                  {m.linkCards.map((link) => (
                    <AiChatLinkCard key={link.id || link.url} link={link} />
                  ))}
                </div>
              )}
              {m.role === 'assistant' && m.choices?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {m.choices.map((choice) => (
                    <button
                      key={choice.linkId || choice.bookingId || choice.documentId}
                      type="button"
                      style={styles.choiceBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleChoice(i, choice);
                      }}
                    >
                      {choice.choiceType === 'link'
                        ? choice.label
                        : choice.choiceType === 'booking_guest_list'
                          ? `Guest list: ${choice.label}`
                          : `Print: ${choice.label}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div style={{ ...styles.message, ...styles.assistantMsg }}>
              <span style={{ opacity: 0.7 }}>Thinking…</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        <div style={styles.inputWrap}>
          <div style={styles.inputRow}>
            <textarea
              style={styles.textarea}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask a question…"
              rows={2}
              disabled={loading}
            />
            <button
              type="button"
              style={styles.sendBtn}
              onClick={handleSend}
              disabled={loading || !input.trim()}
            >
              <FiSend size={18} />
            </button>
          </div>
          {messages.length > 0 && (
            <button type="button" style={styles.clearBtn} onClick={clearMessages}>
              Clear chat
            </button>
          )}
        </div>
      </div>
    </>
  );
}
