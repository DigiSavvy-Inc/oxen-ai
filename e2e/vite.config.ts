import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The app's own Vite setup, pointed at the throwaway config and state that serve.mjs writes.
export default defineConfig({
  root: process.cwd(),
  plugins: [
    react(),
    cloudflare({
      configPath: process.env.STUDIO_E2E_CONFIG,
      persistState: { path: process.env.STUDIO_E2E_PERSIST ?? "" },
      inspectorPort: false,
    }),
  ],
});
