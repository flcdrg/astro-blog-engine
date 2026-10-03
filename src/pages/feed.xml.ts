import atom from "astrojs-atom";
import type { AtomEntry } from "astrojs-atom";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";
import { getCurrentPosts, sortPostsByDate } from "../scripts/posts";
import { buildFeedEntry, getFeedUpdatedDate } from "../scripts/feed";

export async function GET(context: APIContext) {
  if (!context.site) {
    throw Error("site not set");
  }

  const sortedPosts = sortPostsByDate(
    getCurrentPosts(await getCollection("blog")),
    "descending",
  );
  const postsToInclude = sortedPosts.filter((post) => post.body).slice(0, 10); // Get the latest 10 posts

  const siteUrl = context.site?.toString();

  if (!siteUrl) {
    throw new Error("Site URL is not defined");
  }

  const feed: AtomEntry[] = [];

  for (const post of postsToInclude) {
    feed.push(await buildFeedEntry(post, context.site));
  }

  const atomFeedUrl = new URL("feed.xml", context.site).toString();
  const webSubHubUrl = "https://flcdrg.superfeedr.com";

  return atom({
    id: atomFeedUrl,
    title: {
      value: "David Gardiner",
      type: "html",
    },
    author: [
      {
        name: "David Gardiner",
      },
    ],
    updated: getFeedUpdatedDate(postsToInclude),
    subtitle:
      "A blog of software development, .NET and other interesting things",
    generator: {
      value: "astrojs-atom",
      uri: "https://github.com/flcdrg/astrojs-atom",
      version: "3",
    },
    rights: `Copyright ${new Date().getFullYear()} David Gardiner`,
    icon: "https://www.gravatar.com/avatar/37edf2567185071646d62ba28b868fab?s=64",
    logo: "https://www.gravatar.com/avatar/37edf2567185071646d62ba28b868fab?s=256",
    category: [
      { term: ".NET" },
      { term: "Software Development" },
      { term: "Azure" },
      { term: "DevOps" },
    ],
    link: [
      {
        rel: "self",
        href: atomFeedUrl,
        type: "application/atom+xml",
      },
      {
        rel: "hub",
        href: webSubHubUrl,
      },
      {
        rel: "alternate",
        href: new URL("/", context.site).toString(),
        type: "text/html",
        hreflang: "en-AU",
      },
    ],
    lang: "en-AU",
    sortEntriesByUpdated: true,
    entry: feed,
  });
}
