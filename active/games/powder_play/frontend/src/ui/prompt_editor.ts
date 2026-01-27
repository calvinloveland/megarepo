import { generateMaterialFromIntent } from '../../material_gen/llm_adapter';
import { validateMaterial } from '../../material_gen/validator';

export function createPromptEditor(root: HTMLElement, onMaterialReady:(m:any)=>void) {
  const container = document.createElement('div');
  container.innerHTML = `
    <div>
      <h3>Create Material</h3>
      <textarea id="intent" rows="4" cols="40" placeholder="Describe the material..."></textarea><br/>
      <button id="gen">Generate</button>
      <div id="gen-status"></div>
    </div>
  `;
  root.appendChild(container);
  const btn = container.querySelector('#gen') as HTMLButtonElement;
  const status = container.querySelector('#gen-status') as HTMLElement;
  btn.onclick = async () => {
    status.textContent = 'Generating…';
    const intent = (container.querySelector('#intent') as HTMLTextAreaElement).value;
    const ast = await generateMaterialFromIntent(intent);
    const ok = await validateMaterial(ast);
    if (!ok.ok) {
      status.textContent = 'Validation failed: ' + JSON.stringify(ok.errors);
      return;
    }
    status.textContent = 'Validated';
    onMaterialReady(ast);
  }
}
