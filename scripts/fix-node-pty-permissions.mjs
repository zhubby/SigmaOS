import { chmod, readdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import process from "node:process";

const require = createRequire(import.meta.url);

let packageRoot;
try {
  packageRoot = path.dirname(require.resolve("node-pty/package.json"));
} catch {
  process.exit(0);
}

const candidates = [path.join(packageRoot, "build", "Release", "spawn-helper")];
try {
  const prebuildRoot = path.join(packageRoot, "prebuilds");
  const platforms = await readdir(prebuildRoot, { withFileTypes: true });
  for (const platform of platforms) {
    if (platform.isDirectory()) {
      candidates.push(path.join(prebuildRoot, platform.name, "spawn-helper"));
    }
  }
} catch {
  // A source build may not include prebuilds.
}

for (const candidate of candidates) {
  try {
    await chmod(candidate, 0o755);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}
