# Local LLM Integration (WASM / WebGPU)

This page describes how to enable a local LLM for material generation in the browser.

Options:
- Use a WASM/WebGPU-accelerated build of a small quantized model (e.g., a ggml/llama.cpp web build).
- Download a pre-quantized model and follow the instructions to place it in the browser's local storage or IndexedDB using the provided UI.

MVP workflow:
1. Click "Install model" in the UI and follow prompts (or place model files in the browser storage manually).
2. Enable the "Use local model" checkbox.
3. Generate a material; the local WASM runtime will be invoked to produce a JSON MBL AST.

Notes:
- Model downloads can be large (10s - 100s MB). Consider providing an optional small model for quick tests.
- Security: the browser isolates the runtime; we still validate every output before enabling it.
