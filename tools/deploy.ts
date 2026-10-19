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
  contentAddress,
  type ContentAddressResult,
  type ContentPackage,
} from "./content-address";
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
export const DEFAULT_UPDATE_STABILITY_DELAY_MS = 6 * 60 * 60 * 1000;
export const SITE_ORIGIN = "https://xp.4st.li";
/** Entry points fetched by a fixed URL; every other file is named by content. */
export const FIXED_FILES = ["index.html", "capture.html"];
const PINBALL_RUNTIME_PATH = "apps/pinball/runtime";
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
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
// Ruffle's webpack chunks already carry a content hash, and ruffle.js loads
// them by those names.
export const isRuffleChunk = (path: string) =>
  /^js\/(?:core\.ruffle\.[a-f0-9]{20}\.js|[a-f0-9]{20}\.wasm)(?:\.map)?$/.test(
    path,
  );
const APP_VERSION_PATTERN = /const APP_VERSION = "[^"]+";/g;
const VERSIONED_SERVICE_WORKER_MARKER =
  "\nself.__ASTRO_XP_IMMUTABLE_WORKER__=true;\n";

const WORKER_SCRIPTS = [
  "shell-cache",
  "offline-worker",
  "shell-worker",
] as const;

export interface PrecacheEntry {
  // Entry points keep their names, so their downloads skip the HTTP cache.
  fixed?: true;
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

function versionedServiceWorkerName(version: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  return `sw.${version}.js`;
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

export async function prepareEntryPoints(
  paths: BuildPaths,
  version: string,
): Promise<void> {
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
  console.log(`  - Set deployment version to ${version}`);
}

// Directories renamed as a whole: code inside them builds paths to their own
// files, or the runtime finds them through ASTRO_GAME_ROOTS.
async function contentPackages(paths: BuildPaths): Promise<ContentPackage[]> {
  const packages: ContentPackage[] = [];
  for (const type of ["swf", "iframe"]) {
    const parent = join(paths.root, type);
    if (!(await isDirectory(parent))) continue;
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== "scummvm") {
        packages.push({ path: `${type}/${entry.name}`, mapped: true });
      }
    }
  }
  const versionedVendors = async (name: string) =>
    (await readdir(join(paths.root, "vendor", name)).catch(() => [])).map(
      (version) => `vendor/${name}/${version}`,
    );
  for (const path of [
    JS_DOS_ROOT_PATH,
    PINBALL_RUNTIME_PATH,
    ...(await versionedVendors("pipes")),
    ...(await versionedVendors("scummvm")),
  ]) {
    if (await isDirectory(join(paths.root, path))) packages.push({ path });
  }
  return packages.sort((a, b) => a.path.localeCompare(b.path));
}

export async function addressContent(
  paths: BuildPaths,
): Promise<ContentAddressResult> {
  const result = await contentAddress(paths.root, {
    fixed: (
      await Promise.all(
        FIXED_FILES.map(async (path) =>
          (await isFile(join(paths.root, path))) ? path : null,
        ),
      )
    ).filter((path) => path !== null),
    packages: await contentPackages(paths),
    namedByContent: isRuffleChunk,
    unscanned: (path) =>
      path.endsWith(".map") || /(^|\/)SOURCES[^/]*\.json$/.test(path),
    origins: [SITE_ORIGIN],
  });
  console.log(`  - Named ${result.files.size} files by their content`);
  return result;
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
): Promise<OfflineFile> {
  const content = await readFile(path);
  return {
    bytes: content.byteLength,
    integrity: `sha384-${createHash("sha384").update(content).digest("base64")}`,
    url: relative(root, path).split(sep).join("/"),
  };
}

async function offlinePackage(root: string, files: string[]) {
  const entries = await Promise.all(
    files.toSorted().map((path) => offlineFileEntry(root, path)),
  );
  return {
    bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    files: entries,
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

export async function prepareDoomPackage(paths: BuildPaths): Promise<void> {
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
  if (!(await readdir(join(paths.root, "dos"))).length) {
    await rm(join(paths.root, "dos"), { recursive: true });
  }
}

const GAME_RUNTIMES: Record<string, string> = {
  "pink-panther-hokus-pokus": "scummvm",
  "pink-panther-passport-to-peril": "scummvm",
};

// Games are the mapped packages. Their directory names end in the revision
// that offline downloads are keyed by.
export async function describeGamePackages(
  paths: BuildPaths,
  addressed: ContentAddressResult,
): Promise<VersionedGamePackages> {
  const packages: VersionedGamePackages = {};
  for (const [source, target] of [...addressed.packages].sort()) {
    const [type, gameId] = source.split("/");
    if (
      (type !== "swf" && type !== "iframe") ||
      source.split("/").length !== 2
    ) {
      continue;
    }
    const revision = target.slice(source.length + 1);
    packages[gameId] = {
      ...(await offlinePackage(
        paths.root,
        await walkFiles(join(paths.root, target)),
      )),
      revision,
      root: `${target}/`,
      ...(GAME_RUNTIMES[gameId] ? { runtime: GAME_RUNTIMES[gameId] } : {}),
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
  addressed: ContentAddressResult,
): Promise<void> {
  const runtimeFiles = (await readdir(paths.js, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && isRuffleChunk(`js/${entry.name}`))
    .filter((entry) => !entry.name.endsWith(".map"))
    .map((entry) => join(paths.js, entry.name));

  // Shared runtimes: every file whose original path lies under these roots.
  const sharedRuntimes: Record<string, string[]> = {
    scummvm: ["iframe/scummvm/", "vendor/scummvm/"],
  };
  const games = await describeGamePackages(paths, addressed);
  await injectGameRoots(paths, games);

  const runtimes: Record<string, OfflineRuntime> = {};
  for (const [id, prefixes] of Object.entries(sharedRuntimes)) {
    const files = [...addressed.files]
      .filter(([source]) =>
        prefixes.some((prefix) => source.startsWith(prefix)),
      )
      .map(([, target]) => join(paths.root, target));
    if (
      !prefixes.every((prefix) =>
        [...addressed.files.keys()].some((source) => source.startsWith(prefix)),
      )
    ) {
      continue;
    }
    runtimes[id] = {
      ...(await offlinePackage(paths.root, files)),
      revision: await offlineRevision(paths.root, files),
    };
  }
  const manifest: OfflineManifest = {
    games,
    runtime: {
      ...(await offlinePackage(paths.root, runtimeFiles)),
      revision: await offlineRevision(paths.root, runtimeFiles),
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
    const entry = precacheEntry(content, `${urlPrefix}${relativePath}`);
    entries.push(
      FIXED_FILES.includes(relativePath) ? { fixed: true, ...entry } : entry,
    );
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
  version: string,
): Promise<void> {
  console.log("Generating service worker...");
  const jsEntries = await readdir(join(outputDir, "js"));
  const scripts = WORKER_SCRIPTS.map((name) => {
    const matches = jsEntries.filter((entry) =>
      new RegExp(`^${name}\\.[a-f0-9]{8}\\.js$`).test(entry),
    );
    if (matches.length !== 1) {
      throw new Error(
        `Build output must contain exactly one hashed ${name.replace("-", " ")}`,
      );
    }
    return `js/${matches[0]}`;
  });
  const manifest = await createPrecacheManifest(outputDir, "");
  const workerSource = [
    `self.__ASTRO_XP_VERSION__=${JSON.stringify(version)};`,
    `self.__ASTRO_XP_PRECACHE__=${JSON.stringify(manifest)};`,
    `importScripts(${scripts.map((script) => JSON.stringify(script)).join(",")});`,
    "",
  ].join("\n");
  await writeFile(join(outputDir, "sw.js"), workerSource);
  await writeFile(
    join(outputDir, versionedServiceWorkerName(version)),
    workerSource + VERSIONED_SERVICE_WORKER_MARKER,
  );
  console.log(`  - Service worker precaches ${manifest.length} files`);
}

// Every path outside the fixed entry points is named by its content, so
// browsers may keep it forever. Cloudflare reads _headers instead of serving it.
export async function writeHeaders(outputDir: string): Promise<void> {
  const fixed = new Set([...FIXED_FILES, "_headers", "sw.js", "version.json"]);
  const rules = (await readdir(outputDir, { withFileTypes: true }))
    .filter(
      (entry) => !fixed.has(entry.name) && !/^sw\.[^/]+\.js$/.test(entry.name),
    )
    .map((entry) =>
      entry.isDirectory() ? `/${entry.name}/*` : `/${entry.name}`,
    )
    .sort()
    .map((path) => `${path}\n  Cache-Control: ${IMMUTABLE_CACHE_CONTROL}\n`);
  await writeFile(join(outputDir, "_headers"), rules.join(""));
}

// A name is content-addressed when it, or a directory above it, carries a
// content hash, or the file came named by its content.
export const isContentAddressed = (path: string) =>
  FIXED_FILES.includes(path) ||
  isRuffleChunk(path) ||
  /\.[a-f0-9]{8}(\.[^./]+)?$/.test(path) ||
  path
    .split("/")
    .slice(0, -1)
    .some((part) => /\.[a-f0-9]{16}$/.test(part));

export async function validateOutput(outputDir: string): Promise<void> {
  const paths = new BuildPaths(outputDir);
  for (const path of [paths.html, paths.versionJson]) {
    if (!(await isFile(path))) {
      throw new Error(
        `Build output is missing required file: ${relative(outputDir, path)}`,
      );
    }
  }
  const files = (await walkFiles(outputDir)).map((path) =>
    relative(outputDir, path).split(sep).join("/"),
  );
  const unaddressed = files.filter(
    (path) =>
      !isContentAddressed(path) &&
      !["_headers", "version.json", "sw.js"].includes(path) &&
      !/^sw\.[^/]+\.js$/.test(path),
  );
  if (unaddressed.length) {
    throw new Error(
      `Build output has files not named by their content: ${unaddressed.slice(0, 5).join(", ")}`,
    );
  }
  const html = await readFile(paths.html, "utf8");
  for (const name of WORKER_SCRIPTS) {
    const pattern = new RegExp(`^${name}\\.[a-f0-9]{8}\\.js$`);
    if (
      (await readdir(paths.js)).filter((entry) => pattern.test(entry))
        .length !== 1
    ) {
      throw new Error(
        `Build output has no uniquely hashed ${name.replace("-", " ")}`,
      );
    }
  }
  for (const match of html.matchAll(
    /\b(?:src|href)="(?![a-z][a-z\d+.-]*:|\/\/|#)([^"#?]+)/g,
  )) {
    if (!(await isFile(join(outputDir, match[1])))) {
      throw new Error(
        `Build output index.html references a missing file: ${match[1]}`,
      );
    }
  }
  const jsEntries = await readdir(paths.js);
  if (!jsEntries.some((name) => /^core\.ruffle\..*\.js$/.test(name))) {
    throw new Error("Build output has no Ruffle core JavaScript");
  }
  if (!jsEntries.some((name) => name.endsWith(".wasm"))) {
    throw new Error("Build output has no Ruffle WebAssembly");
  }
  const offlineManifestReference = html.match(
    /window\.ASTRO_OFFLINE_MANIFEST_URL="(offline-games\.[a-f0-9]{8}\.json)"/,
  );
  if (!offlineManifestReference) {
    throw new Error("Build output has no versioned offline game manifest");
  }
  await validateVersionMetadata(
    paths,
    join(outputDir, offlineManifestReference[1]),
    html,
  );
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

async function validateVersionMetadata(
  paths: BuildPaths,
  offlineManifestPath: string,
  html: string,
): Promise<void> {
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
  if (
    !(versionMetadata.version as string).endsWith(
      `-${versionMetadata.revision as string}`,
    )
  ) {
    throw new Error("Build output has inconsistent version metadata");
  }

  let offlineManifest: OfflineManifest;
  try {
    offlineManifest = JSON.parse(
      await readFile(offlineManifestPath, "utf8"),
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
  const rootsMatch = html.match(
    /window\.ASTRO_GAME_ROOTS=Object\.freeze\((\{[^<]+\})\)/,
  );
  let configuredRoots: Record<string, string>;
  try {
    configuredRoots = rootsMatch ? JSON.parse(rootsMatch[1]) : {};
  } catch {
    configuredRoots = {};
  }
  for (const [id, game] of Object.entries(offlineManifest.games)) {
    if (configuredRoots[id] !== game.root) {
      throw new Error("Build output has no matching versioned game roots");
    }
    if (
      game.root !== `${game.type}/${id}.${game.revision}/` ||
      !game.files.length ||
      game.files.some((file) => !file.url.startsWith(game.root))
    ) {
      throw new Error(`Build output has an invalid game package for ${id}`);
    }
  }
  for (const [label, entry] of [
    ...Object.entries(offlineManifest.games),
    ["runtime", offlineManifest.runtime],
    ...Object.entries(offlineManifest.runtimes ?? {}),
  ] as [string, OfflineRuntime][]) {
    for (const file of entry.files) {
      const path = join(paths.root, file.url);
      if (!(await isFile(path))) {
        throw new Error(
          `Build output's offline manifest references a missing file for ${label}: ${file.url}`,
        );
      }
      const integrity = `sha384-${createHash("sha384")
        .update(await readFile(path))
        .digest("base64")}`;
      if (file.integrity !== integrity) {
        throw new Error(
          `Build output has invalid offline file integrity for ${label}: ${file.url}`,
        );
      }
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
  generate?: (outputDir: string, version: string) => Promise<void>;
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
    const paths = new BuildPaths(stagingDir);
    await installFflate(stagingDir);
    await installJsDos(stagingDir);
    await installWebtorrent(stagingDir);
    await installRuffleRuntime(paths.js);
    await compressFonts(paths);
    await prepareEntryPoints(paths, deploymentVersion);
    await prepareDoomPackage(paths);
    const addressed = await addressContent(paths);
    await writeOfflineGameManifest(paths, deploymentVersion, addressed);
    await writeVersionMetadata(paths, deploymentVersion, {
      releasedAt,
      stabilityDelayMs,
    });
    await versionOfflineGameManifest(paths);
    await writeHeaders(stagingDir);
    await generate(stagingDir, deploymentVersion);
    await validateOutput(stagingDir);
    await validatePrecacheIntegrity(stagingDir);
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
