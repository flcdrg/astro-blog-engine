import type { CollectionEntry } from "astro:content";
import type { AtomEntry } from "astrojs-atom";
import { DateTime } from "luxon";
import { parse as htmlParser } from "node-html-parser";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import getExcerpt from "./getExcerpt";
import { resolveFeedImageSrc } from "./resolveFeedImageSrc";

type BlogPost = CollectionEntry<"blog">;

function getPostUpdatedDate(post: BlogPost): string {
  const modifiedDate = post.data.modified_time;
  const publishedDate = DateTime.fromISO(post.data.date);

  if (!modifiedDate) {
    return post.data.date;
  }

  const parsedModifiedDate = DateTime.fromISO(modifiedDate);
  return parsedModifiedDate.isValid &&
    parsedModifiedDate.toMillis() > publishedDate.toMillis()
    ? modifiedDate
    : post.data.date;
}

export function getFeedUpdatedDate(posts: BlogPost[]): string {
  const newestPost = posts.reduce<BlogPost | undefined>((newest, post) => {
    if (!newest) {
      return post;
    }

    return DateTime.fromISO(getPostUpdatedDate(post)) >
      DateTime.fromISO(getPostUpdatedDate(newest))
      ? post
      : newest;
  }, undefined);

  return newestPost
    ? DateTime.fromISO(getPostUpdatedDate(newestPost)).toUTC().toISO() ??
        "1970-01-01T00:00:00.000Z"
    : "1970-01-01T00:00:00.000Z";
}

export async function buildFeedEntry(
  post: BlogPost,
  site: URL,
): Promise<AtomEntry> {
  const body = await marked.parse(post.body ?? "");
  const html = htmlParser.parse(body, { comment: false });

  for (const img of html.querySelectorAll("img")) {
    const src = img.getAttribute("src")!;
    const resolvedSrc = await resolveFeedImageSrc(src, site);

    if (resolvedSrc) {
      img.setAttribute("src", resolvedSrc);
    }
  }

  const htmlContent = sanitizeHtml(html.toString(), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
  });
  const postUrl = new URL(post.id, site).toString();

  return {
    id: postUrl,
    updated: getPostUpdatedDate(post),
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
        href: postUrl,
        type: "text/html",
        title: post.data.title,
      },
    ],
    thumbnail: post.data.image
      ? {
          url: new URL(post.data.image.src, site).toString(),
          width: post.data.image.width,
          height: post.data.image.height,
        }
      : undefined,
  };
}
