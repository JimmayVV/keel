import { execFileSync } from "node:child_process";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

// lastmod policy: only real per-file git dates (Google uses lastmod only when it is
// "consistently and verifiably accurate"); a page with no resolvable date carries none.
// Requires a full clone in CI — .github/workflows/pages.yml sets fetch-depth: 0.
const PAGE_SOURCES = {
  "/": "src/pages/index.astro",
  "/install": "src/pages/install.astro",
  "/skills": "src/pages/skills.astro",
  "/philosophy": "src/pages/philosophy.astro",
  "/technical": "src/pages/technical.astro",
};

function gitLastmod(sourcePath) {
  try {
    const iso = execFileSync("git", ["log", "-1", "--format=%cI", "--", sourcePath], {
      cwd: new URL(".", import.meta.url).pathname,
      encoding: "utf8",
    }).trim();
    return iso || undefined;
  } catch {
    return undefined;
  }
}

export default defineConfig({
  site: "https://keel.redlinelabs.dev",
  trailingSlash: "never",
  build: { format: "file" },
  redirects: { "/plain": "/philosophy" },
  integrations: [
    sitemap({
      serialize(item) {
        // Sitemap entries must be the canonical (extensionless) URLs the site serves.
        const url = item.url.replace(/\.html$/, "").replace(/\/index$/, "/");
        const route = new URL(url).pathname.replace(/\/$/, "") || "/";
        const source = PAGE_SOURCES[route];
        if (!source) return undefined; // drop redirects and anything unmapped
        const lastmod = gitLastmod(source);
        return lastmod ? { ...item, url, lastmod } : { ...item, url };
      },
    }),
  ],
});
