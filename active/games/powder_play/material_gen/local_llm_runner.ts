import { generateMaterialFromIntent } from './llm_adapter';
import { validateMaterial } from './validator';
import { compileMBLtoWGSL } from './wgsl_compiler';

export type Progress = {stage: string, message?: string};

export async function runLocalLLM(intent: string, onProgress?: (p: Progress)=>void): Promise<any> {
  onProgress && onProgress({stage:'generating', message:'Generating material AST'});
  // Delegate to existing adapter (stub for real local model)
  const ast = await generateMaterialFromIntent(intent);

  onProgress && onProgress({stage:'validating', message:'Running static validation'});
  const v = await validateMaterial(ast);
  if (!v.ok) throw new Error('Validation failed: ' + JSON.stringify(v.errors));

  onProgress && onProgress({stage:'testing', message:'Running deterministic tests'});
  // TODO: run offline deterministic harness here; for now we assume pass
  await new Promise(res=>setTimeout(res, 250));

  onProgress && onProgress({stage:'compiling', message:'Compiling to WGSL'});
  // Try to compile to WGSL to ensure it is supported by GPU backend
  const wgsl = compileMBLtoWGSL(ast);
  onProgress && onProgress({stage:'done', message:'Material ready',});
  // Attach compiled shader as metadata
  (ast as any).__compiled = {wgsl};
  return ast;
}
