import { describe, it, expect, vi } from 'vitest';
import { runLocalLLM } from '../src/material_api';

describe('e2e generation', () => {
  it('generates, validates and compiles a demo material', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        response: JSON.stringify({
          type: 'material',
          name: 'DemoDust',
          description: 'A demo material',
          tags: ['sand'],
          density: 1.5,
          color: [190, 180, 140]
        })
      })
    }) as any;
    const ast = await runLocalLLM('falling dust demo', (p:any)=>{});
    globalThis.fetch = originalFetch;
    expect(ast).toBeDefined();
    expect(ast.type).toBe('material');
    expect(ast.name).toBe('DemoDust');
    expect(Array.isArray(ast.tags)).toBeTruthy();
  });
});
