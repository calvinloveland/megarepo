import { describe, it, expect } from 'vitest';
import { runLocalLLM } from '../src/material_api';

describe('e2e generation', () => {
  it('generates, validates and compiles a demo material', async () => {
    const ast = await runLocalLLM('falling dust demo', (p:any)=>{});
    expect(ast).toBeDefined();
    expect(ast.type).toBe('material');
    expect(ast.__compiled).toBeDefined();
    expect(ast.__compiled.wgsl).toContain('WGSL');
  });
});
