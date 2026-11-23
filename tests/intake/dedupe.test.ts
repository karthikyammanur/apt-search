import { describe, expect, it } from "vitest";
import { findDuplicate, normalizeAddress, rentsMatch, type KnownListing } from "@/lib/intake/dedupe";

const known = (over: Partial<KnownListing> = {}): KnownListing => ({
  id: 1,
  type: "room",
  city: "Mountain View",
  address: "400 Maple Ave, Mountain View, CA 94040",
  rentCents: 210000,
  urls: ["https://a.example.test/1"],
  photoHashes: [],
  ...over,
});
const candidate = (over: Partial<Parameters<typeof findDuplicate>[1]> = {}) => ({
  url: "https://b.example.test/2",
  address: "400 Maple Avenue, Mountain View, CA",
  city: "Mountain View",
  rentCents: 210000,
  photoHashes: [] as string[],
  ...over,
});

describe("normalizeAddress", () => {
  it.each([
    ["400 Maple Ave, Mountain View, CA 94040", "400 maple ave"],
    ["400 Maple Avenue, Mountain View", "400 maple ave"],
    ["400 MAPLE AVE.", "400 maple ave"],
    ["123 University Avenue, Apt 4, Palo Alto", "123 university ave unit 4"],
    ["123 University Ave #4", "123 university ave unit 4"],
    ["12 N. Main Street", "12 n main st"],
    ["El Camino Real near Page Mill", null],
    ["", null],
    [null, null],
  ])("%s gives %s", (input, expected) => {
    expect(normalizeAddress(input)).toBe(expected);
  });
});

describe("rents within 5 percent", () => {
  it.each([
    { a: 200000, b: 200000, match: true },
    { a: 200000, b: 210000, match: true }, // 4.76% of the larger
    { a: 200000, b: 210526, match: true },
    { a: 200000, b: 210527, match: false }, // just past 5% of the larger
    { a: 200000, b: 250000, match: false },
    { a: null, b: 200000, match: false },
    { a: 200000, b: null, match: false },
  ])("$a and $b: $match", ({ a, b, match }) => {
    expect(rentsMatch(a, b)).toBe(match);
  });
});

describe("findDuplicate", () => {
  it("matches a saved link first", () => {
    expect(findDuplicate([known()], candidate({ url: "https://a.example.test/1", address: null }))).toEqual({ kind: "url", id: 1 });
  });

  it("matches by address and rent", () => {
    expect(findDuplicate([known()], candidate())).toEqual({ kind: "address_rent", id: 1 });
  });

  it("does not match the same address with a different rent, a different city, or an unknown rent", () => {
    expect(findDuplicate([known()], candidate({ rentCents: 260000 }))).toBeNull();
    expect(findDuplicate([known()], candidate({ city: "Palo Alto" }))).toBeNull();
    expect(findDuplicate([known()], candidate({ rentCents: null }))).toBeNull();
  });

  it("does not match without a street number", () => {
    expect(findDuplicate([known({ address: "Maple Ave" })], candidate({ address: "Maple Ave" }))).toBeNull();
  });

  it("matches by photo hash", () => {
    const withPhoto = known({ photoHashes: ["h1"] });
    expect(findDuplicate([withPhoto], candidate({ address: null, rentCents: null, photoHashes: ["h1"] }))).toEqual({ kind: "photo", id: 1 });
  });

  it("a shared photo at a clearly different address is a reused photo, not a merge", () => {
    const withPhoto = known({ photoHashes: ["h1"] });
    expect(findDuplicate([withPhoto], candidate({ address: "9 Other St, Mountain View, CA", photoHashes: ["h1"] }))).toEqual({
      kind: "photo_reuse",
      id: 1,
    });
  });

  it("returns null for a new place", () => {
    expect(findDuplicate([known()], candidate({ address: "5 Pine St, Sunnyvale, CA", city: "Sunnyvale" }))).toBeNull();
  });
});
