// Names every deployed file after its content, so a URL never changes meaning
// and unchanged files keep their URL across releases.
//
// Files get a short content hash before their extension. A package directory
// is renamed as a whole when code inside it builds paths to its own files at
// runtime. Text files are scanned for paths to other files, which are
// rewritten to the new names. A file's hash covers those rewritten paths, so a
// change renames the file and everything that refers to it, and nothing else.
// Files that refer to each other in a cycle share one hash.
import { createHash } from "node:crypto";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";

export interface ContentPackage {
  /** Directory relative to the root, without a trailing slash. */
  path: string;
  /** Code reaches the package through a runtime map, not literal paths. */
  mapped?: boolean;
}

export interface ContentAddressOptions {
  /** Files fetched by a fixed URL. They are rewritten but never renamed. */
  fixed: string[];
  packages: ContentPackage[];
  /** Files already named by their content, such as webpack chunks. */
  namedByContent?: (path: string) => boolean;
  /** Text files that are shipped but never scanned for references. */
  unscanned?: (path: string) => boolean;
  /** Absolute origins whose paths mean the site root. */
  origins?: string[];
}

export interface ContentAddressResult {
  /** Final path of every file, keyed by its original path. */
  files: Map<string, string>;
  /** Final directory of every package, keyed by its original path. */
  packages: Map<string, string>;
}

export interface Reference {
  start: number;
  end: number;
  /** Original path of the file, or of the directory with a trailing slash. */
  target: string;
  form: "absolute" | "root" | "relative";
  dotSlash: boolean;
}

interface Unit {
  id: string;
  files: string[];
  package?: ContentPackage;
  renamed: boolean;
}

const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".mjs"]);
const FILE_HASH_LENGTH = 8;
const PACKAGE_HASH_LENGTH = 16;
// A path-like token between delimiters: optional ./, ../ or /, then segments
// ending in a file with an extension, or in a slash for a directory.
const PATH_TOKEN =
  /(?<=["'`(=\s,])(?:\.{1,2}\/)*\/?(?:[\w.~-]+\/)*(?:[\w~-][\w.~-]*\.[A-Za-z0-9]+|[\w~-][\w.~-]*\/)(?=[?#"'`)\s,;])/g;

export const fileHash = (content: Uint8Array | string) =>
  createHash("sha384").update(content).digest("hex").slice(0, FILE_HASH_LENGTH);

export const hashedFileName = (path: string, hash: string) => {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash + 1
    ? `${path.slice(0, dot)}.${hash}${path.slice(dot)}`
    : `${path}.${hash}`;
};

const extension = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

const directoryOf = (path: string) => {
  const directory = posix.dirname(path);
  return directory === "." ? "" : directory;
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function listFiles(root: string, directory = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, directory), {
    withFileTypes: true,
  })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

/**
 * Finds the paths in a text file that point at existing files or directories.
 * HTML and CSS resolve bare paths against their own directory first; scripts
 * resolve them against the site root, where the page that runs them lives.
 */
export function findReferences(
  source: string,
  file: string,
  exists: (path: string) => boolean,
  origins: string[] = [],
): Reference[] {
  const directory = directoryOf(file);
  const fileRelativeFirst = [".html", ".css"].includes(extension(file));
  const references: Reference[] = [];
  const resolve = (token: string, base: string) => {
    const joined = posix.normalize(base ? `${base}/${token}` : token);
    return joined === ".." || joined.startsWith("../") ? null : joined;
  };
  const add = (start: number, token: string, absolute: boolean) => {
    const fileRelative = [resolve(token, directory), "relative"] as const;
    const rootRelative = [resolve(token, ""), "root"] as const;
    const candidates =
      absolute || token.startsWith("/")
        ? [[resolve(token.replace(/^\/+/, ""), ""), "absolute"] as const]
        : token.startsWith("./") || token.startsWith("../")
          ? [fileRelative]
          : fileRelativeFirst
            ? [fileRelative, rootRelative]
            : [rootRelative, fileRelative];
    for (const [target, form] of candidates) {
      if (target === null || !exists(target)) continue;
      references.push({
        start,
        end: start + token.length,
        target,
        form,
        dotSlash: token.startsWith("./"),
      });
      return;
    }
  };
  for (const origin of origins) {
    const pattern = new RegExp(
      `${escapeRegExp(origin)}(/[\\w.~/-]+)(?=[?#"'\`)\\s,;])`,
      "g",
    );
    // A path inside such a URL follows "/", so PATH_TOKEN never sees it.
    for (const match of source.matchAll(pattern)) {
      add(match.index + origin.length, match[1], true);
    }
  }
  for (const match of source.matchAll(PATH_TOKEN)) {
    add(match.index, match[0], false);
  }
  return references.sort((a, b) => a.start - b.start);
}

export async function contentAddress(
  root: string,
  {
    fixed,
    packages,
    namedByContent = () => false,
    unscanned = () => false,
    origins = [],
  }: ContentAddressOptions,
): Promise<ContentAddressResult> {
  const files = await listFiles(root);
  const fileSet = new Set(files);
  const directories = new Set<string>();
  for (const path of files) {
    for (let at = directoryOf(path); at; at = directoryOf(at)) {
      directories.add(`${at}/`);
    }
  }
  const exists = (path: string) =>
    path.endsWith("/") ? directories.has(path) : fileSet.has(path);
  for (const entry of packages) {
    if (!directories.has(`${entry.path}/`)) {
      throw new Error(`Content package is missing: ${entry.path}`);
    }
  }
  const missingFixed = fixed.filter((path) => !fileSet.has(path));
  if (missingFixed.length) {
    throw new Error(`Fixed files are missing: ${missingFixed.join(", ")}`);
  }

  const packageOf = (path: string) =>
    packages.find((entry) => path.startsWith(`${entry.path}/`));
  const units = new Map<string, Unit>();
  const unitOf = new Map<string, Unit>();
  for (const path of files) {
    const owner = packageOf(path);
    const id = owner ? `${owner.path}/` : path;
    if (!units.has(id)) {
      units.set(id, {
        id,
        files: [],
        package: owner,
        renamed:
          Boolean(owner) || (!fixed.includes(path) && !namedByContent(path)),
      });
    }
    units.get(id)!.files.push(path);
    unitOf.set(path, units.get(id)!);
  }
  // A directory reference only has a unit when the directory is a package or
  // lies inside one; other directories hold separately named files.
  const targetUnit = (target: string) => {
    if (!target.endsWith("/")) return unitOf.get(target);
    const owner = packageOf(target);
    return owner && units.get(`${owner.path}/`);
  };

  const contents = new Map<string, string>();
  const references = new Map<string, Reference[]>();
  const edges = new Map<Unit, Set<Unit>>();
  for (const unit of units.values()) edges.set(unit, new Set());
  for (const path of files) {
    if (!TEXT_EXTENSIONS.has(extension(path)) || unscanned(path)) continue;
    const source = await readFile(join(root, path), "utf8");
    contents.set(path, source);
    const unit = unitOf.get(path)!;
    references.set(
      path,
      findReferences(source, path, exists, origins).filter((reference) => {
        const target = targetUnit(reference.target);
        // Mapped packages are found through a runtime map instead.
        if (!target || target === unit || target.package?.mapped) return false;
        edges.get(unit)!.add(target);
        return true;
      }),
    );
  }

  // Tarjan's algorithm lists strongly connected units dependencies first.
  const components: Unit[][] = [];
  const index = new Map<Unit, number>();
  const low = new Map<Unit, number>();
  const stack: Unit[] = [];
  const onStack = new Set<Unit>();
  const connect = (unit: Unit) => {
    index.set(unit, index.size);
    low.set(unit, index.get(unit)!);
    stack.push(unit);
    onStack.add(unit);
    for (const next of edges.get(unit)!) {
      if (!index.has(next)) {
        connect(next);
        low.set(unit, Math.min(low.get(unit)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(unit, Math.min(low.get(unit)!, index.get(next)!));
      }
    }
    if (low.get(unit) !== index.get(unit)) return;
    const component: Unit[] = [];
    let member: Unit;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== unit);
    components.push(component.sort((a, b) => a.id.localeCompare(b.id)));
  };
  for (const unit of units.values()) if (!index.has(unit)) connect(unit);

  const finalName = new Map<Unit, string>();
  const finalTarget = (target: string) => {
    const unit = targetUnit(target)!;
    const name = finalName.get(unit);
    if (!name) return target;
    return unit.package
      ? `${name}/${target.slice(unit.package.path.length + 1)}`
      : name;
  };
  // References into the units in `pending` keep their original paths.
  const rewrite = (path: string, pending: Set<Unit>) => {
    const source = contents.get(path)!;
    const directory = directoryOf(path);
    let output = "";
    let cursor = 0;
    for (const reference of references.get(path)!) {
      if (pending.has(targetUnit(reference.target)!)) continue;
      const target = finalTarget(reference.target);
      let replacement =
        reference.form === "absolute"
          ? `/${target}`
          : reference.form === "root"
            ? target
            : posix.relative(directory, target) +
              (target.endsWith("/") ? "/" : "");
      if (reference.dotSlash && !replacement.startsWith("../")) {
        replacement = `./${replacement}`;
      }
      output += source.slice(cursor, reference.start) + replacement;
      cursor = reference.end;
    }
    return output + source.slice(cursor);
  };
  const bytes = async (path: string, text: string | undefined) =>
    text !== undefined && text !== contents.get(path)
      ? Buffer.from(text)
      : readFile(join(root, path));

  for (const component of components) {
    const members = new Set(component);
    // Inside a cycle, references between members keep their original paths
    // while hashing, so the shared hash does not depend on itself.
    const draft = new Map<string, string>();
    for (const unit of component) {
      for (const path of unit.files) {
        if (contents.has(path)) draft.set(path, rewrite(path, members));
      }
    }
    const digestOf = async (paths: string[], algorithm: string) => {
      const digest = createHash(algorithm);
      for (const path of paths) {
        digest.update(path);
        digest.update(await bytes(path, draft.get(path)));
      }
      return digest.digest("hex");
    };
    const shared =
      component.length > 1
        ? await digestOf(
            component.flatMap((unit) => unit.files),
            "sha256",
          )
        : null;
    for (const unit of component) {
      if (!unit.renamed) continue;
      if (unit.package) {
        // The same digest that offline game downloads were keyed by.
        const hash = shared ?? (await digestOf(unit.files, "sha256"));
        finalName.set(
          unit,
          `${unit.package.path}.${hash.slice(0, PACKAGE_HASH_LENGTH)}`,
        );
      } else {
        const [path] = unit.files;
        const hash =
          shared?.slice(0, FILE_HASH_LENGTH) ??
          fileHash(await bytes(path, draft.get(path)));
        finalName.set(unit, hashedFileName(path, hash));
      }
    }
    for (const unit of component) {
      for (const path of unit.files) {
        if (!contents.has(path)) continue;
        const text =
          component.length > 1 ? rewrite(path, new Set()) : draft.get(path)!;
        if (text !== contents.get(path))
          await writeFile(join(root, path), text);
      }
    }
  }

  const fileMap = new Map<string, string>();
  const packageMap = new Map<string, string>();
  for (const unit of units.values()) {
    const name = finalName.get(unit);
    for (const path of unit.files) {
      fileMap.set(
        path,
        !name
          ? path
          : unit.package
            ? `${name}/${path.slice(unit.package.path.length + 1)}`
            : name,
      );
    }
    if (!name) continue;
    if (unit.package) packageMap.set(unit.package.path, name);
    await rename(
      join(root, unit.package?.path ?? unit.files[0]),
      join(root, name),
    );
  }
  return { files: fileMap, packages: packageMap };
}
