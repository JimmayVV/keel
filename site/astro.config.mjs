import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://keel.redlinelabs.dev",
  trailingSlash: "never",
  build: { format: "file" },
  redirects: { "/plain": "/philosophy" },
});
