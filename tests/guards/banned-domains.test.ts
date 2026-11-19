import { describe, expect, it } from "vitest";
import { BANNED_SITES, findBannedFetches, loadFetchScopeFiles } from "./rules";

describe("guard: never fetch banned listing sites", () => {
  it("no fetch call under src/ or scripts/ names a banned site, and fetching code holds no banned host", () => {
    expect(findBannedFetches(loadFetchScopeFiles())).toEqual([]);
  });

  it("the banned list covers every site named in AGENTS.md rule 4", () => {
    expect([...BANNED_SITES].sort()).toEqual(
      ["airbnb", "craigslist", "facebook", "furnishedfinder", "zillow", "zumper"].sort(),
    );
  });

  it.each(BANNED_SITES)("detector flags a fetch of %s anywhere in src/", (site) => {
    const text = `await fetch("https://www.${site}.com/rooms");`;
    expect(findBannedFetches([{ path: "src/lib/intake/x.ts", text }])).toHaveLength(1);
  });

  it("detector flags fb.com and a banned host in a provider file", () => {
    expect(
      findBannedFetches([{ path: "src/a.ts", text: "fetch(`https://fb.com/groups/${id}`)" }]),
    ).toHaveLength(1);
    const provider = {
      path: "src/lib/providers/x.ts",
      text: 'const base = "https://m.facebook.com";',
    };
    expect(findBannedFetches([provider])).toHaveLength(1);
  });

  it("the GTFS exception does not exempt banned sites", () => {
    const direct = { path: "scripts/gtfs/x.ts", text: 'fetch("https://www.zillow.com/feed.zip")' };
    const indirect = {
      path: "scripts/gtfs/y.ts",
      text: 'const u = "https://facebook.com/x"; fetch(u)',
    };
    const fine = { path: "scripts/gtfs/z.ts", text: 'fetch("https://api.511.org/transit/gtfs")' };
    // A direct banned URL trips two checks (the fetch argument and the banned host).
    expect(findBannedFetches([direct]).length).toBeGreaterThanOrEqual(1);
    expect(findBannedFetches([indirect])).toHaveLength(1);
    expect(findBannedFetches([fine])).toEqual([]);
  });

  it("detector allows building a link to open and sender addresses, and unrelated fetches", () => {
    const link = {
      path: "src/lib/agent/links.ts",
      text: 'const url = "https://www.zillow.com/palo-alto-ca/";',
    };
    const sender = {
      path: "src/lib/providers/gmail.ts",
      text: 'const q = "from:noreply@mail.craigslist.org";',
    };
    const other = {
      path: "src/lib/providers/rentcast.ts",
      text: 'fetch("https://api.rentcast.io/v1/listings")',
    };
    expect(findBannedFetches([link, sender, other])).toEqual([]);
  });
});
