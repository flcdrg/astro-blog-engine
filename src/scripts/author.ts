export const authorName = "David Gardiner";

export const authorJobTitle = "Senior Developer";

export const authorProfilePath = "/about";

export const authorSameAs = [
  "https://github.com/flcdrg",
  "https://www.linkedin.com/in/davidrgardiner/",
  "https://mastodon.online/@DavidRGardiner",
  "https://stackoverflow.com/users/25702/david-gardiner",
  "https://bsky.app/profile/david.gardiner.net.au",
  "https://hub.docker.com/u/flcdrg",
];

export function getAuthorId(site: URL | undefined): string | undefined {
  return site ? new URL(`${authorProfilePath}#person`, site).toString() : undefined;
}

export function getOrganizationId(site: URL | undefined): string | undefined {
  return site ? `${site}#organization` : undefined;
}
