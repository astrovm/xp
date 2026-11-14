const VERSION = "Microsoft Windows XP [Version 5.1.2600]";
const COPYRIGHT = "(C) Copyright 1985-2001 Microsoft Corp.";
const DEFAULT_TITLE = "C:\\WINDOWS\\system32\\cmd.exe";

const tokenize = (value) => {
  const tokens = [];
  let token = "";
  let quoted = false;
  for (const character of String(value)) {
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (/\s/.test(character) && !quoted) {
      if (token) tokens.push(token);
      token = "";
    } else {
      token += character;
    }
  }
  if (token) tokens.push(token);
  return tokens;
};

const formatDate = (timestamp) => {
  const date = new Date(timestamp);
  const part = (value) => String(value).padStart(2, "0");
  let hour = date.getHours();
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${part(date.getMonth() + 1)}/${part(date.getDate())}/${date.getFullYear()}  ${part(hour)}:${part(date.getMinutes())} ${suffix}`;
};

// A name matches a pattern with * and ?, like cmd.exe. Case does not count.
// cmd.exe adds DOS rules: "?" at the end of a name part also matches no
// character, so "note?.txt" matches "note.txt". A "." before only
// wildcards also matches the end of the name, so "*.*" matches "noext". A
// "*" before a "." takes any text but the last period of the name, so
// "*.tar.gz" matches "a.b.tar.gz", and "*." matches only names with no
// extension.
const wildcardRegExp = (pattern) => {
  let source = "";
  const characters = [...pattern];
  for (const [index, character] of characters.entries()) {
    const rest = characters.slice(index + 1).join("");
    if (character === "*")
      source += rest.startsWith(".") ? "(?:[^.]|\\.(?=.*\\.))*" : ".*";
    else if (character === "?")
      source += /^\?*(?:\.|$)/.test(rest) ? "[^.]?" : ".";
    else if (character === "." && /^[*?]*$/.test(rest)) source += "(?:\\.|$)";
    else source += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "i");
};
export const matchesPattern = (name, pattern) =>
  wildcardRegExp(pattern).test(name);
const hasWildcards = (value) => /[*?]/.test(value);

// The new name that REN makes from a name and a template with * and ?,
// like cmd.exe: "*.bak" makes "notes.txt" into "notes.bak", and "???.x"
// makes "abcdef.txt" into "abc.x".
const renameByTemplate = (name, template) => {
  let result = "";
  let index = 0;
  for (let position = 0; position < template.length; position += 1) {
    const character = template[position];
    if (character === "*") {
      const next = template[position + 1];
      // "*" copies the rest of the name, or the name up to the last
      // character that comes after "*" in the template.
      const end = next
        ? name.toLowerCase().lastIndexOf(next.toLowerCase())
        : -1;
      const stop = end >= index ? end : name.length;
      result += name.slice(index, stop);
      index = stop;
    } else if (character === "?") {
      // "?" copies one character, but never a period.
      if (index < name.length && name[index] !== ".") {
        result += name[index];
        index += 1;
      }
    } else if (character === ".") {
      // "." goes on to the part of the name after its next period.
      result += ".";
      const period = name.indexOf(".", index);
      index = period < 0 ? name.length : period + 1;
    } else {
      result += character;
      if (index < name.length && name[index] !== ".") index += 1;
    }
  }
  return result.replace(/[.\s]+$/, "");
};

const errorText = (error) =>
  error instanceof Error ? error.message : String(error);

const SYNTAX_ERROR = "The syntax of the command is incorrect.";
const NOT_FOUND = "The system cannot find the file specified.";
const PATH_NOT_FOUND = "The system cannot find the path specified.";
const BAD_NAME =
  "The filename, directory name, or volume label syntax is incorrect.";
const DUPLICATE_NAME =
  "A duplicate file name exists, or the file\ncannot be found.";
const ACCESS_DENIED = "Access is denied.";
const FREE_BYTES = 5952212992;
const SERIAL_NUMBERS = { C: "B836-2A76", D: "4C1F-90E3", F: "2E7A-15B8" };
const COMPUTER_NAME = "XP";
const SCREEN_WIDTH = 80;

const isFile = (node) => node?.type === "file";

// NTFS keeps names in the order of their uppercase text, and cmd.exe
// works on the files in that order.
const byName = (left, right) => {
  const a = left.name.toUpperCase();
  const b = right.name.toUpperCase();
  return Number(a > b) - Number(a < b);
};
const filesMatching = (children, pattern) =>
  children
    .filter((child) => isFile(child) && matchesPattern(child.name, pattern))
    .sort(byName);

// The 8.3 name of a long name, like XP makes it: "Documents and Settings"
// becomes "DOCUME~1". A name that is already a short name stays as it is.
const shortName = (name) => {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot + 1) : "";
  const allowed = /^[^\s.+,;=[\]]+$/;
  if (
    base.length <= 8 &&
    extension.length <= 3 &&
    allowed.test(base) &&
    (!extension || allowed.test(extension))
  )
    return name;
  const clean = (value) => value.toUpperCase().replace(/[\s.+,;=[\]]/g, "");
  const shortBase = `${clean(base).slice(0, 6)}~1`;
  const shortExtension = clean(extension).slice(0, 3);
  return shortExtension ? `${shortBase}.${shortExtension}` : shortBase;
};

// A file saved by an old version can have no size. DIR shows it as 0.
const sizeOf = (node) => node.size || 0;

const groupDigits = (value, separators) =>
  separators ? Number(value).toLocaleString("en-US") : String(Number(value));

// A text for each choice, such as "y" or "n", ends a question. Any other
// answer asks the question again, like cmd.exe.
function* ask(text, choices) {
  for (;;) {
    const reply = yield text;
    const choice = String(reply).trim()[0]?.toLowerCase();
    if (choice && choices.includes(choice)) return choice;
  }
}

export class CommandSession {
  constructor(context) {
    this.context = context;
    this.fs = context.fs;
    this.cwd = this.fs.USER_PROFILE;
    // The profile folder and the user name come from the file system, so
    // the prompt and the variables always show the real user.
    const profile = this.fs.getPath(this.fs.USER_PROFILE);
    const userName = this.fs.getNode(this.fs.USER_PROFILE).name;
    // The owner that DIR /Q shows. SET never changes it.
    this.userName = userName;
    const shortProfile = profile
      .split("\\")
      .map((part, index) => (index ? shortName(part) : part))
      .join("\\");
    const temp = `${shortProfile}\\LOCALS~1\\Temp`;
    this.environment = new Map([
      ["COMPUTERNAME", COMPUTER_NAME],
      ["COMSPEC", DEFAULT_TITLE],
      ["HOMEDRIVE", "C:"],
      ["HOMEPATH", profile.replace(/^[A-Z]:/i, "")],
      ["OS", "Windows_NT"],
      ["PATH", "C:\\WINDOWS\\system32;C:\\WINDOWS"],
      ["PATHEXT", ".COM;.EXE;.BAT;.CMD"],
      ["PROMPT", "$P$G"],
      ["SYSTEMDRIVE", "C:"],
      ["SYSTEMROOT", "C:\\WINDOWS"],
      ["TEMP", temp],
      ["TMP", temp],
      ["USERDOMAIN", COMPUTER_NAME],
      ["USERNAME", userName],
      ["USERPROFILE", profile],
      ["WINDIR", "C:\\WINDOWS"],
    ]);
  }

  get banner() {
    return `${VERSION}\n${COPYRIGHT}\n`;
  }

  displayPath(id = this.cwd) {
    return this.fs.getPath(id) || "C:\\";
  }

  // The full path of a name in a folder, such as "C:\t\a.txt".
  joinPath(folderId, name) {
    const base = this.displayPath(folderId);
    return `${base}${base.endsWith("\\") ? "" : "\\"}${name}`;
  }

  // A question, such as "Overwrite ...? (Yes/No/All): ", takes the place
  // of the prompt until the next line answers it.
  get prompt() {
    return this.question?.text ?? `${this.displayPath()}>`;
  }

  resolve(path, options = {}) {
    let value = path.trim();
    if (!value || value === ".") return this.cwd;
    value = value.replaceAll("/", "\\");
    const driveMatch = value.match(/^([cdf]):(?:\\|$)/i);
    // A drive that does not exist has no path.
    if (!driveMatch && /^[a-z]:/i.test(value)) return null;
    let current = driveMatch
      ? {
          c: this.fs.DRIVE_C,
          d: this.fs.DRIVE_D,
          f: this.fs.DRIVE_F,
        }[driveMatch[1].toLowerCase()]
      : value.startsWith("\\")
        ? this.driveRoot(this.cwd)
        : this.cwd;
    if (driveMatch) value = value.slice(driveMatch[0].length);
    else if (value.startsWith("\\")) value = value.slice(1);
    const segments = value.split("\\").filter(Boolean);
    for (const segment of segments) {
      if (segment === ".") continue;
      if (segment === "..") {
        // Like cmd.exe, ".." stops at the drive root.
        const parent = this.fs.getParent(current);
        if (parent && parent.id !== this.fs.MY_COMPUTER) current = parent.id;
        continue;
      }
      const child = this.fs.findChild(current, segment);
      if (!child) {
        if (options.parent && segment === segments.at(-1)) {
          return { parentId: current, name: segment };
        }
        return null;
      }
      current = child.id;
    }
    return options.parent ? { node: this.fs.getNode(current) } : current;
  }

  driveRoot(id) {
    let node = this.fs.getNode(id);
    while (node?.parent && node.parent !== this.fs.MY_COMPUTER) {
      node = this.fs.getParent(node.id);
    }
    return node?.id || this.fs.DRIVE_C;
  }

  expandEnvironment(value) {
    return String(value).replace(/%([^%]+)%/g, (match, name) =>
      this.environment.has(name.toUpperCase())
        ? this.environment.get(name.toUpperCase())
        : match,
    );
  }

  execute(rawLine) {
    return this.fs.transaction(() => this.executeInTransaction(rawLine));
  }

  executeInTransaction(rawLine) {
    try {
      // An answer runs in this try too, so an error that it meets shows
      // as a message, like the error of a command.
      if (this.question) return this.question.answer(rawLine);
      const line = this.expandEnvironment(rawLine).trim();
      if (!line) return { output: "" };
      const tokens = tokenize(line);
      const command = tokens.shift().toLowerCase();
      if (/^[cdf]:$/i.test(command)) return this.changeDrive(command);
      const method = this[`command_${command}`];
      if (method) return method.call(this, tokens, line);
      if (this.launch(command, tokens)) return { output: "" };
      return {
        output: `'${command}' is not recognized as an internal or external command,\noperable program or batch file.`,
      };
    } catch (error) {
      this.question = null;
      // A name that Windows refuses gets the text of cmd.exe.
      return {
        output: /^name-(?:required|invalid|reserved)$/.test(error?.code)
          ? BAD_NAME
          : errorText(error),
      };
    }
  }

  // A job is a generator that writes lines to `out` and yields the text of
  // a question. The next line that the user types answers the question,
  // and the job goes on from there.
  runJob(job, out, reply) {
    out.length = 0;
    this.question = null;
    try {
      const step = reply === undefined ? job.next() : job.next(reply);
      if (!step.done)
        this.question = {
          text: step.value,
          answer: (value) => this.runJob(job, out, value),
        };
    } catch (error) {
      out.push(errorText(error));
    }
    return { output: out.join("\n") };
  }

  // The folder and the name part of a path, as typed: "d\*.txt" gives the
  // folder "d" and the name "*.txt".
  splitPath(path) {
    const value = path.replaceAll("/", "\\");
    const slash = value.lastIndexOf("\\");
    const colon = slash < 0 ? value.indexOf(":") : -1;
    const cut = Math.max(slash, colon);
    const folderText = value.slice(0, cut + 1);
    const folderId = !folderText
      ? this.cwd
      : this.resolve(
          /^[A-Z]:$|^[A-Z]:\\$|^\\$/i.test(folderText)
            ? folderText
            : folderText.slice(0, -1),
        );
    return { folderId, folderText, name: value.slice(cut + 1) };
  }

  // The items that a source path names, like cmd.exe: a name with * or ?
  // names the files that match it, and a folder names its files (or, for
  // MOVE, the folder itself).
  sources(path, { folderItself }) {
    const id = this.resolve(path);
    const node = id && this.fs.getNode(id);
    if (node?.type === "folder" && !folderItself)
      return {
        items: filesMatching(this.fs.getChildren(id), "*"),
        prefix: path.replace(/[\\/]?$/, "\\"),
        many: true,
      };
    const { folderId, folderText, name } = this.splitPath(path);
    if (node) return { items: [node], prefix: folderText, many: false };
    if (!folderId || !hasWildcards(name))
      return { items: [], prefix: folderText, many: false };
    return {
      items: filesMatching(this.fs.getChildren(folderId), name),
      prefix: folderText,
      many: true,
    };
  }

  // Where COPY and MOVE put each item: into a folder, onto a file, or to a
  // new name. A new name with * or ? is a template, like REN.
  destination(path) {
    const id = this.resolve(path);
    const node = id && this.fs.getNode(id);
    if (node?.type === "folder")
      return { folderId: id, nameOf: (item) => item.name, single: false };
    if (node)
      return { folderId: node.parent, nameOf: () => node.name, single: true };
    const { folderId, name } = this.splitPath(path);
    if (!folderId || !name) return null;
    return hasWildcards(name)
      ? {
          folderId,
          nameOf: (item) => renameByTemplate(item.name, name),
          single: false,
        }
      : { folderId, nameOf: () => name, single: true };
  }

  // The Overwrite question shows the target as typed for COPY and as a
  // full path for MOVE, like cmd.exe.
  overwriteText(move, typed, target, folderId, name) {
    const shown = move
      ? this.joinPath(folderId, name)
      : target.single
        ? typed
        : typed
          ? `${typed}${/[\\:]$/.test(typed) ? "" : "\\"}${name}`
          : name;
    return `Overwrite ${shown}? (Yes/No/All): `;
  }

  // A folder in the Recycle Bin, such as a current folder that was
  // deleted, takes no change: no new file, and no file goes out of it,
  // changes, or gets a new name. Each command that writes checks the
  // folder that it changes.
  takesFiles(folderId) {
    return !!this.fs.getNode(folderId) && !this.fs.isInRecycleBin(folderId);
  }

  // COPY and MOVE take * and ?, ask before they replace a file, and look
  // at the files again after each answer, because another window can
  // change them while the question is open.
  copyOrMove(args, move) {
    const paths = args.filter((value) => !value.startsWith("/"));
    const switches = args.map((value) => value.toLowerCase());
    let all = switches.includes("/y");
    if (!paths.length || paths.length > 2 || (move && paths.length < 2))
      return { output: SYNTAX_ERROR };
    const source = this.sources(paths[0], { folderItself: move });
    if (!source.items.length) return { output: NOT_FOUND };
    const typed = paths[1] ?? "";
    const target = this.destination(typed || ".");
    if (!target || !this.takesFiles(target.folderId))
      return { output: PATH_NOT_FOUND };
    if (target.single && source.many) {
      if (move)
        return { output: "Cannot move multiple files to a single file." };
      return this.combine(source, target, typed, all);
    }
    const out = [];
    const session = this;
    function* job() {
      let count = 0;
      for (const item of source.items) {
        const from = item.parent;
        if (source.many)
          out.push(
            move
              ? session.joinPath(item.parent, item.name)
              : `${source.prefix}${item.name}`,
          );
        const name = target.nameOf(item);
        const folderId = target.folderId;
        if (
          !move &&
          item.parent === folderId &&
          item.name.toLowerCase() === name.toLowerCase()
        ) {
          out.push("The file cannot be copied onto itself.");
          continue;
        }
        try {
          session.fs.validateName(name);
        } catch {
          out.push(BAD_NAME);
          continue;
        }
        const existing = session.fs.findChild(folderId, name);
        if (
          existing &&
          existing.id !== item.id &&
          (!isFile(existing) || !isFile(item))
        ) {
          out.push(ACCESS_DENIED);
          continue;
        }
        if (existing && existing.id !== item.id && !all) {
          const text = session.overwriteText(
            move,
            typed,
            target,
            folderId,
            name,
          );
          const choice = yield* ask(text, "yna");
          if (choice === "n") continue;
          if (choice === "a") all = true;
        }
        // Every check comes before the old file goes, so a refused item
        // never destroys a file. The files and the folder can change
        // while a question is open.
        if (session.fs.getNode(item.id)?.parent !== from) {
          out.push(NOT_FOUND);
          continue;
        }
        if (
          !session.takesFiles(folderId) ||
          (move && !session.takesFiles(from))
        ) {
          out.push(PATH_NOT_FOUND);
          continue;
        }
        // A protected item shows cmd.exe's text, and the next item goes
        // on.
        if (move && session.fs.isProtected(item.id)) {
          out.push(ACCESS_DENIED);
          continue;
        }
        // Whatever file holds the name now is the one that goes, like
        // cmd.exe. A folder or a protected file that holds it stops this
        // item.
        const current = session.fs.findChild(folderId, name);
        const replaced = current && current.id !== item.id ? current : null;
        if (
          replaced &&
          (!isFile(replaced) ||
            !isFile(item) ||
            session.fs.isProtected(replaced.id))
        ) {
          out.push(ACCESS_DENIED);
          continue;
        }
        if (replaced) session.fs.destroy(replaced.id);
        const placed = move
          ? session.fs.move(item.id, folderId)
          : session.fs.copy(item.id, folderId);
        if (placed.name !== name) session.fs.rename(placed.id, name);
        count += 1;
      }
      if (!move) out.push(`        ${count} file(s) copied.`);
    }
    return this.runJob(job(), out);
  }

  // COPY of many files onto one name joins their text into one file.
  combine(source, target, typed, all) {
    const out = [];
    const session = this;
    const name = target.nameOf();
    function* job() {
      for (const item of source.items) out.push(`${source.prefix}${item.name}`);
      session.fs.validateName(name);
      const existing = session.fs.findChild(target.folderId, name);
      const joinsItself = source.items.some((item) => item.id === existing?.id);
      if (existing && !joinsItself && !all) {
        const choice = yield* ask(`Overwrite ${typed}? (Yes/No/All): `, "yna");
        if (choice === "n") {
          out.push("        0 file(s) copied.");
          return;
        }
      }
      const content = source.items
        .filter((item) => session.fs.getNode(item.id))
        .map((item) => session.fs.getContent(item.id))
        .join("");
      // The folder can go away while the question is open.
      if (!session.takesFiles(target.folderId)) {
        out.push(PATH_NOT_FOUND, "        0 file(s) copied.");
        return;
      }
      const current = session.fs.findChild(target.folderId, name);
      if (current && (!isFile(current) || session.fs.isProtected(current.id))) {
        out.push(ACCESS_DENIED, "        0 file(s) copied.");
        return;
      }
      if (current) session.fs.setContent(current.id, content);
      else
        session.context.fileOps.createFile(target.folderId, name, { content });
      out.push("        1 file(s) copied.");
    }
    return this.runJob(job(), out);
  }

  command_copy(args) {
    return this.copyOrMove(args, false);
  }

  command_move(args) {
    return this.copyOrMove(args, true);
  }

  // DEL takes * and ? and several names. It asks before it deletes every
  // file in a folder, like cmd.exe. /Q does not ask, and /P asks for each
  // file.
  command_del(args) {
    const switches = args
      .filter((value) => value.startsWith("/"))
      .map((value) => value.toLowerCase());
    const quiet = switches.includes("/q");
    const eachFile = switches.includes("/p");
    const paths = args.filter((value) => !value.startsWith("/"));
    if (!paths.length) return { output: SYNTAX_ERROR };
    const out = [];
    const session = this;
    function* job() {
      for (const path of paths) {
        const id = session.resolve(path);
        const node = id && session.fs.getNode(id);
        const split = node?.type === "folder" ? null : session.splitPath(path);
        const folderId = split ? split.folderId : id;
        const pattern = split ? split.name : "*";
        if (!folderId || !session.takesFiles(folderId)) {
          out.push(PATH_NOT_FOUND);
          continue;
        }
        const shown = session.joinPath(folderId, pattern);
        const matches = () =>
          isFile(node)
            ? [session.fs.getNode(node.id)].filter(Boolean)
            : hasWildcards(pattern)
              ? filesMatching(session.fs.getChildren(folderId), pattern)
              : [];
        const everything = !split || /^\*(?:\.\*)?$/.test(pattern);
        if (!everything && !matches().length) {
          out.push(`Could Not Find ${shown}`);
          continue;
        }
        if (everything && !quiet && !eachFile) {
          const choice = yield* ask(`${shown}, Are you sure (Y/N)? `, "yn");
          if (choice === "n") continue;
        }
        for (const file of matches()) {
          if (eachFile) {
            const choice = yield* ask(
              `${session.joinPath(file.parent, file.name)}, Delete (Y/N)? `,
              "yn",
            );
            if (
              choice === "n" ||
              session.fs.getNode(file.id)?.parent !== folderId
            )
              continue;
          }
          try {
            session.fs.destroy(file.id);
          } catch {
            out.push(session.joinPath(file.parent, file.name), ACCESS_DENIED);
          }
        }
      }
    }
    return this.runJob(job(), out);
  }

  command_erase(args) {
    return this.command_del(args);
  }

  changeDrive(drive) {
    // executeInTransaction only routes c:, d:, and f: here.
    this.cwd = { c: this.fs.DRIVE_C, d: this.fs.DRIVE_D, f: this.fs.DRIVE_F }[
      drive[0].toLowerCase()
    ];
    return { output: "" };
  }

  command_cls() {
    return { clear: true, output: "" };
  }

  command_ver() {
    return { output: `\n${VERSION}` };
  }

  command_exit() {
    this.context.close();
    return { exit: true, output: "" };
  }

  command_cd(args) {
    const values = args.filter((value) => value.toLowerCase() !== "/d");
    if (!values.length) return { output: this.displayPath() };
    const id = this.resolve(values.join(" "));
    const node = id && this.fs.getNode(id);
    if (!node || node.type !== "folder") {
      return { output: "The system cannot find the path specified." };
    }
    this.cwd = id;
    return { output: "" };
  }

  command_chdir(args) {
    return this.command_cd(args);
  }

  // REN takes * and ? in both names, like cmd.exe. A name that REN cannot
  // use leaves that file as it is, and REN goes on with the next file. A
  // new name with a path is a syntax error, because REN keeps each file in
  // its folder.
  command_ren(args) {
    if (args.length !== 2 || /[\\/:]/.test(args[1]))
      return { output: SYNTAX_ERROR };
    const [source, template] = args;
    const { folderId, name: pattern } = this.splitPath(source);
    if (folderId && !this.takesFiles(folderId))
      return { output: PATH_NOT_FOUND };
    const nodes = !folderId
      ? []
      : hasWildcards(pattern)
        ? filesMatching(this.fs.getChildren(folderId), pattern)
        : [this.fs.findChild(folderId, pattern)].filter(Boolean);
    if (!nodes.length) return { output: NOT_FOUND };
    const lines = [];
    for (const node of nodes) {
      try {
        this.context.fileOps.rename(
          node.id,
          renameByTemplate(node.name, template),
        );
      } catch (error) {
        lines.push(
          error?.code === "name-exists" || error?.code === "name-required"
            ? DUPLICATE_NAME
            : error?.code === "access-denied"
              ? ACCESS_DENIED
              : error?.code
                ? SYNTAX_ERROR
                : errorText(error),
        );
      }
    }
    return { output: lines.join("\n") };
  }

  command_rename(args) {
    return this.command_ren(args);
  }

  // The switches of DIR, like cmd.exe. One argument can hold several
  // switches, such as "/b/s". A "-" before a letter turns that switch off.
  dirOptions(args) {
    const options = {
      attributes: null,
      bare: false,
      columns: false,
      lower: false,
      order: null,
      owner: false,
      recurse: false,
      separators: true,
      short: false,
      time: "w",
      wide: false,
      pause: false,
      paths: [],
    };
    for (const arg of args) {
      if (!arg.startsWith("/")) {
        options.paths.push(arg);
        continue;
      }
      for (const part of arg.slice(1).split("/")) {
        const match = /^(-?)([a-z0-9])(?::?(.*))$/i.exec(part);
        if (!match) return { error: `Invalid switch - "${part}".` };
        const on = !match[1];
        const value = match[3];
        const letter = match[2].toLowerCase();
        // Only /A, /O and /T take a value after the letter.
        if (value && !"aot".includes(letter))
          return { error: `Invalid switch - "${part}".` };
        switch (letter) {
          case "a":
            options.attributes = value.toLowerCase();
            break;
          case "o":
            options.order = on ? value.toLowerCase() || "gn" : null;
            break;
          case "t":
            options.time = value.toLowerCase()[0] || "w";
            break;
          case "b":
            options.bare = on;
            break;
          case "c":
            options.separators = on;
            break;
          case "d":
            options.columns = on;
            break;
          case "l":
            options.lower = on;
            break;
          case "q":
            options.owner = on;
            break;
          case "s":
            options.recurse = on;
            break;
          case "w":
            options.wide = on;
            break;
          case "x":
            options.short = on;
            break;
          // /P pauses after each screen of output.
          case "p":
            options.pause = on;
            break;
          // /N and /4 are on or have no effect here: the names are always
          // on the right, and years have 4 digits.
          case "n":
          case "4":
            break;
          default:
            return { error: `Invalid switch - "${part}".` };
        }
      }
    }
    return options;
  }

  // The entries that DIR shows for one folder: "." and ".." (but not in a
  // drive root), then the items that match the pattern and the /A switch,
  // in the /O order. With no /O, the order is the NTFS order: by name, as
  // uppercase text.
  dirEntries(folderId, pattern, options) {
    const folder = this.fs.getNode(folderId);
    const entries = [];
    const atRoot = !folder.parent || folder.parent === this.fs.MY_COMPUTER;
    if (!atRoot && !options.bare) {
      entries.push({ name: ".", node: folder, folder: true });
      entries.push({
        name: "..",
        node: this.fs.getParent(folderId),
        folder: true,
      });
    }
    for (const node of this.fs.getChildren(folderId))
      entries.push({ name: node.name, node, folder: node.type === "folder" });
    const attributes = options.attributes;
    const keep = (entry) => {
      if (pattern && !matchesPattern(entry.name, pattern)) return false;
      if (attributes === null) return true;
      for (const [, not, letter] of attributes.matchAll(/(-?)([a-z])/g)) {
        // New files have the Archive attribute. No item is hidden, a
        // system file or read-only here.
        const has =
          letter === "d"
            ? entry.folder
            : letter === "a"
              ? !entry.folder
              : false;
        if (has === !!not) return false;
      }
      return true;
    };
    const kept = entries.filter(keep);
    const upper = (entry) => entry.name.toUpperCase();
    const compareText = (left, right) =>
      left < right ? -1 : left > right ? 1 : 0;
    const extension = (entry) =>
      entry.folder ? "" : this.fs.extractExtension(entry.name).toUpperCase();
    const keys = {
      n: (left, right) => compareText(upper(left), upper(right)),
      e: (left, right) => compareText(extension(left), extension(right)),
      s: (left, right) =>
        (left.folder ? 0 : sizeOf(left.node)) -
        (right.folder ? 0 : sizeOf(right.node)),
      d: (left, right) =>
        this.dirTime(left, options) - this.dirTime(right, options),
      g: (left, right) => Number(right.folder) - Number(left.folder),
    };
    const dots = kept.filter(
      (entry) => entry.name === "." || entry.name === "..",
    );
    const items = kept.filter((entry) => !dots.includes(entry)).sort(keys.n);
    if (!options.order) return [...dots, ...items];
    const order = [...options.order.matchAll(/(-?)([nesdg])/g)];
    return [...dots, ...items].sort((left, right) => {
      for (const [, reverse, letter] of order) {
        const result = keys[letter](left, right);
        if (result) return reverse ? -result : result;
      }
      return 0;
    });
  }

  dirTime(entry, options) {
    const node = entry.node;
    return options.time === "c" ? node.created : node.modified;
  }

  dirName(entry, options) {
    return options.lower ? entry.name.toLowerCase() : entry.name;
  }

  // One folder of a DIR listing, in the long, wide or bare format.
  dirSection(folderId, pattern, options) {
    const entries = this.dirEntries(folderId, pattern, options);
    const files = entries.filter((entry) => !entry.folder);
    const bytes = files.reduce((sum, entry) => sum + sizeOf(entry.node), 0);
    const lines = [];
    const user = this.userName;
    if (options.bare) {
      for (const entry of entries)
        lines.push(
          options.recurse
            ? this.joinPath(folderId, this.dirName(entry, options))
            : this.dirName(entry, options),
        );
    } else if (options.wide || options.columns) {
      // Like cmd.exe, each column is 3 characters wider than the longest
      // name, and as many columns fit as the 80 characters of the screen
      // take. /D fills the columns from top to bottom.
      const names = entries.map((entry) =>
        entry.folder
          ? `[${this.dirName(entry, options)}]`
          : this.dirName(entry, options),
      );
      const width = Math.max(0, ...names.map((name) => name.length)) + 3;
      const count = Math.max(1, Math.floor(SCREEN_WIDTH / width));
      const rows = options.columns
        ? Math.floor(names.length / count) + 1
        : Math.ceil(names.length / count);
      for (let row = 0; row < rows; row += 1) {
        const cells = [];
        for (let column = 0; column < count; column += 1) {
          const index = options.columns
            ? column * rows + row
            : row * count + column;
          if (index < names.length) cells.push(names[index].padEnd(width));
        }
        if (cells.length) lines.push(cells.join("").trimEnd());
      }
    } else {
      for (const entry of entries) {
        const size = entry.folder
          ? "<DIR>         "
          : groupDigits(sizeOf(entry.node), options.separators).padStart(14);
        const owner = options.owner
          ? `${`${COMPUTER_NAME}\\${user}`.padEnd(22)} `
          : "";
        const short = options.short
          ? `${(entry.name.startsWith(".") ? "" : shortName(entry.name) === entry.name ? "" : shortName(entry.name)).padEnd(12)} `
          : "";
        lines.push(
          `${formatDate(this.dirTime(entry, options))}    ${size} ${owner}${short}${this.dirName(entry, options)}`,
        );
      }
    }
    return {
      lines,
      files: files.length,
      folders: entries.length - files.length,
      bytes,
      empty: !entries.length,
    };
  }

  // DIR shows XP's long format by default, and takes /W, /D, /B, /A, /O,
  // /S, /L, /-C, /Q, /X and /T. A name can have * and ?.
  command_dir(args) {
    const options = this.dirOptions(args);
    if (options.error) return { output: options.error };
    const path = options.paths[0] ?? ".";
    const id = this.resolve(path);
    const node = id && this.fs.getNode(id);
    const split = node?.type === "folder" ? null : this.splitPath(path);
    const folderId = split ? split.folderId : id;
    if (!folderId) return { output: PATH_NOT_FOUND };
    const pattern = split ? split.name : null;
    const sizeText = (value) => groupDigits(value, options.separators);
    const filesLine = (files, bytes) =>
      `${String(files).padStart(16)} File(s) ${sizeText(bytes).padStart(14)} bytes`;
    const freeLine = (folders) =>
      `${String(folders).padStart(16)} Dir(s) ${sizeText(FREE_BYTES).padStart(15)} bytes free`;
    const drive = this.displayPath(this.driveRoot(folderId))[0];
    const lines = options.bare
      ? []
      : [
          ` Volume in drive ${drive} has no label.`,
          ` Volume Serial Number is ${SERIAL_NUMBERS[drive]}`,
        ];
    const total = { files: 0, folders: 0, bytes: 0, shown: 0 };
    const visit = (currentId) => {
      const section = this.dirSection(currentId, pattern, options);
      if (!section.empty) {
        total.shown += 1;
        if (!options.bare)
          lines.push("", ` Directory of ${this.displayPath(currentId)}`, "");
        lines.push(...section.lines);
        if (!options.bare && options.recurse)
          lines.push(filesLine(section.files, section.bytes));
      }
      total.files += section.files;
      total.folders += section.folders;
      total.bytes += section.bytes;
      if (!options.recurse) return;
      const children = this.dirEntries(currentId, null, {
        ...options,
        attributes: "d",
        bare: true,
        order: null,
      });
      for (const child of children) visit(child.node.id);
    };
    visit(folderId);
    if (!total.shown) {
      if (!options.bare && !options.recurse)
        lines.push("", ` Directory of ${this.displayPath(folderId)}`, "");
      lines.push("File Not Found");
      return { output: lines.join("\n"), paged: options.pause };
    }
    if (options.bare) return { output: lines.join("\n"), paged: options.pause };
    if (options.recurse)
      lines.push(
        "",
        "     Total Files Listed:",
        filesLine(total.files, total.bytes),
      );
    else lines.push(filesLine(total.files, total.bytes));
    lines.push(freeLine(total.folders));
    return { output: lines.join("\n"), paged: options.pause };
  }

  command_echo(args, line) {
    const body = line.slice(line.search(/\s|$/)).trimStart();
    if (!body) return { output: "ECHO is on." };
    const redirect = body.match(/^(.*?)(>{1,2})([^>]+)$/);
    if (!redirect) return { output: body };
    const [, text, operator, path] = redirect;
    const destination = this.resolve(tokenize(path).join(" "), {
      parent: true,
    });
    // A folder in the Recycle Bin takes no new file, and its files do not
    // change.
    if (
      !destination ||
      !this.takesFiles(destination.node?.parent ?? destination.parentId)
    )
      return { output: PATH_NOT_FOUND };
    const content = `${text.trimEnd()}\n`;
    if (destination.node) {
      if (destination.node.type !== "file")
        return { output: "Access is denied." };
      this.fs.setContent(
        destination.node.id,
        operator === ">>"
          ? `${this.fs.getContent(destination.node.id)}${content}`
          : content,
      );
    } else {
      this.context.fileOps.createFile(destination.parentId, destination.name, {
        content,
      });
    }
    return { output: "" };
  }

  command_type(args) {
    const id = this.resolve(args.join(" "));
    const node = id && this.fs.getNode(id);
    if (!node || node.type !== "file") {
      return { output: "The system cannot find the file specified." };
    }
    return { output: this.fs.getContent(node.id).replace(/\n$/, "") };
  }

  // MD names the path as typed when it exists, and makes the folders on
  // the way that do not exist yet, like cmd.exe.
  command_md(args) {
    const typed = args.join(" ");
    if (!typed) return { output: SYNTAX_ERROR };
    if (this.resolve(typed))
      return { output: `A subdirectory or file ${typed} already exists.` };
    const parts = typed.replaceAll("/", "\\").split("\\");
    for (let index = 1; index <= parts.length; index += 1) {
      if (!parts[index - 1]) continue;
      const target = this.resolve(parts.slice(0, index).join("\\"), {
        parent: true,
      });
      if (target?.node) continue;
      if (
        this.fs.getNode(target?.parentId)?.type !== "folder" ||
        !this.takesFiles(target.parentId)
      )
        return { output: PATH_NOT_FOUND };
      this.context.fileOps.createFolder(target.parentId, target.name);
    }
    return { output: "" };
  }

  command_mkdir(args) {
    return this.command_md(args);
  }

  command_rd(args) {
    const recursive = args.some((value) => value.toLowerCase() === "/s");
    const target = args.filter((value) => !value.startsWith("/"));
    const id = this.resolve(target.join(" "));
    const node = id && this.fs.getNode(id);
    if (!node || node.type !== "folder" || !this.takesFiles(node.id)) {
      return { output: "The system cannot find the path specified." };
    }
    if (node.protected) return { output: ACCESS_DENIED };
    if (this.fs.getChildren(node.id).length && !recursive) {
      return { output: "The directory is not empty." };
    }
    this.fs.destroy(node.id);
    return { output: "" };
  }

  command_rmdir(args) {
    return this.command_rd(args);
  }

  command_set(args, line) {
    const body = line.slice(line.search(/\s|$/)).trimStart();
    if (!body) {
      return {
        output: [...this.environment.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, value]) => `${name}=${value}`)
          .join("\n"),
      };
    }
    const equals = body.indexOf("=");
    if (equals < 1) {
      const name = body.toUpperCase();
      return {
        output: this.environment.has(name)
          ? `${name}=${this.environment.get(name)}`
          : `Environment variable ${body} not defined`,
      };
    }
    const name = body.slice(0, equals).trim().toUpperCase();
    const value = body.slice(equals + 1);
    if (value) this.environment.set(name, value);
    else this.environment.delete(name);
    return { output: "" };
  }

  command_title(args) {
    this.context.setTitle(args.join(" ") || DEFAULT_TITLE);
    return { output: "" };
  }

  command_start(args) {
    // The tokenizer drops empty quoted titles such as `start "" notepad`.
    const values = args;
    if (!values.length)
      return { output: "The system cannot find the file specified." };
    const pathId = this.resolve(values.join(" "));
    if (pathId && this.fs.open(pathId)) return { output: "" };
    return this.launch(values[0], values.slice(1))
      ? { output: "" }
      : { output: "The system cannot find the file specified." };
  }

  command_help() {
    return {
      output: [
        "For more information on a specific command, type HELP command-name",
        "CD       Displays the name of or changes the current directory.",
        "CLS      Clears the screen.",
        "COPY     Copies one or more files to another location.",
        "DEL      Deletes one or more files.",
        "DIR      Displays a list of files and subdirectories in a directory.",
        "ECHO     Displays messages, or turns command echoing on or off.",
        "EXIT     Quits the CMD.EXE program.",
        "MD       Creates a directory.",
        "MOVE     Moves files from one directory to another directory.",
        "RD       Removes a directory.",
        "REN      Renames a file or files.",
        "SET      Displays, sets, or removes environment variables.",
        "START    Starts a program or opens a file or folder.",
        "TITLE    Sets the window title for a CMD.EXE session.",
        "TYPE     Displays the contents of a text file.",
        "VER      Displays the Windows version.",
      ].join("\n"),
    };
  }

  launch(command, args) {
    const aliases = {
      calc: "__calculator",
      "calc.exe": "__calculator",
      command: "__command-prompt",
      explorer: "__my-computer",
      "explorer.exe": "__my-computer",
      mspaint: "__paint",
      "mspaint.exe": "__paint",
      notepad: "__notepad",
      "notepad.exe": "__notepad",
    };
    const applicationId = aliases[command.toLowerCase()];
    if (!applicationId) return false;
    let file = null;
    if (args.length) {
      const id = this.resolve(args.join(" "));
      file = id && this.fs.getNode(id);
      if (!file) return false;
    }
    return !!this.context.launchApplication(
      applicationId,
      file ? { file } : {},
    );
  }
}
