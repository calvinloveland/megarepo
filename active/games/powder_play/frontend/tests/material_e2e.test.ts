import { describe, it, expect } from 'vitest';
import { runLocalLLM } from '../../material_gen/local_llm_runner';

describe('e2e generation', () => {
  it('generates, validates and compiles a demo material', async () => {
    const ast = await runLocalLLM('falling dust demo', (p:any)=>{});
    expect(ast).toBeDefined();
    expect(ast.type).toBe('material');
    expect(ast.__compiled).toBeDefined();
    expect(ast.__compiled.wgsl).toContain('WGSL');
  });
});
