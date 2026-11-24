import type { RawListing } from "../types";

/** What a channel adapter yields. `skipped` means the channel did not run, and is not an error. */
export type Collected = {
  items: RawListing[];
  error: string | null;
  skipped?: string;
  warnings?: string[];
};
