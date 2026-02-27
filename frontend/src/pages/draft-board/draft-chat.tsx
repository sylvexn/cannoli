import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface ChatMessage {
  username: string;
  message: string;
  timestamp: string;
}

interface DraftChatProps {
  ws: WebSocket | null;
  username: string;
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '');
}

export function DraftChat({ ws, username }: DraftChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [sendDisabled, setSendDisabled] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sendTimestamps = useRef<number[]>([]);

  // Listen for incoming chat messages
  useEffect(() => {
    if (!ws) return;

    function handleMessage(event: MessageEvent) {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'chat' && msg.data) {
          setMessages(prev => [...prev, msg.data as ChatMessage]);
        }
      } catch {
        // ignore non-JSON or non-chat messages
      }
    }

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!collapsed) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, collapsed]);

  // Client-side rate limit: max 3 messages per second
  const checkRateLimit = useCallback((): boolean => {
    const now = Date.now();
    const timestamps = sendTimestamps.current;
    // Remove timestamps older than 1 second
    while (timestamps.length > 0 && now - timestamps[0] > 1000) timestamps.shift();
    if (timestamps.length >= 3) {
      setSendDisabled(true);
      setTimeout(() => setSendDisabled(false), 1000);
      return false;
    }
    timestamps.push(now);
    return true;
  }, []);

  const handleSend = useCallback(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const trimmed = stripHtml(input).trim();
    if (!trimmed) return;
    if (!checkRateLimit()) return;

    const message = trimmed.slice(0, 200);
    ws.send(JSON.stringify({ type: 'chat', username, message }));
    setInput('');
  }, [ws, input, username, checkRateLimit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="flex flex-col border border-border/40 rounded-md bg-surface-raised overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center justify-between px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-text-secondary hover:text-text-primary transition-colors bg-surface-raised"
      >
        <span>Draft Chat</span>
        <span className="flex items-center gap-2">
          <span className="text-text-muted">{messages.length}</span>
          <span className={cn('transition-transform', collapsed ? 'rotate-180' : '')}>
            &#9660;
          </span>
        </span>
      </button>

      {!collapsed && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5" style={{ maxHeight: 200 }}>
            {messages.length === 0 && (
              <p className="text-xs text-text-muted italic py-2 text-center">No messages yet</p>
            )}
            {messages.map((msg, i) => (
              <div key={i} className="text-xs leading-snug">
                <span className="font-semibold text-accent-primary">{msg.username}</span>
                <span className="text-text-muted mx-1">:</span>
                <span className="text-text-primary break-words">{msg.message}</span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="flex gap-1 p-1.5 border-t border-border/30">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value.slice(0, 200))}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              maxLength={200}
              className="flex-1 min-w-0 bg-surface text-text-primary text-xs rounded px-2 py-1 border border-border/30 outline-none focus:border-accent-primary/50 placeholder:text-text-muted"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sendDisabled || !input.trim()}
              className="px-2 py-1 text-xs font-medium rounded bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}
