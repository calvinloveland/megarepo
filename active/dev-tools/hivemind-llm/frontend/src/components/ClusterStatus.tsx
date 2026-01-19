/**
 * Cluster status panel showing connected peers and model info
 */

import { useClusterStore, useChatStore, useHardwareStore } from '../store';
import { getGPUDescription } from '../inference/webgpu';

export function ClusterStatus() {
  const { connected, peerState, clusterStats, peerId } = useClusterStore();
  const { activeModel, generation } = useChatStore();
  const { webgpu, modelLoaded, modelLoadProgress } = useHardwareStore();

  const gpuDescription = webgpu ? getGPUDescription(webgpu) : 'Detecting...';
  const isFinalizingShaders = !modelLoaded && modelLoadProgress >= 0.8;

  return (
    <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-3">
      <div className="max-w-4xl mx-auto">
        {/* Connection Status */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                connected
                  ? peerState === 'ready'
                    ? 'bg-green-500'
                    : 'bg-yellow-500 animate-pulse'
                  : 'bg-red-500'
              }`}
            />
            <span className="text-sm text-zinc-400">
              {connected
                ? peerState === 'ready'
                  ? 'Connected'
                  : peerState === 'downloading'
                  ? 'Loading model...'
                  : 'Connecting...'
                : 'Disconnected'}
            </span>
            {peerId && (
              <span className="text-xs text-zinc-600 font-mono">
                {peerId.slice(0, 8)}
              </span>
            )}
          </div>

          {/* GPU Info */}
          <div className="text-sm text-zinc-500">
            <span className="hidden sm:inline">{gpuDescription}</span>
          </div>
        </div>

        {/* Cluster Stats */}
        {clusterStats && (
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <svg
                className="w-4 h-4 text-hivemind-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              <span className="text-zinc-400">
                <span className="text-zinc-200">{clusterStats.ready_peers}</span>
                /{clusterStats.total_peers} peers
              </span>
            </div>

            <div className="flex items-center gap-2">
              <svg
                className="w-4 h-4 text-hivemind-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
                />
              </svg>
              <span className="text-zinc-400">
                <span className="text-zinc-200">
                  {clusterStats.total_vram_gb.toFixed(1)}
                </span>
                GB VRAM
              </span>
            </div>

            {activeModel && (
              <div className="flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-hivemind-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                  />
                </svg>
                <span className="text-zinc-200">{activeModel.name}</span>
              </div>
            )}
          </div>
        )}

        {/* Model Loading Progress */}
        {!modelLoaded && modelLoadProgress > 0 && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-xs text-zinc-500 mb-1">
              <span>
                {isFinalizingShaders
                  ? 'Finalizing GPU shaders...'
                  : 'Loading model...'}
              </span>
              <span>{Math.round(modelLoadProgress * 100)}%</span>
            </div>
            <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full bg-hivemind-500 transition-all duration-300 ${
                  isFinalizingShaders ? 'animate-pulse' : ''
                }`}
                style={{ width: `${modelLoadProgress * 100}%` }}
              />
            </div>
            {isFinalizingShaders && (
              <p className="mt-1 text-[0.7rem] text-zinc-500">
                The last step can take a few minutes on some GPUs.
              </p>
            )}
          </div>
        )}

        {/* Generation Stats */}
        {generation.status === 'generating' && (
          <div className="mt-2 text-xs text-zinc-500">
            {generation.tokens_generated} tokens •{' '}
            {generation.tokens_per_second.toFixed(1)} tokens/sec
          </div>
        )}
      </div>
    </div>
  );
}
