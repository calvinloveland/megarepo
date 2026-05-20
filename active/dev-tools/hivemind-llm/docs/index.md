# HiveMind LLM

**Distributed Browser-Based LLM Inference — The More Users, The Smarter It Gets**

HiveMind LLM is a chat application that runs large language models directly in users' browsers using WebGPU. What makes it unique: as more users join the chat, their combined computing power automatically unlocks access to larger, more capable models.

## 🎯 Core Concept

```
1 user  → TinyLlama 1.1B (runs locally)
5 users → Phi-2 2.7B (distributed across browsers)
10+ users → Llama 3.2 3B or larger (fully distributed)
```

Unlike traditional LLM services where the server does all the work, HiveMind distributes model inference across all connected users. Each browser handles a portion of the model's layers, coordinating via WebRTC for peer-to-peer communication.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chat Interface                            │
│                (Static HTML + TypeScript)                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Coordinator Service                           │
│  • Peer discovery & WebRTC signaling                            │
│  • Cluster capacity tracking                                     │
│  • Model selection based on available compute                   │
│  • Token routing between peers                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│    Browser 1    │  │    Browser 2    │  │    Browser 3    │
│  ┌───────────┐  │  │  ┌───────────┐  │  │  ┌───────────┐  │
│  │  Layers   │  │  │  │  Layers   │  │  │  │  Layers   │  │
│  │   0-10    │  │  │  │  11-20    │  │  │  │  21-31    │  │
│  └───────────┘  │  │  └───────────┘  │  │  └───────────┘  │
│    WebGPU       │  │    WebGPU       │  │    WebGPU       │
└─────────────────┘  └─────────────────┘  └─────────────────┘
         │                    │                    │
         └────────── WebRTC P2P Mesh ─────────────┘
```

## 🚀 How It Works

1. **User Joins**: When you open HiveMind, your browser checks WebGPU capability and reports available VRAM to the coordinator.

2. **Cluster Formation**: The coordinator tracks all connected peers and their compute capacity.

3. **Model Selection**: Based on total cluster capacity, the coordinator selects the largest model that can run efficiently:
   - < 4GB total VRAM → TinyLlama 1.1B (single peer)
   - 4-8GB → Phi-2 2.7B (2-3 peers)
   - 8-16GB → Llama 3.2 3B (4-6 peers)
   - 16GB+ → Larger models as capacity allows

4. **Layer Distribution**: Model layers are assigned to peers based on their available VRAM. Peers download only their assigned layers.

5. **Inference Pipeline**:
   - User sends a message
   - Tokens are embedded on the first peer
   - Hidden states flow through peers in sequence (pipeline parallelism)
   - Final peer generates output tokens
   - Response streams back to the user

6. **Dynamic Scaling**: As peers join/leave, the system automatically rebalances layers and may upgrade/downgrade the active model.

## 🔧 Technology Stack

### Frontend
- **Static HTML** + **TypeScript** for the UI
- **WebGPU** via [@aspect-build/aspect-webassets](https://github.com/aspect-build/aspect-webassets) for GPU compute
- **WebLLM** (MLC-AI) for browser-based model inference
- **WebRTC** for peer-to-peer hidden state transfer

### Backend (Coordinator)
- **Python** + **Flask** for signaling server
- **WebSocket** for real-time peer coordination
- **Redis** (optional) for multi-instance coordinator scaling

### ML/Inference
- **MLC-compiled models** in WebGPU format
- Custom layer partitioning for distributed inference
- Quantized models (4-bit) to minimize VRAM requirements

## 📦 Project Structure

```
hivemind-llm/
├── coordinator/           # Python signaling server
│   ├── app.py            # Flask application
│   ├── cluster.py        # Cluster state management
│   ├── models.py         # Model registry & selection logic
│   └── requirements.txt
├── frontend/             # React chat application
│   ├── src/
│   │   ├── components/   # UI components
│   │   ├── inference/    # WebGPU inference engine
│   │   ├── network/      # WebRTC & signaling
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts
├── shared/               # Shared types & protocols
│   └── protocol.ts       # Message types for peer communication
└── docs/
    └── architecture.md   # Detailed architecture documentation
```

## 🎮 Usage

### Running Locally

```bash
# Start the coordinator
cd coordinator
pip install -r requirements.txt
python app.py

# In another terminal, start the frontend
cd frontend
npm install
npm run dev
```

### Docker

```bash
docker-compose up
```

Then open `http://localhost:5173` in multiple browser windows to see the distributed inference in action!

## 🧪 Development Status

This is an experimental project exploring browser-based distributed LLM inference. Current status:

- [ ] Coordinator service (signaling + cluster management)
- [ ] WebGPU capability detection
- [ ] Single-peer inference with WebLLM
- [ ] WebRTC peer mesh
- [ ] Distributed layer execution
- [ ] Dynamic model switching
- [ ] Chat UI

## 🔮 Future Ideas

- **Incentive Layer**: Reward contributors with tokens or priority access
- **Persistence**: Cache model layers in IndexedDB for faster rejoins
- **Privacy Mode**: Encrypted hidden states for sensitive conversations
- **Mobile Support**: Extend to WebGPU-capable mobile browsers
- **Federated Training**: Allow the swarm to fine-tune models collaboratively

## 📚 Inspiration

- [Petals](https://petals.dev/) - BitTorrent-style distributed LLM inference
- [WebLLM](https://webllm.mlc.ai/) - High-performance in-browser LLM inference
- [BOINC](https://boinc.berkeley.edu/) - Volunteer distributed computing

## 📄 License

MIT License - See [LICENSE](../LICENSE) for details.
