/**
 * Chat State Store - Zustand store for chat messages and generation state
 */

import { create } from 'zustand';
import type { ChatMessage, ModelConfig } from '../types';

interface ChatState {
  // Messages
  messages: ChatMessage[];
  
  // Active model
  activeModel: ModelConfig | null;
  
  // Generation state
  generation: {
    status: 'idle' | 'loading' | 'generating' | 'complete' | 'error';
    currentPrompt: string | null;
    tokensGenerated: number;
    startTime: number | null;
  };
  
  // Actions
  addMessage: (message: ChatMessage) => void;
  updateLastMessage: (content: string) => void;
  clearMessages: () => void;
  setActiveModel: (model: ModelConfig | null) => void;
  setGeneration: (updates: Partial<ChatState['generation']>) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  // Initial state
  messages: [],
  activeModel: null,
  generation: {
    status: 'idle',
    currentPrompt: null,
    tokensGenerated: 0,
    startTime: null,
  },
  
  // Actions
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message],
  })),
  
  updateLastMessage: (content) => set((state) => {
    if (state.messages.length === 0) return state;
    const messages = [...state.messages];
    messages[messages.length - 1] = {
      ...messages[messages.length - 1],
      content,
    };
    return { messages };
  }),
  
  clearMessages: () => set({ messages: [] }),
  
  setActiveModel: (activeModel) => set({ activeModel }),
  
  setGeneration: (updates) => set((state) => ({
    generation: { ...state.generation, ...updates },
  })),
}));
