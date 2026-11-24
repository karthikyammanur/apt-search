// Public interface of the intake layer, for steps 6 (agent) and 7 (screens).

export * from "./types";
export * from "./pipeline";
export { createDeps } from "./deps";
export { recompute, readAnalysis, analyzeFacts, type Analysis } from "./analysis";
export { loadFacts, saveFacts, FACT_SCHEMAS, isFactField, type FactField, type FactWrite } from "./facts";
export { runAutomaticChannels, processBatch, type ChannelSummary, type AutomaticChannel } from "./run";
export { handleCapture, tokenMatches, CAPTURE_TOKEN_HEADER } from "./capture";
export { loadWeights } from "./store";
