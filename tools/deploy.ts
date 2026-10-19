import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

import { compress as compressWoff2 } from "wawoff2";
import {
  PRECACHE_EXTENSIONS,
  PRECACHE_IGNORES,
  PRECACHE_MAXIMUM_FILE_SIZE,
} from "../precache-config";

const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE_DIR = join(PROJECT_DIR, "site");
export const DEFAULT_OUTPUT_DIR = join(PROJECT_DIR, "dist");
export const RUFFLE_PACKAGE = "@ruffle-rs/ruffle";
/** Build-output paths for npm browser assets (unversioned; lockfile pins versions). */
export const FFLATE_JS_PATH = "vendor/fflate/index.js";
export const JS_DOS_ROOT_PATH = "vendor/js-dos";
export const WEBTORRENT_JS_PATH = "vendor/webtorrent/webtorrent.min.js";
export const RELEASES_PATH = "releases";
export const DEFAULT_UPDATE_STABILITY_DELAY_MS = 6 * 60 * 60 * 1000;
const NODE_MODULES = join(PROJECT_DIR, "node_modules");
const FFLATE_SOURCE = join(NODE_MODULES, "fflate");
const JS_DOS_SOURCE = join(NODE_MODULES, "js-dos");
const WEBTORRENT_SOURCE = join(NODE_MODULES, "webtorrent");
const RUFFLE_SOURCE = join(NODE_MODULES, ...RUFFLE_PACKAGE.split("/"));
const RUFFLE_FILE_SUFFIXES = [".js", ".js.map", ".wasm"];
const JS_DOS_RUNTIME_FILES = [
  "js-dos.js",
  "js-dos.css",
  "emulators/emulators.js",
  "emulators/wdosbox.js",
  "emulators/wdosbox.wasm",
  "emulators/wlibzip.js",
  "emulators/wlibzip.wasm",
];
export const PRECACHE_FILE_SUFFIXES = new Set(
  PRECACHE_EXTENSIONS.map((extension) => `.${extension}`),
);
const APP_VERSION_PATTERN = /const APP_VERSION = "[^"]+";/g;
const VERSIONED_SERVICE_WORKER_MARKER =
  "\nself.__ASTRO_XP_IMMUTABLE_WORKER__=true;\n";

const WORKER_SCRIPTS = ["offline-worker", "shell-worker"] as const;

export interface PrecacheEntry {
  integrity: string;
  revision: string;
  url: string;
}
interface OfflineFile {
  bytes: number;
  integrity: string;
  url: string;
}

interface OfflineGame {
  bytes: number;
  files: OfflineFile[];
  revision: string;
  root: string;
  runtime?: string;
  type: "iframe" | "swf";
}

interface OfflineRuntime {
  bytes: number;
  files: OfflineFile[];
  revision: string;
}

interface OfflineManifest {
  games: Record<string, OfflineGame>;
  runtime: OfflineRuntime;
  runtimes?: Record<string, OfflineRuntime>;
  version: string;
}

type VersionedGamePackages = Record<string, OfflineGame>;

export class BuildPaths {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  get js() {
    return join(this.root, "js");
  }

  get css() {
    return join(this.root, "css");
  }

  get html() {
    return join(this.root, "index.html");
  }

  get captureHtml() {
    return join(this.root, "capture.html");
  }

  get mainJs() {
    return join(this.js, "main.js");
  }

  get versionJson() {
    return join(this.root, "version.json");
  }

  get offlineGamesJson() {
    return join(this.root, "offline-games.json");
  }

  get fflateJs() {
    return join(this.root, ...FFLATE_JS_PATH.split("/"));
  }

  get jsDosRoot() {
    return join(this.root, ...JS_DOS_ROOT_PATH.split("/"));
  }

  get webtorrentJs() {
    return join(this.root, ...WEBTORRENT_JS_PATH.split("/"));
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function releaseRelativePath(version: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  return `${RELEASES_PATH}/${version}`;
}

// Callers validate the version through releaseRelativePath first.
function versionedServiceWorkerName(version: string): string {
  return `sw.${version}.js`;
}

export async function scopeReleaseReferences(
  root: string,
  version: string,
): Promise<void> {
  const releasePath = releaseRelativePath(version);
  const referencePattern =
    /(["'`(=]\s*)\/(apps|assets|css|dos|iframe|js|swf|vendor)\//g;
  for (const path of await walkFiles(root)) {
    if (
      ![".css", ".html", ".js", ".json", ".mjs"].includes(extname(path)) ||
      path.endsWith(`${sep}js${sep}offline-worker.js`)
    ) {
      continue;
    }
    const content = await readFile(path, "utf8");
    const scoped = content.replace(referencePattern, `$1/${releasePath}/$2/`);
    if (scoped !== content) await writeFile(path, scoped);
  }
}

async function replaceExactlyOnce(
  content: string,
  pattern: RegExp,
  replacement: string,
  error: string,
): Promise<string> {
  const matches = content.match(pattern);
  if (matches?.length !== 1) {
    throw new Error(error);
  }
  return content.replace(pattern, replacement);
}

async function requirePackageFile(
  path: string,
  packageName: string,
): Promise<void> {
  if (!(await isFile(path))) {
    throw new Error(
      `${packageName} is not installed; run \`bun install --frozen-lockfile\``,
    );
  }
}

export async function installFflate(
  outputDir: string,
  sourceDir = FFLATE_SOURCE,
): Promise<void> {
  const sourceJavaScript = join(sourceDir, "umd", "index.js");
  await requirePackageFile(sourceJavaScript, "fflate");
  const destination = join(outputDir, "vendor", "fflate");
  await mkdir(destination, { recursive: true });
  await cp(sourceJavaScript, join(destination, "index.js"), {
    preserveTimestamps: true,
  });
}

export async function installJsDos(
  outputDir: string,
  sourceDir = JS_DOS_SOURCE,
): Promise<void> {
  const sourceRoot = join(sourceDir, "dist");
  const destination = join(outputDir, ...JS_DOS_ROOT_PATH.split("/"));
  for (const relativePath of JS_DOS_RUNTIME_FILES) {
    const source = join(sourceRoot, relativePath);
    await requirePackageFile(source, "js-dos");
    const target = join(destination, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { preserveTimestamps: true });
  }
  console.log("  - Installed js-dos");
}

export async function installWebtorrent(
  outputDir: string,
  sourceDir = WEBTORRENT_SOURCE,
): Promise<void> {
  const sourceJavaScript = join(sourceDir, "dist", "webtorrent.min.js");
  await requirePackageFile(sourceJavaScript, "webtorrent");
  const destination = join(outputDir, "vendor", "webtorrent");
  await mkdir(destination, { recursive: true });
  await cp(sourceJavaScript, join(destination, "webtorrent.min.js"), {
    preserveTimestamps: true,
  });
  console.log("  - Installed WebTorrent");
}

export async function installRuffle(
  jsDir: string,
  sourceDir = RUFFLE_SOURCE,
): Promise<void> {
  await mkdir(jsDir, { recursive: true });
  let names: string[];
  try {
    names = await readdir(sourceDir);
  } catch {
    throw new Error(
      `${RUFFLE_PACKAGE} is not installed; run \`bun install --frozen-lockfile\``,
    );
  }
  const files = names.filter((name) =>
    RUFFLE_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix)),
  );
  if (
    !files.includes("ruffle.js") ||
    !files.some(
      (name) => name.startsWith("core.ruffle.") && name.endsWith(".js"),
    ) ||
    !files.some((name) => name.endsWith(".wasm"))
  ) {
    throw new Error(
      `${RUFFLE_PACKAGE} is missing required runtime files; reinstall dependencies`,
    );
  }
  await Promise.all(
    files.map((name) =>
      cp(join(sourceDir, name), join(jsDir, name), {
        preserveTimestamps: true,
      }),
    ),
  );
  console.log(`  - Installed ${files.length} Ruffle runtime files`);
}

export async function getShortHash(filePath: string): Promise<string> {
  return createHash("sha384")
    .update(await readFile(filePath))
    .digest("hex")
    .slice(0, 8);
}

export function runGit(arguments_: string[], projectDir = PROJECT_DIR): string {
  const result = Bun.spawnSync(["git", ...arguments_], {
    cwd: projectDir,
    stderr: "pipe",
    stdout: "pipe",
  });
  if (!result.success) {
    throw new Error(
      `Could not resolve deployment revision with git ${arguments_.join(" ")}`,
    );
  }
  return result.stdout.toString().trim();
}

export function getDeploymentVersion(
  revision = "HEAD",
  projectDir = PROJECT_DIR,
  git: typeof runGit = runGit,
): string {
  const commitDate = git(["show", "-s", "--format=%cs", revision], projectDir);
  const shortRevision = git(["rev-parse", "--short=7", revision], projectDir);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(commitDate)) {
    throw new Error(`Git returned an invalid commit date: ${commitDate}`);
  }
  if (!/^[a-f0-9]{7,}$/.test(shortRevision)) {
    throw new Error(`Git returned an invalid revision: ${shortRevision}`);
  }
  const [year, month, day] = commitDate.split("-");
  return `${year.slice(2)}.${month}.${day}-${shortRevision.slice(0, 7)}`;
}

const isTrueTypeFont = (bytes: Uint8Array): boolean => {
  const tag = String.fromCharCode(...bytes.subarray(0, 4));
  return tag === "\0\x01\0\0" || tag === "true";
};

// Serve the original XP fonts as WOFF2. The source tree keeps the verified
// TrueType files; WOFF2 is a lossless container about 55% smaller.
export async function compressFonts(
  paths: BuildPaths,
  compress: (input: Uint8Array) => Promise<Uint8Array> = compressWoff2,
): Promise<string[]> {
  const fontsDirectory = join(paths.css, "fonts");
  if (!(await isDirectory(fontsDirectory))) return [];
  const converted: string[] = [];
  for (const path of await walkFiles(fontsDirectory)) {
    if (extname(path).toLowerCase() !== ".ttf") continue;
    const source = new Uint8Array(await readFile(path));
    if (!isTrueTypeFont(source)) continue;
    await writeFile(`${path.slice(0, -4)}.woff2`, await compress(source));
    await rm(path);
    converted.push(relative(fontsDirectory, path).split(sep).join("/"));
  }
  if (!converted.length) return converted;

  const escape = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const cssPath of (await walkFiles(paths.css)).filter(
    (path) => extname(path) === ".css",
  )) {
    let css = await readFile(cssPath, "utf8");
    for (const name of converted) {
      css = css.replace(
        new RegExp(
          `(fonts/${escape(name.slice(0, -4))})\\.ttf("\\)\\s*)format\\("truetype"\\)`,
          "g",
        ),
        '$1.woff2$2format("woff2")',
      );
    }
    await writeFile(cssPath, css);
  }
  let html = await readFile(paths.html, "utf8");
  for (const name of converted) {
    html = html.replace(
      new RegExp(`<link\\b[^>]*href="css/fonts/${escape(name)}"[^>]*>`, "g"),
      (tag) =>
        tag
          .replace(/\.ttf"/, '.woff2"')
          .replace('type="font/ttf"', 'type="font/woff2"'),
    );
  }
  await writeFile(paths.html, html);
  return converted;
}

export async function updateHtml(
  paths: BuildPaths,
  version: string,
): Promise<Record<string, string>> {
  console.log("Updating output with versioned asset filenames...");
  let mainJavaScript = await readFile(paths.mainJs, "utf8");
  mainJavaScript = await replaceExactlyOnce(
    mainJavaScript,
    APP_VERSION_PATTERN,
    `const APP_VERSION = "${version}";`,
    "Could not update APP_VERSION in output js/main.js",
  );
  await writeFile(paths.mainJs, mainJavaScript);

  let html = await readFile(paths.html, "utf8");
  html = await replaceExactlyOnce(
    html,
    /<meta name="astro-version" content="[^"]+" \/>/g,
    `<meta name="astro-version" content="${version}" />`,
    "Could not update the deployment version in output index.html",
  );
  const startupRecoveryPath = join(paths.js, "startup-recovery.js");
  const startupRecovery = await readFile(startupRecoveryPath, "utf8");
  html = await replaceExactlyOnce(
    html,
    /<script src="js\/startup-recovery\.js"><\/script>/g,
    `<script>\n${startupRecovery}\n</script>`,
    "Could not inline startup recovery in output index.html",
  );
  await writeFile(paths.html, html);
  await rm(startupRecoveryPath);

  const staticPaths = [
    ...(await walkFiles(join(paths.root, "assets"))),
    ...(await walkFiles(join(paths.css, "fonts"))),
    join(paths.root, "favicon.ico"),
  ];
  const staticAssets = new Map<string, string>();
  await Promise.all(
    staticPaths.map(async (sourcePath) => {
      const relativePath = relative(paths.root, sourcePath)
        .split(sep)
        .join("/");
      const extension = extname(relativePath);
      const hash = await getShortHash(sourcePath);
      const hashedRelativePath = `${relativePath.slice(
        0,
        -extension.length,
      )}.${hash}${extension}`;
      await rename(sourcePath, join(paths.root, hashedRelativePath));
      staticAssets.set(relativePath, hashedRelativePath);
    }),
  );

  const mutableAssets: Record<string, string> = {
    ruffle: "js/ruffle.js",
    gamesJs: "js/games.js",
    flashUrlRouterJs: "js/flash-url-router.js",
    storagePolicyJs: "js/storage-policy.js",
    gameInstallerJs: "js/game-installer.js",
    gameLibraryJs: "js/game-library.js",
    gameDataJs: "js/game-data.js",
    filesystemJs: "js/filesystem.js",
    fileOperationsJs: "js/file-operations.js",
    dialogsJs: "js/dialogs.js",
    offlineJs: "js/offline.js",
    offlineWorkerJs: "js/offline-worker.js",
    shellWorkerJs: "js/shell-worker.js",
    mainJs: "js/main.js",
    mainCss: "css/main.css",
  };
  const entrypointMarkup = await readFile(paths.html, "utf8");
  const entrypoints = [
    ...entrypointMarkup.matchAll(
      /\b(?:src|href)="((?:apps|js|css)\/[^"?]+\.(?:js|css))(?:\?v=[^"]+)?"/g,
    ),
  ].map((match) => match[1]);
  for (const relativePath of new Set(entrypoints)) {
    if (!Object.values(mutableAssets).includes(relativePath)) {
      mutableAssets[`entry:${relativePath}`] = relativePath;
    }
  }
  const applicationsDirectory = join(paths.root, "apps");
  const applicationReferenceFiles = (
    (await isDirectory(applicationsDirectory))
      ? await walkFiles(applicationsDirectory)
      : []
  )
    .filter((path) => [".css", ".html", ".js"].includes(extname(path)))
    .map((path) => relative(paths.root, path).split(sep).join("/"));
  const referenceFiles = [
    ...new Set([
      ...Object.values(mutableAssets).filter(
        (path) =>
          path !== "js/ruffle.js" &&
          path !== "js/offline-worker.js" &&
          path !== "js/shell-worker.js",
      ),
      ...applicationReferenceFiles,
      "index.html",
      ...((await isFile(paths.captureHtml)) ? ["capture.html"] : []),
    ]),
  ];
  for (const referencePath of referenceFiles) {
    const absolutePath = join(paths.root, referencePath);
    let content = await readFile(absolutePath, "utf8");
    for (const [originalPath, hashedPath] of staticAssets) {
      content = content.replaceAll(originalPath, hashedPath);
      const referenceDirectory = dirname(referencePath);
      const originalRelativePath = relative(referenceDirectory, originalPath)
        .split(sep)
        .join("/");
      const hashedRelativePath = relative(referenceDirectory, hashedPath)
        .split(sep)
        .join("/");
      content = content.replaceAll(originalRelativePath, hashedRelativePath);
    }
    await writeFile(absolutePath, content);
  }

  const hashedAssets = Object.fromEntries(
    await Promise.all(
      Object.entries(mutableAssets).map(async ([name, relativePath]) => {
        const sourcePath = join(paths.root, relativePath);
        const hash = await getShortHash(sourcePath);
        const extension = extname(relativePath);
        const hashedRelativePath = `${relativePath.slice(
          0,
          -extension.length,
        )}.${hash}${extension}`;
        await rename(sourcePath, join(paths.root, hashedRelativePath));
        return [name, hashedRelativePath];
      }),
    ),
  ) as Record<string, string>;
  const fflateHash = await getShortHash(paths.fflateJs);

  let content = await readFile(paths.html, "utf8");
  for (const [name, originalPath] of Object.entries(mutableAssets)) {
    if (name === "offlineWorkerJs" || name === "shellWorkerJs") continue;
    const pattern = new RegExp(
      originalPath.replaceAll(".", "\\.") + '(?:\\?v=[^"]+)?"',
      "g",
    );
    content = await replaceExactlyOnce(
      content,
      pattern,
      `${hashedAssets[name]}"`,
      `Could not update asset reference matching ${pattern.source}`,
    );
  }
  const fflatePattern = new RegExp(
    `${FFLATE_JS_PATH.replaceAll(".", "\\.")}(?:\\?v=[^"]+)?"?`,
    "g",
  );
  content = await replaceExactlyOnce(
    content,
    fflatePattern,
    `${FFLATE_JS_PATH}?v=${fflateHash}"`,
    "Could not update fflate asset reference",
  );
  await writeFile(paths.html, content);

  for (const relativePath of [
    "iframe/pink-panther-hokus-pokus/index.html",
    "iframe/pink-panther-passport-to-peril/index.html",
    "iframe/revcdos/index.html",
  ]) {
    const absolutePath = join(paths.root, relativePath);
    if (!(await isFile(absolutePath))) continue;
    let iframe = await readFile(absolutePath, "utf8");
    iframe = await replaceExactlyOnce(
      iframe,
      /\.\.\/\.\.\/js\/storage-policy\.js(?:\?v=[^"]+)?"?/g,
      `../../${hashedAssets.storagePolicyJs}"`,
      `Could not update storage policy reference in ${relativePath}`,
    );
    await writeFile(absolutePath, iframe);
  }

  if (await isFile(paths.captureHtml)) {
    let capture = await readFile(paths.captureHtml, "utf8");
    for (const [name, originalPath] of [
      ["ruffle", "js/ruffle.js"],
      ["gamesJs", "js/games.js"],
      ["flashUrlRouterJs", "js/flash-url-router.js"],
    ] as const) {
      const pattern = new RegExp(
        originalPath.replaceAll(".", "\\.") + '(?:\\?v[^"]+)?"',
        "g",
      );
      capture = await replaceExactlyOnce(
        capture,
        pattern,
        `${hashedAssets[name]}"`,
        `Could not update capture reference for ${originalPath}`,
      );
    }
    await writeFile(paths.captureHtml, capture);
  }

  console.log(`  - Set deployment version to ${version}`);
  return hashedAssets;
}

export function isOptionalOfflinePath(relativePath: string): boolean {
  const path = relativePath.split(sep).join("/");
  return (
    path.startsWith("swf/") ||
    path.startsWith("iframe/") ||
    path.startsWith("dos/") ||
    path.startsWith("vendor/scummvm/") ||
    (path.startsWith("js/") &&
      (path.endsWith(".wasm") ||
        Boolean(path.split("/").at(-1)?.startsWith("core.ruffle."))))
  );
}

async function offlineFileEntry(
  root: string,
  path: string,
  revision?: string,
): Promise<OfflineFile> {
  const relativePath = relative(root, path).split(sep).join("/");
  const content = await readFile(path);
  return {
    bytes: content.byteLength,
    integrity: `sha384-${createHash("sha384").update(content).digest("base64")}`,
    url: revision ? `${relativePath}?rev=${revision}` : relativePath,
  };
}

async function offlineRevision(root: string, files: string[]): Promise<string> {
  const digest = createHash("sha256");
  for (const path of files.toSorted()) {
    digest.update(relative(root, path).split(sep).join("/"));
    digest.update(await readFile(path));
  }
  return digest.digest("hex").slice(0, 16);
}

async function prepareDoomPackage(paths: BuildPaths): Promise<void> {
  const iframeRoot = join(paths.root, "iframe", "doom");
  const dosRoot = join(paths.root, "dos", "doom");
  if (!(await isDirectory(iframeRoot)) || !(await isDirectory(dosRoot))) return;

  const bundledDosRoot = join(iframeRoot, "dos", "doom");
  await mkdir(dirname(bundledDosRoot), { recursive: true });
  await cp(dosRoot, bundledDosRoot, { recursive: true });
  const indexPath = join(iframeRoot, "index.html");
  const index = await replaceExactlyOnce(
    await readFile(indexPath, "utf8"),
    /\.\.\/\.\.\/dos\/doom\/doom\.jsdos/g,
    "dos/doom/doom.jsdos",
    "Could not package the Doom game data",
  );
  await writeFile(indexPath, index);
  await rm(dosRoot, { recursive: true });
}

export async function versionGamePackages(
  paths: BuildPaths,
): Promise<VersionedGamePackages> {
  await prepareDoomPackage(paths);
  const gameIds = new Set<string>();
  for (const parent of [join(paths.root, "swf"), join(paths.root, "iframe")]) {
    if (!(await isDirectory(parent))) continue;
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (entry.isDirectory()) gameIds.add(entry.name);
    }
  }
  gameIds.delete("scummvm");

  const gameRuntimes: Record<string, string> = {
    "pink-panther-hokus-pokus": "scummvm",
    "pink-panther-passport-to-peril": "scummvm",
  };
  const packages: VersionedGamePackages = {};
  for (const gameId of [...gameIds].sort()) {
    const type = (await isDirectory(join(paths.root, "swf", gameId)))
      ? "swf"
      : "iframe";
    const sourceRoot = join(paths.root, type, gameId);
    const files = (await walkFiles(sourceRoot)).sort();
    const revision = await offlineRevision(paths.root, files);
    const versionedName = `${gameId}.${revision}`;
    const versionedRoot = join(paths.root, type, versionedName);
    await rename(sourceRoot, versionedRoot);
    const versionedFiles = (await walkFiles(versionedRoot)).sort();
    packages[gameId] = {
      bytes: (
        await Promise.all(
          versionedFiles.map(async (path) => (await stat(path)).size),
        )
      ).reduce((total, bytes) => total + bytes, 0),
      files: await Promise.all(
        versionedFiles.map((path) => offlineFileEntry(paths.root, path)),
      ),
      revision,
      root: `${type}/${versionedName}/`,
      ...(gameRuntimes[gameId] ? { runtime: gameRuntimes[gameId] } : {}),
      type,
    };
  }
  return packages;
}

async function injectGameRoots(
  paths: BuildPaths,
  games: VersionedGamePackages,
): Promise<void> {
  const roots = Object.fromEntries(
    Object.entries(games).map(([id, game]) => [id, game.root]),
  );
  const mapping = `<script>window.ASTRO_GAME_ROOTS=Object.freeze(${JSON.stringify(roots)});</script>`;
  for (const path of [paths.html, paths.captureHtml]) {
    if (!(await isFile(path))) continue;
    const content = await readFile(path, "utf8");
    const updated = await replaceExactlyOnce(
      content,
      /<script(?: defer)? src="js\/games\.[a-f0-9]{8}\.js"><\/script>/g,
      `${mapping}\n    $&`,
      `Could not inject versioned game roots into ${relative(paths.root, path)}`,
    );
    await writeFile(path, updated);
  }
}

export async function writeOfflineGameManifest(
  paths: BuildPaths,
  version: string,
): Promise<void> {
  const runtimeFiles = (await readdir(paths.js, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name.endsWith(".wasm") ||
          (entry.name.startsWith("core.ruffle.") &&
            entry.name.endsWith(".js"))),
    )
    .map((entry) => join(paths.js, entry.name))
    .toSorted();

  const sharedRuntimes: Record<string, string[]> = {
    scummvm: [
      join(paths.root, "iframe", "scummvm"),
      join(paths.root, "vendor", "scummvm", "2026.3.0"),
    ],
  };
  const games = await versionGamePackages(paths);
  await injectGameRoots(paths, games);

  const runtimes = Object.fromEntries(
    await Promise.all(
      (
        await Promise.all(
          Object.entries(sharedRuntimes).map(async ([id, roots]) => ({
            id,
            roots,
            available: (await Promise.all(roots.map(isDirectory))).every(
              Boolean,
            ),
          })),
        )
      )
        .filter(({ available }) => available)
        .map(async ({ id, roots }) => {
          const files = (await Promise.all(roots.map(walkFiles))).flat().sort();
          const revision = await offlineRevision(paths.root, files);
          return [
            id,
            {
              bytes: (
                await Promise.all(
                  files.map(async (path) => (await stat(path)).size),
                )
              ).reduce((total, bytes) => total + bytes, 0),
              files: await Promise.all(
                files.map((path) =>
                  offlineFileEntry(paths.root, path, revision),
                ),
              ),
              revision,
            },
          ];
        }),
    ),
  );
  const runtimeRevision = await offlineRevision(paths.root, runtimeFiles);
  const manifest: OfflineManifest = {
    games,
    runtime: {
      bytes: (
        await Promise.all(
          runtimeFiles.map(async (path) => (await stat(path)).size),
        )
      ).reduce((total, bytes) => total + bytes, 0),
      files: await Promise.all(
        runtimeFiles.map((path) =>
          offlineFileEntry(paths.root, path, runtimeRevision),
        ),
      ),
      revision: runtimeRevision,
    },
    runtimes,
    version,
  };
  await writeFile(paths.offlineGamesJson, `${JSON.stringify(manifest)}\n`);
}

export async function versionOfflineGameManifest(
  paths: BuildPaths,
): Promise<string> {
  const hash = await getShortHash(paths.offlineGamesJson);
  const filename = `offline-games.${hash}.json`;
  await rename(paths.offlineGamesJson, join(paths.root, filename));
  const mapping = `<script>window.ASTRO_OFFLINE_MANIFEST_URL=${JSON.stringify(filename)};</script>`;
  const html = await replaceExactlyOnce(
    await readFile(paths.html, "utf8"),
    /<script(?: defer)? src="js\/offline\.[a-f0-9]{8}\.js"><\/script>/g,
    `${mapping}\n    $&`,
    "Could not inject the versioned offline game manifest",
  );
  await writeFile(paths.html, html);
  return filename;
}

export async function writeVersionMetadata(
  paths: BuildPaths,
  version: string,
  {
    releasedAt = new Date().toISOString(),
    stabilityDelayMs = DEFAULT_UPDATE_STABILITY_DELAY_MS,
  }: { releasedAt?: string; stabilityDelayMs?: number } = {},
): Promise<void> {
  if (!Number.isFinite(Date.parse(releasedAt))) {
    throw new Error("Release time must be a valid date");
  }
  if (!Number.isInteger(stabilityDelayMs) || stabilityDelayMs < 0) {
    throw new Error("Update stability delay must be a non-negative integer");
  }
  const files = await walkFiles(paths.root);
  let offlineBytes = 0;
  for (const path of files) {
    const relativePath = relative(paths.root, path);
    if (
      path !== paths.versionJson &&
      path !== paths.offlineGamesJson &&
      PRECACHE_FILE_SUFFIXES.has(extname(path).toLowerCase()) &&
      !isOptionalOfflinePath(relativePath)
    ) {
      offlineBytes += (await stat(path)).size;
    }
  }
  const offlineManifest = JSON.parse(
    await readFile(paths.offlineGamesJson, "utf8"),
  ) as OfflineManifest;
  const bundledGameBytes =
    offlineManifest.runtime.bytes +
    Object.values(offlineManifest.runtimes ?? {}).reduce(
      (total, runtime) => total + runtime.bytes,
      0,
    ) +
    Object.values(offlineManifest.games).reduce(
      (total, game) => total + game.bytes,
      0,
    );
  const revision = version.split("-").at(-1);
  await writeFile(
    paths.versionJson,
    `${JSON.stringify({
      bundledGameBytes,
      offlineBytes,
      releasedAt,
      revision,
      stabilityDelayMs,
      version,
    })}\n`,
  );
}

export async function createPrecacheManifest(
  contentDir: string,
  urlPrefix: string,
): Promise<PrecacheEntry[]> {
  const root = resolve(contentDir);
  const ignores = PRECACHE_IGNORES.map((pattern) => new Bun.Glob(pattern));
  const entries: PrecacheEntry[] = [];
  for (const path of (await walkFiles(root)).sort()) {
    const relativePath = relative(root, path).split(sep).join("/");
    if (
      relativePath.split("/").some((part) => part.startsWith(".")) ||
      !PRECACHE_FILE_SUFFIXES.has(extname(relativePath)) ||
      ignores.some((glob) => glob.match(relativePath))
    ) {
      continue;
    }
    const content = await readFile(path);
    if (content.length > PRECACHE_MAXIMUM_FILE_SIZE) {
      console.warn(`  - Skipping precache for oversized ${relativePath}`);
      continue;
    }
    entries.push(precacheEntry(content, `${urlPrefix}${relativePath}`));
  }
  return entries;
}

function precacheEntry(content: Buffer, url: string): PrecacheEntry {
  return {
    integrity: `sha384-${createHash("sha384").update(content).digest("base64")}`,
    revision: createHash("sha384").update(content).digest("hex").slice(0, 8),
    url,
  };
}

export async function generateServiceWorker(
  outputDir: string,
  version?: string,
): Promise<void> {
  console.log("Generating service worker...");
  const releasePrefix = version ? `${releaseRelativePath(version)}/` : "";
  const contentDir = join(outputDir, releasePrefix);
  const jsEntries = await readdir(join(contentDir, "js"));
  const scripts = WORKER_SCRIPTS.map((name) => {
    const matches = jsEntries.filter((entry) =>
      new RegExp(`^${name}\\.[a-f0-9]{8}\\.js$`).test(entry),
    );
    if (matches.length !== 1) {
      throw new Error(
        `Build output must contain exactly one hashed ${name.replace("-", " ")}`,
      );
    }
    return `${releasePrefix}js/${matches[0]}`;
  });
  const manifest = await createPrecacheManifest(contentDir, releasePrefix);
  // A release keeps index.html at the root, outside the release directory.
  if (version) {
    manifest.push(
      precacheEntry(
        await readFile(join(outputDir, "index.html")),
        "index.html",
      ),
    );
  }
  const workerSource = [
    ...(version
      ? [`self.__ASTRO_XP_VERSION__=${JSON.stringify(version)};`]
      : []),
    `self.__ASTRO_XP_PRECACHE__=${JSON.stringify(manifest)};`,
    `importScripts(${scripts.map((script) => JSON.stringify(script)).join(",")});`,
    "",
  ].join("\n");
  await writeFile(join(outputDir, "sw.js"), workerSource);
  if (version) {
    await writeFile(
      join(outputDir, versionedServiceWorkerName(version)),
      workerSource + VERSIONED_SERVICE_WORKER_MARKER,
    );
  }
  console.log(`  - Service worker precaches ${manifest.length} files`);
}

export async function validateOutput(outputDir: string): Promise<void> {
  const paths = new BuildPaths(outputDir);
  const required = [
    paths.html,
    paths.versionJson,
    paths.fflateJs,
    join(paths.jsDosRoot, "js-dos.js"),
    join(paths.jsDosRoot, "emulators", "wdosbox.wasm"),
    paths.webtorrentJs,
  ];
  const missing = (
    await Promise.all(
      required.map(async (path) =>
        (await isFile(path)) ? undefined : relative(outputDir, path),
      ),
    )
  ).filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `Build output is missing required files: ${missing.join(", ")}`,
    );
  }

  const html = await readFile(paths.html, "utf8");
  const offlineManifestReference = html.match(
    /window\.ASTRO_OFFLINE_MANIFEST_URL="(offline-games\.([a-f0-9]{8})\.json)"/,
  );
  if (!offlineManifestReference) {
    throw new Error("Build output has no versioned offline game manifest");
  }
  const versionedOfflineManifest = join(outputDir, offlineManifestReference[1]);
  if (
    !(await isFile(versionedOfflineManifest)) ||
    (await getShortHash(versionedOfflineManifest)) !==
      offlineManifestReference[2]
  ) {
    throw new Error("Build output has an invalid offline manifest hash");
  }
  for (const asset of [
    "js/ruffle.js",
    "js/games.js",
    "js/flash-url-router.js",
    "js/storage-policy.js",
    "js/game-installer.js",
    "js/game-library.js",
    "js/game-data.js",
    "js/filesystem.js",
    "js/file-operations.js",
    "js/dialogs.js",
    "js/offline.js",
    "js/main.js",
    "css/main.css",
  ]) {
    const [directory, filename] = asset.split("/");
    const extension = extname(filename);
    const stem = filename.slice(0, -extension.length);
    const pattern = new RegExp(
      `${directory}/${stem.replaceAll(".", "\\.")}\\.([a-f0-9]{8})\\${extension}"`,
    );
    const match = html.match(pattern);
    if (!match) {
      throw new Error(`Build output has no hashed reference for ${asset}`);
    }
    const hashedPath = join(outputDir, match[0].slice(0, -1));
    if (
      !(await isFile(hashedPath)) ||
      (await getShortHash(hashedPath)) !== match[1]
    ) {
      throw new Error(`Build output has an invalid content hash for ${asset}`);
    }
  }
  const fflateReference = new RegExp(
    `${FFLATE_JS_PATH.replaceAll(".", "\\.")}\\?v=[a-f0-9]{8}"`,
  );
  if (!fflateReference.test(html)) {
    throw new Error("Build output has no versioned fflate reference");
  }
  const staticFiles = [
    ...(await walkFiles(join(outputDir, "assets"))),
    ...(await walkFiles(join(outputDir, "css", "fonts"))),
  ];
  const favicons = (await readdir(outputDir))
    .filter((name) => /^favicon\.[a-f0-9]{8}\.ico$/.test(name))
    .map((name) => join(outputDir, name));
  if (favicons.length !== 1) {
    throw new Error("Build output has no uniquely hashed favicon");
  }
  for (const path of [...staticFiles, ...favicons]) {
    const filename = basename(path);
    const match = filename.match(/\.([a-f0-9]{8})\.[^./]+$/);
    if (!match || (await getShortHash(path)) !== match[1]) {
      throw new Error(
        `Build output has an invalid static asset hash for ${relative(
          outputDir,
          path,
        )}`,
      );
    }
  }
  const referenceDocuments = [
    { content: html, path: paths.html },
    ...((await isFile(paths.captureHtml))
      ? [
          {
            content: await readFile(paths.captureHtml, "utf8"),
            path: paths.captureHtml,
          },
        ]
      : []),
  ];
  for (const match of html.matchAll(
    /(?:src|href)="((?:js|css)\/[^"]+\.(?:js|css))"/g,
  )) {
    referenceDocuments.push({
      content: await readFile(join(outputDir, match[1]), "utf8"),
      path: join(outputDir, match[1]),
    });
  }
  for (const document of referenceDocuments) {
    for (const match of document.content.matchAll(
      /(?:\.\.\/)*assets\/[^"'`()\s]+|(?:css\/)?fonts\/[^"'`()\s]+|favicon[^"'`()\s]+/g,
    )) {
      const reference = match[0];
      if (!/\.[a-f0-9]{8}\.[^./]+$/.test(reference)) {
        throw new Error(
          `Build output has an unhashed static reference in ${relative(
            outputDir,
            document.path,
          )}: ${reference}`,
        );
      }
      const target =
        reference.startsWith("../") || reference.startsWith("fonts/")
          ? join(dirname(document.path), reference)
          : join(outputDir, reference);
      if (!(await isFile(target))) {
        throw new Error(
          `Build output references a missing static asset: ${reference}`,
        );
      }
    }
  }
  const jsEntries = await readdir(paths.js);
  for (const name of WORKER_SCRIPTS) {
    const pattern = new RegExp(`^${name}\\.[a-f0-9]{8}\\.js$`);
    if (jsEntries.filter((entry) => pattern.test(entry)).length !== 1) {
      throw new Error(
        `Build output has no uniquely hashed ${name.replace("-", " ")}`,
      );
    }
  }
  if (!jsEntries.some((name) => /^core\.ruffle\..*\.js$/.test(name))) {
    throw new Error("Build output has no Ruffle core JavaScript");
  }
  if (!jsEntries.some((name) => name.endsWith(".wasm"))) {
    throw new Error("Build output has no Ruffle WebAssembly");
  }

  let versionMetadata: Record<string, unknown>;
  try {
    versionMetadata = JSON.parse(await readFile(paths.versionJson, "utf8"));
  } catch {
    throw new Error("Build output has invalid version metadata");
  }
  if (
    Object.keys(versionMetadata).sort().join(",") !==
    "bundledGameBytes,offlineBytes,releasedAt,revision,stabilityDelayMs,version"
  ) {
    throw new Error("Build output has invalid version metadata");
  }
  if (
    !Number.isInteger(versionMetadata.offlineBytes) ||
    (versionMetadata.offlineBytes as number) <= 0 ||
    !Number.isInteger(versionMetadata.bundledGameBytes) ||
    (versionMetadata.bundledGameBytes as number) <= 0 ||
    typeof versionMetadata.releasedAt !== "string" ||
    !Number.isFinite(Date.parse(versionMetadata.releasedAt)) ||
    !Number.isInteger(versionMetadata.stabilityDelayMs) ||
    (versionMetadata.stabilityDelayMs as number) < 0
  ) {
    throw new Error("Build output has invalid offline download size");
  }

  let offlineManifest: OfflineManifest;
  try {
    offlineManifest = JSON.parse(
      await readFile(versionedOfflineManifest, "utf8"),
    ) as OfflineManifest;
  } catch {
    throw new Error("Build output has invalid offline game manifest");
  }
  if (
    offlineManifest.version !== versionMetadata.version ||
    Object.keys(offlineManifest.games ?? {}).length === 0 ||
    !offlineManifest.runtime?.files?.length
  ) {
    throw new Error("Build output has invalid offline game manifest");
  }
  const gameRoots = Object.fromEntries(
    Object.entries(offlineManifest.games).map(([id, game]) => [id, game.root]),
  );
  const rootsMatch = html.match(
    /window\.ASTRO_GAME_ROOTS=Object\.freeze\((\{[^<]+\})\)/,
  );
  let configuredRoots: Record<string, string> = {};
  try {
    configuredRoots = rootsMatch ? JSON.parse(rootsMatch[1]) : {};
  } catch {
    configuredRoots = {};
  }
  if (
    Object.entries(gameRoots).some(([id, root]) => configuredRoots[id] !== root)
  ) {
    throw new Error("Build output has no matching versioned game roots");
  }
  for (const [id, game] of Object.entries(offlineManifest.games)) {
    if (
      game.root !== `${game.type}/${id}.${game.revision}/` ||
      !game.files.length ||
      game.files.some((file) => !file.url.startsWith(game.root))
    ) {
      throw new Error(`Build output has an invalid game package for ${id}`);
    }
    for (const file of game.files) {
      const path = join(outputDir, file.url);
      if (!(await isFile(path))) {
        throw new Error(
          `Build output references a missing game file: ${file.url}`,
        );
      }
      const integrity = `sha384-${createHash("sha384")
        .update(await readFile(path))
        .digest("base64")}`;
      if (file.integrity !== integrity) {
        throw new Error(
          `Build output has invalid game file integrity: ${file.url}`,
        );
      }
    }
  }
  for (const runtime of [
    offlineManifest.runtime,
    ...Object.values(offlineManifest.runtimes ?? {}),
  ]) {
    for (const file of runtime.files) {
      const path = join(outputDir, file.url.split("?")[0]);
      if (
        !file.url.endsWith(`?rev=${runtime.revision}`) ||
        !(await isFile(path))
      ) {
        throw new Error(
          `Build output has an invalid runtime file: ${file.url}`,
        );
      }
      const integrity = `sha384-${createHash("sha384")
        .update(await readFile(path))
        .digest("base64")}`;
      if (file.integrity !== integrity) {
        throw new Error(
          `Build output has invalid runtime file integrity: ${file.url}`,
        );
      }
    }
  }
  if (
    !(versionMetadata.version as string).endsWith(
      `-${versionMetadata.revision as string}`,
    )
  ) {
    throw new Error("Build output has inconsistent version metadata");
  }
  console.log("Build output validated successfully");
}

export async function replaceOutput(
  stagingDir: string,
  outputDir: string,
): Promise<void> {
  await mkdir(dirname(outputDir), { recursive: true });
  const backupDir = join(dirname(stagingDir), "previous-output");
  if (await isDirectory(outputDir)) {
    await rename(outputDir, backupDir);
  }
  try {
    await rename(stagingDir, outputDir);
  } catch (error) {
    if (await isDirectory(backupDir)) {
      await rename(backupDir, outputDir);
    }
    throw error;
  }
}

export async function assembleReleaseOutput(
  stagingDir: string,
  version: string,
): Promise<void> {
  const releasePath = releaseRelativePath(version);
  const releaseDir = join(stagingDir, ...releasePath.split("/"));
  const rootHtml = join(stagingDir, "index.html");
  const html = await replaceExactlyOnce(
    await readFile(rootHtml, "utf8"),
    /<head>/g,
    `<head>\n    <base href="/${releasePath}/" />`,
    "Could not set the immutable release base URL",
  ).then((content) =>
    content.replaceAll(
      "https://xp.4st.li/assets/",
      `https://xp.4st.li/${releasePath}/assets/`,
    ),
  );

  await mkdir(releaseDir, { recursive: true });
  for (const entry of await readdir(stagingDir, { withFileTypes: true })) {
    if (
      entry.name === RELEASES_PATH ||
      entry.name === "index.html" ||
      entry.name === "sw.js" ||
      entry.name === "version.json"
    ) {
      continue;
    }
    await rename(join(stagingDir, entry.name), join(releaseDir, entry.name));
  }
  await writeFile(rootHtml, html);
  // Cloudflare reads _headers instead of serving it. A release path never
  // changes content, so browsers can skip revalidating it.
  await writeFile(
    join(stagingDir, "_headers"),
    `/${RELEASES_PATH}/*\n  Cache-Control: public, max-age=31536000, immutable\n`,
  );
}

export async function validateReleaseOutput(
  outputDir: string,
  version: string,
): Promise<void> {
  const releasePath = releaseRelativePath(version);
  const releaseDir = join(outputDir, ...releasePath.split("/"));
  const allowedRootEntries = new Set([
    "_headers",
    "index.html",
    "releases",
    "sw.js",
    versionedServiceWorkerName(version),
    "version.json",
  ]);
  const unexpectedRootEntries = (await readdir(outputDir)).filter(
    (name) => !allowedRootEntries.has(name),
  );
  if (unexpectedRootEntries.length > 0) {
    throw new Error(
      `Build output has files outside the release directory: ${unexpectedRootEntries.join(", ")}`,
    );
  }
  const releases = await readdir(join(outputDir, RELEASES_PATH));
  if (releases.length !== 1 || releases[0] !== version) {
    throw new Error("Build output has an invalid release directory");
  }
  const html = await readFile(join(outputDir, "index.html"), "utf8");
  if (!html.includes(`<base href="/${releasePath}/" />`)) {
    throw new Error("Build output has no matching immutable release base URL");
  }
  await validatePrecacheIntegrity(outputDir);
  const rootWorker = await readFile(join(outputDir, "sw.js"), "utf8");
  const versionedWorker = await readFile(
    join(outputDir, versionedServiceWorkerName(version)),
    "utf8",
  );
  if (versionedWorker !== rootWorker + VERSIONED_SERVICE_WORKER_MARKER) {
    throw new Error(
      "Build output has an inconsistent versioned service worker",
    );
  }
  if (await isFile(join(releaseDir, "offline-games.json"))) {
    throw new Error("Build output contains an unversioned offline manifest");
  }
  const manifestReference = html.match(
    /window\.ASTRO_OFFLINE_MANIFEST_URL="(offline-games\.[a-f0-9]{8}\.json)"/,
  )?.[1];
  if (
    !manifestReference ||
    !(await isFile(join(releaseDir, manifestReference)))
  ) {
    throw new Error("Build output has no release-scoped offline manifest");
  }
  for (const requiredPath of [
    "apps",
    "assets",
    "capture.html",
    "css",
    "iframe",
    "js",
    "vendor",
  ]) {
    const path = join(releaseDir, requiredPath);
    if (!(await isFile(path)) && !(await isDirectory(path))) {
      throw new Error(`Build output is missing release path: ${requiredPath}`);
    }
  }
  for (const path of await walkFiles(releaseDir)) {
    if (
      ![".css", ".html", ".js", ".json", ".mjs"].includes(extname(path)) ||
      /offline-worker\.[a-f0-9]{8}\.js$/.test(path)
    ) {
      continue;
    }
    const reference = (await readFile(path, "utf8")).match(
      /["'`(=]\s*\/(apps|assets|css|dos|iframe|js|swf|vendor)\//,
    )?.[0];
    if (reference) {
      throw new Error(
        `Build output has an unscoped release reference in ${relative(releaseDir, path)}: ${reference}`,
      );
    }
  }
}

export async function validatePrecacheIntegrity(
  outputDir: string,
): Promise<void> {
  const serviceWorker = join(outputDir, "sw.js");
  if (!(await isFile(serviceWorker))) {
    throw new Error("Build output is missing required file: sw.js");
  }
  const source = await readFile(serviceWorker, "utf8");
  const manifest = source.match(/^self\.__ASTRO_XP_PRECACHE__=(.*);$/m)?.[1];
  const entries: PrecacheEntry[] = manifest ? JSON.parse(manifest) : [];
  if (entries.length === 0) {
    throw new Error("Build output has no integrity-protected precache entries");
  }
  let indexEntries = 0;
  const root = resolve(outputDir);
  for (const { integrity, revision, url } of entries) {
    const relativeUrl = decodeURIComponent(url.split(/[?#]/, 1)[0])
      .replace(/^\/+/, "")
      .split("/")
      .join(sep);
    const path = resolve(root, relativeUrl);
    if (path !== root && !path.startsWith(`${root}${sep}`)) {
      throw new Error(`Precache entry escapes the build output: ${url}`);
    }
    if (!(await isFile(path))) {
      throw new Error(`Precache entry references a missing file: ${url}`);
    }
    const expected = precacheEntry(await readFile(path), url);
    if (integrity !== expected.integrity) {
      throw new Error(`Precache entry has invalid integrity: ${url}`);
    }
    // The worker reuses a cached file whenever its revision matches.
    if (revision !== expected.revision) {
      throw new Error(`Precache entry has an invalid revision: ${url}`);
    }
    if (url === "index.html") indexEntries += 1;
  }
  if (indexEntries !== 1) {
    throw new Error("Build output must precache index.html exactly once");
  }
}

export interface BuildOptions {
  outputDir: string;
  releasedAt?: string;
  revision?: string;
  sourceDir: string;
  stabilityDelayMs?: number;
  version?: string;
  installRuffle?: (jsDir: string) => Promise<void>;
  generate?: (outputDir: string, version?: string) => Promise<void>;
}

export async function build({
  outputDir,
  releasedAt,
  revision = "HEAD",
  sourceDir,
  stabilityDelayMs = DEFAULT_UPDATE_STABILITY_DELAY_MS,
  version,
  installRuffle: installRuffleRuntime = installRuffle,
  generate = (directory, buildVersion) =>
    generateServiceWorker(directory, buildVersion),
}: BuildOptions): Promise<void> {
  const resolvedOutput = resolve(outputDir);
  const resolvedSource = resolve(sourceDir);
  if (
    resolvedOutput === resolvedSource ||
    resolvedOutput.startsWith(`${resolvedSource}${sep}`)
  ) {
    throw new Error("Build output must be outside the site source directory");
  }

  const deploymentVersion = version ?? getDeploymentVersion(revision);
  await mkdir(dirname(resolvedOutput), { recursive: true });
  const temporaryDirectory = await mkdtemp(
    join(
      dirname(resolvedOutput),
      `.${resolvedOutput.split(sep).at(-1)}-build-`,
    ),
  );
  try {
    const stagingDir = join(temporaryDirectory, "output");
    await cp(resolvedSource, stagingDir, {
      recursive: true,
      preserveTimestamps: true,
    });
    await scopeReleaseReferences(stagingDir, deploymentVersion);
    const paths = new BuildPaths(stagingDir);
    await installFflate(stagingDir);
    await installJsDos(stagingDir);
    await installWebtorrent(stagingDir);
    await installRuffleRuntime(paths.js);
    await compressFonts(paths);
    await updateHtml(paths, deploymentVersion);
    await writeOfflineGameManifest(paths, deploymentVersion);
    await writeVersionMetadata(paths, deploymentVersion, {
      releasedAt,
      stabilityDelayMs,
    });
    await versionOfflineGameManifest(paths);
    await validateOutput(stagingDir);
    await assembleReleaseOutput(stagingDir, deploymentVersion);
    await generate(stagingDir, deploymentVersion);
    await validateReleaseOutput(stagingDir, deploymentVersion);
    await replaceOutput(stagingDir, resolvedOutput);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  console.log(`Build completed successfully: ${resolvedOutput}`);
}

export function parseBuildArguments(arguments_: string[]): {
  outputDir: string;
  revision: string;
  sourceDir: string;
  stabilityDelayMs: number;
} {
  let outputDir = DEFAULT_OUTPUT_DIR;
  let revision = "HEAD";
  let stabilityDelayMs = DEFAULT_UPDATE_STABILITY_DELAY_MS;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (
      argument === "--output" ||
      argument === "--revision" ||
      argument === "--update-delay-hours"
    ) {
      const value = arguments_[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === "--output")
        outputDir = isAbsolute(value) ? value : resolve(value);
      else if (argument === "--revision") revision = value;
      else {
        const hours = Number(value);
        if (!Number.isFinite(hours) || hours < 0) {
          throw new Error("--update-delay-hours must be zero or greater");
        }
        stabilityDelayMs = Math.round(hours * 60 * 60 * 1000);
      }
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { outputDir, revision, sourceDir: SOURCE_DIR, stabilityDelayMs };
}

if (import.meta.main) {
  try {
    await build(parseBuildArguments(Bun.argv.slice(2)));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
