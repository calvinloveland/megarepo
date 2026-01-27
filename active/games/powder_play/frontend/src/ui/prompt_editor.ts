import { runLocalLLM, installModelFromUrl } from '../material_api';

export function createPromptEditor(root: HTMLElement, onMaterialReady:(m:any)=>void) {
  const container = document.createElement('div');
  container.innerHTML = `
    <div>
      <h3>Create Material</h3>
      <textarea id="intent" rows="4" cols="40" placeholder="Describe the material..."></textarea><br/>
      <label><input type="checkbox" id="use-local-model"> Use local model (WASM)</label>
      <button id="install-model">Install model</button>
      <br/>
      <button id="gen">Generate</button>
      <div id="gen-status"></div>
    </div>
  `;
  root.appendChild(container);
  const btn = container.querySelector('#gen') as HTMLButtonElement;
  const status = container.querySelector('#gen-status') as HTMLElement;
  const installBtn = container.querySelector('#install-model') as HTMLButtonElement;
  const useLocal = container.querySelector('#use-local-model') as HTMLInputElement;

  installBtn.onclick = async () => {
    status.textContent = 'Installing model…';
    try {
      await installModelFromUrl('https://example.com/model', (pct:number)=>{
        status.textContent = `Installing: ${pct}%`;
      });
      status.textContent = 'Model installed (stub)';
      useLocal.checked = true;
    } catch (err:any) {
      status.textContent = 'Install error: ' + err.message;
    }
  }

  btn.onclick = async () => {
    status.textContent = 'Generating…';
    const intent = (container.querySelector('#intent') as HTMLTextAreaElement).value;
    try {
      const ast = await runLocalLLM(intent, (p:any)=>{
        status.textContent = `${p.stage}: ${p.message || ''}`;
      });
      status.textContent = 'Validated and compiled';
      onMaterialReady(ast);
    } catch (err:any) {
      status.textContent = 'Error: ' + err.message;
    }
  }
}
