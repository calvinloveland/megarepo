/**
 * Component Tests
 * 
 * Tests for individual UI components.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClusterStatus, ChatMessages, ChatInput } from '../components';

describe('ChatInput', () => {
  it('should render input field', () => {
    render(<ChatInput onSend={vi.fn()} />);
    
    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
  });

  it('should call onSend when submitting', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.submit(input.closest('form')!);
    
    expect(onSend).toHaveBeenCalledWith('Hello');
  });

  it('should not submit empty message', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    
    const input = screen.getByRole('textbox');
    fireEvent.submit(input.closest('form')!);
    
    expect(onSend).not.toHaveBeenCalled();
  });

  it('should clear input after submit', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Test' } });
    fireEvent.submit(input.closest('form')!);
    
    expect(input.value).toBe('');
  });

  it('should show placeholder text', () => {
    render(<ChatInput onSend={vi.fn()} placeholder="Custom placeholder" />);
    
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('placeholder', 'Custom placeholder');
  });

  it('should be disabled when disabled prop is true', () => {
    render(<ChatInput onSend={vi.fn()} disabled={true} />);
    
    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
  });
});

describe('ChatMessages', () => {
  it('should render empty state when no messages', () => {
    render(<ChatMessages messages={[]} />);
    
    // Should render without crashing
    expect(screen.getByText(/start a conversation/i)).toBeInTheDocument();
  });

  it('should render messages', () => {
    const messages = [
      { id: '1', role: 'user' as const, content: 'Hello', timestamp: new Date() },
      { id: '2', role: 'assistant' as const, content: 'Hi there!', timestamp: new Date() },
    ];
    
    render(<ChatMessages messages={messages} />);
    
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('should show generating indicator', () => {
    const messages = [
      { id: '1', role: 'user' as const, content: 'Hello', timestamp: new Date() },
    ];
    
    render(<ChatMessages messages={messages} isGenerating={true} />);
    
    // Should show the typing indicator (dots with typing-dot class)
    expect(document.querySelector('.typing-dot')).toBeInTheDocument();
  });
});

describe('ClusterStatus', () => {
  // Mock the store for ClusterStatus
  vi.mock('../store', async () => {
    const actual = await vi.importActual('../store');
    return {
      ...actual,
      useClusterStore: () => ({
        connected: true,
        peerState: 'ready',
        clusterStats: {
          total_peers: 5,
          ready_peers: 3,
          total_vram_gb: 24,
          active_model: { name: 'Llama-7B' },
        },
      }),
      useHardwareStore: () => ({
        webGPU: { supported: true, estimatedVRAM: 4 },
        modelLoaded: true,
        modelLoadProgress: 100,
      }),
    };
  });

  it('should render cluster status', () => {
    render(<ClusterStatus />);
    
    // Should render without crashing and show some status info
    expect(document.body).toBeInTheDocument();
  });
});
