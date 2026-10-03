export function getCanonicalUrl(astroUrl: URL, astroSite: URL | undefined): string | URL | null | undefined {
  const pathname = astroUrl.pathname.replace(/\.html$/, "");
  const site = astroSite ?? astroUrl;
  if (pathname === "/index") {
    return new URL("/", site);
  }
  return new URL(pathname, site);
}