/**
 * Chat message display component
 */

import { useRef, useEffect } from 'react';
import type { ChatMessage } from '../types';

interface ChatMessagesProps {
  messages: ChatMessage[];
  isGenerating: boolean;
}

export function ChatMessages({ messages, isGenerating }: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-hivemind-500 to-hivemind-700 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-zinc-200 mb-2">
            Welcome to HiveMind
          </h2>
          <p className="text-zinc-400 text-sm mb-4">
            Chat with an AI powered by distributed browser computing.
            As more users join, the collective intelligence grows.
          </p>
          <div className="text-xs text-zinc-500">
            Start a conversation below
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        
        {isGenerating && messages[messages.length - 1]?.role !== 'assistant' && (
          <TypingIndicator />
        )}
        
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <div className="text-center text-xs text-zinc-500 py-2">
        {message.content}
      </div>
    );
  }

  return (
    <div
      className={`message-enter flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2 ${
          isUser
            ? 'bg-hivemind-600 text-white'
            : 'bg-zinc-800 text-zinc-100'
        }`}
      >
        {/* Message content */}
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
        
        {/* Metadata */}
        <div
          className={`text-xs mt-1 ${
            isUser ? 'text-hivemind-200' : 'text-zinc-500'
          }`}
        >
          {formatTime(message.timestamp)}
          {message.model && !isUser && (
            <span className="ml-2">• {message.model}</span>
          )}
          {message.tokens && !isUser && (
            <span className="ml-2">• {message.tokens} tokens</span>
          )}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-zinc-800 rounded-2xl px-4 py-3">
        <div className="flex gap-1">
          <div className="w-2 h-2 bg-zinc-500 rounded-full typing-dot" />
          <div className="w-2 h-2 bg-zinc-500 rounded-full typing-dot" />
          <div className="w-2 h-2 bg-zinc-500 rounded-full typing-dot" />
        </div>
      </div>
    </div>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
