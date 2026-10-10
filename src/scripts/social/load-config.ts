import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import { configSchema, type SocialConfig } from "./schema.ts";

export function loadSocialConfig(directory = "src/data"): SocialConfig {
  let content: string;
  try {
    content = readFileSync(join(directory, "social-config.json"), "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    const path = join(directory, "social-config.jsonc");
    content = readFileSync(path, "utf8");
    const errors: ParseError[] = [];
    const value: unknown = parse(content, errors, { allowTrailingComma: true });
    if (errors.length) throw new Error(`Invalid JSONC in ${path} at offset ${errors[0]!.offset}`);
    return configSchema.parse(value);
  }
  return configSchema.parse(JSON.parse(content));
}