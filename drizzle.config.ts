import { defineConfig } from "drizzle-kit";

// Only used by `npm run db:generate` to write SQL migrations from src/db/schema.ts.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
});
