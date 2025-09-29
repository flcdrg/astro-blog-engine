import atom from "astrojs-atom";
import type { AtomEntry } from "astrojs-atom";
import { getCollection } from "astro:content";
import sanitizeHtml from "sanitize-html";
import type { APIContext } from "astro";
import getExcerpt from "../../../scripts/getExcerpt";
import onlyCurrent from "../../../scripts/filters";
import { parse as htmlParser } from "node-html-parser";
import { getImage } from "astro:assets";
import { marked } from "marked";

// get dynamic import of images as a map collection
const imagesGlob = import.meta.glob<{ default: ImageMetadata }>(
  "/src/assets/**/*.{jpeg,jpg,png,gif}" // add more image formats if needed
);

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
    const html = htmlParser.parse(body, { comment: false});
    // hold all img tags in variable images
    const images = html.querySelectorAll("img");

    for (const img of images) {
      const src = img.getAttribute("src")!;

      // Relative paths that are optimized by Astro build
      if (src.startsWith("../../assets/")) {
        // remove prefix of `./`
        const prefixRemoved = src.replace("../../assets/", "");
        // create prefix absolute path from root dir
        const imagePathPrefix = `/src/assets/${prefixRemoved}`;

        // call the dynamic import and return the module
        const imagePath = await imagesGlob[imagePathPrefix]?.()?.then(
          (res) => res.default
        );

        if (imagePath) {
          const optimizedImg = await getImage({ src: imagePath });
          const newSrc = context.site + optimizedImg.src.replace("/", "");

          // set the correct path to the optimized image
          img.setAttribute("src", newSrc);
        }
      } else if (src.startsWith("/images")) {
        // images starting with `/images/` is the public dir
        img.setAttribute("src", context.site + src.replace("/", ""));
      } else if (src.startsWith("http://") || src.startsWith("https://")) {
        // External URLs - leave as is
        // No change needed for external URLs
      } else {
        throw Error(`src unknown: ${src}`);
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
          }
        : undefined,
    });
  }

  const atomFeedUrl = `${siteUrl}tags/${tag}/feed.xml`;

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
    link: [
      {
        rel: "self",
        href: atomFeedUrl,
        type: "application/atom+xml",
      },
      {
        rel: "alternate",
        href: `${siteUrl}tags/${tag}`,
        type: "text/html",
        hreflang: "en-AU",
      },
    ],
    lang: "en-AU",
    entry: feed,
  });
}