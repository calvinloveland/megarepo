/**
 * Chat input component
 */

import { useState, useRef, useEffect, FormEvent, KeyboardEvent } from 'react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSend,
  disabled,
  placeholder = 'Type a message...',
}: ChatInputProps) {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [message]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (message.trim() && !disabled) {
      onSend(message.trim());
      setMessage('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-zinc-800 bg-zinc-900 p-4"
    >
      <div className="max-w-3xl mx-auto">
        <div className="flex gap-3 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              rows={1}
              className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl
                         text-zinc-100 placeholder-zinc-500
                         focus:outline-none focus:border-hivemind-500 focus:ring-1 focus:ring-hivemind-500
                         disabled:opacity-50 disabled:cursor-not-allowed
                         resize-none overflow-hidden"
              style={{ minHeight: '48px', maxHeight: '200px' }}
            />
          </div>

          <button
            type="submit"
            disabled={disabled || !message.trim()}
            className="px-4 py-3 bg-hivemind-600 text-white rounded-xl
                       hover:bg-hivemind-500 transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed
                       flex items-center justify-center"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        </div>

        <div className="mt-2 text-xs text-zinc-600 text-center">
          Press Enter to send • Shift+Enter for new line
        </div>
      </div>
    </form>
  );
}
