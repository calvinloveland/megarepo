# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e4]:
    - heading "Powder Playground" [level=1] [ref=e5]
    - generic [ref=e7]:
      - button "Play" [ref=e8]
      - button "Step" [ref=e9]
      - combobox [ref=e10]:
        - option "CPU" [selected]
        - option "WebGPU"
    - generic [ref=e11]: Ready
  - generic [ref=e15]:
    - generic [ref=e16]: "[plugin:vite:import-analysis] Failed to resolve import \"../../material_gen/local_llm_runner\" from \"src/ui/prompt_editor.ts\". Does the file exist?"
    - generic [ref=e17]: /workspaces/megarepo/active/games/powder_play/frontend/src/ui/prompt_editor.ts:2:28
    - generic [ref=e18]: "1 | import { runLocalLLM } from \"../../material_gen/local_llm_runner\"; | ^ 2 | export function createPromptEditor(root, onMaterialReady) { 3 | const container = document.createElement(\"div\");"
    - generic [ref=e19]: at TransformPluginContext._formatError (file:///workspaces/megarepo/active/games/powder_play/frontend/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:49258:41) at TransformPluginContext.error (file:///workspaces/megarepo/active/games/powder_play/frontend/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:49253:16) at normalizeUrl (file:///workspaces/megarepo/active/games/powder_play/frontend/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:64307:23) at process.processTicksAndRejections (node:internal/process/task_queues:95:5) at async file:///workspaces/megarepo/active/games/powder_play/frontend/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:64439:39 at async Promise.all (index 0) at async TransformPluginContext.transform (file:///workspaces/megarepo/active/games/powder_play/frontend/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:64366:7) at async PluginContainer.transform (file:///workspaces/megarepo/active/games/powder_play/frontend/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:49099:18) at async loadAndTransform (file:///workspaces/megarepo/active/games/powder_play/frontend/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51978:27
    - generic [ref=e20]:
      - text: Click outside, press Esc key, or fix the code to dismiss.
      - text: You can also disable this overlay by setting
      - code [ref=e21]: server.hmr.overlay
      - text: to
      - code [ref=e22]: "false"
      - text: in
      - code [ref=e23]: vite.config.js
      - text: .
```