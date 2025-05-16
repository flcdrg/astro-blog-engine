// @ts-check
import { defineConfig } from 'astro/config';
import { existsSync, globSync } from 'node:fs';
import { execSync } from 'child_process';
import { join, resolve } from 'path';

import sitemap, { type SitemapItem } from "@astrojs/sitemap";

import mdx from "@astrojs/mdx";

// https://astro.build/config
export default defineConfig({
  compressHTML: false,
  site: process.env.DEPLOY_PRIME_URL || "https://david.gardiner.net.au",
  integrations: [sitemap({
    serialize(item) {

      // ensure we have no trailing slash for files
      item.url = item.url.replace(/\/$/, '');

      try {
        // if item is a post, get last modified date from Git
        const urlPattern = /https:\/\/.*?\/(\d{4})\/(\d{2})\/(.+)/;
        const match = item.url.match(urlPattern);
        
        if (match && match[1] && match[2] && match[3]) {
          const year = match[1];
          const month = match[2];
          const slug = match[3];
          
          // Create a glob pattern for the file
          const filePattern = `${year}-${month}-*-${slug}.md`;
          const postsDir = resolve(process.cwd(), 'src', 'posts', year);
          
          try {
            // First check if the directory exists
            if (existsSync(postsDir)) {
              // Use Node's built-in fs.globSync to find files matching the pattern
              const files = globSync(filePattern, { cwd: postsDir });
              
              if (files.length > 0 && files[0]) {
                const filePath = join(postsDir, files[0]);
                
                updateLastModifiedFromGit(filePath, item);
              }
            }
          } catch (err) {
            // Handle errors without crashing
            console.error(`Error finding file for ${item.url}: ${err instanceof Error ? err.message : String(err)}`);
          }
        } // or specific root-level pages /about, /speaking
        else if (item.url.match(/\/about$/)) {
          const filePath = join(process.cwd(), 'src', 'pages', 'about.astro');
          updateLastModifiedFromGit(filePath, item);
        }
        else if (item.url.match(/\/speaking$/)) {
          const filePath = join(process.cwd(), 'src', 'pages', 'speaking.md');
          updateLastModifiedFromGit(filePath, item);
        }
      } catch (error) {
        // Catch any errors to prevent build failures
        console.error(`Error processing sitemap item ${item.url}: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      return item;
    }
  }), mdx()],
  experimental: {
  },
  build: {
    format: 'file',
  }
});

function updateLastModifiedFromGit(filePath: string, item: SitemapItem) {
  if (existsSync(filePath)) {
    // Get last modified date from git
    const gitCmd = `git log -1 --pretty="format:%cI" "${filePath}"`;
    const lastModified = execSync(gitCmd, { encoding: 'utf8' }).trim();

    if (lastModified) {
      item.lastmod = new Date(lastModified).toISOString();
      //console.log(`Set lastmod for ${item.url} to ${item.lastmod}`);
    }
  }
}
