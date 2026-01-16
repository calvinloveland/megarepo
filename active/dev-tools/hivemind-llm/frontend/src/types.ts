/**
 * Shared types for HiveMind LLM
 */

// ==================== Peer & Cluster Types ====================

export interface PeerCapabilities {
  vram_gb: number;
  webgpu_supported: boolean;
  compute_capability: string;
  browser: string;
  estimated_tflops: number;
}

export type PeerState =
  | 'connecting'
  | 'downloading'
  | 'ready'
  | 'busy'
  | 'disconnecting';

export interface PeerInfo {
  id: string;
  state: PeerState;
  vram_gb: number;
  layers: [number, number] | null;
  browser: string;
}

export interface ClusterStats {
  total_peers: number;
  ready_peers: number;
  total_vram_gb: number;
  active_model: ModelInfo | null;
  tokens_generated: number;
  requests_completed: number;
  peers: PeerInfo[];
  pipeline_order: string[];
}

// ==================== Model Types ====================

export interface ModelInfo {
  id: string;
  name: string;
  mlc_model_id: string;
  num_layers: number;
  hidden_size?: number;
  quantization?: string;
}

export interface ModelConfig extends ModelInfo {
  vram_required_gb: number;
  min_peers: number;
  tier: string;
}

export interface LayerAssignment {
  model: ModelInfo;
  start_layer: number;
  end_layer: number;
  is_first: boolean;
  is_last: boolean;
  peer_order: string[];
}

// ==================== Chat Types ====================

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  model?: string;
  tokens?: number;
}

export interface ChatSession {
  id: string;
  messages: ChatMessage[];
  createdAt: Date;
  title?: string;
}

// ==================== WebSocket Events ====================

export interface WelcomeEvent {
  peer_id: string;
}

export interface LayerAssignmentEvent {
  model: ModelInfo;
  start_layer: number;
  end_layer: number;
  is_first: boolean;
  is_last: boolean;
  peer_order: string[];
}

export interface ClusterUpdateEvent {
  total_peers: number;
  ready_peers: number;
  total_vram_gb: number;
  active_model: string | null;
  pipeline_order: string[];
}

export interface ModelChangeEvent {
  model: ModelInfo;
  action: 'reload_layers';
}

export interface WebRTCSignalEvent {
  from_peer: string;
  signal: RTCSessionDescriptionInit | RTCIceCandidateInit;
}

// ==================== Inference Types ====================

export interface InferenceRequest {
  prompt: string;
  max_tokens: number;
  temperature: number;
  top_p: number;
}

export interface GenerationProgress {
  status: 'idle' | 'loading' | 'generating' | 'complete' | 'error';
  tokens_generated: number;
  tokens_per_second: number;
  error?: string;
}

// ==================== WebGPU Types ====================

export interface WebGPUInfo {
  supported: boolean;
  adapter: GPUAdapterInfoCustom | null;
  limits: Record<string, number> | null;
  estimatedVRAM: number;
}

export interface GPUAdapterInfoCustom {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
}
