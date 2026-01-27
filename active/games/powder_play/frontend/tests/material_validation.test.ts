import { describe, it, expect } from 'vitest';
import { validateMaterial } from '../../material_gen/validator';
import { Interpreter } from '../../material_runtime/interpreter';

describe('material validator', () => {
  it('rejects budgets that exceed limits', () => {
    const ast = { type:'material', name:'bad', primitives:[], budgets:{max_ops:1000, max_spawns:10} } as any;
    const res = await validateMaterial(ast);
    expect(res.ok).toBe(false);
    expect(res.errors).toBeDefined();
  });

  it('accepts a simple valid material', async () => {
    const ast = {
      type: 'material', name: 'dust', primitives: [ {op:'move', dx:0, dy:1} ], budgets: {max_ops:10, max_spawns:1}
    } as any;
    const res = await validateMaterial(ast);
    expect(res.ok).toBe(true);
  });
});

describe('interpreter', () => {
  it('respects maxOps budgets', () => {
    // create many primitives but small max_ops
    const prims = [] as any[];
    for (let i=0;i<500;i++) prims.push({op:'read', dx:0, dy:1});
    const ast = { type:'material', name:'busy', primitives:prims, budgets:{max_ops:20, max_spawns:0}} as any;
    const ip = new Interpreter(ast);
    const ctx = {
      readNeighbor: (_dx:number,_dy:number) => 0,
      lastRead:0,
      intent:null
    } as any;
    ip.step(ctx);
    expect(ip.ops).toBeLessThanOrEqual(20);
  });
});
