import { defineConfig, devices } from "@playwright/test";
import { E2E_PASSWORD } from "./tests/e2e/env";

const PORT = 3100;

// Runs against a production build on its own port, so it cannot collide with `npm run dev`.
// The password and a throwaway database are set here for the server this config starts, and
// they override any DATABASE_URL in an env file, so the test never touches a real database.
// The login page records failed attempts, so the database is recreated and migrated first.
const E2E_DATABASE_URL = "file:data/e2e.db";
const RESET_DB = "require('node:fs').rmSync('data/e2e.db',{force:true})";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node -e "${RESET_DB}" && npm run db:migrate && npm run build && npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      APP_PASSWORD: E2E_PASSWORD,
      DATABASE_URL: E2E_DATABASE_URL,
      DATABASE_AUTH_TOKEN: "",
    },
  },
});
