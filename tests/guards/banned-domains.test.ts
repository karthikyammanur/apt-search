import { describe, expect, it } from "vitest";
import { BANNED_SITES, findBannedFetches, loadSourceFiles } from "./rules";

describe("guard: never fetch banned listing sites", () => {
  it("no fetch call under src/ names a banned site, and providers hold no banned host", () => {
    expect(findBannedFetches(loadSourceFiles())).toEqual([]);
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
