import atom from "astrojs-atom";
import type { AtomEntry } from "astrojs-atom";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";
import type { CollectionEntry } from "astro:content";
import {
  getCurrentPosts,
  getUniqueTags,
  groupPostsByTag,
  sortPostsByDate,
} from "../../scripts/posts";
import { buildFeedEntry, getFeedUpdatedDate } from "../../scripts/feed";

export async function getStaticPaths() {
  const allPosts = getCurrentPosts(await getCollection("blog"));
  const uniqueTags = getUniqueTags(allPosts);
  const postsByTag = groupPostsByTag(allPosts);

  return uniqueTags.map((tag) => {
    const filteredPosts = sortPostsByDate(postsByTag.get(tag) ?? [], "descending");
    return {
      params: { tag },
      props: { posts: filteredPosts, tag },
    };
  });
}

export async function GET(context: APIContext) {
  if (!context.site) {
    throw Error("site not set");
  }

  // Get the tag from the URL params
  const tag = context.params.tag as string;
  const posts = context.props.posts as CollectionEntry<"blog">[];

  const postsToInclude = posts.filter((post) => post.body).slice(0, 10); // Get the latest 10 posts

  const siteUrl = context.site?.toString();

  if (!siteUrl) {
    throw new Error("Site URL is not defined");
  }

  const feed: AtomEntry[] = [];

  for (const post of postsToInclude) {
    feed.push(await buildFeedEntry(post, context.site));
  }

  const encodedTag = encodeURIComponent(tag);
  const atomFeedUrl = new URL(`tags/${encodedTag}.xml`, context.site).toString();

  return atom({
    id: atomFeedUrl,
    title: {
      value: `David Gardiner - ${tag}`,
      type: "html",
    },
    author: [
      {
        name: "David Gardiner",
      },
    ],
    updated: getFeedUpdatedDate(postsToInclude),
    subtitle: `Blog posts tagged with '${tag}' - A blog of software development, .NET and other interesting things`,
    generator: {
      value: "astrojs-atom",
      uri: "https://github.com/flcdrg/astrojs-atom",
      version: "3",
    },
    rights: `Copyright ${new Date().getFullYear()} David Gardiner`,
    icon: "https://www.gravatar.com/avatar/37edf2567185071646d62ba28b868fab?s=64",
    logo: "https://www.gravatar.com/avatar/37edf2567185071646d62ba28b868fab?s=256",
    category: [
      { term: tag },
      { term: "Software Development" },
    ],
    link: [
      {
        rel: "self",
        href: atomFeedUrl,
        type: "application/atom+xml",
      },
      {
        rel: "alternate",
        href: new URL(`tags/${encodedTag}`, context.site).toString(),
        type: "text/html",
        hreflang: "en-AU",
      },
    ],
    lang: "en-AU",
    sortEntriesByUpdated: true,
    entry: feed,
  });
}
