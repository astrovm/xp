// @ts-nocheck
import { beforeEach, describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { CommandSession } from "../site/apps/programs/command-session.js";

const require = createRequire(import.meta.url);

let fs;
let fileOps;
let context;
let session;
const run = (line) => session.execute(line).output;

beforeEach(() => {
  const memoryStorage = new Map();
  globalThis.localStorage = {
    getItem: (key) => (memoryStorage.has(key) ? memoryStorage.get(key) : null),
    setItem: (key, value) => memoryStorage.set(key, String(value)),
    removeItem: (key) => memoryStorage.delete(key),
  };
  const fsPath = require.resolve("../site/js/filesystem.js");
  const operationsPath = require.resolve("../site/js/file-operations.js");
  delete require.cache[fsPath];
  delete require.cache[operationsPath];
  fs = require(fsPath);
  fs.resetForTests();
  fileOps = require(operationsPath);
  fileOps.resetForTests();
  context = {
    fs,
    fileOps,
    closed: false,
    title: null,
    launched: [],
    close() {
      this.closed = true;
    },
    setTitle(title) {
      this.title = title;
    },
    launchApplication(id, options) {
      this.launched.push([id, options]);
      return true;
    },
  };
  session = new CommandSession(context);
});

describe("Command Prompt session", () => {
  test("starts in the user profile with the XP banner and prompt", () => {
    expect(session.banner).toBe(
      "Microsoft Windows XP [Version 5.1.2600]\n(C) Copyright 1985-2001 Microsoft Corp.\n",
    );
    expect(session.prompt).toBe("C:\\Documents and Settings\\Administrator>");
  });

  test("changes directories with quoted, relative, parent, and rooted paths", () => {
    expect(run('cd "My Documents"')).toBe("");
    expect(session.prompt).toBe(
      "C:\\Documents and Settings\\Administrator\\My Documents>",
    );
    expect(run("cd ..")).toBe("");
    expect(session.prompt).toBe("C:\\Documents and Settings\\Administrator>");
    expect(run("cd /d \\")).toBe("");
    expect(session.prompt).toBe("C:\\>");
    expect(run("chdir")).toBe("C:\\");
    expect(run("cd Missing")).toBe(
      "The system cannot find the path specified.",
    );
  });

  test("switches drives and rejects unknown drives", () => {
    expect(run("d:")).toBe("");
    expect(session.prompt).toBe("D:\\>");
    expect(run("F:")).toBe("");
    expect(session.prompt).toBe("F:\\>");
    expect(run("z:")).toStartWith("'z:' is not recognized");
  });

  test("writes, appends, and reads files with echo redirection and type", () => {
    run('cd "My Documents"');
    expect(run("echo first>note.txt")).toBe("");
    expect(run("echo second>>note.txt")).toBe("");
    expect(run("type note.txt")).toBe("first\nsecond");
    expect(run("echo replaced>note.txt")).toBe("");
    expect(run("type note.txt")).toBe("replaced");
    expect(run('echo text>"My Pictures"')).toBe("Access is denied.");
    expect(run('echo spaced>"two words.txt"')).toBe("");
    expect(run('type "two words.txt"')).toBe("spaced");
    expect(run("echo text>Missing\\note.txt")).toBe(
      "The system cannot find the path specified.",
    );
    expect(run("type missing.txt")).toBe(
      "The system cannot find the file specified.",
    );
    expect(run("echo")).toBe("ECHO is on.");
    expect(run("echo Hello XP")).toBe("Hello XP");
  });

  test("lists folders and files with XP dir totals", () => {
    run('cd "My Documents"');
    run("md Projects");
    run("echo 12345>data.txt");
    const listing = run("dir");
    expect(listing).toContain(
      " Directory of C:\\Documents and Settings\\Administrator\\My Documents",
    );
    expect(listing).toMatch(/<DIR>\s+\.\n/);
    expect(listing).toMatch(/<DIR>\s+\.\.\n/);
    expect(listing).toMatch(/<DIR>\s+Projects/);
    expect(listing).toMatch(/\s6 data\.txt/);
    expect(listing).toMatch(/\s+1 File\(s\)\s+6 bytes/);
    expect(run("dir data.txt")).toMatch(/\s+1 File\(s\)\s+6 bytes\n\s+0 Dir/);
    expect(run("dir missing")).toBe("File Not Found");
  });

  test("creates, renames, and removes folders", () => {
    expect(run("md Work")).toBe("");
    expect(run("mkdir Work")).toBe("A subdirectory or file already exists.");
    run("echo x>Work\\file.txt");
    expect(run("rd Work")).toBe("The directory is not empty.");
    expect(run("ren Work Archive")).toBe("");
    expect(fs.findChild(fs.USER_PROFILE, "Archive")).not.toBeNull();
    expect(run("rmdir /s Archive")).toBe("");
    expect(fs.findChild(fs.USER_PROFILE, "Archive")).toBeNull();
    expect(run("rd Missing")).toBe(
      "The system cannot find the path specified.",
    );
    expect(run("ren Only")).toBe("The syntax of the command is incorrect.");
    expect(run("ren Missing Other")).toBe(
      "The system cannot find the file specified.",
    );
  });

  test("copies, moves, and deletes files", () => {
    run('cd "My Documents"');
    run("md Target");
    run("echo copy me>a.txt");
    expect(run("copy a.txt Target")).toBe("        1 file(s) copied.");
    expect(run("type Target\\a.txt")).toBe("copy me");
    expect(run("type a.txt")).toBe("copy me");
    run("echo move me>b.txt");
    expect(run("move b.txt Target")).toBe("        1 file(s) copied.");
    expect(fs.findChild(fs.MY_DOCUMENTS, "b.txt")).toBeNull();
    expect(run("type Target\\b.txt")).toBe("move me");
    expect(run("copy a.txt Missing")).toBe(
      "The system cannot find the path specified.",
    );
    expect(run("copy a.txt")).toBe("The syntax of the command is incorrect.");
    expect(run("del /q a.txt")).toBe("");
    expect(fs.findChild(fs.MY_DOCUMENTS, "a.txt")).toBeNull();
    expect(run("erase Target")).toBe("Could Not Find the file specified.");
  });

  test("sets, expands, lists, and clears environment variables", () => {
    expect(run("set username")).toBe("USERNAME=Administrator");
    expect(run("set GREETING=hello")).toBe("");
    expect(run("echo %greeting% %UNKNOWN%")).toBe("hello %UNKNOWN%");
    expect(run("set")).toContain("GREETING=hello\nHOMEDRIVE=C:");
    expect(run("set GREETING=")).toBe("");
    expect(run("set GREETING")).toBe(
      "Environment variable GREETING not defined",
    );
  });

  test("launches applications and opens files through start and aliases", () => {
    run('cd "My Documents"');
    run("echo text>note.txt");
    expect(run("notepad note.txt")).toBe("");
    expect(context.launched.at(-1)[0]).toBe("__notepad");
    expect(context.launched.at(-1)[1].file.name).toBe("note.txt");
    expect(run("CALC.EXE")).toBe("");
    expect(context.launched.at(-1)).toEqual(["__calculator", {}]);
    expect(run('start "" mspaint')).toBe("");
    expect(context.launched.at(-1)).toEqual(["__paint", {}]);
    expect(run("notepad missing.txt")).toStartWith(
      "'notepad' is not recognized",
    );
    expect(run("start")).toBe("The system cannot find the file specified.");
    expect(run("start nothing")).toBe(
      "The system cannot find the file specified.",
    );
  });

  test("handles title, cls, ver, help, exit, and unknown commands", () => {
    expect(run("title Build Window")).toBe("");
    expect(context.title).toBe("Build Window");
    expect(run("title")).toBe("");
    expect(context.title).toBe("C:\\WINDOWS\\system32\\cmd.exe");
    run("title Other");
    expect(run('title ""')).toBe("");
    expect(context.title).toBe("C:\\WINDOWS\\system32\\cmd.exe");
    expect(session.execute("cls")).toEqual({ clear: true, output: "" });
    expect(run("ver")).toBe("\nMicrosoft Windows XP [Version 5.1.2600]");
    expect(run("help")).toContain("TYPE     Displays the contents");
    expect(run("   ")).toBe("");
    expect(run("frobnicate")).toBe(
      "'frobnicate' is not recognized as an internal or external command,\noperable program or batch file.",
    );
    expect(session.execute("exit")).toEqual({ exit: true, output: "" });
    expect(context.closed).toBeTrue();
  });

  test("reports filesystem errors without the internal module prefix", () => {
    run("md Work");
    expect(run("ren Work CON")).toBe('"CON" is a reserved device name');
    expect(fs.findChild(session.cwd, "Work")).toBeTruthy();
  });

  test("navigates drive-qualified, dotted, and above-root paths", () => {
    run("cd c:\\Documents and Settings");
    expect(session.prompt).toBe("C:\\Documents and Settings>");
    run("cd .\\astro");
    expect(session.prompt).toBe("C:\\Documents and Settings\\Administrator>");
    run("c:");
    run("cd ..");
    expect(session.cwd).toBe(fs.DRIVE_C);
    expect(session.prompt).toBe("C:\\>");
  });

  test("falls back to the C: drive when the current folder disappears", () => {
    const folder = fs.createFolder(fs.MY_DOCUMENTS, "Temporary");
    run(`cd "${fs.getPath(folder.id)}"`);
    fs.destroy(folder.id);
    expect(session.prompt).toBe("C:\\>");
    run("cd \\");
    expect(session.cwd).toBe(fs.DRIVE_C);
  });

  test("lists drive roots and formats morning, afternoon, and unknown sizes", () => {
    const morning = fs.createFile(fs.DRIVE_C, "morning.txt");
    const afternoon = fs.createFile(fs.DRIVE_C, "afternoon.txt");
    fs.getNode(morning.id).modified = new Date(2026, 0, 2, 0, 5).getTime();
    fs.getNode(afternoon.id).modified = new Date(2026, 0, 2, 13, 5).getTime();
    fs.getNode(afternoon.id).size = undefined;
    const listing = run("dir c:\\");
    expect(listing).toContain("12:05 AM");
    expect(listing).toContain("01:05 PM");
    expect(listing).not.toContain("<DIR>          ..");
    expect(listing).toMatch(/\s0 afternoon\.txt/);
  });

  test("renames with the long command name and reports non-error failures", () => {
    fs.createFile(session.cwd, "old.txt");
    expect(run("rename old.txt new.txt")).toBe("");
    expect(fs.findChild(session.cwd, "new.txt")).toBeTruthy();
    context.fileOps = {
      rename() {
        throw "rename refused";
      },
    };
    expect(run("ren new.txt other.txt")).toBe("rename refused");
  });

  test("ren refuses the name of another file with XP's message", () => {
    fs.createFile(session.cwd, "first.txt");
    fs.createFile(session.cwd, "second.txt");
    expect(run("ren first.txt second.txt")).toBe(
      "A duplicate file name exists, or the file cannot be found.",
    );
    expect(fs.findChild(session.cwd, "first.txt")).toBeTruthy();
  });

  test("start opens folders and files through their registered handlers", () => {
    const opened = [];
    fs.registerFolderHandler((node) => opened.push(node.name));
    fs.registerFileType(".txt", (node) => opened.push(node.name));
    fs.createFolder(session.cwd, "Projects");
    fs.createFile(session.cwd, "readme.txt");
    expect(run("start Projects")).toBe("");
    expect(run("start readme.txt")).toBe("");
    expect(opened).toEqual(["Projects", "readme.txt"]);
    expect(context.launched).toEqual([]);
  });

  test("start reports folders that nothing can open", () => {
    fs.createFolder(session.cwd, "Folder");
    context.launchApplication = () => false;
    expect(run("start Folder")).toBe(
      "The system cannot find the file specified.",
    );
  });
});
