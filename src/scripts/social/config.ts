import rawConfig from "../../data/social-config.json";
import rawMappings from "../../data/social-posts.json";
import { configSchema, mappingsSchema, type Mapping } from "./schema";

export const socialConfig = configSchema.parse(rawConfig);
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
