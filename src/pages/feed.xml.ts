import atom from "astrojs-atom";
import type { AtomEntry } from "astrojs-atom";
import { getCollection } from "astro:content";
import sanitizeHtml from "sanitize-html";
import MarkdownIt from "markdown-it";
import type { APIContext } from "astro";
import getExcerpt from "../scripts/getExcerpt";
import onlyCurrent from "../scripts/filters";
import { parse as htmlParser } from "node-html-parser";
import { getImage } from "astro:assets";

// From https://billyle.dev/posts/adding-rss-feed-content-and-fixing-markdown-image-paths-in-astro

// get dynamic import of images as a map collection
const imagesGlob = import.meta.glob<{ default: ImageMetadata }>(
  "/src/assets/**/*.{jpeg,jpg,png,gif}" // add more image formats if needed
);

const parser = new MarkdownIt();

export async function GET(context: APIContext) {
  if (!context.site) {
    throw Error("site not set");
  }

  const posts = (await getCollection("blog")).filter(onlyCurrent);

  const sortedPosts = posts.sort(
    (a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime()
  );
  const postsToInclude = sortedPosts.filter((post) => post.body).slice(0, 10); // Get the latest 10 posts

  const siteUrl = context.site?.toString();

  if (!siteUrl) {
    throw new Error("Site URL is not defined");
  }

  const feed: AtomEntry[] = [];

  for (const post of postsToInclude) {
    // convert markdown to html string
    const body = parser.render(post.body!);
    // convert html string to DOM-like structure
    const html = htmlParser.parse(body);
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
      category: post.data.tags.map((tag) => ({
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

  const atomFeedUrl = `${siteUrl}feed.xml`;

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
    updated: new Date().toISOString(),
    subtitle:
      "A blog of software development, .NET and other interesting things",
    link: [
      {
        rel: "self",
        href: atomFeedUrl,
        type: "application/atom+xml",
      },
      {
        rel: "alternate",
        href: siteUrl,
        type: "text/html",
        hreflang: "en-AU",
      },
    ],
    lang: "en-AU",
    entry: feed,
  });
}
