import { createLlm } from "./client";

export * from "./client";
export * from "./providers";

/** Shared client using the providers whose keys are set in the environment. */
export const llm = createLlm();
export const generateStructured = llm.generateStructured;
