/**
 * HiveMind LLM - Main Application
 */

import { useEffect, useCallback } from 'react';
import { ClusterStatus, ChatMessages, ChatInput } from './components';
import {
  useClusterStore,
  useChatStore,
  useHardwareStore,
} from './store';
import { coordinator } from './network/coordinator';
import { peerMesh } from './network/peers';
import { inferenceEngine } from './inference/engine';
import { detectWebGPU, meetsMinimumRequirements } from './inference/webgpu';
import { initializeErrorLogger, registerWebGPUErrorListener } from './utils/errorLogger';
import type { ChatMessage } from './types';

// Initialize error logging ASAP to catch any initialization errors
const errorLogger = initializeErrorLogger({
  endpoint: `${import.meta.env.VITE_COORDINATOR_URL || 'http://localhost:5000'}/api/errors`,
  debug: true, // Log errors to console during development
  batchSize: 5,
  flushInterval: 3000,
});

registerWebGPUErrorListener();

// Log that the app is starting
errorLogger.logMessage('HiveMind app initializing');

function App() {
  const {
    connected,
    peerState,
    setConnected,
    setPeerId,
    setPeerState,
    setClusterStats,
    setLayerAssignment,
    layerAssignment,
  } = useClusterStore();

  const {
    messages,
    generation,
    addMessage,
    updateLastMessage,
    setActiveModel,
    setGeneration,
  } = useChatStore();

  const {
    modelLoaded,
    setWebGPU,
    setModelLoaded,
    setModelLoadProgress,
  } = useHardwareStore();

  // Initialize on mount
  useEffect(() => {
    let mounted = true;

    async function initialize() {
      try {
        // 1. Detect WebGPU capabilities (with timeout)
        console.log('Detecting WebGPU...');
        const gpuInfo = await Promise.race([
          detectWebGPU(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))
        ]) as Awaited<ReturnType<typeof detectWebGPU>> | null;
        
        if (!mounted) return;
        
        if (!gpuInfo) {
          console.warn('WebGPU detection timed out');
          setWebGPU({ supported: false, adapter: null, limits: null, estimatedVRAM: 0 });
          addMessage({
            id: crypto.randomUUID(),
            role: 'system',
            content: '⚠️ WebGPU detection timed out. Some features may be limited.',
            timestamp: new Date(),
          });
        } else {
          setWebGPU(gpuInfo);
          
          const requirements = meetsMinimumRequirements(gpuInfo);
          if (!requirements.meets) {
            console.warn('Requirements not met:', requirements.reason);
            addMessage({
              id: crypto.randomUUID(),
              role: 'system',
              content: `⚠️ ${requirements.reason}`,
              timestamp: new Date(),
            });
          }
        }

        // 2. Connect to coordinator (async, don't block UI)
        console.log('Connecting to coordinator...');
        coordinator.connect().then((peerId) => {
          if (!mounted) return;
          
          setPeerId(peerId);
          setConnected(true);
          peerMesh.initialize(peerId);

          // 3. Report capabilities
          if (gpuInfo) {
            coordinator.reportCapabilities({
              vram_gb: gpuInfo.estimatedVRAM,
              webgpu_supported: gpuInfo.supported,
              compute_capability: gpuInfo.adapter?.architecture || 'unknown',
              browser: navigator.userAgent,
              estimated_tflops: 0,
            });
          }
        }).catch((error) => {
          console.error('Failed to connect:', error);
          if (!mounted) return;
          addMessage({
            id: crypto.randomUUID(),
            role: 'system',
            content: '⚠️ Failed to connect to the HiveMind network. Running in local-only mode.',
            timestamp: new Date(),
          });
        });
      } catch (error) {
        console.error('Initialization error:', error);
        errorLogger.log(error as Error, { phase: 'initialization' });
      }
    }

    initialize();

    // Setup coordinator event handlers
    coordinator.onLayerAssignment(async (assignment) => {
      if (!mounted) return;
      
      setLayerAssignment(assignment);
      setActiveModel(assignment.model);
      setPeerState('downloading');

      // Load the model
      try {
        const { fallbackReason } = await inferenceEngine.loadModel(assignment.model, (progress) => {
          setModelLoadProgress(progress);
        });

        if (fallbackReason) {
          addMessage({
            id: crypto.randomUUID(),
            role: 'system',
            content: `ℹ️ ${fallbackReason}`,
            timestamp: new Date(),
          });
        }
        
        setModelLoaded(true);
        setPeerState('ready');
        coordinator.updateState('ready');
        
        // Connect to other peers in the pipeline
        const otherPeers = assignment.peer_order.filter(
          (id) => id !== coordinator.currentPeerId
        );
        if (otherPeers.length > 0) {
          await peerMesh.connectToPeers(otherPeers);
        }
      } catch (error) {
        console.error('Failed to load model:', error);
        setPeerState('connecting');
      }
    });

    coordinator.onClusterUpdate((update) => {
      if (!mounted) return;
      setClusterStats({
        total_peers: update.total_peers,
        ready_peers: update.ready_peers,
        total_vram_gb: update.total_vram_gb,
        active_model: null, // Will be set separately
        tokens_generated: 0,
        requests_completed: 0,
        peers: [],
        pipeline_order: update.pipeline_order,
      });
    });

    coordinator.onModelChange(async (event) => {
      if (!mounted) return;
      
      console.log('Model change requested:', event);
      // Model upgrade/downgrade - would reload layers here
      setPeerState('downloading');
      setModelLoaded(false);
    });

    coordinator.onDisconnect(() => {
      if (!mounted) return;
      setConnected(false);
      setPeerState('connecting');
    });

    // Heartbeat interval
    const heartbeatInterval = setInterval(() => {
      if (coordinator.isConnected) {
        coordinator.sendHeartbeat();
      }
    }, 30000);

    return () => {
      mounted = false;
      clearInterval(heartbeatInterval);
      coordinator.disconnect();
      peerMesh.disconnectAll();
    };
  }, []);

  // Handle sending a message
  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!modelLoaded || generation.status === 'generating') return;

      // Add user message
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        timestamp: new Date(),
      };
      addMessage(userMessage);

      // Add placeholder for assistant response
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        model: layerAssignment?.model.name,
      };
      addMessage(assistantMessage);

      // Build conversation history
      const conversationMessages = [...messages, userMessage].map((msg) => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      }));

      // Generate response
      try {
        setGeneration({ status: 'generating', tokens_generated: 0 });
        
        let fullResponse = '';
        await inferenceEngine.generate(conversationMessages, {
          maxTokens: 512,
          temperature: 0.7,
          onToken: (token) => {
            fullResponse += token;
            updateLastMessage(fullResponse);
          },
          onProgress: (progress) => {
            setGeneration(progress);
          },
        });

        // Report completion
        coordinator.reportInferenceComplete(generation.tokens_generated);
      } catch (error) {
        console.error('Generation error:', error);
        updateLastMessage(
          '⚠️ An error occurred during generation. Please try again.'
        );
        setGeneration({ status: 'error', error: String(error) });
      }
    },
    [
      modelLoaded,
      generation.status,
      messages,
      layerAssignment,
      addMessage,
      updateLastMessage,
      setGeneration,
    ]
  );

  const isInputDisabled =
    !connected || peerState !== 'ready' || !modelLoaded || generation.status === 'generating';

  const inputPlaceholder = !connected
    ? 'Connecting to HiveMind...'
    : peerState !== 'ready'
    ? 'Loading model...'
    : generation.status === 'generating'
    ? 'Generating response...'
    : 'Type a message...';

  return (
    <div className="flex flex-col h-screen bg-zinc-950">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-hivemind-500 to-hivemind-700 flex items-center justify-center">
            <svg
              className="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-zinc-100">HiveMind</h1>
        </div>

        <a
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
            />
          </svg>
        </a>
      </header>

      {/* Cluster Status */}
      <ClusterStatus />

      {/* Chat Area */}
      <ChatMessages
        messages={messages}
        isGenerating={generation.status === 'generating'}
      />

      {/* Input */}
      <ChatInput
        onSend={handleSendMessage}
        disabled={isInputDisabled}
        placeholder={inputPlaceholder}
      />
    </div>
  );
}

export default App;
