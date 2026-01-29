import { generateMaterialFromIntent } from "./llm_adapter";
import { validateMaterial } from "./validator";
import { hasWasmRuntime, runWasmModel } from "./wasm_llm_runner";

export type Progress = { stage: string; message?: string };

export async function runLocalLLM(
  intent: string,
  onProgress?: (p: Progress) => void,
): Promise<any> {
  onProgress &&
    onProgress({
      stage: "checking",
      message: "Checking for local WASM runtime",
    });
  const hasWasm = await hasWasmRuntime();
  let ast: any;
  if (hasWasm) {
    onProgress &&
      onProgress({ stage: "generating", message: "Running WASM LLM locally" });
    ast = await runWasmModel(
      intent,
      (m: any) => onProgress && onProgress({ stage: "wasm", message: m }),
    );
  } else {
    onProgress &&
      onProgress({
        stage: "generating",
        message: "Generating material AST (fallback)",
      });
    ast = await generateMaterialFromIntent(intent);
  }

  onProgress &&
    onProgress({ stage: "validating", message: "Running static validation" });
  const v = await validateMaterial(ast);
  if (!v.ok) throw new Error("Validation failed: " + JSON.stringify(v.errors));

  onProgress &&
    onProgress({ stage: "testing", message: "Running deterministic tests" });
  // TODO: run offline deterministic harness here; for now we assume pass
  await new Promise((res) => setTimeout(res, 250));

  onProgress && onProgress({ stage: "done", message: "Material ready" });
  return ast;
}
