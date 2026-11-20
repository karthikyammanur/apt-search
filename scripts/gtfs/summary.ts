/** Anchor station names so unrelated stops mentioning Palo Alto are excluded. */
export const SUMMARY_STATIONS = [
  {
    label: "California Ave Caltrain",
    pattern: /^california (ave|avenue)\b/i,
    requiredMode: "rail",
  },
  {
    label: "Palo Alto Transit Center",
    pattern: /^palo alto(?: transit (?:center|ctr)\b| caltrain\b| station\b|$)/i,
    requiredMode: null,
  },
] as const;
