import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

import {
  BuildPaths,
  PRECACHE_FILE_SUFFIXES,
  addressContent,
  build,
  compressFonts,
  createPrecacheManifest,
  generateServiceWorker,
  getDeploymentVersion,
  isContentAddressed,
  parseBuildArguments,
  prepareDoomPackage,
  prepareEntryPoints,
  replaceOutput,
  runGit,
  DEFAULT_OUTPUT_DIR,
  DEFAULT_UPDATE_STABILITY_DELAY_MS,
  installFflate,
  installJsDos,
  installRuffle,
  installWebtorrent,
  validatePrecacheIntegrity,
  validateOutput,
  versionOfflineGameManifest,
  writeHeaders,
  writeOfflineGameManifest,
  writeVersionMetadata,
} from "../tools/deploy";
import { bunCommand } from "./helpers/coverage";

const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "astro-xp-deploy-test-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function writeFiles(
  root: string,
  files: Record<string, string | Uint8Array>,
): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
  }
}

async function makeSource(root: string): Promise<void> {
  await writeFiles(root, {
    "index.html": [
      "<head>",
      '<meta name="astro-version" content="development" />',
      '<meta property="og:image" content="https://xp.4st.li/assets/xp/bliss.jpg" />',
      '<script src="js/startup-recovery.js"></script>',
      '<script defer src="vendor/fflate/index.js"></script>',
      '<script defer src="js/games.js"></script>',
      '<script defer src="js/flash-url-router.js"></script>',
      '<script defer src="js/storage-policy.js"></script>',
      '<script defer src="js/dialogs.js"></script>',
      '<script defer src="js/shell-cache.js"></script>',
      '<script defer src="js/offline.js"></script>',
      '<script type="module" src="apps/index.js"></script>',
      '<script defer src="js/shell/desktop.js"></script>',
      '<script defer src="js/main.js"></script>',
      '<meta name="astro-ruffle-src" content="js/ruffle.js" />',
      '<link rel="preload" href="css/fonts/test.ttf" as="font" crossorigin>',
      '<link rel="stylesheet" href="css/main.css">',
      '<link rel="stylesheet" href="css/shell/desktop.css">',
      '<link rel="icon" href="favicon.ico">',
      '<img src="assets/xp/bliss.jpg">',
      "</head>",
    ].join("\n"),
    "capture.html": [
      '<script src="js/ruffle.js"></script>',
      '<script src="js/games.js"></script>',
      '<script src="js/flash-url-router.js"></script>',
    ].join("\n"),
    "js/games.js":
      'const icon = "assets/icons/game.png"; const swf = "swf/bike-mania/main.swf";',
    "js/flash-url-router.js": "flash url router",
    "js/storage-policy.js": "storage policy",
    "js/dialogs.js": "dialogs",
    "js/shell-cache.js": "shell cache",
    "js/offline.js": "offline",
    "js/offline-worker.js": "offline worker",
    "js/shell-worker.js": "shell worker",
    "js/startup-recovery.js": "startup recovery",
    "apps/index.js": 'import "./catalog.js";',
    "apps/catalog.js": 'const icon = "assets/xp/icons/paint.png";',
    "js/shell/desktop.js": "desktop shell",
    "js/main.js": [
      'const APP_VERSION = "old";',
      'const sound = "assets/xp/sounds/startup.wav";',
      'const pipes = "vendor/pipes/abc/index.html";',
    ].join("\n"),
    "css/main.css": [
      '@font-face { src: url("fonts/test.ttf"); }',
      'body { background: url("../assets/xp/bliss.jpg"); }',
    ].join("\n"),
    "css/shell/desktop.css": ".desktop { display: block; }",
    "css/fonts/test.ttf": "font",
    "assets/icons/game.png": "icon",
    "assets/icons/SOURCES.json": '{"file":"assets/icons/game.png"}',
    "assets/xp/bliss.jpg": "wallpaper",
    "assets/xp/Chess.bmp": "bitmap",
    "assets/xp/about.png": "about",
    "assets/xp/icons/paint.png": "paint",
    "assets/xp/sounds/startup.wav": "sound",
    "favicon.ico": "favicon",
    "vendor/fflate/index.js": "fflate",
    "vendor/js-dos/js-dos.js": "js-dos",
    "vendor/js-dos/emulators/wdosbox.wasm": "wasm",
    "vendor/pipes/abc/index.html": '<script src="pipes.js"></script>',
    "vendor/pipes/abc/pipes.js": "pipes",
    "vendor/webtorrent/webtorrent.min.js": "webtorrent",
    "swf/bike-mania/main.swf": "swf",
    "iframe/doom/index.html":
      'doom ../../dos/doom/doom.jsdos <script src="../../vendor/js-dos/js-dos.js"></script>',
    "iframe/inside-the-firewall/index.html": "firewall",
    "iframe/pink-panther-hokus-pokus/index.html":
      '<script src="../../js/storage-policy.js"></script>',
    "iframe/pink-panther-passport-to-peril/index.html":
      '<script src="../../js/storage-policy.js"></script>',
    "iframe/revcdos/index.html":
      '<script src="../../js/storage-policy.js"></script>',
    "iframe/scummvm/index.html": '<script src="launcher.js"></script>',
    "iframe/scummvm/launcher.js": [
      'const route = "/iframe/scummvm/local-games/peril";',
      'const root = "../../vendor/scummvm/2026.3.0/";',
    ].join("\n"),
    "vendor/scummvm/2026.3.0/data/index.json": JSON.stringify({
      peril: { baseUrl: "/iframe/scummvm/local-games/peril" },
    }),
    "vendor/scummvm/2026.3.0/scummvm.wasm": "scummvm",
    "dos/doom/doom.jsdos": "jsdos",
  });
}

const RUFFLE_CORE = "core.ruffle.0123456789abcdef0123.js";
const RUFFLE_WASM = "0123456789abcdef0123.wasm";
const ruffleRuntime = {
  "ruffle.js": `load("${RUFFLE_CORE}")`,
  [RUFFLE_CORE]: `load("${RUFFLE_WASM}")`,
  [RUFFLE_WASM]: "wasm",
};

async function addGeneratedRuntime(root: string): Promise<void> {
  await writeFiles(join(root, "js"), ruffleRuntime);
}

const VERSION = "26.07.28-abcdef1";

// The build steps between installing packages and writing the worker.
async function prepareSite(root: string, version = VERSION) {
  const paths = new BuildPaths(root);
  await prepareEntryPoints(paths, version);
  await prepareDoomPackage(paths);
  const addressed = await addressContent(paths);
  await writeOfflineGameManifest(paths, version, addressed);
  await writeVersionMetadata(paths, version);
  const manifestName = await versionOfflineGameManifest(paths);
  return { addressed, manifestName, paths };
}

async function fileSnapshot(root: string): Promise<Map<string, Uint8Array>> {
  const snapshot = new Map<string, Uint8Array>();
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile())
        snapshot.set(relative(root, path), await readFile(path));
    }
  }
  await visit(root);
  return snapshot;
}

describe("npm runtime installation", () => {
  test("copies Ruffle runtime files from a package directory", async () => {
    const root = await makeTemporaryDirectory();
    const source = join(root, "package");
    const jsDir = join(root, "js");
    await writeFiles(source, {
      "ruffle.js": "ruffle",
      "ruffle.js.map": "map",
      "core.ruffle.abc123.js": "core",
      "abc123.wasm": "wasm",
      "nested/ignored.js": "ignored",
      "README.md": "docs",
    });
    await installRuffle(jsDir, source);

    expect(await Bun.file(join(jsDir, "ruffle.js")).exists()).toBeTrue();
    expect(await Bun.file(join(jsDir, "abc123.wasm")).exists()).toBeTrue();
    expect(await Bun.file(join(jsDir, "ignored.js")).exists()).toBeFalse();
    expect(await Bun.file(join(jsDir, "README.md")).exists()).toBeFalse();
  });

  test("rejects incomplete Ruffle packages", async () => {
    const root = await makeTemporaryDirectory();
    const source = join(root, "package");
    await writeFiles(source, {
      "ruffle.js": "ruffle",
      "core.ruffle.abc123.js": "core",
    });
    await expect(installRuffle(join(root, "js"), source)).rejects.toThrow(
      "missing required runtime",
    );
  });

  test("copies js-dos and WebTorrent browser assets", async () => {
    const root = await makeTemporaryDirectory();
    const jsDosSource = join(root, "js-dos");
    const webtorrentSource = join(root, "webtorrent");
    const output = join(root, "out");
    await writeFiles(jsDosSource, {
      "dist/js-dos.js": "player",
      "dist/js-dos.css": "css",
      "dist/emulators/emulators.js": "emulators",
      "dist/emulators/wdosbox.js": "box",
      "dist/emulators/wdosbox.wasm": "box-wasm",
      "dist/emulators/wlibzip.js": "zip",
      "dist/emulators/wlibzip.wasm": "zip-wasm",
    });
    await writeFiles(webtorrentSource, {
      "dist/webtorrent.min.js": "torrent",
    });

    await installJsDos(output, jsDosSource);
    await installWebtorrent(output, webtorrentSource);

    const paths = new BuildPaths(output);
    expect(await readFile(join(paths.jsDosRoot, "js-dos.js"), "utf8")).toBe(
      "player",
    );
    expect(
      await readFile(
        join(paths.jsDosRoot, "emulators", "wdosbox.wasm"),
        "utf8",
      ),
    ).toBe("box-wasm");
    expect(await readFile(paths.webtorrentJs, "utf8")).toBe("torrent");
  });
});

describe("build metadata", () => {
  test("serves TrueType fonts as WOFF2 and rewrites their references", async () => {
    const root = await makeTemporaryDirectory();
    const trueType = new Uint8Array([0, 1, 0, 0, 7, 7]);
    await mkdir(join(root, "css", "fonts"), { recursive: true });
    await writeFile(join(root, "css", "fonts", "tahoma.ttf"), trueType);
    await writeFile(join(root, "css", "fonts", "note.ttf"), "not a font");
    await writeFile(
      join(root, "css", "fonts.css"),
      '@font-face { src: url("fonts/tahoma.ttf") format("truetype"); }',
    );
    await writeFile(
      join(root, "index.html"),
      '<link rel="preload" href="css/fonts/tahoma.ttf" as="font" type="font/ttf" crossorigin />',
    );

    const converted = await compressFonts(new BuildPaths(root), async (input) =>
      input.slice(4),
    );

    expect(converted).toEqual(["tahoma.ttf"]);
    expect(await readFile(join(root, "css", "fonts", "tahoma.woff2"))).toEqual(
      Buffer.from([7, 7]),
    );
    expect(
      await Bun.file(join(root, "css", "fonts", "tahoma.ttf")).exists(),
    ).toBeFalse();
    expect(
      await Bun.file(join(root, "css", "fonts", "note.ttf")).exists(),
    ).toBeTrue();
    expect(await readFile(join(root, "css", "fonts.css"), "utf8")).toBe(
      '@font-face { src: url("fonts/tahoma.woff2") format("woff2"); }',
    );
    expect(await readFile(join(root, "index.html"), "utf8")).toBe(
      '<link rel="preload" href="css/fonts/tahoma.woff2" as="font" type="font/woff2" crossorigin />',
    );
  });

  test("uses the commit date and short revision", () => {
    const outputs = ["2026-07-28", "abcdef123456"];
    const git = () => outputs.shift() ?? "";
    expect(getDeploymentVersion("main", "/tmp", git)).toBe("26.07.28-abcdef1");
  });

  test("rejects invalid git output", () => {
    const outputs = ["not-a-date", "abcdef1"];
    const git = () => outputs.shift() ?? "";
    expect(() => getDeploymentVersion("HEAD", "/tmp", git)).toThrow(
      "invalid commit date",
    );
  });

  test("names files by content and writes matching manifests", async () => {
    const root = await makeTemporaryDirectory();
    await makeSource(root);
    await addGeneratedRuntime(root);
    const { addressed, manifestName, paths } = await prepareSite(root);
    const final = (path: string) => addressed.files.get(path)!;

    const html = await readFile(paths.html, "utf8");
    const main = await readFile(join(root, final("js/main.js")), "utf8");
    expect(main).toContain(`const APP_VERSION = "${VERSION}";`);
    expect(html).toContain(
      `<meta name="astro-version" content="${VERSION}" />`,
    );
    expect(html).toContain("startup recovery");
    expect(html).not.toContain("startup-recovery.js");
    expect(addressed.files.has("js/startup-recovery.js")).toBeFalse();
    for (const path of [
      "js/main.js",
      "js/games.js",
      "js/dialogs.js",
      "js/shell-cache.js",
      "js/offline.js",
      "js/shell/desktop.js",
      "apps/index.js",
      "css/main.css",
      "css/shell/desktop.css",
      "vendor/fflate/index.js",
      "favicon.ico",
      "assets/xp/bliss.jpg",
    ]) {
      expect(final(path)).toMatch(/\.[a-f0-9]{8}\.[a-z]+$/);
      expect(html).toContain(`"${final(path)}"`);
      expect(await Bun.file(join(root, path)).exists()).toBeFalse();
    }
    expect(html).toContain(
      `content="https://xp.4st.li/${final("assets/xp/bliss.jpg")}"`,
    );
    // Ruffle's chunks already carry a hash and keep their names.
    expect(final(`js/${RUFFLE_CORE}`)).toBe(`js/${RUFFLE_CORE}`);
    expect(html).toContain(`content="${final("js/ruffle.js")}"`);
    expect(html).toContain(
      `window.ASTRO_OFFLINE_MANIFEST_URL="${manifestName}"`,
    );
    expect(manifestName).toMatch(/^offline-games\.[a-f0-9]{8}\.json$/);
    const capture = await readFile(paths.captureHtml, "utf8");
    expect(capture).toContain(`"${final("js/ruffle.js")}"`);
    expect(capture).toContain(`"${final("js/games.js")}"`);
    expect(capture).toContain("window.ASTRO_GAME_ROOTS=");

    expect(main).toContain(`"${final("assets/xp/sounds/startup.wav")}"`);
    expect(main).toMatch(/"vendor\/pipes\/abc\.[a-f0-9]{16}\/index\.html"/);
    expect(await readFile(join(root, final("css/main.css")), "utf8")).toBe(
      [
        `@font-face { src: url("${final("css/fonts/test.ttf").slice(4)}"); }`,
        `body { background: url("../${final("assets/xp/bliss.jpg")}"); }`,
      ].join("\n"),
    );
    expect(
      await readFile(join(root, final("apps/catalog.js")), "utf8"),
    ).toContain(`"${final("assets/xp/icons/paint.png")}"`);
    // Provenance files are shipped as they are.
    expect(
      await readFile(join(root, final("assets/icons/SOURCES.json")), "utf8"),
    ).toBe('{"file":"assets/icons/game.png"}');
    const games = await readFile(join(root, final("js/games.js")), "utf8");
    expect(games).toContain(`"${final("assets/icons/game.png")}"`);
    // Games are found through ASTRO_GAME_ROOTS, not literal paths.
    expect(games).toContain('"swf/bike-mania/main.swf"');

    const manifest = JSON.parse(
      await readFile(join(root, manifestName), "utf8"),
    );
    expect(manifest.games["bike-mania"].files[0].integrity).toMatch(
      /^sha384-[A-Za-z0-9+/]+={0,2}$/,
    );
    for (const gameId of [
      "pink-panther-hokus-pokus",
      "pink-panther-passport-to-peril",
      "revcdos",
    ]) {
      expect(
        await readFile(
          join(root, manifest.games[gameId].root, "index.html"),
          "utf8",
        ),
      ).toContain(`"../../${final("js/storage-policy.js")}"`);
    }
    expect(manifest.games["pink-panther-hokus-pokus"].runtime).toBe("scummvm");
    expect(
      manifest.runtimes.scummvm.files.map(({ url }: { url: string }) => url),
    ).toEqual(
      [
        "iframe/scummvm/index.html",
        "iframe/scummvm/launcher.js",
        "vendor/scummvm/2026.3.0/data/index.json",
        "vendor/scummvm/2026.3.0/scummvm.wasm",
      ]
        .map(final)
        .sort(),
    );
    expect(
      await readFile(join(root, final("iframe/scummvm/launcher.js")), "utf8"),
    ).toContain(
      `"../../${addressed.packages.get("vendor/scummvm/2026.3.0")}/"`,
    );
    expect(
      manifest.runtime.files.map(({ url }: { url: string }) => url),
    ).toEqual([`js/${RUFFLE_WASM}`, `js/${RUFFLE_CORE}`]);
    expect(PRECACHE_FILE_SUFFIXES.has(".ttf")).toBeTrue();
    expect(PRECACHE_FILE_SUFFIXES.has(".bmp")).toBeTrue();
    expect(PRECACHE_FILE_SUFFIXES.has(".data")).toBeTrue();

    const metadata = JSON.parse(await readFile(paths.versionJson, "utf8"));
    expect(metadata.offlineBytes).toBeGreaterThan(0);
    expect(metadata.bundledGameBytes).toBeGreaterThan(0);
    expect(Number.isFinite(Date.parse(metadata.releasedAt))).toBeTrue();
    expect(metadata.stabilityDelayMs).toBe(6 * 60 * 60 * 1000);
    expect(manifest.version).toBe(VERSION);
    expect(manifest.games["bike-mania"].type).toBe("swf");
    expect(manifest.games["bike-mania"].root).toBe(
      `${addressed.packages.get("swf/bike-mania")}/`,
    );
    expect(manifest.games.doom.type).toBe("iframe");
    expect(
      manifest.games.doom.files.map(({ url }: { url: string }) => url),
    ).toEqual([
      `${manifest.games.doom.root}dos/doom/doom.jsdos`,
      `${manifest.games.doom.root}index.html`,
    ]);
    expect(
      await readFile(
        join(root, manifest.games.doom.root, "index.html"),
        "utf8",
      ),
    ).toBe(
      `doom dos/doom/doom.jsdos <script src="../../${addressed.packages.get("vendor/js-dos")}/js-dos.js"></script>`,
    );
    expect(await Bun.file(join(root, "dos")).exists()).toBeFalse();
    const configuredRoots = JSON.parse(
      html.match(/window\.ASTRO_GAME_ROOTS=Object\.freeze\((\{[^<]+\})\)/)![1],
    );
    expect(configuredRoots).toEqual(
      Object.fromEntries(
        Object.entries(manifest.games).map(([id, game]: [string, any]) => [
          id,
          game.root,
        ]),
      ),
    );
    expect(metadata.bundledGameBytes).toBe(
      manifest.runtime.bytes +
        Object.values(manifest.runtimes).reduce(
          (total: number, runtime: any) => total + runtime.bytes,
          0,
        ) +
        Object.values(manifest.games).reduce(
          (total: number, game: any) => total + game.bytes,
          0,
        ),
    );
    expect({
      revision: metadata.revision,
      version: metadata.version,
    }).toEqual({ revision: "abcdef1", version: VERSION });
  });

  test("keeps game revisions when only the release changes", async () => {
    const first = await makeTemporaryDirectory();
    const second = await makeTemporaryDirectory();
    for (const root of [first, second]) {
      await makeSource(root);
      await addGeneratedRuntime(root);
    }
    await writeFile(join(second, "js", "dialogs.js"), "dialogs v2");
    const one = await prepareSite(first);
    const two = await prepareSite(second, "26.07.29-1234567");
    expect(two.addressed.packages.get("swf/bike-mania")).toBe(
      one.addressed.packages.get("swf/bike-mania"),
    );
    expect(two.addressed.files.get("assets/xp/bliss.jpg")).toBe(
      one.addressed.files.get("assets/xp/bliss.jpg"),
    );
    expect(two.addressed.files.get("js/dialogs.js")).not.toBe(
      one.addressed.files.get("js/dialogs.js"),
    );
  });

  test("fails when the entry points can't be prepared", async () => {
    const root = await makeTemporaryDirectory();
    await makeSource(root);
    await editFile(join(root, "index.html"), (html) =>
      html.replace('<meta name="astro-version" content="development" />', ""),
    );
    await expect(
      prepareEntryPoints(new BuildPaths(root), VERSION),
    ).rejects.toThrow("Could not update the deployment version");
  });
});

describe("service worker and artifact validation", () => {
  const workerScripts = {
    "js/shell-cache.11111111.js": "shell cache",
    "js/offline-worker.12345678.js": "offline worker",
    "js/shell-worker.87654321.js": "shell worker",
  };

  test("precaches bitmap artwork and Pinball data with revisions", async () => {
    const root = await makeTemporaryDirectory();
    await writeFiles(root, {
      "index.html": "final index",
      "capture.html": "capture",
      ...workerScripts,
      "assets/xp/Chess.12345678.bmp": "bitmap",
      "apps/pinball/runtime.0123456789abcdef/SpaceCadetPinball.data":
        "pinball data",
    });

    await generateServiceWorker(root, VERSION);

    const worker = await readFile(join(root, "sw.js"), "utf8");
    const manifest = JSON.parse(
      worker.match(/^self\.__ASTRO_XP_PRECACHE__=(.*);$/m)![1],
    );
    expect(manifest).toEqual([
      precached(
        "pinball data",
        "apps/pinball/runtime.0123456789abcdef/SpaceCadetPinball.data",
      ),
      precached("bitmap", "assets/xp/Chess.12345678.bmp"),
      { fixed: true, ...precached("capture", "capture.html") },
      { fixed: true, ...precached("final index", "index.html") },
      precached("shell cache", "js/shell-cache.11111111.js"),
    ]);
    expect(worker).toContain(
      'importScripts("js/shell-cache.11111111.js","js/offline-worker.12345678.js","js/shell-worker.87654321.js");',
    );
    expect(worker).toContain(`self.__ASTRO_XP_VERSION__="${VERSION}";`);
    expect(await readFile(join(root, `sw.${VERSION}.js`), "utf8")).toBe(
      `${worker}\nself.__ASTRO_XP_IMMUTABLE_WORKER__=true;\n`,
    );
    await validatePrecacheIntegrity(root);
    await writeFile(join(root, "index.html"), "changed after generation");
    await expect(validatePrecacheIntegrity(root)).rejects.toThrow(
      "invalid integrity: index.html",
    );
  });

  test("leaves out ignored, hidden, unknown and oversized files", async () => {
    const root = await makeTemporaryDirectory();
    await writeFiles(root, {
      "index.html": "index",
      "version.json": "{}",
      "sw.js": "worker",
      [`sw.${VERSION}.js`]: "worker",
      "assets/xp/SOURCES.json": "{}",
      "swf/game/main.swf": "swf",
      "iframe/game/index.html": "iframe",
      "dos/doom/doom.jsdos": "dos",
      "vendor/scummvm/scummvm.js": "scummvm",
      "js/abc123.wasm": "ruffle",
      "js/core.ruffle.abc123.js": "ruffle core",
      "js/offline-worker.12345678.js": "offline worker",
      "js/shell-worker.87654321.js": "shell worker",
      "js/main.js": "main",
      ".hidden/file.js": "hidden",
      "notes.txt": "text",
      "apps/pinball/runtime/large.wasm": "x",
    });
    await writeFile(
      join(root, "apps/pinball/runtime/large.wasm"),
      new Uint8Array(25_000_001),
    );

    expect(
      (await createPrecacheManifest(root, "prefix/")).map(({ url }) => url),
    ).toEqual(["prefix/index.html", "prefix/js/main.js"]);
  });

  test("accepts a complete artifact and rejects a missing game file", async () => {
    const { root, manifestName } = await makeValidArtifact();
    const manifest = JSON.parse(
      await readFile(join(root, manifestName), "utf8"),
    );
    await unlink(join(root, manifest.games["bike-mania"].root, "main.swf"));
    await expect(validateOutput(root)).rejects.toThrow(
      `references a missing file for bike-mania: ${manifest.games["bike-mania"].root}main.swf`,
    );
  });
});

describe("cache rules", () => {
  test("keeps everything but the entry points forever", async () => {
    const root = await makeTemporaryDirectory();
    await writeFiles(root, {
      "index.html": "",
      "capture.html": "",
      "version.json": "",
      "sw.js": "",
      [`sw.${VERSION}.js`]: "",
      "favicon.12345678.ico": "",
      "js/main.12345678.js": "",
      "swf/game.0123456789abcdef/main.swf": "",
    });
    await writeHeaders(root);
    expect(await readFile(join(root, "_headers"), "utf8")).toBe(
      ["/favicon.12345678.ico", "/js/*", "/swf/*"]
        .map(
          (path) =>
            `${path}\n  Cache-Control: public, max-age=31536000, immutable\n`,
        )
        .join(""),
    );
  });

  test("knows which names carry their content hash", () => {
    for (const path of [
      "index.html",
      "capture.html",
      "js/main.12345678.js",
      "LICENSE.12345678",
      `js/${RUFFLE_CORE}`,
      `js/${RUFFLE_WASM}.map`,
      "swf/game.0123456789abcdef/main.swf",
      "vendor/pipes/abc.0123456789abcdef/sub/index.html",
    ]) {
      expect(isContentAddressed(path)).toBeTrue();
    }
    for (const path of [
      "js/main.js",
      "js/main.1234567.js",
      "swf/game/main.swf",
      "game.0123456789abcdef",
      "js/core.ruffle.abc.js",
    ]) {
      expect(isContentAddressed(path)).toBeFalse();
    }
  });
});

describe("Doom package", () => {
  test("moves the game data into the game and keeps other DOS data", async () => {
    const root = await makeTemporaryDirectory();
    await writeFiles(root, {
      "iframe/doom/index.html": "../../dos/doom/doom.jsdos",
      "dos/doom/doom.jsdos": "doom",
      "dos/other/other.jsdos": "other",
    });
    await prepareDoomPackage(new BuildPaths(root));
    expect(await readFile(join(root, "iframe/doom/index.html"), "utf8")).toBe(
      "dos/doom/doom.jsdos",
    );
    expect(
      await readFile(join(root, "iframe/doom/dos/doom/doom.jsdos"), "utf8"),
    ).toBe("doom");
    expect(await readdir(join(root, "dos"))).toEqual(["other"]);
  });

  test("needs exactly one data reference and skips missing games", async () => {
    const root = await makeTemporaryDirectory();
    await prepareDoomPackage(new BuildPaths(root));
    await writeFiles(root, {
      "iframe/doom/index.html": "no data",
      "dos/doom/doom.jsdos": "doom",
    });
    await expect(prepareDoomPackage(new BuildPaths(root))).rejects.toThrow(
      "Could not package the Doom game data",
    );
  });
});

describe("atomic build", () => {
  test("keeps temporary build directories out of git status", async () => {
    const result = Bun.spawnSync(
      ["git", "check-ignore", ".dist-build-example/output/index.html"],
      {
        cwd: join(import.meta.dir, ".."),
        stderr: "pipe",
        stdout: "pipe",
      },
    );

    expect(result.success).toBe(true);
    expect(result.stdout.toString()).toContain(".dist-build-example");
  });

  test("does not mutate source and replaces old output", async () => {
    const project = await makeTemporaryDirectory();
    const source = join(project, "site");
    const output = join(project, "dist");
    await makeSource(source);
    const originalFiles = await fileSnapshot(source);
    await mkdir(output);
    await writeFile(join(output, "stale.txt"), "stale");

    await build({
      sourceDir: source,
      outputDir: output,
      version: "26.07.28-abcdef1",
      releasedAt: "2026-07-28T12:00:00.000Z",
      stabilityDelayMs: 2 * 60 * 60 * 1000,
      installRuffle: async (jsDir) => writeFiles(jsDir, ruffleRuntime),
    });

    const currentFiles = await fileSnapshot(source);
    expect([...currentFiles.keys()]).toEqual([...originalFiles.keys()]);
    for (const [path, bytes] of originalFiles) {
      expect(currentFiles.get(path)).toEqual(bytes);
    }
    expect(await Bun.file(join(output, "stale.txt")).exists()).toBeFalse();
    expect(await Bun.file(join(output, "sw.js")).exists()).toBeTrue();
    expect(
      await Bun.file(join(output, "sw.26.07.28-abcdef1.js")).exists(),
    ).toBeTrue();
    expect(await Bun.file(join(output, "releases")).exists()).toBeFalse();
    expect(
      await Bun.file(join(output, "offline-games.json")).exists(),
    ).toBeFalse();
    const rootHtml = await readFile(join(output, "index.html"), "utf8");
    expect(rootHtml).not.toContain("<base");
    const metadata = JSON.parse(
      await readFile(join(output, "version.json"), "utf8"),
    );
    expect(metadata.offlineBytes).toBeGreaterThan(0);
    expect(metadata.bundledGameBytes).toBeGreaterThan(0);
    expect(metadata.revision).toBe("abcdef1");
    expect(metadata.version).toBe("26.07.28-abcdef1");
    expect(metadata.releasedAt).toBe("2026-07-28T12:00:00.000Z");
    expect(metadata.stabilityDelayMs).toBe(2 * 60 * 60 * 1000);
    const headers = await readFile(join(output, "_headers"), "utf8");
    for (const path of ["/js/*", "/swf/*", "/vendor/*"]) {
      expect(headers).toContain(
        `${path}\n  Cache-Control: public, max-age=31536000, immutable\n`,
      );
    }
    expect(headers).not.toMatch(/^\/(index\.html|sw\.|version\.json)/m);

    await writeFiles(output, { "assets/xp/extra.png": "extra" });
    await expect(validateOutput(output)).rejects.toThrow(
      "files not named by their content: assets/xp/extra.png",
    );
  });

  test("preserves previous output after a failed build", async () => {
    const project = await makeTemporaryDirectory();
    const source = join(project, "site");
    const output = join(project, "dist");
    await makeSource(source);
    await mkdir(output);
    await writeFile(join(output, "previous.txt"), "keep");

    await expect(
      build({
        sourceDir: source,
        outputDir: output,
        version: "26.07.28-abcdef1",
        installRuffle: async () => {
          throw new Error("network failed");
        },
      }),
    ).rejects.toThrow("network failed");
    expect(await readFile(join(output, "previous.txt"), "utf8")).toBe("keep");
  });

  test("rejects output inside the source tree", async () => {
    const project = await makeTemporaryDirectory();
    const source = join(project, "site");
    await makeSource(source);
    await expect(
      build({
        sourceDir: source,
        outputDir: join(source, "dist"),
        version: "26.07.28-abcdef1",
      }),
    ).rejects.toThrow("outside");
  });
});

describe("build inputs and release metadata validation", () => {
  test("CLI defaults and explicit paths, revision and delay are parsed consistently", () => {
    expect(parseBuildArguments([])).toEqual({
      outputDir: DEFAULT_OUTPUT_DIR,
      revision: "HEAD",
      sourceDir: join(import.meta.dir, "..", "site"),
      stabilityDelayMs: DEFAULT_UPDATE_STABILITY_DELAY_MS,
    });
    expect(
      parseBuildArguments([
        "--output",
        "/tmp/synthetic-build",
        "--revision",
        "deadbee",
        "--update-delay-hours",
        "1.5",
      ]),
    ).toMatchObject({
      outputDir: "/tmp/synthetic-build",
      revision: "deadbee",
      stabilityDelayMs: 5400000,
    });
    expect(
      parseBuildArguments([
        "--output",
        "relative-dist",
        "--update-delay-hours",
        "0",
      ]).outputDir,
    ).toEndWith("/relative-dist");
  });
  for (const args of [
    ["--output"],
    ["--revision"],
    ["--update-delay-hours"],
    ["--unknown"],
    ["--update-delay-hours", "-1"],
    ["--update-delay-hours", "NaN"],
    ["--update-delay-hours", "Infinity"],
  ]) {
    test(`CLI rejects invalid arguments ${args.join(" ")}`, () => {
      expect(() => parseBuildArguments(args)).toThrow();
    });
  }
  test("Git helper reports a real repository revision and rejects invalid repositories", async () => {
    expect(runGit(["rev-parse", "--short=7", "HEAD"])).toMatch(
      /^[a-f0-9]{7,}$/,
    );
    const empty = await makeTemporaryDirectory();
    expect(() => runGit(["rev-parse", "HEAD"], empty)).toThrow();
  });
  for (const options of [
    { releasedAt: "invalid" },
    { stabilityDelayMs: -1 },
    { stabilityDelayMs: 0.5 },
    { stabilityDelayMs: Infinity },
  ]) {
    test(`version metadata rejects ${JSON.stringify(options)}`, async () => {
      const root = await makeTemporaryDirectory();
      await expect(
        writeVersionMetadata(new BuildPaths(root), "26.07.28-abcdef1", options),
      ).rejects.toThrow();
      expect(await Bun.file(join(root, "version.json")).exists()).toBeFalse();
    });
  }
});

const sri = (content: string | Uint8Array) =>
  `sha384-${createHash("sha384").update(content).digest("base64")}`;
const shortHash = (content: string | Uint8Array) =>
  createHash("sha384").update(content).digest("hex").slice(0, 8);
const precached = (content: string | Uint8Array, url: string) => ({
  integrity: sri(content),
  revision: shortHash(content),
  url,
});
const precacheWorker = (entries: object[]) =>
  `self.__ASTRO_XP_PRECACHE__=${JSON.stringify(entries)};\n`;

async function makeValidArtifact() {
  const root = await makeTemporaryDirectory();
  await makeSource(root);
  await addGeneratedRuntime(root);
  const { manifestName, paths } = await prepareSite(root);
  await writeHeaders(root);
  await generateServiceWorker(root, VERSION);
  await validateOutput(root);
  return { root, manifestName, paths };
}

type Artifact = Awaited<ReturnType<typeof makeValidArtifact>>;

const editFile = async (path: string, change: (content: string) => string) =>
  writeFile(path, change(await readFile(path, "utf8")));

// Rewrites the offline manifest under its new content hash.
async function rewriteManifest(
  { root, manifestName, paths }: Artifact,
  change: (manifest: any) => void,
) {
  const manifest = JSON.parse(await readFile(join(root, manifestName), "utf8"));
  change(manifest);
  const content = JSON.stringify(manifest);
  const nextName = `offline-games.${shortHash(content)}.json`;
  await unlink(join(root, manifestName));
  await writeFile(join(root, nextName), content);
  await editFile(paths.html, (html) => html.replace(manifestName, nextName));
}

const jsFile = async (root: string, pattern: RegExp) =>
  join(
    root,
    "js",
    (await readdir(join(root, "js"))).find((name) => pattern.test(name))!,
  );

describe("build output validation failures", () => {
  const cases: [string, (artifact: Artifact) => Promise<unknown>, string][] = [
    [
      "a missing version file",
      ({ paths }) => unlink(paths.versionJson),
      "missing required file: version.json",
    ],
    [
      "a file not named by its content",
      ({ root }) => writeFiles(root, { "assets/xp/extra.png": "extra" }),
      "files not named by their content: assets/xp/extra.png",
    ],
    [
      "a reference to a missing file",
      ({ paths }) =>
        editFile(
          paths.html,
          (html) => `${html}\n<img src="assets/xp/missing.12345678.png?x=1">`,
        ),
      "references a missing file: assets/xp/missing.12345678.png",
    ],
    [
      "a reference to an unrenamed script",
      ({ paths }) =>
        editFile(paths.html, (html) =>
          html.replace(/js\/dialogs\.[a-f0-9]{8}\.js/, "js/dialogs.js"),
        ),
      "references a missing file: js/dialogs.js",
    ],
    [
      "an unversioned offline manifest reference",
      ({ paths }) =>
        editFile(paths.html, (html) =>
          html.replace("ASTRO_OFFLINE_MANIFEST_URL", "ASTRO_MANIFEST"),
        ),
      "no versioned offline game manifest",
    ],
    [
      "a missing shell cache",
      async ({ root }) => unlink(await jsFile(root, /^shell-cache\./)),
      "no uniquely hashed shell cache",
    ],
    [
      "a missing offline worker",
      async ({ root }) => unlink(await jsFile(root, /^offline-worker\./)),
      "no uniquely hashed offline worker",
    ],
    [
      "a missing shell worker",
      async ({ root }) => unlink(await jsFile(root, /^shell-worker\./)),
      "no uniquely hashed shell worker",
    ],
    [
      "a missing Ruffle core",
      async ({ root }) => unlink(await jsFile(root, /^core\.ruffle\./)),
      "no Ruffle core JavaScript",
    ],
    [
      "a missing Ruffle WebAssembly module",
      async ({ root }) => unlink(await jsFile(root, /\.wasm$/)),
      "no Ruffle WebAssembly",
    ],
    [
      "unreadable version metadata",
      ({ paths }) => writeFile(paths.versionJson, "{"),
      "invalid version metadata",
    ],
    [
      "unexpected version metadata fields",
      ({ paths }) =>
        editFile(paths.versionJson, (json) =>
          JSON.stringify({ ...JSON.parse(json), extra: true }),
        ),
      "invalid version metadata",
    ],
    [
      "an empty offline download",
      ({ paths }) =>
        editFile(paths.versionJson, (json) =>
          JSON.stringify({ ...JSON.parse(json), offlineBytes: 0 }),
        ),
      "invalid offline download size",
    ],
    [
      "inconsistent version metadata",
      ({ paths }) =>
        editFile(paths.versionJson, (json) =>
          JSON.stringify({ ...JSON.parse(json), revision: "fedcba9" }),
        ),
      "inconsistent version metadata",
    ],
    [
      "an unreadable offline manifest",
      async (artifact) => {
        const nextName = `offline-games.${shortHash("{")}.json`;
        await unlink(join(artifact.root, artifact.manifestName));
        await writeFile(join(artifact.root, nextName), "{");
        await editFile(artifact.paths.html, (html) =>
          html.replace(artifact.manifestName, nextName),
        );
      },
      "invalid offline game manifest",
    ],
    [
      "an offline manifest for another version",
      (artifact) =>
        rewriteManifest(artifact, (manifest) => {
          manifest.version = "26.07.27-0000000";
        }),
      "invalid offline game manifest",
    ],
    [
      "an offline manifest without games",
      (artifact) =>
        rewriteManifest(artifact, (manifest) => {
          delete manifest.games;
        }),
      "invalid offline game manifest",
    ],
    [
      "unreadable game roots",
      ({ paths }) =>
        editFile(paths.html, (html) =>
          html.replace(
            "ASTRO_GAME_ROOTS=Object.freeze({",
            "ASTRO_GAME_ROOTS=Object.freeze({,",
          ),
        ),
      "no matching versioned game roots",
    ],
    [
      "missing game roots",
      ({ paths }) =>
        editFile(paths.html, (html) =>
          html.replace("ASTRO_GAME_ROOTS", "ASTRO_ROOTS"),
        ),
      "no matching versioned game roots",
    ],
    [
      "a game package without files",
      (artifact) =>
        rewriteManifest(artifact, (manifest) => {
          manifest.games.doom.files = [];
        }),
      "invalid game package for doom",
    ],
    [
      "a game root that doesn't match its revision",
      (artifact) =>
        rewriteManifest(artifact, (manifest) => {
          manifest.games.doom.revision = "0000000000000000";
        }),
      "invalid game package for doom",
    ],
    [
      "a game file outside its root",
      (artifact) =>
        rewriteManifest(artifact, (manifest) => {
          manifest.games.doom.files[0].url = "js/other.js";
        }),
      "invalid game package for doom",
    ],
    [
      "a game file with the wrong integrity",
      (artifact) =>
        rewriteManifest(artifact, (manifest) => {
          manifest.games.doom.files[0].integrity = sri("other");
        }),
      "invalid offline file integrity for doom",
    ],
    [
      "a runtime file with the wrong integrity",
      (artifact) =>
        rewriteManifest(artifact, (manifest) => {
          manifest.runtime.files[0].integrity = sri("other");
        }),
      "invalid offline file integrity for runtime",
    ],
    [
      "a missing shared runtime file",
      (artifact) =>
        rewriteManifest(artifact, (manifest) => {
          manifest.runtimes.scummvm.files[0].url = "vendor/missing.wasm";
        }),
      "references a missing file for scummvm: vendor/missing.wasm",
    ],
    [
      "a runtime without files",
      (artifact) =>
        rewriteManifest(artifact, (manifest) => {
          delete manifest.runtimes;
          manifest.runtime.files = [];
        }),
      "invalid offline game manifest",
    ],
  ];
  test("accepts catalogs without shared runtimes", async () => {
    const artifact = await makeValidArtifact();
    await rewriteManifest(artifact, (manifest) => {
      delete manifest.runtimes;
    });
    await validateOutput(artifact.root);
  });

  for (const [label, mutate, message] of cases)
    test(`rejects ${label}`, async () => {
      const artifact = await makeValidArtifact();
      await mutate(artifact);
      await expect(validateOutput(artifact.root)).rejects.toThrow(message);
    });
});

// A minimal output whose worker lists the given entries.
async function makeWorkerOutput(worker?: string) {
  const root = await makeTemporaryDirectory();
  await writeFiles(root, {
    "index.html": "index",
    "version.json": "{}",
    ...(worker === undefined ? {} : { "sw.js": worker }),
  });
  return root;
}

describe("precache validation failures", () => {
  test("accepts a worker that lists the index", async () => {
    await validatePrecacheIntegrity(
      await makeWorkerOutput(
        precacheWorker([precached("index", "index.html")]),
      ),
    );
  });

  const cases: [string, string | undefined, string][] = [
    ["a missing worker", undefined, "missing required file: sw.js"],
    [
      "a worker without integrity-protected entries",
      "self.skipWaiting();",
      "no integrity-protected precache entries",
    ],
    [
      "an entry outside the output",
      precacheWorker([precached("x", "../outside.js")]),
      "escapes the build output: ../outside.js",
    ],
    [
      "an entry for a missing file",
      precacheWorker([precached("x", "missing.js")]),
      "references a missing file: missing.js",
    ],
    [
      "an entry with a stale revision",
      precacheWorker([
        { ...precached("{}", "version.json"), revision: "00000000" },
      ]),
      "invalid revision: version.json",
    ],
    [
      "a worker that does not precache the index",
      precacheWorker([precached("{}", "version.json")]),
      "must precache index.html exactly once",
    ],
  ];
  for (const [label, worker, message] of cases)
    test(`rejects ${label}`, async () => {
      await expect(
        validatePrecacheIntegrity(await makeWorkerOutput(worker)),
      ).rejects.toThrow(message);
    });
});

describe("build helpers", () => {
  test("rejects unsafe release versions", async () => {
    const root = await makeTemporaryDirectory();
    await writeFiles(root, {
      "index.html": "index",
      "js/shell-cache.11111111.js": "shell cache",
      "js/offline-worker.12345678.js": "offline worker",
      "js/shell-worker.87654321.js": "shell worker",
    });
    await expect(generateServiceWorker(root, "../escape")).rejects.toThrow(
      "Invalid release version: ../escape",
    );
  });

  test("installs Ruffle from the dependency by default and reports a missing package", async () => {
    const root = await makeTemporaryDirectory();
    await installRuffle(join(root, "js"));
    expect(await readdir(join(root, "js"))).toContain("ruffle.js");
    await expect(
      installRuffle(join(root, "other"), join(root, "missing")),
    ).rejects.toThrow("is not installed");
  });

  test("reports browser packages that are not installed", async () => {
    const root = await makeTemporaryDirectory();
    const missing = join(root, "missing");
    for (const [install, name] of [
      [installFflate, "fflate"],
      [installJsDos, "js-dos"],
      [installWebtorrent, "webtorrent"],
    ] as const)
      await expect(install(join(root, "out"), missing)).rejects.toThrow(
        `${name} is not installed; run \`bun install --frozen-lockfile\``,
      );
  });

  test("derives the deployment version from the current commit", () => {
    expect(getDeploymentVersion()).toMatch(/^\d{2}\.\d{2}\.\d{2}-[a-f0-9]{7}$/);
    const git = (arguments_: string[]) =>
      arguments_[0] === "show" ? "2026-07-28" : "not-a-sha";
    expect(() => getDeploymentVersion("HEAD", ".", git)).toThrow(
      "invalid revision: not-a-sha",
    );
  });

  test("leaves sources without TrueType fonts unchanged", async () => {
    const root = await makeTemporaryDirectory();
    expect(await compressFonts(new BuildPaths(root))).toEqual([]);
    await writeFiles(root, {
      "css/fonts/readme.txt": "fonts",
      "css/fonts/fake.ttf": "not a font",
    });
    await symlink(
      join(root, "css/fonts/readme.txt"),
      join(root, "css/fonts/link.txt"),
    );
    expect(await compressFonts(new BuildPaths(root))).toEqual([]);
    expect(await readdir(join(root, "css/fonts"))).toContain("fake.ttf");
  });

  test("names a minimal site without optional packages", async () => {
    const root = await makeTemporaryDirectory();
    await makeSource(root);
    await addGeneratedRuntime(root);
    for (const path of [
      "apps",
      "capture.html",
      "swf",
      "dos",
      "iframe/pink-panther-hokus-pokus",
      "iframe/pink-panther-passport-to-peril",
      "iframe/revcdos",
      "iframe/scummvm",
      "vendor/pipes",
      "vendor/scummvm",
    ])
      await rm(join(root, path), { recursive: true });
    await editFile(join(root, "index.html"), (html) =>
      html.replace('<script type="module" src="apps/index.js"></script>', ""),
    );
    await writeFiles(root, { "iframe/notes.txt": "not a game" });
    const { manifestName, paths } = await prepareSite(root);
    await writeHeaders(root);
    await generateServiceWorker(root, VERSION);
    await validateOutput(root);
    const manifest = JSON.parse(
      await readFile(join(root, manifestName), "utf8"),
    );
    expect(Object.keys(manifest.games).sort()).toEqual([
      "doom",
      "inside-the-firewall",
    ]);
    expect(manifest.runtimes).toEqual({});
    expect(
      await readFile(
        join(root, manifest.games.doom.root, "index.html"),
        "utf8",
      ),
    ).toStartWith("doom ../../dos/doom/doom.jsdos");
    expect(await Bun.file(paths.captureHtml).exists()).toBeFalse();
  });

  test("totals bundled bytes for catalogs without shared runtimes", async () => {
    const root = await makeTemporaryDirectory();
    const paths = new BuildPaths(root);
    await writeFiles(root, {
      "offline-games.json": JSON.stringify({
        games: { doom: { bytes: 5 } },
        runtime: { bytes: 7 },
      }),
    });
    await writeVersionMetadata(paths, "26.07.28-abcdef1");
    expect(
      JSON.parse(await readFile(paths.versionJson, "utf8")).bundledGameBytes,
    ).toBe(12);
  });

  test("requires exactly one of each worker script", async () => {
    const root = await makeTemporaryDirectory();
    await writeFiles(root, { "js/main.js": "main" });
    await expect(generateServiceWorker(root, VERSION)).rejects.toThrow(
      "exactly one hashed shell cache",
    );
    await writeFiles(root, { "js/shell-cache.11111111.js": "cache" });
    await expect(generateServiceWorker(root, VERSION)).rejects.toThrow(
      "exactly one hashed offline worker",
    );
    await writeFiles(root, { "js/offline-worker.12345678.js": "worker" });
    await expect(generateServiceWorker(root, VERSION)).rejects.toThrow(
      "exactly one hashed shell worker",
    );
  });

  test("restores the previous output when replacing it fails", async () => {
    const root = await makeTemporaryDirectory();
    const output = join(root, "dist");
    await writeFiles(output, { "index.html": "previous" });
    await mkdir(join(root, "build"));
    await expect(
      replaceOutput(join(root, "build", "missing"), output),
    ).rejects.toThrow();
    expect(await readFile(join(output, "index.html"), "utf8")).toBe("previous");
    await rm(output, { recursive: true });
    await expect(
      replaceOutput(join(root, "build", "missing"), output),
    ).rejects.toThrow();
  });

  test("builds the version from the requested Git revision", async () => {
    const project = await makeTemporaryDirectory();
    const source = join(project, "site");
    await makeSource(source);
    await build({
      sourceDir: source,
      outputDir: join(project, "dist"),
      installRuffle: async (jsDir) => writeFiles(jsDir, ruffleRuntime),
      generate: async (directory, version) => {
        await writeFiles(directory, {
          "sw.js": precacheWorker([
            precached(
              await readFile(join(directory, "index.html")),
              "index.html",
            ),
          ]),
        });
        await cp(join(directory, "sw.js"), join(directory, `sw.${version}.js`));
        await editFile(
          join(directory, `sw.${version}.js`),
          (worker) => `${worker}\nself.__ASTRO_XP_IMMUTABLE_WORKER__=true;\n`,
        );
      },
    });
    const metadata = JSON.parse(
      await readFile(join(project, "dist", "version.json"), "utf8"),
    );
    expect(metadata.version).toBe(getDeploymentVersion("HEAD"));
  });

  test("reports command-line build failures", () => {
    const result = Bun.spawnSync(
      bunCommand(join(import.meta.dir, "..", "tools", "deploy.ts"), "--bogus"),
      { stderr: "pipe", stdout: "pipe" },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Unknown argument: --bogus");
  });
});
