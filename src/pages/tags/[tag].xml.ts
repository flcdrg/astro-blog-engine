import atom from "astrojs-atom";
import type { AtomEntry } from "astrojs-atom";
import { getCollection } from "astro:content";
import sanitizeHtml from "sanitize-html";
import type { APIContext } from "astro";
import getExcerpt from "../../scripts/getExcerpt";
import onlyCurrent from "../../scripts/filters";
import { resolveFeedImageSrc } from "../../scripts/resolveFeedImageSrc";
import { parse as htmlParser } from "node-html-parser";
import { marked } from "marked";

export async function getStaticPaths() {
  const allPosts = (await getCollection("blog")).filter(onlyCurrent);

  const uniqueTags = [
    ...new Set(allPosts.map((post: any) => post.data.tags).flat()),
  ];

  return uniqueTags.map((tag) => {
    const filteredPosts = allPosts
      .filter((post: any) => post.data.tags.includes(tag))
      .sort(
        (a: any, b: any) =>
          new Date(b.data.date).getTime() - new Date(a.data.date).getTime()
      );
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
  const posts = context.props.posts as any[];

  const postsToInclude = posts.filter((post) => post.body).slice(0, 10); // Get the latest 10 posts

  const siteUrl = context.site?.toString();

  if (!siteUrl) {
    throw new Error("Site URL is not defined");
  }

  const feed: AtomEntry[] = [];

  for (const post of postsToInclude) {
    // convert markdown to html string
    const body = await marked.parse(post.body!);

    // convert html string to DOM-like structure
    const html = htmlParser.parse(body, { comment: false });
    // hold all img tags in variable images
    const images = html.querySelectorAll("img");

    for (const img of images) {
      const src = img.getAttribute("src")!;

      const resolvedSrc = await resolveFeedImageSrc(src, context.site);

      if (resolvedSrc) {
        img.setAttribute("src", resolvedSrc);
      }
    }

    const htmlContent = sanitizeHtml(html.toString(), {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
    });

    feed.push({
      id: `${new URL(post.id, context.site).toString()}`,
      updated: post.data.date,
      published: post.data.date,
      title: post.data.title,
      content: {
        type: "html",
        value: htmlContent,
      },
      summary: {
        type: "html",
        value: post.data.description || getExcerpt(htmlContent, 500),
      },
      category: post.data.tags.map((tag: string) => ({
        term: tag,
      })),
      link: [
        {
          rel: "alternate",
          href: new URL(post.id, context.site).toString(),
          type: "text/html",
          title: post.data.title,
        },
      ],
      thumbnail: post.data.image
        ? {
            url: `${new URL(post.data.image.src, context.site).toString()}`,
            width: post.data.image.width,
            height: post.data.image.height,
          }
        : undefined,
    });
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
    updated: new Date().toISOString(),
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
