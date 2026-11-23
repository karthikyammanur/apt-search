// The model fallback chain: Gemini, then OpenRouter, Groq, SambaNova and Z.ai GLM Flash.
// Every entry speaks the OpenAI chat protocol, so one client covers all of them. A blank key
// means the provider is skipped. Model IDs change often on free tiers, so each one can be
// overridden from the environment (for example GEMINI_MODEL) without a code change.

export type LlmProviderId = "gemini" | "openrouter" | "groq" | "sambanova" | "zai";

export type LlmProvider = {
  id: LlmProviderId;
  baseURL: string;
  apiKey: string;
  /** Model for text-only turns. */
  model: string;
  /** Model for turns with screenshots. Null when the provider has none. */
  visionModel: string | null;
};

type Spec = {
  id: LlmProviderId;
  keyEnv: string;
  modelEnv: string;
  visionEnv: string;
  baseURL: string;
  model: string;
  visionModel: string | null;
};

/** Order matters: the first configured provider is tried first. Base URLs and model IDs checked against each provider's /models list on 2026-11-23. */
export const PROVIDER_SPECS: readonly Spec[] = [
  {
    id: "gemini",
    keyEnv: "GEMINI_API_KEY",
    modelEnv: "GEMINI_MODEL",
    visionEnv: "GEMINI_VISION_MODEL",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    model: "gemini-3.5-flash-lite",
    visionModel: "gemini-3.8-flash",
  },
  {
    id: "openrouter",
    keyEnv: "OPENROUTER_API_KEY",
    modelEnv: "OPENROUTER_MODEL",
    visionEnv: "OPENROUTER_VISION_MODEL",
    baseURL: "https://openrouter.ai/api/v1",
    model: "nvidia/nemotron-3.5-super-vl:free",
    visionModel: "nvidia/nemotron-3.5-super-vl:free",
  },
  {
    id: "groq",
    keyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_MODEL",
    visionEnv: "GROQ_VISION_MODEL",
    baseURL: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b",
    visionModel: null,
  },
  {
    id: "sambanova",
    keyEnv: "SAMBANOVA_API_KEY",
    modelEnv: "SAMBANOVA_MODEL",
    visionEnv: "SAMBANOVA_VISION_MODEL",
    baseURL: "https://api.sambanova.ai/v1",
    model: "gpt-oss-120b",
    visionModel: "gemma-4-31B-it",
  },
  {
    id: "zai",
    keyEnv: "ZAI_API_KEY",
    modelEnv: "ZAI_MODEL",
    visionEnv: "ZAI_VISION_MODEL",
    baseURL: "https://api.z.ai/api/paas/v4",
    model: "glm-4.7-flash",
    visionModel: null,
  },
];

type Env = Record<string, string | undefined>;

/** Providers that have a key, in fallback order. A blank or whitespace key skips the provider. */
export function configuredProviders(env: Env = process.env): LlmProvider[] {
  const out: LlmProvider[] = [];
  for (const spec of PROVIDER_SPECS) {
    const apiKey = (env[spec.keyEnv] ?? "").trim();
    if (!apiKey) continue;
    const vision = (env[spec.visionEnv] ?? "").trim() || spec.visionModel;
    out.push({
      id: spec.id,
      baseURL: spec.baseURL,
      apiKey,
      model: (env[spec.modelEnv] ?? "").trim() || spec.model,
      visionModel: vision,
    });
  }
  return out;
}
