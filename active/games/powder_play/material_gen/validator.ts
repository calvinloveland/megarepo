import Ajv from 'ajv';
import schema from './schema.json';

const ajv = new Ajv();
const validate = ajv.compile(schema as any);

export function validateMaterial(ast: any): {ok:boolean, errors?: any[]} {
  const valid = validate(ast);
  if (!valid) return {ok:false, errors:validate.errors};
  // Additional budget checks
  const budgets = ast.budgets || {};
  if (budgets.max_ops > 200 || budgets.max_spawns > 4) {
    return {ok:false, errors:[{message:'Budget exceeds allowed limits'}]};
  }
  // Ensure primitives list is an array of objects
  if (!Array.isArray(ast.primitives)) return {ok:false, errors:[{message:'primitives must be array'}]};
  return {ok:true};
}
