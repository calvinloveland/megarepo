// Stub adapter for local LLM. For now, returns a conservative example JSON AST.
import templates from './prompt_templates.json';

export async function generateMaterialFromIntent(intent: string): Promise<any> {
  // TODO: integrate with local LLM runtime (ggml / llama.cpp / gpt4all)
  // For MVP, return a simple example.
  return {
    type: 'material',
    name: 'dust_'+Math.floor(Math.random()*1000),
    description: intent,
    tags: ['sand'],
    density: 1.5,
    color: [190, 180, 140]
  };
}
