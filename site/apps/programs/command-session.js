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

const displaySize = (size) => Number(size || 0).toLocaleString("en-US");

const errorText = (error) =>
  error instanceof Error
    ? error.message.replace(/^(?:VirtualFS|FileOperations):\s*/, "")
    : String(error);

export class CommandSession {
  constructor(context) {
    this.context = context;
    this.fs = context.fs;
    this.cwd = this.fs.USER_PROFILE;
    this.environment = new Map([
      ["COMSPEC", DEFAULT_TITLE],
      ["HOMEDRIVE", "C:"],
      ["HOMEPATH", "\\Documents and Settings\\Administrator"],
      ["OS", "Windows_NT"],
      ["PATH", "C:\\WINDOWS\\system32;C:\\WINDOWS"],
      ["PATHEXT", ".COM;.EXE;.BAT;.CMD"],
      ["PROMPT", "$P$G"],
      ["SYSTEMDRIVE", "C:"],
      ["SYSTEMROOT", "C:\\WINDOWS"],
      ["TEMP", "C:\\DOCUME~1\\ADMINI~1\\LOCALS~1\\Temp"],
      ["TMP", "C:\\DOCUME~1\\ADMINI~1\\LOCALS~1\\Temp"],
      ["USERNAME", "Administrator"],
      ["USERPROFILE", "C:\\Documents and Settings\\Administrator"],
      ["WINDIR", "C:\\WINDOWS"],
    ]);
  }

  get banner() {
    return `${VERSION}\n${COPYRIGHT}\n`;
  }

  displayPath(id = this.cwd) {
    const path = this.fs.getPath(id) || "C:\\";
    if (id === this.fs.USER_PROFILE) {
      return "C:\\Documents and Settings\\Administrator";
    }
    const profilePath = this.fs.getPath(this.fs.USER_PROFILE);
    return profilePath && path.startsWith(profilePath)
      ? `C:\\Documents and Settings\\Administrator${path.slice(profilePath.length)}`
      : path;
  }

  get prompt() {
    return `${this.displayPath()}>`;
  }

  resolve(path, options = {}) {
    let value = path.trim();
    if (!value || value === ".") return this.cwd;
    value = value.replaceAll("/", "\\");
    const driveMatch = value.match(/^([cdf]):(?:\\|$)/i);
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
    const line = this.expandEnvironment(rawLine).trim();
    if (!line) return { output: "" };
    const tokens = tokenize(line);
    const command = tokens.shift().toLowerCase();
    try {
      if (/^[cdf]:$/i.test(command)) return this.changeDrive(command);
      const method = this[`command_${command}`];
      if (method) return method.call(this, tokens, line);
      if (this.launch(command, tokens)) return { output: "" };
      return {
        output: `'${command}' is not recognized as an internal or external command,\noperable program or batch file.`,
      };
    } catch (error) {
      return { output: errorText(error) };
    }
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

  command_dir(args) {
    const target = args.find((value) => !value.startsWith("/")) || ".";
    const id = this.resolve(target);
    const node = id && this.fs.getNode(id);
    if (!node) return { output: "File Not Found" };
    const folder = node.type === "folder" ? node : this.fs.getParent(node.id);
    const children =
      node.type === "folder" ? this.fs.getChildren(node.id) : [node];
    const lines = [
      " Volume in drive C has no label.",
      " Volume Serial Number is B836-2A76",
      "",
      ` Directory of ${this.displayPath(folder.id)}`,
      "",
    ];
    if (node.type === "folder") {
      lines.push(`${formatDate(folder.modified)}    <DIR>          .`);
      if (folder.parent && folder.parent !== this.fs.MY_COMPUTER) {
        lines.push(`${formatDate(folder.modified)}    <DIR>          ..`);
      }
    }
    let fileCount = 0;
    let directoryCount = 0;
    let totalSize = 0;
    for (const child of children) {
      if (child.type === "folder") {
        directoryCount += 1;
        lines.push(
          `${formatDate(child.modified)}    <DIR>          ${child.name}`,
        );
      } else {
        fileCount += 1;
        totalSize += child.size || 0;
        lines.push(
          `${formatDate(child.modified)}    ${displaySize(child.size).padStart(14)} ${child.name}`,
        );
      }
    }
    lines.push(
      `${String(fileCount).padStart(15)} File(s) ${displaySize(totalSize).padStart(14)} bytes`,
      `${String(directoryCount + (node.type === "folder" ? (folder.parent === this.fs.MY_COMPUTER ? 1 : 2) : 0)).padStart(15)} Dir(s)  5,952,212,992 bytes free`,
    );
    return { output: lines.join("\n") };
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
    if (!destination)
      return { output: "The system cannot find the path specified." };
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

  command_md(args) {
    const target = this.resolve(args.join(" "), { parent: true });
    if (!target || target.node) {
      return { output: "A subdirectory or file already exists." };
    }
    this.context.fileOps.createFolder(target.parentId, target.name);
    return { output: "" };
  }

  command_mkdir(args) {
    return this.command_md(args);
  }

  command_del(args) {
    const target = args.filter((value) => !value.startsWith("/"));
    const id = this.resolve(target.join(" "));
    const node = id && this.fs.getNode(id);
    if (!node || node.type !== "file")
      return { output: "Could Not Find the file specified." };
    this.fs.destroy(node.id);
    return { output: "" };
  }

  command_erase(args) {
    return this.command_del(args);
  }

  command_rd(args) {
    const recursive = args.some((value) => value.toLowerCase() === "/s");
    const target = args.filter((value) => !value.startsWith("/"));
    const id = this.resolve(target.join(" "));
    const node = id && this.fs.getNode(id);
    if (!node || node.type !== "folder") {
      return { output: "The system cannot find the path specified." };
    }
    if (this.fs.getChildren(node.id).length && !recursive) {
      return { output: "The directory is not empty." };
    }
    this.fs.destroy(node.id);
    return { output: "" };
  }

  command_rmdir(args) {
    return this.command_rd(args);
  }

  command_ren(args) {
    if (args.length < 2)
      return { output: "The syntax of the command is incorrect." };
    const id = this.resolve(args[0]);
    if (!id) return { output: "The system cannot find the file specified." };
    try {
      this.context.fileOps.rename(id, args.slice(1).join(" "));
    } catch (error) {
      if (error.code !== "name-exists") throw error;
      return {
        output: "A duplicate file name exists, or the file cannot be found.",
      };
    }
    return { output: "" };
  }

  command_rename(args) {
    return this.command_ren(args);
  }

  copyOrMove(args, move) {
    if (args.length < 2)
      return { output: "The syntax of the command is incorrect." };
    const sourceId = this.resolve(args[0]);
    const destinationId = this.resolve(args.slice(1).join(" "));
    const source = sourceId && this.fs.getNode(sourceId);
    const destination = destinationId && this.fs.getNode(destinationId);
    if (!source || !destination || destination.type !== "folder") {
      return { output: "The system cannot find the path specified." };
    }
    if (move) this.fs.move(source.id, destination.id);
    else this.fs.copy(source.id, destination.id);
    return { output: "        1 file(s) copied." };
  }

  command_copy(args) {
    return this.copyOrMove(args, false);
  }

  command_move(args) {
    return this.copyOrMove(args, true);
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
