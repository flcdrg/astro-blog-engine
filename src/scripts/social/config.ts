import rawMappings from "../../data/social-posts.json";
import { mappingsSchema, type Mapping } from "./schema";
import { loadSocialConfig } from "./load-config";

export const socialConfig = loadSocialConfig();
export const socialMappings = mappingsSchema.parse(rawMappings);

export function getSocialMapping(id: string, overrides: Mapping): Mapping {
  const generated = socialMappings[id] ?? {};
  const { blueskyUri, ...withoutUri } = generated;
  return {
    ...(overrides.blueskyUrl && overrides.blueskyUrl !== generated.blueskyUrl ? withoutUri : generated),
    ...(overrides.blueskyUrl ? {
      blueskyUrl: overrides.blueskyUrl,
    } : {}),
    ...(overrides.mastodonUrl ? { mastodonUrl: overrides.mastodonUrl } : {}),
  };
}
