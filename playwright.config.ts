import { defineConfig, devices } from "@playwright/test";
import { E2E_PASSWORD } from "./tests/e2e/env";

const PORT = 3100;

// Runs against a production build on its own port, so it cannot collide with `npm run dev`.
// The password is set here for the server this config starts. No env file is read by the test.
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
    command: `npm run build && npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { APP_PASSWORD: E2E_PASSWORD },
  },
});
