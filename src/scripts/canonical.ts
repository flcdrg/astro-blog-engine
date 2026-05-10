export function getCanonicalUrl(astroUrl: URL, astroSite: URL | undefined): string | URL | null | undefined {
  const pathname = astroUrl.pathname.replace(".html", "");
  if (pathname === "/index") {
    return new URL("/", astroSite);
  }
  return new URL(pathname, astroSite);
}