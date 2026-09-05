'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Icon } from './ui/Icon';
import { chatReplyAction, getChatHistoryAction } from '@/lib/actions/chat';

interface Message {
  id: number;
  from: 'agent' | 'user';
  text: string;
}

const GREETING: Message = { id: 1, from: 'agent', text: "Hi! I'm your campaign agent. Ask me about registrations, attendance, cadence steps, scoring, or what needs attention." };

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const pathname = usePathname();
  const campaignMatch = pathname.match(/^\/campaigns\/([^/]+)/);
  const campaignId = campaignMatch ? campaignMatch[1] : null;

  // History used to live only in this component's state, so switching tabs
  // (a full navigation, not a client-side toggle) wiped the conversation.
  // Messages are now persisted per-campaign server-side (see chatReplyAction) —
  // reload them whenever the active campaign changes.
  useEffect(() => {
    let cancelled = false;
    // Route both branches through a resolved promise so setState only ever
    // happens inside a callback, never synchronously in the effect body —
    // matches the "no direct setState in an effect" lint rule while still
    // reloading history (or resetting to the greeting) on every campaign switch.
    const load = campaignId ? getChatHistoryAction(campaignId) : Promise.resolve([]);
    load.then((history) => {
      if (cancelled) return;
      setMessages(history.length > 0 ? history.map((m, i) => ({ id: i, ...m })) : [GREETING]);
    });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  async function send() {
    const text = input.trim();
    if (!text) return;
    setInput('');
    const history = messages.map((m) => ({ from: m.from, text: m.text }));
    setMessages((m) => [...m, { id: Date.now(), from: 'user', text }]);
    setTyping(true);
    const reply = await chatReplyAction(campaignId, history, text);
    setTyping(false);
    setMessages((m) => [...m, { id: Date.now() + 1, from: 'agent', text: reply }]);
  }

  return (
    <>
      {open && (
        <div
          style={{
            position: 'fixed',
            bottom: 92,
            right: 24,
            width: 360,
            height: 520,
            maxHeight: 'calc(100vh - 116px)',
            background: '#fff',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-panel)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 1000,
          }}
        >
          <div style={{ flexShrink: 0, background: 'var(--accent-500)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 'var(--fs-label-2)', fontWeight: 700, color: '#fff' }}>
              AI
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: '#fff' }}>Campaign Agent</div>
              <div style={{ fontSize: 'var(--fs-label-2)', color: 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success-500)', flexShrink: 0 }} />
                Online
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              style={{ cursor: 'pointer', width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', border: 'none', background: 'transparent', padding: 0 }}
            >
              <Icon name="close" size={16} style={{ color: '#fff' }} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--surface-page)' }}>
            {messages.map((msg) => (
              <div key={msg.id} style={{ display: 'flex', justifyContent: msg.from === 'user' ? 'flex-end' : 'flex-start' }}>
                <div
                  style={{
                    maxWidth: '78%',
                    background: msg.from === 'user' ? 'var(--accent-500)' : 'var(--n10)',
                    color: msg.from === 'user' ? '#fff' : 'var(--n80)',
                    padding: '9px 13px',
                    borderRadius: 14,
                    fontSize: 'var(--fs-label-1)',
                    lineHeight: 1.5,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            {typing && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ background: 'var(--n10)', padding: '10px 14px', borderRadius: 14, display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--n50)' }} />
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--n50)' }} />
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--n50)' }} />
                </div>
              </div>
            )}
          </div>

          <div style={{ flexShrink: 0, borderTop: '1px solid var(--border-subtle)', padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'center', background: '#fff' }}>
            <input
              type="text"
              aria-label="Message"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder={campaignId ? 'Ask about this campaign…' : 'Ask about your webinars…'}
              style={{
                flex: 1,
                height: 38,
                border: 'none',
                borderRadius: 'var(--radius-full)',
                background: 'var(--n10)',
                padding: '0 14px',
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--fs-label-1)',
                color: 'var(--n90)',
                outline: 'none',
              }}
            />
            <button
              onClick={send}
              aria-label="Send message"
              style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent-500)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, border: 'none', padding: 0 }}
            >
              <Icon name="arrow-right" size={15} style={{ color: '#fff' }} />
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close chat' : 'Open chat'}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'var(--accent-500)',
          boxShadow: 'var(--shadow-panel)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 1000,
          border: 'none',
          padding: 0,
        }}
      >
        <Icon name={open ? 'close' : 'chat'} size={24} style={{ color: '#fff' }} />
      </button>
    </>
  );
}
