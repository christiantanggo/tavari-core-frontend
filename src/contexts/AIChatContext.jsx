import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { executeAiChatActions } from '../utils/aiChatActionExecutor';

const AIChatContext = createContext(null);

export function AIChatProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigationContextRef = useRef(null);
  const actionRuntimeRef = useRef({
    businessId: null,
    navigate: null,
    close: null,
    openBookingDetail: null,
    openBookingId: null,
  });

  const toggleOpen = useCallback(() => setIsOpen((prev) => !prev), []);
  const close = useCallback(() => setIsOpen(false), []);

  const setNavigationContext = useCallback((ctx) => {
    navigationContextRef.current = ctx;
  }, []);

  const setActionRuntime = useCallback((runtime) => {
    actionRuntimeRef.current = {
      businessId: runtime?.businessId ?? actionRuntimeRef.current.businessId,
      navigate: runtime?.navigate ?? actionRuntimeRef.current.navigate,
      close: runtime?.close ?? actionRuntimeRef.current.close,
      openBookingDetail: runtime?.openBookingDetail ?? actionRuntimeRef.current.openBookingDetail,
      openBookingId: runtime?.openBookingId ?? actionRuntimeRef.current.openBookingId,
    };
  }, []);

  const patchLastAssistantMessage = useCallback((patch) => {
    setMessages((prev) => {
      if (!prev.length) return prev;
      const copy = [...prev];
      const idx = copy.length - 1;
      if (copy[idx]?.role !== 'assistant') return prev;
      copy[idx] = { ...copy[idx], ...patch };
      return copy;
    });
  }, []);

  const patchAssistantMessage = useCallback((index, patch) => {
    setMessages((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const copy = [...prev];
      copy[index] = { ...copy[index], ...patch };
      return copy;
    });
  }, []);

  const sendMessage = useCallback(async (content, pageContext = {}) => {
    if (!content?.trim()) return;
    const userMsg = { role: 'user', content: content.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    try {
      const navContext = navigationContextRef.current || {};
      const context = {
        ...pageContext,
        pathname: navContext.pathname || pageContext.pathname || '',
        module: navContext.module || pageContext.module || '',
        screen: navContext.screen || pageContext.screen || '',
        enabledModules: navContext.enabledModules || [],
        visibleNav: navContext.visibleNav || [],
        visibleFeatures: navContext.visibleFeatures || [],
        businessId: navContext.businessId || pageContext.businessId || null,
        openBookingId: pageContext.openBookingId || navContext.openBookingId || null,
      };

      const { data, error } = await supabase.functions.invoke('tavari-ai-chat', {
        body: {
          messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
          context,
        },
      });
      if (error) throw error;

      const assistantContent = data?.content || 'Sorry, I could not generate a response.';
      const actions = Array.isArray(data?.actions) ? data.actions : [];

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: assistantContent, actions },
      ]);

      const runtime = actionRuntimeRef.current;
      if (actions.length && runtime.navigate) {
        await executeAiChatActions(actions, {
          businessId: runtime.businessId || context.businessId,
          navigate: runtime.navigate,
          close: runtime.close,
          openBookingDetail: runtime.openBookingDetail,
          onChoices: (choices, content) => {
            patchLastAssistantMessage({
              content: content || assistantContent,
              choices: choices?.length ? choices : undefined,
            });
          },
          onMessagePatch: (patch) => {
            patchLastAssistantMessage({
              content: patch.content || assistantContent,
              choices: patch.choices?.length ? patch.choices : undefined,
              linkCards: patch.linkCards?.length ? patch.linkCards : undefined,
            });
          },
        });
      }
    } catch (err) {
      let errMsg = err?.message || 'Failed to send message.';
      if (err?.name === 'FunctionsHttpError' && err?.context instanceof Response) {
        try {
          const ct = err.context.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const j = await err.context.json();
            if (j?.detail) errMsg = `${j.error || 'Request failed'}: ${j.detail}`;
            else if (typeof j?.error === 'string') errMsg = j.error;
          }
        } catch {
          /* keep errMsg */
        }
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${errMsg}` }]);
    } finally {
      setLoading(false);
    }
  }, [messages, patchLastAssistantMessage]);

  const clearMessages = useCallback(() => setMessages([]), []);

  const value = {
    isOpen,
    toggleOpen,
    close,
    messages,
    loading,
    sendMessage,
    clearMessages,
    setNavigationContext,
    setActionRuntime,
    patchLastAssistantMessage,
    patchAssistantMessage,
  };
  return <AIChatContext.Provider value={value}>{children}</AIChatContext.Provider>;
}

const AI_CHAT_FALLBACK = {
  isOpen: false,
  toggleOpen: () => {},
  close: () => {},
  messages: [],
  loading: false,
  sendMessage: async () => {},
  clearMessages: () => {},
  setNavigationContext: () => {},
  setActionRuntime: () => {},
  patchLastAssistantMessage: () => {},
  patchAssistantMessage: () => {},
};

export function useAIChat() {
  const ctx = useContext(AIChatContext);
  // Never crash the dashboard shell (e.g. unlock remount / HMR context mismatch).
  if (!ctx) return AI_CHAT_FALLBACK;
  return ctx;
}
