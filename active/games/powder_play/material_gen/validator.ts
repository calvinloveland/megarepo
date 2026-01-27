import schema from './schema.json';

const allowedOps = new Set(['move','swap','set','spawn','change_state','read','if','rand','timer']);

export async function validateMaterial(ast: any): Promise<{ok:boolean, errors?: any[]}> {
  const { default: Ajv } = await import('ajv');
  const ajv = new Ajv();
  const validate = ajv.compile(schema as any);

  const valid = validate(ast);
  if (!valid) return {ok:false, errors:validate.errors};
  // Additional budget checks
  const budgets = ast.budgets || {};
  if (budgets.max_ops > 200 || budgets.max_spawns > 4) {
    return {ok:false, errors:[{message:'Budget exceeds allowed limits'}]};
  }
  // Ensure primitives list is an array of objects with allowed ops
  if (!Array.isArray(ast.primitives)) return {ok:false, errors:[{message:'primitives must be array'}]};
  for (const p of ast.primitives) {
    if (!p || typeof p !== 'object' || !allowedOps.has(p.op)) return {ok:false, errors:[{message:'Invalid primitive op'}]};
  }
  return {ok:true};
}
