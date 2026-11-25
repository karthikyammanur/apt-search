// A post with no street address often still names where it is: a neighbourhood or campus area,
// cross streets, a station ("near Cal Ave Caltrain") or a city. This finds that phrase in the post's
// own words, and turns it into a search string for the geocoder. It never invents a place: every
// result is a phrase the post contains. The point the geocoder returns is only ever an estimate.

export type ApproximateKind = "cross_streets" | "station" | "landmark" | "city";

export type ApproximatePlace = {
  kind: ApproximateKind;
  /** What to ask the geocoder for. */
  query: string;
  /** How the place is shown: "near California Avenue Caltrain", "Menlo Park". */
  label: string;
};

/** Places named without a street, each with the words that name it and what to search for. */
const LANDMARKS: readonly { words: RegExp; query: string; label: string }[] = [
  { words: /\b(?:evgr|escondido\s+village)\b/i, query: "Escondido Village, Stanford, CA", label: "Escondido Village" },
  { words: /\b(?:stanford\s+(?:campus|university)|on[- ]campus|next\s+to\s+stanford|near\s+stanford|close\s+to\s+stanford)\b/i, query: "Stanford University, Stanford, CA", label: "Stanford campus" },
  { words: /\bstanford\b/i, query: "Stanford University, Stanford, CA", label: "Stanford" },
  { words: /\bdowntown\s+palo\s+alto\b|\buniversity\s+ave(?:nue)?\b/i, query: "University Avenue, Palo Alto, CA", label: "Downtown Palo Alto" },
  { words: /\bdowntown\s+menlo\s+park\b/i, query: "Santa Cruz Avenue, Menlo Park, CA", label: "Downtown Menlo Park" },
  { words: /\bdowntown\s+mountain\s+view\b|\bcastro\s+st(?:reet)?\b/i, query: "Castro Street, Mountain View, CA", label: "Downtown Mountain View" },
  { words: /\bmidtown\b.*\bpalo\s+alto\b|\bpalo\s+alto\b.*\bmidtown\b/i, query: "Midtown, Palo Alto, CA", label: "Midtown Palo Alto" },
  { words: /\bsouth\s+palo\s+alto\b/i, query: "South Palo Alto, Palo Alto, CA", label: "South Palo Alto" },
  { words: /\bsand\s+hill\b/i, query: "Sand Hill Road, Menlo Park, CA", label: "Sand Hill Road" },
  { words: /\bstanford\s+(?:shopping\s+center|mall)\b/i, query: "Stanford Shopping Center, Palo Alto, CA", label: "Stanford Shopping Center" },
];

/** Cities and towns the app covers, in the form a post writes them. */
const CITIES = [
  "Palo Alto",
  "East Palo Alto",
  "Menlo Park",
  "Mountain View",
  "Redwood City",
  "Sunnyvale",
  "Los Altos",
  "Atherton",
  "Stanford",
  "Cupertino",
  "Santa Clara",
  "San Mateo",
  "San Carlos",
  "Belmont",
] as const;

const STREET_WORD = String.raw`(?:st|street|ave|avenue|rd|road|blvd|boulevard|way|dr|drive|ln|lane|pl|place|ct|court|real|camino|alma|mill|expy|expressway|pkwy|parkway)`;
/** "El Camino & Page Mill", "Alma and Hamilton", "Middlefield / Colorado". */
// A lookahead, so every starting word is tried: in "Room at El Camino & Page Mill" the pair "Room at El
// Camino" is not a place, and "El Camino & Page Mill" must still be found.
const CROSS_STREETS = new RegExp(
  String.raw`(?=\b([A-Z][A-Za-z.']+(?:\s+[A-Z][A-Za-z.']+){0,2}?)\s*(?:&|\band\b|\bat\b|/)\s*([A-Z][A-Za-z.']+(?:\s+[A-Z][A-Za-z.']+){0,2})(?=[\s,.;:)]|$))`,
  "g",
);
const HAS_STREET_WORD = new RegExp(String.raw`\b${STREET_WORD}\b`, "i");
const KNOWN_STREETS = /\b(?:el\s+camino|alma|page\s+mill|middlefield|embarcadero|university|hamilton|california|castro|shoreline|rengstorff|bayshore|oregon|arastradero|charleston|san\s+antonio|waverley|bryant|emerson|cowper|ramona|santa\s+cruz|willow|marsh|ravenswood)\b/i;

function cityIn(text: string): string | null {
  const hits = CITIES.filter((city) => new RegExp(String.raw`\b${city.replace(/ /g, String.raw`\s+`)}\b`, "i").test(text));
  // The longest name wins, so "East Palo Alto" is not read as "Palo Alto".
  return hits.sort((a, b) => b.length - a.length)[0] ?? null;
}

function stationIn(text: string): ApproximatePlace | null {
  if (/\bcal(?:ifornia)?\.?\s*ave(?:nue)?\b[^.\n]{0,20}\bcaltrain\b|\bcaltrain\b[^.\n]{0,20}\bcal(?:ifornia)?\.?\s*ave/i.test(text)) {
    return { kind: "station", query: "California Avenue Caltrain Station, Palo Alto, CA", label: "near California Avenue Caltrain" };
  }
  const named = /\b(?:near|by|next\s+to|steps\s+from|close\s+to|walk\s+to)\s+(?:the\s+)?([A-Z][A-Za-z.']+(?:\s+[A-Z][A-Za-z.']+){0,2})\s+(?:Caltrain|Train\s+Station)\b/.exec(text);
  if (named?.[1]) return { kind: "station", query: `${named[1]} Caltrain Station, CA`, label: `near ${named[1]} Caltrain` };
  const bare = /\b([A-Z][A-Za-z.']+(?:\s+[A-Z][A-Za-z.']+){0,2})\s+Caltrain(?:\s+Station)?\b/.exec(text);
  if (bare?.[1] && !/^(?:The|Near|By|Next|Close|Steps|Walk|To|From)$/.test(bare[1])) {
    return { kind: "station", query: `${bare[1]} Caltrain Station, CA`, label: `near ${bare[1]} Caltrain` };
  }
  return null;
}

function crossStreetsIn(text: string, city: string | null): ApproximatePlace | null {
  for (const match of text.matchAll(CROSS_STREETS)) {
    const [, a, b] = match;
    if (!a || !b) continue;
    const streety = (name: string) => HAS_STREET_WORD.test(name) || KNOWN_STREETS.test(name);
    // Both sides must look like streets, so "Room and Board" or "Cats and Dogs" are not places.
    if (!streety(a) || !streety(b)) continue;
    return { kind: "cross_streets", query: `${a} & ${b}, ${city ? `${city}, ` : ""}CA`, label: `near ${a} and ${b}` };
  }
  return null;
}

/**
 * The most specific place the post names: cross streets, then a station, then a neighbourhood or
 * campus area, then a city. `city` is the city the post is known to be in (the extracted fact),
 * used when the text itself names none. Null when the post names no place at all.
 */
export function approximatePlace(text: string, city?: string | null): ApproximatePlace | null {
  const inText = cityIn(text);
  const known = city?.trim() || inText;
  const crossStreets = crossStreetsIn(text, known);
  if (crossStreets) return crossStreets;
  const station = stationIn(text);
  if (station) return station;
  for (const landmark of LANDMARKS) {
    if (landmark.words.test(text)) return { kind: "landmark", query: landmark.query, label: landmark.label };
  }
  if (known) return { kind: "city", query: `${known}, CA`, label: known };
  return null;
}
