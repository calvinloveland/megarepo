export function attachControls(root: HTMLElement, onPlayChange:(playing:boolean)=>void) {
  const div = document.createElement('div');
  div.innerHTML = `
    <button id="play-btn">Play</button>
    <button id="step-btn">Step</button>
    <select id="backend-select">
      <option value="cpu">CPU</option>
      <option value="gpu">WebGPU</option>
    </select>
  `;
  root.appendChild(div);
  const playBtn = div.querySelector('#play-btn') as HTMLButtonElement;
  const stepBtn = div.querySelector('#step-btn') as HTMLButtonElement;
  const backendSel = div.querySelector('#backend-select') as HTMLSelectElement;

  let playing = false;
  let interval: any = null;

  playBtn.onclick = () => {
    playing = !playing;
    playBtn.textContent = playing ? 'Pause' : 'Play';
    if (playing) {
      interval = setInterval(()=> onPlayChange(true), 1000/30);
    } else {
      clearInterval(interval);
      onPlayChange(false);
    }
  };

  stepBtn.onclick = () => onPlayChange(false);

  backendSel.onchange = () => {
    const ev = new CustomEvent('backend_change', {detail: backendSel.value});
    root.dispatchEvent(ev);
  };
}
