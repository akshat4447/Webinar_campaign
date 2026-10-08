'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Icon } from './ui/Icon';
import { Button } from './ui/Button';
import { chatReplyAction, getChatHistoryAction } from '@/lib/actions/chat';
import { useEscapeKey } from '@/lib/useEscapeKey';

interface Message {
  id: number;
  from: 'agent' | 'user';
  text: string;
}

const GREETING: Message = { id: 1, from: 'agent', text: 'This is the campaign agent. Ask about registrations, attendance, cadence steps, scoring, or what needs attention.' };

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logEndRef = useRef<HTMLLIElement>(null);
  // Escape closes the panel and hands focus back to the launcher so keyboard users keep their place.
  const closeChat = useCallback(() => {
    setOpen(false);
    fabRef.current?.focus();
  }, []);
  useEscapeKey(closeChat, open);
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
    if (!text || typing) return;
    setInput('');
    const history = messages.map((m) => ({ from: m.from, text: m.text }));
    setMessages((m) => [...m, { id: Date.now(), from: 'user', text }]);
    setTyping(true);
    try {
      const reply = await chatReplyAction(campaignId, history, text);
      setMessages((m) => [...m, { id: Date.now() + 1, from: 'agent', text: reply }]);
    } catch {
      setMessages((m) => [
        ...m,
        { id: Date.now() + 1, from: 'agent', text: 'The agent could not respond. Try again in a moment.' },
      ]);
    } finally {
      setTyping(false);
    }
  }

  // Focus the message box when the panel opens; keep the newest message in view.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    logEndRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, typing, open]);

  return (
    <>
      {open && (
        <section className="lsq-home-chat" role="dialog" aria-label="Campaign agent">
          <header className="lsq-home-chat__head">
            <span className="lsq-avatar" aria-hidden="true">AI</span>
            <div className="lsq-grow">
              <h2 className="lsq-home-chat__title">Campaign Agent</h2>
              <p className="lsq-home-chat__status">
                <span className="lsq-home-chat__dot" aria-hidden="true" />
                Online
              </p>
            </div>
            <Button hierarchy="tertiary" size="sm" iconPosition="only" ariaLabel="Close chat" icon={<Icon name="close" size={16} />} onClick={closeChat} />
          </header>

          <ul className="lsq-home-chat__log" role="log" aria-live="polite" aria-label="Conversation">
            {messages.map((msg) => (
              <li key={msg.id} className="lsq-home-chat__msg" data-from={msg.from}>
                <div className="lsq-home-chat__bubble">
                  <span className="lsq-sr-only">{msg.from === 'user' ? 'Sent message: ' : 'Agent reply: '}</span>
                  {msg.text}
                </div>
              </li>
            ))}
            {typing && (
              <li className="lsq-home-chat__msg" data-from="agent">
                <div className="lsq-home-chat__typing" role="status">
                  <span className="lsq-sr-only">The agent is typing</span>
                  <span aria-hidden="true" />
                  <span aria-hidden="true" />
                  <span aria-hidden="true" />
                </div>
              </li>
            )}
            <li ref={logEndRef} aria-hidden="true" />
          </ul>

          <form
            className="lsq-home-chat__form"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              ref={inputRef}
              type="text"
              className="lsq-input"
              aria-label="Message"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={campaignId ? 'Ask about this campaign…' : 'Ask about webinars…'}
            />
            <Button type="submit" size="md" iconPosition="only" ariaLabel="Send message" disabled={typing || !input.trim()} icon={<Icon name="send" size={16} />} />
          </form>
        </section>
      )}

      <button
        ref={fabRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close chat' : 'Open chat'}
        aria-expanded={open}
        className="lsq-btn lsq-btn--md lsq-btn--primary lsq-home-chat-fab"
      >
        <Icon name={open ? 'close' : 'chat'} size={22} />
      </button>
    </>
  );
}
