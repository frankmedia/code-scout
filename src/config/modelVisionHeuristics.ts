/**
 * Infer image-input support from model id strings (OpenRouter `org/model`, Ollama tags, GGUF names).
 * Not authoritative — use Settings **Images in chat** to override.
 *
 * - **Qwen2.5-Coder** (incl. `qwen/qwen2.5-coder-…` on OpenRouter) → text-only.
 * - **Qwen-VL**, **llava**, **llama 3.2 vision**, **pixtral**, etc. → multimodal.
 */
export function guessSupportsVisionFromModelId(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (!id.trim()) return false;

  const visionMarkers =
    /(^|[-_/])(vl|vision)([-_/]|$)/.test(id) ||
    /llava|pixtral|moondream|cogvlm|internvl|minicpm-v|bakllava|smolvlm|idefics|bunny|fuyu|kosmos|phi[-_]?3[-_.]*vision|gemma[-_]?3|molmo|paligemma|granite-vision|nemotron.*nano.*vl|nvidia\/nemotron/i.test(
      id,
    ) ||
    /qwen[-_]?[\d.]*[-_]?vl|qwen2\.5-vl|qwen2_5_vl|qwen-vl|qwen\/qwen.*vl/.test(id) ||
    /llama[-_]?3\.2[-_/].*vision|llama3\.2-vision|llama[-_/]3\.2[-_/][^/\s]*vision|meta-llama\/llama-3\.2.*vision/i.test(
      id,
    ) ||
    /vision-instruct|vision-preview|90b-vision|11b-vision|multimodal-instruct/i.test(id);

  if (visionMarkers) return true;

  const codeFirstLikelyTextOnly =
    /coder|codellama|code-llama|starcoder|deepseek-coder|wizardcoder|codeqwen|qwen[-_\/]?[\d.]*[-_]?coder|qwen2\.5-coder|\/qwen2\.5-coder/.test(
      id,
    ) &&
    !/(vl|vision|llava|pixtral)/.test(id);

  if (codeFirstLikelyTextOnly) return false;

  return false;
}

/**
 * `supportsVision === true` → on; `false` → off; `undefined` → guess from `modelId`.
 */
export function effectiveSupportsVision(model: { supportsVision?: boolean; modelId: string } | undefined): boolean {
  if (!model) return false;
  if (model.supportsVision === true) return true;
  if (model.supportsVision === false) return false;
  return guessSupportsVisionFromModelId(model.modelId);
}
