// Very small safe compiler that emits a WGSL stub for simple MBL primitives.
// This is conservative: it only supports `move` and `read` patterns for now.

export function compileMBLtoWGSL(ast: any): string {
  if (!ast || !Array.isArray(ast.primitives)) throw new Error('Invalid AST');
  for (const p of ast.primitives) {
    if (!['move','read','if','rand','timer'].includes(p.op)) {
      throw new Error('Unsupported primitive for GPU compilation: ' + p.op);
    }
  }
  // Return a minimal WGSL compute shader that will be used as a template by the backend.
  // The real compiler will emit neighbor reads and write logic mapped from the AST.
  return `// WGSL stub compiled from MBL for material: ${ast.name}\n@compute @workgroup_size(8,8,1)\nfn main() { /* compiled logic */ }`;
}
