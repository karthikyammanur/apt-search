import { beforeAll, expect, it, vi } from "vitest";
import { createDb } from "@/db";
import { runMigrations } from "@/db/run-migrations";
import { seedDemo } from "@/db/demo";

vi.mock("@/app/(views)/auth", () => ({ requireLogin: vi.fn() }));
vi.mock("@/lib/providers", () => ({
  geocode: vi.fn(async () => ({ ok: true, data: { lat: 37.4419, lng: -122.143 } })),
}));
import { getMapPoints } from "@/lib/queries/map";
import { requireLogin } from "@/app/(views)/auth";

const db = createDb(":memory:");
beforeAll(async () => {
  await runMigrations(db);
  await seedDemo(db);
});
it("checks login before returning stations and a fake office point", async () => {
  const result = await getMapPoints({ db });
  expect(requireLogin).toHaveBeenCalled();
  expect(result.office).toEqual({ lat: 37.4419, lng: -122.143 });
  expect(result.stations.length).toBeGreaterThan(0);
  expect(result.stations).toHaveLength(5);
});
it("does not reach the database or geocoder when login is refused", async () => {
  vi.mocked(requireLogin).mockRejectedValueOnce(new Error("login required"));
  await expect(getMapPoints({ db })).rejects.toThrow("login required");
});
