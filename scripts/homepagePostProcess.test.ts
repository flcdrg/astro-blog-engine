import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { demoteHeadingLevels, postProcessHomepage } from "./homepagePostProcess";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "homepage-post-process-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("demoteHeadingLevels", () => {
  it("demotes headings one level and preserves attributes", () => {
    expect(
      demoteHeadingLevels(
        '<h1 id="one">One</h1><h2 class="two">Two</h2><h5>Five</h5><h6>Six</h6>',
      ),
    ).toBe(
      '<h2 id="one">One</h2><h3 class="two">Two</h3><h6>Five</h6><h6>Six</h6>',
    );
  });
});

describe("postProcessHomepage", () => {
  it("demotes headings only inside full-post articles", async () => {
    const directory = await createTemporaryDirectory();
    const homepage = join(directory, "index.html");
    await writeFile(
      homepage,
      '<h1>Page title</h1><article data-full-post-content><h1>Post title</h1><h2>Section</h2></article>',
    );

    await postProcessHomepage({ dir: directory });

    expect(await readFile(homepage, "utf8")).toBe(
      '<h1>Page title</h1><article data-full-post-content><h2>Post title</h2><h3>Section</h3></article>',
    );
  });

  it("does nothing when the homepage file is missing", async () => {
    const directory = await createTemporaryDirectory();

    await expect(postProcessHomepage({ dir: directory })).resolves.toBeUndefined();
  });
});
