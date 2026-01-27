const allowedOps = new Set(['move','swap','set','spawn','change_state','read','if','rand','timer']);

// Lightweight validator to avoid heavy dependency during early prototyping.
export async function validateMaterial(ast: any): Promise<{ok:boolean, errors?: any[]}> {
  const errors: any[] = [];
  if (!ast || typeof ast !== 'object') return {ok:false, errors:[{message:'ast must be object'}]};
  if (ast.type !== 'material') errors.push({message:'type must be "material"'});
  if (typeof ast.name !== 'string' || !ast.name) errors.push({message:'name required'});
  if (!Array.isArray(ast.primitives)) errors.push({message:'primitives must be array'});
  if (ast.budgets == null || typeof ast.budgets !== 'object') errors.push({message:'budgets required'});
  else {
    const b = ast.budgets;
    if (typeof b.max_ops !== 'number' || b.max_ops < 1 || b.max_ops > 200) errors.push({message:'max_ops out of range'});
    if (typeof b.max_spawns !== 'number' || b.max_spawns < 0 || b.max_spawns > 4) errors.push({message:'max_spawns out of range'});
  }
  if (Array.isArray(ast.primitives)) {
    for (const p of ast.primitives) {
      if (!p || typeof p !== 'object' || !allowedOps.has(p.op)) errors.push({message:'Invalid primitive op'});
    }
  }
  return {ok: errors.length === 0, errors: errors.length ? errors : undefined};
}
