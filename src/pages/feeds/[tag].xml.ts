import atom, { type AtomEntry } from "astrojs-atom";
import type { APIContext, APIRoute } from "astro";
import { getCollection, getEntry } from "astro:content";
import { getImage } from "astro:assets";
import getExcerpt from "../../scripts/getExcerpt";
import MarkdownIt from "markdown-it";
import { parse as htmlParser } from "node-html-parser";
import sanitizeHtml from "sanitize-html";


// get dynamic import of images as a map collection
const imagesGlob = import.meta.glob<{ default: ImageMetadata }>(
  "/src/assets/**/*.{jpeg,jpg,png,gif}" // add more image formats if needed
);

export async function GET(context: APIContext) {
  const { params } = context;

  const tag = params.tag ? params.tag : "default";

  const tagInfo = await getEntry("tags", tag);

    if (!tagInfo) {
        return new Response("Tag not found", { status: 404 });
    }

  //   return new Response(
  //     JSON.stringify(tagInfo),
  //   );

  if (!context.site) {
    throw new Error("Site URL is not defined");
  }
  const siteUrl = context.site.toString();

    const feed: AtomEntry[] = [];

    const postsToInclude = await Promise.all(
      tagInfo.data.posts.map(async (postRef) => {
        const post = await getEntry("blog", postRef.id);
        if (!post || !post.body) {
            throw new Error(`Post not found or has no body: ${postRef.id}`);
        }
        return post;
    })) ?? [];

      const parser = new MarkdownIt();

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
  

  const atomFeedUrl = `${siteUrl}feeds/${tag}.xml`;

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
    entry: feed
  });
}

export async function getStaticPaths() {
  const tags = await getCollection("tags");
  return tags.map((tag) => ({ params: { tag: tag.id } }));
}
