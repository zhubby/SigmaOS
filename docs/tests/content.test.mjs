import { readdir, readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";

const docsRoot = path.resolve("src/content/docs");
const repoRoot = path.resolve("..");

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(absolute));
    else if (/\.(md|mdx)$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

test("every published page declares its content contract and valid source paths", async () => {
  const files = await markdownFiles(docsRoot);
  assert(files.length > 0, "the docs collection must not be empty");
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const match = source.match(/^---\n([\s\S]*?)\n---/);
    assert(match, `${file} is missing frontmatter`);
    const frontmatter = parse(match[1]);
    for (const field of ["title", "description", "type", "status", "audience", "sourceOfTruth"]) {
      assert(frontmatter[field], `${file} is missing ${field}`);
    }
    for (const sourcePath of frontmatter.sourceOfTruth) {
      assert(!path.isAbsolute(sourcePath), `${file} has an absolute source path: ${sourcePath}`);
      await access(path.join(repoRoot, sourcePath));
    }
  }
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
