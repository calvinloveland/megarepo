// Stub adapter for local LLM. For now, returns a conservative example JSON AST.
import templates from './prompt_templates.json';

export async function generateMaterialFromIntent(intent: string): Promise<any> {
  // TODO: integrate with local LLM runtime (ggml / llama.cpp / gpt4all)
  // For MVP, return a simple example.
  return {
    type: 'material',
    name: 'dust_'+Math.floor(Math.random()*1000),
    description: intent,
    primitives: [
      {op: 'read', dx:0, dy:1},
      {op: 'if', cond:{eq:{read:1, value:0}}, then:[{op:'move', dx:0, dy:1}]}
    ],
    budgets: {max_ops:50, max_spawns:1}
  };
}
