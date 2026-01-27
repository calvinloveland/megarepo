// Frontend-local material API shim for browser usage (demo-only, avoids importing files outside Vite root)
export async function runLocalLLM(intent: string, onProgress?: (p:any)=>void) {
  onProgress && onProgress({stage:'generating', message:'demo model'});
  // simple demo model same as demo_model
  const lower = (intent||'').toLowerCase();
  const name = 'demo_' + (lower.split(/\s+/)[0] || 'x');
  const ast = {
    type: 'material', name, description: intent,
    primitives: [ {op:'read', dx:0,dy:1}, {op:'if', cond:{eq:{read:1,value:0}}, then:[{op:'move',dx:0,dy:1}]} ],
    budgets: {max_ops:50, max_spawns:1}
  };
  onProgress && onProgress({stage:'validating'});
  await new Promise(r=>setTimeout(r,100));
  onProgress && onProgress({stage:'compiled'});
  (ast as any).__compiled = {wgsl: `// WGSL stub for ${ast.name}`};
  return ast;
}

export async function installModelFromUrl(_url:string, onProgress?: (pct:number)=>void) {
  onProgress && onProgress(0);
  await new Promise(r=>setTimeout(r,200)); onProgress && onProgress(50);
  await new Promise(r=>setTimeout(r,200)); onProgress && onProgress(100);
  return true;
}
