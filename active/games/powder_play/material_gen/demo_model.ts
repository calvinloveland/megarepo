// Simple deterministic demo model generator used for local testing.
export function generateDemoModel(intent: string) {
  // Map some keywords to behavior; keep conservative budgets
  const lower = (intent || '').toLowerCase();
  const name = 'demo_' + (lower.split(/\s+/)[0] || 'x');
  if (lower.includes('water')) {
    return {
      type: 'material',
      name,
      description: intent,
      primitives: [
        {op:'read', dx:0, dy:1},
        {op:'if', cond:{eq:{read:1, value:0}}, then:[{op:'move', dx:0, dy:1}]}
      ],
      budgets: {max_ops:50, max_spawns:1}
    };
  }
  // default: simple falling dust
  return {
    type: 'material',
    name,
    description: intent,
    primitives: [
      {op:'read', dx:0, dy:1},
      {op:'if', cond:{eq:{read:1, value:0}}, then:[{op:'move', dx:0, dy:1}]}
    ],
    budgets: {max_ops:50, max_spawns:0}
  };
}
