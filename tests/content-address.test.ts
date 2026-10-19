import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  contentAddress,
  fileHash,
  findReferences,
  hashedFileName,
  type ContentAddressOptions,
} from "../tools/content-address";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function site(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "astro-xp-content-address-"));
  temporaryDirectories.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

async function listing(root: string, directory = ""): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(join(root, directory), {
    withFileTypes: true,
  })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) paths.push(...(await listing(root, path)));
    else paths.push(path);
  }
  return paths.sort();
}

const address = (root: string, options: Partial<ContentAddressOptions> = {}) =>
  contentAddress(root, { fixed: [], packages: [], ...options });

const read = (root: string, path: string) => readFile(join(root, path), "utf8");

describe("file names", () => {
  test("put the hash before the extension", () => {
    expect(fileHash("a")).toMatch(/^[a-f0-9]{8}$/);
    expect(hashedFileName("js/main.js", "12345678")).toBe(
      "js/main.12345678.js",
    );
    expect(hashedFileName("js/app.min.js", "12345678")).toBe(
      "js/app.min.12345678.js",
    );
    expect(hashedFileName("LICENSE", "12345678")).toBe("LICENSE.12345678");
    expect(hashedFileName("conf/.env", "12345678")).toBe("conf/.env.12345678");
  });
});

describe("findReferences", () => {
  const files = new Set([
    "index.html",
    "js/main.js",
    "js/apps/notes.js",
    "apps/notes.js",
    "css/fonts/a.woff2",
    "assets/bliss.jpg",
    "vendor/pipes/abc/index.html",
    "vendor/pipes/",
    "vendor/pipes/abc/",
  ]);
  const exists = (path: string) => files.has(path);
  const targets = (source: string, file: string, origins?: string[]) =>
    findReferences(source, file, exists, origins).map(
      ({ target, form, dotSlash }) => [target, form, dotSlash],
    );

  test("resolves HTML and CSS paths against their own folder first", () => {
    expect(targets('<a href="notes.js">', "js/apps/x.html")).toEqual([
      ["js/apps/notes.js", "relative", false],
    ]);
    expect(targets('<a href="apps/notes.js">', "js/x.html")).toEqual([
      ["js/apps/notes.js", "relative", false],
    ]);
    expect(targets('url("fonts/a.woff2")', "css/main.css")).toEqual([
      ["css/fonts/a.woff2", "relative", false],
    ]);
    expect(targets('<img src="assets/bliss.jpg">', "css/x.html")).toEqual([
      ["assets/bliss.jpg", "root", false],
    ]);
  });

  test("resolves script paths against the site root first", () => {
    expect(targets('import("apps/notes.js")', "js/main.js")).toEqual([
      ["apps/notes.js", "root", false],
    ]);
    expect(targets('load("apps/notes.js")', "js/x/main.js")).toEqual([
      ["apps/notes.js", "root", false],
    ]);
    expect(targets('load("notes.js")', "js/apps/main.js")).toEqual([
      ["js/apps/notes.js", "relative", false],
    ]);
  });

  test("keeps ./ and ../ relative and / absolute", () => {
    expect(
      targets(
        'import "./notes.js"; import "../main.js"; fetch("/assets/bliss.jpg")',
        "js/apps/x.js",
      ),
    ).toEqual([
      ["js/apps/notes.js", "relative", true],
      ["js/main.js", "relative", false],
      ["assets/bliss.jpg", "absolute", false],
    ]);
  });

  test("reads absolute URLs on the site's own origin only", () => {
    expect(
      targets(
        '<meta content="https://xp.example/assets/bliss.jpg"> https://other.example/assets/bliss.jpg"',
        "index.html",
        ["https://xp.example"],
      ),
    ).toEqual([["assets/bliss.jpg", "absolute", false]]);
  });

  test("finds folders and skips missing paths and paths above the root", () => {
    expect(
      targets(
        '"vendor/pipes/abc/" "vendor/missing/" "../../../index.html" "missing.js" "js/main.js?v=1#x"',
        "js/main.js",
      ),
    ).toEqual([
      ["vendor/pipes/abc/", "root", false],
      ["js/main.js", "root", false],
    ]);
  });
});

describe("contentAddress", () => {
  test("renames files and rewrites what points at them", async () => {
    const root = await site({
      "index.html": '<script src="js/main.js"></script><img src="./logo.png">',
      "js/main.js": 'import "./util.js"; const img = "assets/bliss.jpg";',
      "js/util.js": "export const util = 1;",
      "assets/bliss.jpg": "bliss",
      "logo.png": "logo",
      "notes.txt": "js/main.js",
    });

    const result = await address(root, { fixed: ["index.html"] });

    const util = `js/util.${fileHash("export const util = 1;")}.js`;
    const bliss = `assets/bliss.${fileHash("bliss")}.jpg`;
    const main = result.files.get("js/main.js")!;
    expect(result.files.get("js/util.js")).toBe(util);
    expect(result.files.get("assets/bliss.jpg")).toBe(bliss);
    expect(result.files.get("index.html")).toBe("index.html");
    expect(result.files.get("notes.txt")).toBe(
      `notes.${fileHash("js/main.js")}.txt`,
    );
    const mainSource = `import "./util.${fileHash("export const util = 1;")}.js"; const img = "${bliss}";`;
    expect(main).toBe(`js/main.${fileHash(mainSource)}.js`);
    expect(await read(root, main)).toBe(mainSource);
    expect(await read(root, "index.html")).toBe(
      `<script src="${main}"></script><img src="./logo.${fileHash("logo")}.png">`,
    );
    expect(result.packages.size).toBe(0);
  });

  test("renames only the files whose content or dependencies changed", async () => {
    const files = {
      "index.html":
        '<script src="js/main.js"></script><script src="js/other.js"></script>',
      "js/main.js": 'const css = "css/a.css";',
      "js/other.js": "other",
      "css/a.css": "a {}",
    };
    const before = await site(files);
    const after = await site({ ...files, "css/a.css": "a { color: red }" });
    const first = await address(before, { fixed: ["index.html"] });
    const second = await address(after, { fixed: ["index.html"] });
    expect(second.files.get("js/other.js")).toBe(
      first.files.get("js/other.js"),
    );
    expect(second.files.get("css/a.css")).not.toBe(
      first.files.get("css/a.css"),
    );
    expect(second.files.get("js/main.js")).not.toBe(
      first.files.get("js/main.js"),
    );
  });

  test("gives files that refer to each other one hash", async () => {
    const root = await site({
      "js/a.js": 'load("js/b.js")',
      "js/b.js": 'load("js/a.js")',
      "js/c.js": 'load("js/a.js")',
    });
    const result = await address(root);
    const a = result.files.get("js/a.js")!;
    const b = result.files.get("js/b.js")!;
    const hash = a.split(".")[1];
    expect(b).toBe(`js/b.${hash}.js`);
    expect(await read(root, a)).toBe(`load("${b}")`);
    expect(await read(root, b)).toBe(`load("${a}")`);
    expect(await read(root, result.files.get("js/c.js")!)).toBe(`load("${a}")`);
  });

  test("renames packages as a whole", async () => {
    const root = await site({
      "index.html":
        '<iframe src="vendor/pipes/abc/index.html"></iframe><script>const root = "vendor/pipes/abc/";</script>',
      "vendor/pipes/abc/index.html": '<script src="pipes.js"></script>',
      "vendor/pipes/abc/pipes.js": "pipes",
      "js/main.js": 'const game = "swf/game/main.swf"; const box = "vendor/";',
      "swf/game/main.swf": "swf",
      "swf/game/index.html": '<script src="../../js/main.js"></script>',
      "vendor/other.js": "other",
    });
    const result = await address(root, {
      fixed: ["index.html"],
      packages: [
        { path: "swf/game", mapped: true },
        { path: "vendor/pipes/abc" },
      ],
    });
    const pipes = result.packages.get("vendor/pipes/abc")!;
    const game = result.packages.get("swf/game")!;
    expect(pipes).toMatch(/^vendor\/pipes\/abc\.[a-f0-9]{16}$/);
    expect(game).toMatch(/^swf\/game\.[a-f0-9]{16}$/);
    expect(result.files.get("vendor/pipes/abc/pipes.js")).toBe(
      `${pipes}/pipes.js`,
    );
    // Inside a package, files keep their names and references.
    expect(await read(root, `${pipes}/index.html`)).toBe(
      '<script src="pipes.js"></script>',
    );
    expect(await read(root, "index.html")).toBe(
      `<iframe src="${pipes}/index.html"></iframe><script>const root = "${pipes}/";</script>`,
    );
    // Mapped packages are found through ASTRO_GAME_ROOTS instead.
    const main = result.files.get("js/main.js")!;
    expect(await read(root, main)).toBe(
      'const game = "swf/game/main.swf"; const box = "vendor/";',
    );
    expect(await read(root, `${game}/index.html`)).toBe(
      `<script src="../../${main}"></script>`,
    );
    expect(await listing(root)).toContain(`${game}/main.swf`);
  });

  test("gives a package and a file in a cycle one hash", async () => {
    const root = await site({
      "js/loader.js": 'const url = "vendor/tool/index.js";',
      "vendor/tool/index.js": 'const back = "/js/loader.js";',
    });
    const result = await address(root, {
      packages: [{ path: "vendor/tool" }],
    });
    const loader = result.files.get("js/loader.js")!;
    const tool = result.packages.get("vendor/tool")!;
    expect(tool.slice(-16, -8)).toBe(loader.split(".")[1]);
    expect(await read(root, `${tool}/index.js`)).toBe(
      `const back = "/${loader}";`,
    );
  });

  test("keeps fixed, already hashed and unscanned files as they are", async () => {
    const root = await site({
      "index.html": '<script src="js/core.ruffle.abc.js"></script>',
      "js/core.ruffle.abc.js": 'load("js/chunk.wasm")',
      "js/chunk.wasm": "wasm",
      "assets/SOURCES.json": '{"file":"js/chunk.wasm"}',
      "site.json": '{"url":"https://xp.example/js/chunk.wasm"}',
    });
    const result = await address(root, {
      fixed: ["index.html"],
      namedByContent: (path) => path.startsWith("js/core.ruffle."),
      unscanned: (path) => path.endsWith("SOURCES.json"),
      origins: ["https://xp.example"],
    });
    const wasm = result.files.get("js/chunk.wasm")!;
    expect(result.files.get("js/core.ruffle.abc.js")).toBe(
      "js/core.ruffle.abc.js",
    );
    expect(await read(root, "js/core.ruffle.abc.js")).toBe(`load("${wasm}")`);
    expect(await read(root, "index.html")).toBe(
      '<script src="js/core.ruffle.abc.js"></script>',
    );
    expect(await read(root, result.files.get("assets/SOURCES.json")!)).toBe(
      '{"file":"js/chunk.wasm"}',
    );
    expect(await read(root, result.files.get("site.json")!)).toBe(
      `{"url":"https://xp.example/${wasm}"}`,
    );
  });

  test("names files without an extension and skips links", async () => {
    const root = await site({ LICENSE: "license", "index.html": "LICENSE" });
    await symlink(join(root, "LICENSE"), join(root, "link"));
    const result = await address(root, { fixed: ["index.html"] });
    expect(result.files.get("LICENSE")).toBe(`LICENSE.${fileHash("license")}`);
    expect(result.files.has("link")).toBeFalse();
  });

  test("rejects missing packages and fixed files", async () => {
    const root = await site({ "index.html": "" });
    await expect(
      address(root, { packages: [{ path: "vendor/missing" }] }),
    ).rejects.toThrow("Content package is missing: vendor/missing");
    await expect(
      address(root, { fixed: ["index.html", "capture.html"] }),
    ).rejects.toThrow("Fixed files are missing: capture.html");
  });
});
