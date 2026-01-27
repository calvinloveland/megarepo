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
  if (ast.color !== undefined) {
    const c = ast.color;
    const isHex = typeof c === 'string';
    const isArray = Array.isArray(c) && c.length >= 3 && c.length <= 4 && c.every((v:any)=>typeof v === 'number' && v>=0 && v<=255);
    if (!isHex && !isArray) errors.push({message:'color must be hex string or [r,g,b] array'});
  }
  if (ast.density !== undefined) {
    if (typeof ast.density !== 'number' || ast.density < 0) errors.push({message:'density must be non-negative number'});
  }
  if (ast.reactions !== undefined) {
    if (!Array.isArray(ast.reactions)) errors.push({message:'reactions must be array'});
    else {
      for (const r of ast.reactions) {
        if (!r || typeof r !== 'object') { errors.push({message:'reaction must be object'}); continue; }
        if (typeof r.with !== 'string' || !r.with) errors.push({message:'reaction.with required'});
        if (typeof r.result !== 'string' || !r.result) errors.push({message:'reaction.result required'});
        if (r.byproduct !== undefined && typeof r.byproduct !== 'string') errors.push({message:'reaction.byproduct must be string'});
        if (r.probability !== undefined && (typeof r.probability !== 'number' || r.probability < 0 || r.probability > 1)) errors.push({message:'reaction.probability must be 0..1'});
        if (r.priority !== undefined && typeof r.priority !== 'number') errors.push({message:'reaction.priority must be number'});
      }
    }
  }
  if (ast.condense !== undefined) {
    const c = ast.condense;
    if (!c || typeof c !== 'object') errors.push({message:'condense must be object'});
    else {
      if (c.at !== 'top') errors.push({message:'condense.at must be "top"'});
      if (typeof c.result !== 'string' || !c.result) errors.push({message:'condense.result required'});
      if (c.probability !== undefined && (typeof c.probability !== 'number' || c.probability < 0 || c.probability > 1)) errors.push({message:'condense.probability must be 0..1'});
    }
  }
  return {ok: errors.length === 0, errors: errors.length ? errors : undefined};
}
