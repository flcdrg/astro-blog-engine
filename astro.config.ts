// @ts-check
import { defineConfig } from "astro/config";

import sitemap from "@astrojs/sitemap";
import astroCanonical from "./scripts/astroCanonical";
import { updateSitemapItemLastModified } from "./scripts/sitemapLastModified";
import { postProcessSitemap } from "./scripts/sitemapPostProcess";
import mermaid from "astro-mermaid";

// https://astro.build/config
export default defineConfig({
  compressHTML: false,
  site: process.env.DEPLOY_PRIME_URL || "https://david.gardiner.net.au",
  integrations: [
    sitemap({
      serialize(item) {
        // ensure we have no trailing slash for files
        item.url = item.url.replace(/\/$/, "");
        updateSitemapItemLastModified(item);

        return item;
      },
    }),
    {
      name: "sitemap-root-trailing-slash",
      hooks: {
        "astro:build:done": async ({ dir }) => {
          await postProcessSitemap({
            dir,
            siteRoot: (
              process.env.DEPLOY_PRIME_URL || "https://david.gardiner.net.au"
            ).replace(/\/$/, ""),
          });
        },
      },
    },
    astroCanonical(),
    mermaid({
      theme: "forest",
      autoTheme: true,
      // Register icon packs for use in diagrams
      iconPacks: [
        {
          name: "logos",
          loader: () =>
            fetch("https://unpkg.com/@iconify-json/logos@1/icons.json").then(
              (res) => res.json(),
            ),
        },
        {
          name: "iconoir",
          loader: () =>
            fetch("https://unpkg.com/@iconify-json/iconoir@1/icons.json").then(
              (res) => res.json(),
            ),
        },
      ],
    }),
  ],
  experimental: {},
  build: {
    format: "file",
  },
});
