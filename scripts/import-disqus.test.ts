import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { importDisqusXml } from "./import-disqus";

const thread = (id: string, link = "http://example.com/2025/07/a-post.html") => `
<thread dsq:id="${id}"><id>old-identifier</id><forum>forum</forum><link>${link}</link>
<title>A post</title><isDeleted>false</isDeleted><author><email>thread-secret@example.com</email></author></thread>`;
const post = (id: string, options: { thread?: string; parent?: string; extra?: string; flags?: string; message?: string } = {}) => `
<post dsq:id="${id}"><id>private-account-identifier</id><message><![CDATA[${options.message ?? "<p>Hello <strong>world</strong></p>"}]]></message>
<createdAt>2025-07-01T12:30:00Z</createdAt>
${options.flags ?? "<isDeleted>false</isDeleted><isSpam>false</isSpam><isApproved>true</isApproved>"}
<author><email>private@example.com</email><name>Public Name</name><username>private-username</username><isAnonymous>false</isAnonymous></author>
<ipAddress>192.0.2.123</ipAddress><thread dsq:id="${options.thread ?? "thread1"}"/>
${options.parent ? `<parent dsq:id="${options.parent}"/>` : ""}${options.extra ?? ""}</post>`;
const wxr = (content: string) => `<?xml version="1.0" encoding="utf-8"?>
<disqus xmlns="http://disqus.com" xmlns:dsq="http://disqus.com/disqus-internals" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<category dsq:id="category1"><title>General</title></category>${content}</disqus>`;
const run = (xml: string) => importDisqusXml(xml, "https://example.com", new Set(["2025/07/a-post"]));

describe("typical Disqus WXR import", () => {
  it("loads the CLI through native Node TypeScript and reports required arguments", () => {
    const result = spawnSync(process.execPath, ["scripts/import-disqus.ts"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: import-disqus --export disqus.xml");
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });

  it("imports standard namespaced WXR with CDATA, canonical links and relationships without private fields", () => {
    const result = run(wxr(thread("thread1") + post("1") + post("2", { parent: "1" })));
    const comments = result.archive.threads["2025/07/a-post"]!;
    expect(result.importedComments).toBe(2);
    expect(result.skippedPosts).toBe(0);
    expect(comments[1]?.parentId).toBe("1");
    expect(comments[0]).toEqual({
      id: "1", name: "Public Name", html: "<p>Hello <strong>world</strong></p>",
      createdAt: "2025-07-01T12:30:00.000Z",
    });
    const json = JSON.stringify(result.archive);
    expect(json).not.toMatch(/email|ipAddress|username|192\.0\.2|private-|private@|thread-secret/);
  });

  it("excludes spam, deleted, explicitly unapproved and missing moderation flags", () => {
    const result = run(wxr(thread("thread1") + post("approved")
      + post("spam", { flags: "<isDeleted>false</isDeleted><isSpam>true</isSpam>" })
      + post("deleted", { flags: "<isDeleted>true</isDeleted><isSpam>false</isSpam>" })
      + post("pending", { flags: "<isDeleted>false</isDeleted><isSpam>false</isSpam><isApproved>false</isApproved>" })
      + post("status", { extra: "<status>pending</status>" })
      + post("missing", { flags: "" })));
    expect(result.importedComments).toBe(1);
    expect(result.skippedPosts).toBe(5);
    expect(JSON.stringify(result.archive)).not.toMatch(/spam|deleted|pending|missing/);
  });

  it("fails closed without approval evidence and accepts only reviewed allowlisted IDs", () => {
    const flags = "<isDeleted>false</isDeleted><isSpam>false</isSpam>";
    const xml = wxr(thread("thread1") + post("reviewed", { flags })
      + post("unknown", { flags }) + post("explicitly-pending", {
        flags: `${flags}<isApproved>false</isApproved>`,
      }) + post("pending-status", { flags: `${flags}<status>pending</status>` })
      + post("approved-status", { flags: `${flags}<status>approved</status>` }));
    const defaultResult = run(xml);
    expect(defaultResult.importedComments).toBe(1);
    expect(defaultResult.unknownApprovalPosts).toBe(2);
    const reviewed = importDisqusXml(xml, "https://example.com", new Set(["2025/07/a-post"]),
      new Set(["reviewed", "explicitly-pending", "pending-status"]));
    expect(reviewed.archive.threads["2025/07/a-post"]?.map((comment) => comment.id))
      .toEqual(["approved-status", "reviewed"]);
    expect(reviewed.unknownApprovalPosts).toBe(1);
    expect(reviewed.skippedPosts).toBe(3);
  });

  it("reports unmatched threads, skips unknown references and omits empty threads", () => {
    const result = run(wxr(thread("thread1") + thread("unknown", "https://example.com/2025/07/not-in-catalogue")
      + thread("foreign", "https://other.example/2025/07/a-post") + post("orphan", { thread: "unknown" })));
    expect(result.archive.threads).toEqual({});
    expect(result.unmatchedThreads).toEqual(["foreign", "unknown"]);
    expect(result.skippedPosts).toBe(1);
  });

  it("drops relationships to removed or cross-thread comments and breaks cycles", () => {
    const result = run(wxr(thread("thread1") + post("1", { parent: "removed" })
      + post("2", { parent: "3" }) + post("3", { parent: "2" }) + post("4", { parent: "4" })));
    const comments = result.archive.threads["2025/07/a-post"]!;
    expect(comments.find((comment) => comment.id === "1")?.parentId).toBeUndefined();
    expect(comments.find((comment) => comment.id === "2")?.parentId).toBeUndefined();
    expect(comments.find((comment) => comment.id === "4")?.parentId).toBeUndefined();
  });

  it("sanitises malicious HTML and ignores comments with no public text", () => {
    const result = run(wxr(thread("thread1") + post("1", { message: '<p onclick="bad()">Safe<script>bad()</script><a href="javascript:bad()">link</a></p>' })
      + post("2", { message: '<img src="https://example.com/tracker"><script>bad()</script>' })));
    expect(result.importedComments).toBe(1);
    expect(result.archive.threads["2025/07/a-post"]?.[0]?.html).not.toMatch(/onclick|script|javascript|<img/);
  });

  it("rejects malformed XML, document entities and duplicate comment identities", () => {
    expect(() => run("<disqus><post></disqus>")).toThrow(/XML/);
    expect(() => run('<!DOCTYPE disqus [<!ENTITY secret SYSTEM "file:///private">]><disqus/>')).toThrow(/document type/);
    expect(() => run(wxr(thread("thread1") + post("1") + post("1")))).toThrow(/Duplicate/);
  });
});
