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
  build,
  compressFonts,
  createPrecacheManifest,
  generateServiceWorker,
  getDeploymentVersion,
  parseBuildArguments,
  replaceOutput,
  runGit,
  scopeReleaseReferences,
  DEFAULT_OUTPUT_DIR,
  DEFAULT_UPDATE_STABILITY_DELAY_MS,
  installFflate,
  installJsDos,
  installRuffle,
  installWebtorrent,
  updateHtml,
  validatePrecacheIntegrity,
  validateReleaseOutput,
  validateOutput,
  versionOfflineGameManifest,
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
      '<script src="js/startup-recovery.js"></script>',
      '<script src="js/ruffle.js?v=old"></script>',
      '<script src="vendor/fflate/index.js?v=old"></script>',
      '<script src="js/games.js?v=old"></script>',
      '<script src="js/flash-url-router.js?v=old"></script>',
      '<script src="js/storage-policy.js?v=old"></script>',
      '<script src="js/game-installer.js?v=old"></script>',
      '<script src="js/game-library.js?v=old"></script>',
      '<script src="js/game-data.js?v=old"></script>',
      '<script src="js/filesystem.js?v=old"></script>',
      '<script src="js/file-operations.js?v=old"></script>',
      '<script src="js/dialogs.js?v=old"></script>',
      '<script src="js/offline.js?v=old"></script>',
      '<script type="module" src="apps/index.js"></script>',
      '<script src="js/shell/desktop.js"></script>',
      '<script src="js/main.js?v=old"></script>',
      '<link rel="preload" href="css/fonts/test.ttf" as="font" crossorigin>',
      '<link rel="stylesheet" href="css/main.css?v=old">',
      '<link rel="stylesheet" href="css/shell/desktop.css">',
      '<link rel="icon" href="favicon.ico">',
      '<img src="assets/xp/bliss.jpg">',
      "</head>",
    ].join("\n"),
    "capture.html": [
      '<script src="js/ruffle.js?v=old"></script>',
      '<script src="js/games.js?v=old"></script>',
      '<script src="js/flash-url-router.js?v=old"></script>',
    ].join("\n"),
    "js/games.js": 'const icon = "assets/icons/game.png";',
    "js/flash-url-router.js": "flash url router",
    "js/storage-policy.js": "storage policy",
    "js/game-installer.js": "game installer",
    "js/game-library.js": "game library",
    "js/game-data.js": "game data",
    "js/filesystem.js": "filesystem",
    "js/file-operations.js": "file operations",
    "js/dialogs.js": "dialogs",
    "js/offline.js": "offline",
    "js/offline-worker.js": "offline worker",
    "js/shell-worker.js": "shell worker",
    "js/startup-recovery.js": "startup recovery",
    "apps/index.js": "application registry",
    "apps/catalog.js": 'const icon = "assets/xp/icons/paint.png";',
    "js/shell/desktop.js": "desktop shell",
    "js/main.js": [
      'const APP_VERSION = "old";',
      'const sound = "assets/xp/sounds/startup.wav";',
    ].join("\n"),
    "css/main.css": [
      '@font-face { src: url("fonts/test.ttf"); }',
      'body { background: url("../assets/xp/bliss.jpg"); }',
    ].join("\n"),
    "css/shell/desktop.css": ".desktop { display: block; }",
    "css/fonts/test.ttf": "font",
    "assets/icons/game.png": "icon",
    "assets/icons/SOURCES.json": "{}",
    "assets/xp/bliss.jpg": "wallpaper",
    "assets/xp/Chess.bmp": "bitmap",
    "assets/xp/about.png": "about",
    "assets/xp/icons/paint.png": "paint",
    "assets/xp/sounds/startup.wav": "sound",
    "favicon.ico": "favicon",
    "vendor/fflate/index.js": "fflate",
    "vendor/js-dos/js-dos.js": "js-dos",
    "vendor/js-dos/emulators/wdosbox.wasm": "wasm",
    "vendor/webtorrent/webtorrent.min.js": "webtorrent",
    "swf/bike-mania/main.swf": "swf",
    "iframe/doom/index.html": "doom ../../dos/doom/doom.jsdos",
    "iframe/inside-the-firewall/index.html": "firewall",
    "iframe/pink-panther-hokus-pokus/index.html":
      '<script src="../../js/storage-policy.js?v=old"></script>',
    "iframe/pink-panther-passport-to-peril/index.html":
      '<script src="../../js/storage-policy.js?v=old"></script>',
    "iframe/revcdos/index.html":
      '<script src="../../js/storage-policy.js?v=old"></script>',
    "iframe/scummvm/launcher.js": [
      'const route = "/iframe/scummvm/local-games/peril";',
      'const dataPath = ["", "vendor", "scummvm", "2026.3.0", "data"].join("/");',
    ].join("\n"),
    "vendor/scummvm/2026.3.0/data/index.json": JSON.stringify({
      peril: { baseUrl: "/iframe/scummvm/local-games/peril" },
      pokus: { baseUrl: "/iframe/scummvm/local-games/pokus" },
    }),
    "vendor/scummvm/2026.3.0/scummvm.wasm": "scummvm",
    "dos/doom/doom.jsdos": "jsdos",
  });
}

async function addGeneratedRuntime(root: string): Promise<void> {
  await writeFiles(root, {
    "js/ruffle.js": "ruffle",
    "js/core.ruffle.abc123.js": "core",
    "js/abc123.wasm": "wasm",
  });
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

  test("versions main before hashing and writes matching manifests", async () => {
    const root = await makeTemporaryDirectory();
    await makeSource(root);
    await addGeneratedRuntime(root);
    const paths = new BuildPaths(root);

    const hashedAssets = await updateHtml(paths, "26.07.28-abcdef1");
    await writeOfflineGameManifest(paths, "26.07.28-abcdef1");
    await writeVersionMetadata(paths, "26.07.28-abcdef1");
    const offlineManifestName = await versionOfflineGameManifest(paths);

    const main = await readFile(join(root, hashedAssets.mainJs), "utf8");
    const html = await readFile(paths.html, "utf8");
    expect(main).toContain('const APP_VERSION = "26.07.28-abcdef1";');
    expect(html).toContain(
      '<meta name="astro-version" content="26.07.28-abcdef1" />',
    );
    expect(html).toContain("startup recovery");
    expect(html).not.toContain('src="js/startup-recovery.js"');
    expect(
      await Bun.file(join(root, "js", "startup-recovery.js")).exists(),
    ).toBeFalse();
    expect(html).toContain(`${hashedAssets.mainJs}"`);
    expect(html).toContain(`${hashedAssets.flashUrlRouterJs}"`);
    expect(html).toContain(`${hashedAssets.storagePolicyJs}"`);
    expect(html).toContain(`${hashedAssets.gameInstallerJs}"`);
    expect(html).toContain(`${hashedAssets.gameLibraryJs}"`);
    expect(html).toContain(`${hashedAssets.gameDataJs}"`);
    expect(html).toContain(`${hashedAssets.fileOperationsJs}"`);
    expect(html).toContain(`${hashedAssets.mainCss}"`);
    expect(html).toContain(`${hashedAssets["entry:js/shell/desktop.js"]}"`);
    expect(html).toContain(`${hashedAssets["entry:apps/index.js"]}"`);
    expect(html).toContain(`${hashedAssets["entry:css/shell/desktop.css"]}"`);
    expect(html).toContain(
      `window.ASTRO_OFFLINE_MANIFEST_URL="${offlineManifestName}"`,
    );
    expect(offlineManifestName).toMatch(/^offline-games\.[a-f0-9]{8}\.json$/);
    const capture = await readFile(paths.captureHtml, "utf8");
    expect(capture).toContain(`${hashedAssets.ruffle}"`);
    expect(capture).toContain(`${hashedAssets.gamesJs}"`);
    expect(capture).toContain(`${hashedAssets.flashUrlRouterJs}"`);
    const manifest = JSON.parse(
      await readFile(join(root, offlineManifestName), "utf8"),
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
      ).toContain(`../../${hashedAssets.storagePolicyJs}"`);
    }
    expect(html).toMatch(/favicon\.[a-f0-9]{8}\.ico"/);
    expect(html).toMatch(/assets\/xp\/bliss\.[a-f0-9]{8}\.jpg"/);
    expect(await readFile(join(root, hashedAssets.gamesJs), "utf8")).toMatch(
      /assets\/icons\/game\.[a-f0-9]{8}\.png/,
    );
    expect(await readFile(join(root, hashedAssets.mainJs), "utf8")).toMatch(
      /assets\/xp\/sounds\/startup\.[a-f0-9]{8}\.wav/,
    );
    expect(await readFile(join(root, hashedAssets.mainCss), "utf8")).toMatch(
      /fonts\/test\.[a-f0-9]{8}\.ttf/,
    );
    expect(await readFile(join(root, "apps/catalog.js"), "utf8")).toMatch(
      /assets\/xp\/icons\/paint\.[a-f0-9]{8}\.png/,
    );
    expect(await readFile(join(root, hashedAssets.mainCss), "utf8")).toMatch(
      /\.\.\/assets\/xp\/bliss\.[a-f0-9]{8}\.jpg/,
    );
    expect(await Bun.file(join(root, "js", "main.js")).exists()).toBeFalse();
    expect(await Bun.file(join(root, "css", "main.css")).exists()).toBeFalse();
    expect(PRECACHE_FILE_SUFFIXES.has(".ttf")).toBeTrue();
    expect(PRECACHE_FILE_SUFFIXES.has(".bmp")).toBeTrue();
    expect(PRECACHE_FILE_SUFFIXES.has(".data")).toBeTrue();

    const metadata = JSON.parse(await readFile(paths.versionJson, "utf8"));
    expect(metadata.offlineBytes).toBeGreaterThan(0);
    expect(metadata.bundledGameBytes).toBeGreaterThan(0);
    expect(Number.isFinite(Date.parse(metadata.releasedAt))).toBeTrue();
    expect(metadata.stabilityDelayMs).toBe(6 * 60 * 60 * 1000);
    expect(manifest.version).toBe("26.07.28-abcdef1");
    expect(manifest.games["bike-mania"].type).toBe("swf");
    expect(manifest.games.doom.type).toBe("iframe");
    expect(
      manifest.games.doom.files.map(({ url }: { url: string }) => url),
    ).toEqual([
      `${manifest.games.doom.root}dos/doom/doom.jsdos`,
      `${manifest.games.doom.root}index.html`,
    ]);
    const configuredRoots = JSON.parse(
      html.match(/window\.ASTRO_GAME_ROOTS=Object\.freeze\((\{[^<]+\})\)/)![1],
    );
    expect(configuredRoots).toMatchObject(
      Object.fromEntries(
        Object.entries(manifest.games).map(([id, game]: [string, any]) => [
          id,
          game.root,
        ]),
      ),
    );
    expect(manifest.runtime.files.length).toBeGreaterThan(0);
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
    }).toEqual({
      revision: "abcdef1",
      version: "26.07.28-abcdef1",
    });
  });

  test("fails when an asset reference is missing", async () => {
    const root = await makeTemporaryDirectory();
    await makeSource(root);
    await addGeneratedRuntime(root);
    const html = join(root, "index.html");
    await writeFile(
      html,
      (await readFile(html, "utf8")).replace(
        '<script src="js/dialogs.js?v=old"></script>',
        "",
      ),
    );
    expect(
      updateHtml(new BuildPaths(root), "26.07.28-abcdef1"),
    ).rejects.toThrow("Could not update asset reference");
  });

  test("rejects a hashed filename that does not match its content", async () => {
    const root = await makeTemporaryDirectory();
    await makeSource(root);
    await addGeneratedRuntime(root);
    const paths = new BuildPaths(root);
    const hashedAssets = await updateHtml(paths, "26.07.28-abcdef1");
    await writeFile(join(root, hashedAssets.mainJs), "tampered");
    await writeOfflineGameManifest(paths, "26.07.28-abcdef1");
    await writeVersionMetadata(paths, "26.07.28-abcdef1");
    await versionOfflineGameManifest(paths);
    await expect(validateOutput(root)).rejects.toThrow(
      "invalid content hash for js/main.js",
    );
  });
});

describe("service worker and artifact validation", () => {
  const release = "releases/26.07.28-abcdef1";
  const workerScripts = {
    [`${release}/js/offline-worker.12345678.js`]: "offline worker",
    [`${release}/js/shell-worker.87654321.js`]: "shell worker",
  };

  test("precaches bitmap artwork and Pinball data with revisions", async () => {
    const root = await makeTemporaryDirectory();
    await writeFiles(root, {
      "index.html": "final index",
      ...workerScripts,
      [`${release}/assets/xp/Chess.12345678.bmp`]: "bitmap",
      [`${release}/apps/pinball/runtime/SpaceCadetPinball.data`]:
        "pinball data",
    });

    await generateServiceWorker(root, "26.07.28-abcdef1");

    const worker = await readFile(join(root, "sw.js"), "utf8");
    const manifest = JSON.parse(
      worker.match(/^self\.__ASTRO_XP_PRECACHE__=(.*);$/m)![1],
    );
    expect(manifest).toEqual([
      precached(
        "pinball data",
        `${release}/apps/pinball/runtime/SpaceCadetPinball.data`,
      ),
      precached("bitmap", `${release}/assets/xp/Chess.12345678.bmp`),
      precached("final index", "index.html"),
    ]);
    expect(worker).toContain(
      `importScripts("${release}/js/offline-worker.12345678.js","${release}/js/shell-worker.87654321.js");`,
    );
    expect(worker).toContain('self.__ASTRO_XP_VERSION__="26.07.28-abcdef1";');
    expect(await readFile(join(root, "sw.26.07.28-abcdef1.js"), "utf8")).toBe(
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

  test("builds an unversioned worker from the output root", async () => {
    const root = await makeTemporaryDirectory();
    await writeFiles(root, {
      "index.html": "index",
      "js/offline-worker.12345678.js": "offline worker",
      "js/shell-worker.87654321.js": "shell worker",
    });
    await generateServiceWorker(root);
    const worker = await readFile(join(root, "sw.js"), "utf8");
    expect(worker).not.toContain("__ASTRO_XP_VERSION__");
    expect(worker).toContain(
      JSON.stringify([precached("index", "index.html")]),
    );
    expect(await Bun.file(join(root, "sw.undefined.js")).exists()).toBeFalse();
  });

  test("accepts a complete artifact and rejects a missing representative game", async () => {
    const root = await makeTemporaryDirectory();
    await makeSource(root);
    await addGeneratedRuntime(root);
    const paths = new BuildPaths(root);
    await updateHtml(paths, "26.07.28-abcdef1");
    await writeOfflineGameManifest(paths, "26.07.28-abcdef1");
    await writeVersionMetadata(paths, "26.07.28-abcdef1");
    const offlineManifestName = await versionOfflineGameManifest(paths);
    await validateOutput(root);

    const manifest = JSON.parse(
      await readFile(join(root, offlineManifestName), "utf8"),
    );
    await unlink(join(root, manifest.games["bike-mania"].root, "main.swf"));
    await expect(validateOutput(root)).rejects.toThrow("missing game file");
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
      installRuffle: async (jsDir) =>
        writeFiles(jsDir, {
          "ruffle.js": "ruffle",
          "core.ruffle.abc123.js": "core",
          "abc123.wasm": "wasm",
        }),
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
    const release = join(output, "releases", "26.07.28-abcdef1");
    expect(
      await Bun.file(join(release, "offline-games.json")).exists(),
    ).toBeFalse();
    const rootHtml = await readFile(join(output, "index.html"), "utf8");
    expect(rootHtml).toContain('<base href="/releases/26.07.28-abcdef1/" />');
    const scummvmIndexPath = join(
      release,
      "vendor",
      "scummvm",
      "2026.3.0",
      "data",
      "index.json",
    );
    const scummvmIndex = JSON.parse(await readFile(scummvmIndexPath, "utf8"));
    expect(scummvmIndex.peril.baseUrl).toBe(
      "/releases/26.07.28-abcdef1/iframe/scummvm/local-games/peril",
    );
    const metadata = JSON.parse(
      await readFile(join(output, "version.json"), "utf8"),
    );
    expect(metadata.offlineBytes).toBeGreaterThan(0);
    expect(metadata.bundledGameBytes).toBeGreaterThan(0);
    expect(metadata.revision).toBe("abcdef1");
    expect(metadata.version).toBe("26.07.28-abcdef1");
    expect(metadata.releasedAt).toBe("2026-07-28T12:00:00.000Z");
    expect(metadata.stabilityDelayMs).toBe(2 * 60 * 60 * 1000);
    expect(await readFile(join(output, "_headers"), "utf8")).toBe(
      "/releases/*\n  Cache-Control: public, max-age=31536000, immutable\n",
    );

    await writeFile(
      scummvmIndexPath,
      '{"peril":{"baseUrl":"/iframe/scummvm/local-games/peril"}}',
    );
    await expect(
      validateReleaseOutput(output, "26.07.28-abcdef1"),
    ).rejects.toThrow("unscoped release reference");
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
  const paths = new BuildPaths(root);
  await updateHtml(paths, "26.07.28-abcdef1");
  await writeOfflineGameManifest(paths, "26.07.28-abcdef1");
  await writeVersionMetadata(paths, "26.07.28-abcdef1");
  const manifestName = await versionOfflineGameManifest(paths);
  await validateOutput(root);
  return { root, manifestName, paths };
}

type Artifact = Awaited<ReturnType<typeof makeValidArtifact>>;

const editFile = async (path: string, change: (content: string) => string) =>
  writeFile(path, change(await readFile(path, "utf8")));

// Rewrites the offline manifest under its new content hash so validation
// reaches the checks after the hash comparison.
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
      "missing required files: version.json",
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
      "a tampered offline manifest",
      ({ root, manifestName }) => writeFile(join(root, manifestName), "{}"),
      "invalid offline manifest hash",
    ],
    [
      "an unhashed script reference",
      ({ paths }) =>
        editFile(paths.html, (html) =>
          html.replace(/js\/dialogs\.[a-f0-9]{8}\.js/, "js/dialogs.js"),
        ),
      "no hashed reference for js/dialogs.js",
    ],
    [
      "a missing hashed script",
      async ({ paths, root }) =>
        unlink(
          join(
            root,
            (await readFile(paths.html, "utf8")).match(
              /js\/dialogs\.[a-f0-9]{8}\.js/,
            )![0],
          ),
        ),
      "invalid content hash for js/dialogs.js",
    ],
    [
      "an unversioned fflate reference",
      ({ paths }) =>
        editFile(paths.html, (html) =>
          html.replace(/index\.js\?v=[a-f0-9]{8}/, "index.js"),
        ),
      "no versioned fflate reference",
    ],
    [
      "a missing favicon",
      async ({ root }) =>
        unlink(
          join(
            root,
            (await readdir(root)).find((name) => name.startsWith("favicon."))!,
          ),
        ),
      "no uniquely hashed favicon",
    ],
    [
      "an unhashed static asset",
      ({ root }) => writeFiles(root, { "assets/xp/extra.png": "extra" }),
      "invalid static asset hash for assets/xp/extra.png",
    ],
    [
      "an unhashed static reference",
      ({ paths }) =>
        editFile(paths.html, (html) => `${html}\n"assets/xp/raw.png"`),
      "unhashed static reference in index.html: assets/xp/raw.png",
    ],
    [
      "a missing hashed static asset",
      ({ paths }) =>
        editFile(
          paths.html,
          (html) => `${html}\n"assets/xp/missing.12345678.png"`,
        ),
      "references a missing static asset: assets/xp/missing.12345678.png",
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
      "a game file with the wrong integrity",
      (artifact) =>
        rewriteManifest(artifact, (manifest) => {
          manifest.games.doom.files[0].integrity = sri("other");
        }),
      "invalid game file integrity",
    ],
    [
      "an unrevisioned runtime file",
      (artifact) =>
        rewriteManifest(artifact, (manifest) => {
          manifest.runtime.files[0].url = "js/ruffle.js";
        }),
      "invalid runtime file: js/ruffle.js",
    ],
    [
      "a runtime file with the wrong integrity",
      (artifact) =>
        rewriteManifest(artifact, (manifest) => {
          manifest.runtime.files[0].integrity = sri("other");
        }),
      "invalid runtime file integrity",
    ],
    [
      "a shared runtime without files",
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

const releaseVersion = "26.07.28-abcdef1";

// A minimal immutable release that passes validateReleaseOutput; options
// replace one part at a time.
async function makeRelease({
  html = [
    "<head>",
    `<base href="/releases/${releaseVersion}/" />`,
    '<script>window.ASTRO_OFFLINE_MANIFEST_URL="offline-games.12345678.json";</script>',
  ].join("\n"),
  worker,
  versionedWorker,
  files = {},
}: {
  html?: string;
  worker?: string;
  versionedWorker?: string;
  files?: Record<string, string>;
} = {}) {
  const root = await makeTemporaryDirectory();
  const release = `releases/${releaseVersion}`;
  const rootWorker = worker ?? precacheWorker([precached(html, "index.html")]);
  await writeFiles(root, {
    "index.html": html,
    "version.json": "{}",
    "sw.js": rootWorker,
    [`sw.${releaseVersion}.js`]:
      versionedWorker ??
      `${rootWorker}\nself.__ASTRO_XP_IMMUTABLE_WORKER__=true;\n`,
    [`${release}/offline-games.12345678.json`]: "{}",
    [`${release}/apps/index.js`]: "apps",
    [`${release}/assets/xp/bliss.jpg`]: "wallpaper",
    [`${release}/capture.html`]: "capture",
    [`${release}/css/main.css`]: "body {}",
    [`${release}/iframe/doom/index.html`]: "doom",
    [`${release}/js/main.js`]: "main",
    [`${release}/js/offline-worker.12345678.js`]: 'fetch("/assets/x")',
    [`${release}/js/shell-worker.12345678.js`]: "shell worker",
    [`${release}/vendor/v.js`]: "vendor",
    ...files,
  });
  return root;
}

describe("release output validation failures", () => {
  test("accepts a minimal scoped release", async () => {
    await validateReleaseOutput(await makeRelease(), releaseVersion);
  });

  const cases: [string, () => Promise<string>, string][] = [
    [
      "files outside the release directory",
      () => makeRelease({ files: { "stray.txt": "stray" } }),
      "files outside the release directory: stray.txt",
    ],
    [
      "more than one release directory",
      () => makeRelease({ files: { "releases/other/index.html": "other" } }),
      "invalid release directory",
    ],
    [
      "an HTML document without the release base URL",
      () => makeRelease({ html: "<head></head>" }),
      "no matching immutable release base URL",
    ],
    [
      "a versioned worker that differs from the root worker",
      () => makeRelease({ versionedWorker: "changed" }),
      "inconsistent versioned service worker",
    ],
    [
      "an unversioned offline manifest",
      () =>
        makeRelease({
          files: { [`releases/${releaseVersion}/offline-games.json`]: "{}" },
        }),
      "contains an unversioned offline manifest",
    ],
    [
      "a missing release-scoped offline manifest",
      () =>
        makeRelease({
          html: `<head>\n<base href="/releases/${releaseVersion}/" />`,
        }),
      "no release-scoped offline manifest",
    ],
    [
      "a missing release path",
      async () => {
        const root = await makeRelease();
        await rm(join(root, "releases", releaseVersion, "vendor"), {
          recursive: true,
        });
        return root;
      },
      "missing release path: vendor",
    ],
    [
      "a missing root worker",
      async () => {
        const root = await makeRelease();
        await unlink(join(root, "sw.js"));
        return root;
      },
      "missing required file: sw.js",
    ],
    [
      "a worker without integrity-protected entries",
      () => makeRelease({ worker: "self.skipWaiting();" }),
      "no integrity-protected precache entries",
    ],
    [
      "a precache entry outside the output",
      () =>
        makeRelease({
          worker: precacheWorker([precached("x", "../outside.js")]),
        }),
      "escapes the build output: ../outside.js",
    ],
    [
      "a precache entry for a missing file",
      () =>
        makeRelease({
          worker: precacheWorker([precached("x", "missing.js")]),
        }),
      "references a missing file: missing.js",
    ],
    [
      "a precache entry with a stale revision",
      () =>
        makeRelease({
          worker: precacheWorker([
            { ...precached("{}", "version.json"), revision: "00000000" },
          ]),
        }),
      "invalid revision: version.json",
    ],
    [
      "a worker that does not precache the index",
      () =>
        makeRelease({
          worker: precacheWorker([precached("{}", "version.json")]),
        }),
      "must precache index.html exactly once",
    ],
  ];
  for (const [label, create, message] of cases)
    test(`rejects ${label}`, async () => {
      await expect(
        validateReleaseOutput(await create(), releaseVersion),
      ).rejects.toThrow(message);
    });
});

describe("build helpers", () => {
  test("rejects unsafe release versions", async () => {
    const root = await makeTemporaryDirectory();
    await expect(scopeReleaseReferences(root, "../escape")).rejects.toThrow(
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

  test("versions a minimal site without optional packages", async () => {
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
    ])
      await rm(join(root, path), { recursive: true });
    await editFile(join(root, "index.html"), (html) =>
      html.replace('<script type="module" src="apps/index.js"></script>', ""),
    );
    await writeFiles(root, { "iframe/notes.txt": "not a game" });
    const paths = new BuildPaths(root);
    await updateHtml(paths, "26.07.28-abcdef1");
    await writeOfflineGameManifest(paths, "26.07.28-abcdef1");
    const manifest = JSON.parse(await readFile(paths.offlineGamesJson, "utf8"));
    await writeVersionMetadata(paths, "26.07.28-abcdef1");
    await versionOfflineGameManifest(paths);
    await validateOutput(root);
    expect(Object.keys(manifest.games).sort()).toEqual([
      "doom",
      "inside-the-firewall",
    ]);
    expect(
      await readFile(
        join(root, manifest.games.doom.root, "index.html"),
        "utf8",
      ),
    ).toBe("doom ../../dos/doom/doom.jsdos");
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
    await expect(generateServiceWorker(root)).rejects.toThrow(
      "exactly one hashed offline worker",
    );
    await writeFiles(root, { "js/offline-worker.12345678.js": "worker" });
    await expect(generateServiceWorker(root)).rejects.toThrow(
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
      installRuffle: async (jsDir) =>
        writeFiles(jsDir, {
          "ruffle.js": "ruffle",
          "core.ruffle.abc123.js": "core",
          "abc123.wasm": "wasm",
        }),
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
