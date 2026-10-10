import DOMPurify from "dompurify";
import { discussionDate, loadDiscussion, safeDiscussionUrl, type Discussion, type DiscussionAuthor } from "./discussion";
import { mappingSchema, providerSchema } from "./schema";

export function sanitiseDiscussionHtml(html: string): DocumentFragment {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["p", "br", "a", "strong", "em", "b", "i", "code", "pre", "blockquote", "ul", "ol", "li", "span"],
    ALLOWED_ATTR: ["href", "title"],
    ALLOWED_NAMESPACES: ["http://www.w3.org/1999/xhtml"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  fragment.querySelectorAll("a").forEach((anchor) => {
    const href = safeDiscussionUrl(anchor.getAttribute("href") ?? undefined);
    if (href) {
      anchor.href = href;
      anchor.rel = "nofollow noopener noreferrer";
      anchor.target = "_blank";
    } else {
      anchor.removeAttribute("href");
    }
  });
  return fragment;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function externalLink(url: string, text: string): HTMLAnchorElement {
  const link = element("a", undefined, text);
  const safe = safeDiscussionUrl(url);
  if (safe) link.href = safe;
  link.rel = "nofollow noopener noreferrer";
  link.target = "_blank";
  return link;
}

function authorElement(author: DiscussionAuthor): HTMLElement {
  const result = element("span", "social-discussion__author");
  if (author.avatar) {
    const image = element("img", "social-discussion__avatar");
    image.src = author.avatar;
    image.alt = "";
    image.width = 32;
    image.height = 32;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    result.append(image);
  }
  result.append(author.profileUrl
    ? externalLink(author.profileUrl, author.name) : document.createTextNode(author.name));
  return result;
}

export function renderDiscussion(container: HTMLElement, data: Discussion): void {
  const summary = element("p", "social-discussion__counts",
    [
      data.likes === undefined ? "Like count unavailable" : `${data.likes} likes`,
      data.reposts === undefined ? "Repost count unavailable" : `${data.reposts} reposts`,
      data.replyCount === undefined ? "Reply count unavailable" : `${data.replyCount} replies`,
    ].join(" · "));
  const nodes: HTMLElement[] = [summary];
  if (data.warnings.length) {
    const warnings = element("ul", "social-discussion__note");
    warnings.setAttribute("aria-label", "Discussion preview limitations");
    data.warnings.forEach((warning) => warnings.append(element("li", undefined, warning)));
    nodes.push(warnings);
  }
  if (data.likeAuthors.length) {
    const likes = element("ul", "social-discussion__likes");
    likes.setAttribute("aria-label", "A few people who liked this post");
    data.likeAuthors.forEach((author) => {
      const item = element("li");
      item.append(authorElement(author));
      likes.append(item);
    });
    nodes.push(likes);
  }
  const list = element("ol", "social-discussion__replies");
  const prefix = container.closest<HTMLElement>("[data-social-discussion]")?.id ?? "social-discussion";
  const replyIds = new Map(data.replies.map((reply, index) => [reply.id, `${prefix}-reply-${index}`]));
  for (const reply of data.replies) {
    const item = element("li", "social-discussion__reply");
    item.id = replyIds.get(reply.id)!;
    const header = element("div", "social-discussion__reply-header");
    header.append(authorElement(reply.author));
    const time = element("time", undefined, discussionDate(reply.publishedAt));
    time.dateTime = reply.publishedAt;
    const permalink = externalLink(reply.url, "");
    permalink.append(time);
    header.append(permalink);
    item.append(header);
    if (reply.parentId && reply.parentId !== data.rootId) {
      const parent = replyIds.get(reply.parentId);
      const relationship = element("p", "social-discussion__parent");
      if (parent) {
        const link = element("a", undefined, "Reply to an earlier comment");
        link.href = `#${parent}`;
        relationship.append(link);
      } else {
        relationship.textContent = "Reply to a comment outside this preview";
      }
      item.append(relationship);
    }
    const content = element("div", "social-discussion__content");
    if (reply.html !== undefined) content.append(sanitiseDiscussionHtml(reply.html));
    else content.textContent = reply.text ?? "";
    if (reply.warning) {
      const details = element("details", "social-discussion__warning");
      details.append(element("summary", undefined, `Content warning: ${reply.warning}`), content);
      item.append(details);
    } else {
      item.append(content);
    }
    list.append(item);
  }
  if (data.replies.length) nodes.push(list);
  nodes.push(element("p", "social-discussion__note", data.replies.length
    ? `Showing ${data.replies.length} public replies. Visit the source thread for the full discussion; federation and moderation may limit this preview.`
    : "No public replies are available in this preview. Visit the source thread to join the discussion."));
  container.replaceChildren(...nodes);
}

export function initialiseDiscussions(): void {
  document.querySelectorAll<HTMLElement>("[data-social-discussion]").forEach((section) => {
    if (section.dataset["initialised"]) return;
    section.dataset["initialised"] = "true";
    const status = section.querySelector<HTMLElement>("[data-discussion-status]")!;
    const container = section.querySelector<HTMLElement>("[data-discussion-content]")!;
    const retry = section.querySelector<HTMLButtonElement>("[data-discussion-retry]")!;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      retry.hidden = true;
      status.textContent = "Loading public discussion…";
      container.setAttribute("aria-busy", "true");
      try {
        const provider = providerSchema.parse(section.dataset["provider"]);
        const mapping = mappingSchema.parse({
          ...(section.dataset["blueskyUrl"] ? { blueskyUrl: section.dataset["blueskyUrl"] } : {}),
          ...(section.dataset["blueskyUri"] ? { blueskyUri: section.dataset["blueskyUri"] } : {}),
          ...(section.dataset["mastodonUrl"] ? { mastodonUrl: section.dataset["mastodonUrl"] } : {}),
        });
        renderDiscussion(container, await loadDiscussion(provider, mapping));
        status.textContent = "Public discussion loaded.";
      } catch {
        status.textContent = "The public discussion could not be loaded. The service may be unavailable or restrict public access. Try again or use the source link.";
        retry.hidden = false;
      } finally {
        loading = false;
        container.setAttribute("aria-busy", "false");
      }
    };
    retry.addEventListener("click", () => { void load(); });
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      });
      observer.observe(section);
    } else {
      void load();
    }
  });
}
