// @ts-nocheck
import { beforeEach, describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import {
  CommandSession,
  cmdArguments,
  matchesPattern,
} from "../site/apps/programs/command-session.js";

const require = createRequire(import.meta.url);

let fs;
let fileOps;
let context;
let session;
const run = (line) => session.execute(line).output;
// Another tab does not know which folders the sessions of this tab are in,
// so it can delete the current folder.
const inOtherTab = (action) => {
  fs.releaseFolder(session);
  fs.releaseFolder(session.jobFolder);
  action();
};

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
    // The shell opens an item with its program, like START.
    openItem: (id) => fs.open(id),
    // The shell runs a program that XP has, like Run does.
    ran: [],
    runProgram(name, args, base) {
      if (!["calc.exe", "mspaint", "notepad"].includes(name.toLowerCase()))
        return false;
      this.ran.push([name, args, base]);
      return true;
    },
  };
  session = new CommandSession(context);
});

describe("Command Prompt session", () => {
  // Like XP, /C and /K lose the first quote and the last quote.
  test("cmd takes its /C and /K command like XP", () => {
    expect(cmdArguments('/c "echo hi"')).toEqual({
      command: "echo hi",
      close: true,
    });
    expect(cmdArguments('/K "dir" /b')).toEqual({
      command: "dir /b",
      close: false,
    });
    expect(cmdArguments('/c "echo hi')).toEqual({
      command: "echo hi",
      close: true,
    });
    expect(cmdArguments("/cdir")).toEqual({ command: "dir", close: true });
    expect(cmdArguments("")).toEqual({ command: undefined, close: false });
  });

  test("starts in the user profile with the XP banner and prompt", () => {
    expect(session.banner).toBe(
      "Microsoft Windows XP [Version 5.1.2600]\n(C) Copyright 1985-2001 Microsoft Corp.\n",
    );
    expect(session.prompt).toBe("C:\\Documents and Settings\\astro>");
  });

  test("changes directories with quoted, relative, parent, and rooted paths", () => {
    expect(run('cd "My Documents"')).toBe("");
    expect(session.prompt).toBe(
      "C:\\Documents and Settings\\astro\\My Documents>",
    );
    expect(run("cd ..")).toBe("");
    expect(session.prompt).toBe("C:\\Documents and Settings\\astro>");
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
      " Directory of C:\\Documents and Settings\\astro\\My Documents",
    );
    expect(listing).toMatch(/<DIR>\s+\.\n/);
    expect(listing).toMatch(/<DIR>\s+\.\.\n/);
    expect(listing).toMatch(/<DIR>\s+Projects/);
    expect(listing).toMatch(/\s6 data\.txt/);
    expect(listing).toMatch(/\s+1 File\(s\)\s+6 bytes/);
    expect(run("dir data.txt")).toMatch(/\s+1 File\(s\)\s+6 bytes\n\s+0 Dir/);
    expect(run("dir missing")).toBe(
      " Volume in drive C has no label.\n Volume Serial Number is B836-2A76\n\n Directory of C:\\Documents and Settings\\astro\\My Documents\n\nFile Not Found",
    );
  });

  test("creates, renames, and removes folders", () => {
    expect(run("md Work")).toBe("");
    expect(run("mkdir Work")).toBe(
      "A subdirectory or file Work already exists.",
    );
    expect(run("md")).toBe("The syntax of the command is incorrect.");
    expect(run("md New\\Inner\\Deep")).toBe("");
    expect(run("cd New\\Inner\\Deep")).toBe("");
    run("cd \\");
    run("echo x>C:\\plain.txt");
    expect(run("md C:\\plain.txt\\x")).toBe(
      "The system cannot find the path specified.",
    );
    expect(run("md Q:\\x")).toBe("The system cannot find the path specified.");
    run('cd "%USERPROFILE%"');
    run("echo x>Work\\file.txt");
    expect(run("rd Work")).toBe("The directory is not empty.");
    expect(run("ren Work Archive")).toBe("");
    expect(fs.findChild(fs.USER_PROFILE, "Archive")).not.toBeNull();
    // RD /S asks first, with the path as it is typed, like cmd.exe.
    expect(run("rmdir /s Archive")).toBe("");
    expect(session.prompt).toBe("Archive, Are you sure (Y/N)? ");
    expect(run("n")).toBe("");
    expect(fs.findChild(fs.USER_PROFILE, "Archive")).not.toBeNull();
    expect(run("rmdir /s Archive")).toBe("");
    expect(run("y")).toBe("");
    expect(fs.findChild(fs.USER_PROFILE, "Archive")).toBeNull();
    // /Q does not ask.
    run("md Quiet\\Inner");
    expect(run("rd /S /Q Quiet")).toBe("");
    expect(fs.findChild(fs.USER_PROFILE, "Quiet")).toBeNull();
    // RD with no /S removes an empty folder and asks nothing.
    run("md Empty");
    expect(run("rd Empty")).toBe("");
    expect(fs.findChild(fs.USER_PROFILE, "Empty")).toBeNull();
    expect(run("rd")).toBe("The syntax of the command is incorrect.");
    expect(run("rd /s")).toBe("The syntax of the command is incorrect.");
    // A folder that goes to the Recycle Bin while the question is open is
    // gone. In the XP VM, a folder that moves then gets this text.
    const binned = fs.createFolder(fs.USER_PROFILE, "Binned");
    expect(run("rd /s Binned")).toBe("");
    fs.remove(binned.id);
    expect(run("y")).toBe("The system cannot find the file specified.");
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
    // Like cmd.exe, MOVE of one file prints nothing.
    expect(run("move b.txt Target")).toBe("");
    expect(fs.findChild(fs.MY_DOCUMENTS, "b.txt")).toBeNull();
    expect(run("type Target\\b.txt")).toBe("move me");
    // A target that does not exist is the name of the copy.
    expect(run("copy a.txt Missing")).toBe("        1 file(s) copied.");
    expect(run("type Missing")).toBe("copy me");
    expect(run("copy a.txt Nowhere\\b.txt")).toBe(
      "The system cannot find the path specified.",
    );
    expect(run("copy a.txt")).toBe(
      "The file cannot be copied onto itself.\n        0 file(s) copied.",
    );
    expect(run("move a.txt")).toBe("The syntax of the command is incorrect.");
    expect(run("del /q a.txt")).toBe("");
    expect(fs.findChild(fs.MY_DOCUMENTS, "a.txt")).toBeNull();
    expect(run("erase Missing.txt")).toBe(
      "Could Not Find C:\\Documents and Settings\\astro\\My Documents\\Missing.txt",
    );
  });

  test("sets, expands, lists, and clears environment variables", () => {
    expect(run("set username")).toBe("USERNAME=astro");
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
    const here = "C:\\Documents and Settings\\astro\\My Documents";
    // A program gets the text after its name as it is typed, and the
    // current folder, like XP.
    expect(run('notepad "a b.txt"  x')).toBe("");
    expect(context.ran.at(-1)).toEqual(["notepad", '"a b.txt"  x', here]);
    expect(run('"notepad" /select,"C:\\a b\\c.txt"')).toBe("");
    expect(context.ran.at(-1)).toEqual([
      "notepad",
      '/select,"C:\\a b\\c.txt"',
      here,
    ]);
    expect(run("CALC.EXE")).toBe("");
    expect(context.ran.at(-1)).toEqual(["calc.exe", "", here]);
    expect(run('start "" mspaint')).toBe("");
    expect(context.ran.at(-1)).toEqual(["mspaint", "", here]);
    // START /D gives the program its folder, like XP.
    fs.createFolder(fs.DRIVE_C, "x y");
    expect(run('start /min /d "C:\\x y" mspaint a.bmp')).toBe("");
    expect(context.ran.at(-1)).toEqual(["mspaint", "a.bmp", "C:\\x y"]);
    // cmd runs a new cmd in this window: the window starts it. START opens
    // a new Command Prompt window.
    expect(session.execute("cmd")).toEqual({
      output: "",
      shell: { command: undefined, close: false },
    });
    expect(session.execute('command.com /c "dir"')).toEqual({
      output: "",
      shell: { command: "dir", close: true },
    });
    expect(context.launched).toEqual([]);
    expect(run("start cmd /k dir")).toBe("");
    expect(run('start "Build" dir /w')).toBe("");
    expect(run("start")).toBe("");
    const folder = session.cwd;
    expect(context.launched).toEqual(
      [
        ["/k dir", undefined],
        ["/K dir /w", "Build"],
        ["", undefined],
      ].map(([text, title]) => [
        "__command-prompt",
        { arguments: text, from: session, folder, fresh: false, title },
      ]),
    );
    expect(run("winword note.txt")).toStartWith("'winword' is not recognized");
    expect(run("start nothing")).toBe(
      "The system cannot find the file specified.",
    );
    context.launchApplication = () => false;
    expect(run("start")).toBe("The system cannot find the file specified.");
    expect(run("start echo")).toBe(
      "The system cannot find the file specified.",
    );
  });

  test("handles title, cls, ver, help, exit, and unknown commands", () => {
    // The window shows the title of its cmd.
    expect(run("title Build Window")).toBe("");
    expect(session.title).toBe("Build Window");
    expect(run("title")).toBe("");
    expect(session.title).toBe("C:\\WINDOWS\\system32\\cmd.exe");
    run("title Other");
    expect(run('title ""')).toBe("");
    expect(session.title).toBe("C:\\WINDOWS\\system32\\cmd.exe");
    expect(session.execute("cls")).toEqual({ clear: true, output: "" });
    expect(run("ver")).toBe("\nMicrosoft Windows XP [Version 5.1.2600]");
    expect(run("help")).toContain("TYPE     Displays the contents");
    expect(run("   ")).toBe("");
    expect(run("frobnicate")).toBe(
      "'frobnicate' is not recognized as an internal or external command,\noperable program or batch file.",
    );
    // The window ends the session: EXIT only says so.
    expect(session.execute("exit")).toEqual({ exit: true, output: "" });
    expect(context.closed).toBeFalse();
  });

  test("reports refused names with the texts of cmd.exe", () => {
    run("md Work");
    expect(run("ren Work CON")).toBe("The syntax of the command is incorrect.");
    expect(run("md CON")).toBe(
      "The filename, directory name, or volume label syntax is incorrect.",
    );
    expect(fs.findChild(session.cwd, "Work")).toBeTruthy();
  });

  test("navigates drive-qualified, dotted, and above-root paths", () => {
    run("cd c:\\Documents and Settings");
    expect(session.prompt).toBe("C:\\Documents and Settings>");
    run("cd .\\astro");
    expect(session.prompt).toBe("C:\\Documents and Settings\\astro>");
    run("c:");
    run("cd ..");
    expect(session.cwd).toBe(fs.DRIVE_C);
    expect(session.prompt).toBe("C:\\>");
  });

  test("falls back to the C: drive when the current folder disappears", () => {
    const folder = fs.createFolder(fs.MY_DOCUMENTS, "Temporary");
    run(`cd "${fs.getPath(folder.id)}"`);
    inOtherTab(() => fs.destroy(folder.id));
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
    expect(run("dir /-c c:\\")).toMatch(/\s0 afternoon\.txt/);
    // In size order, a file with no size counts as 0.
    expect(run("dir /b /os /a-d c:\\")).toBe("afternoon.txt\nmorning.txt");
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

  test("copy into the same folder copies nothing, like cmd.exe", () => {
    const file = fs.createFile(session.cwd, "a.txt", { content: "a" });
    expect(run("copy a.txt .")).toBe(
      "The file cannot be copied onto itself.\n        0 file(s) copied.",
    );
    expect(
      fs.getChildren(session.cwd).filter((node) => node.name.endsWith("a.txt")),
    ).toEqual([fs.getNode(file.id)]);
    // A move into its own folder leaves the file where it is.
    expect(run("move a.txt .")).toBe("");
    expect(fs.getNode(file.id).parent).toBe(session.cwd);
  });

  test("copy and move ask before they replace a file, and take Yes, No and All", () => {
    const prompt = session.prompt;
    const target = fs.createFolder(session.cwd, "Target");
    fs.createFile(session.cwd, "a.txt", { content: "new" });
    const old = fs.createFile(target.id, "a.txt", { content: "old" });
    // COPY shows the target as typed, like cmd.exe.
    const question = "Overwrite Target\\a.txt? (Yes/No/All): ";
    expect(run("copy a.txt Target")).toBe("");
    expect(session.prompt).toBe(question);
    // Any other answer asks again.
    expect(run("maybe")).toBe("");
    expect(run("")).toBe("");
    expect(session.prompt).toBe(question);
    expect(run("n")).toBe("        0 file(s) copied.");
    expect(session.prompt).toBe(prompt);
    expect(fs.getNode(old.id).content).toBe("old");

    expect(run("copy a.txt Target")).toBe("");
    expect(run("Yes")).toBe("        1 file(s) copied.");
    expect(fs.getNode(old.id)).toBeNull();
    expect(run("type Target\\a.txt")).toBe("new");
    expect(run("type a.txt")).toBe("new");

    const moved = fs.findChild(session.cwd, "a.txt");
    fs.setContent(fs.findChild(target.id, "a.txt").id, "older");
    // MOVE shows the full path.
    expect(run("move a.txt Target")).toBe("");
    expect(session.prompt).toBe(
      "Overwrite C:\\Documents and Settings\\astro\\Target\\a.txt? (Yes/No/All): ",
    );
    expect(run("a")).toBe("");
    expect(fs.getNode(moved.id).parent).toBe(target.id);
    expect(fs.getChildren(target.id).map((node) => node.name)).toEqual([
      "a.txt",
    ]);
    expect(fs.findChild(session.cwd, "a.txt")).toBeNull();
  });

  test("an overwrite question sees changes made while it is open", () => {
    const target = fs.createFolder(session.cwd, "Target");
    const source = fs.createFile(session.cwd, "a.txt", { content: "new" });
    const old = fs.createFile(target.id, "a.txt", { content: "old" });
    expect(run("copy a.txt Target")).toBe("");
    fs.remove(source.id);
    expect(run("y")).toBe(
      "The system cannot find the file specified.\n        0 file(s) copied.",
    );
    expect(fs.getNode(old.id).content).toBe("old");

    const again = fs.createFile(session.cwd, "a.txt", { content: "new" });
    expect(run("copy a.txt Target")).toBe("");
    // The file it would replace has a new name now, so it stays.
    fs.rename(old.id, "kept.txt");
    expect(run("y")).toBe("        1 file(s) copied.");
    expect(fs.getNode(old.id).content).toBe("old");
    expect(fs.findChild(target.id, "a.txt").content).toBe("new");
    expect(fs.getNode(again.id).parent).toBe(session.cwd);
  });

  test("copy and move refuse a folder and a file with the same name", () => {
    fs.createFolder(session.cwd, "Target");
    const inside = fs.createFolder(
      fs.findChild(session.cwd, "Target").id,
      "item",
    );
    fs.createFile(session.cwd, "item");
    const folder = fs.createFolder(session.cwd, "Box");
    fs.createFolder(inside.parent, "Box");
    expect(run("copy item Target")).toBe(
      "Access is denied.\n        0 file(s) copied.",
    );
    expect(run("move Box Target")).toBe("Access is denied.");
    expect(fs.getNode(folder.id).parent).toBe(session.cwd);
    expect(session.prompt).toEndWith(">");
  });

  test("ren takes * and ? like cmd.exe", () => {
    run("md Work");
    run("cd Work");
    const folder = fs.createFolder(session.cwd, "Notes");
    for (const name of ["one.txt", "two.txt", "three.log", "abcdef.txt"])
      fs.createFile(session.cwd, name);
    fs.createFolder(session.cwd, "dir.txt");
    fs.createFile(folder.id, "deep.txt");
    expect(run("ren *.txt *.bak")).toBe("");
    expect(
      fs
        .getChildren(session.cwd)
        .map((node) => node.name)
        .sort(),
    ).toEqual([
      "Notes",
      "abcdef.bak",
      "dir.txt",
      "one.bak",
      "three.log",
      "two.bak",
    ]);
    // Wildcards match files only, and only in the folder that is named.
    expect(fs.findChild(folder.id, "deep.txt")).toBeTruthy();
    expect(run("ren ???def.bak ???.x")).toBe("");
    expect(fs.findChild(session.cwd, "abc.x")).toBeTruthy();
    expect(run("ren t*.* *.old")).toBe("");
    expect(fs.findChild(session.cwd, "two.old")).toBeTruthy();
    expect(fs.findChild(session.cwd, "three.old")).toBeTruthy();
    expect(run("ren Notes\\*.txt new*.md")).toBe("");
    expect(fs.getChildren(folder.id).map((node) => node.name)).toEqual([
      "newp.md",
    ]);
    expect(run("ren o?e.bak ?ne.")).toBe("");
    expect(fs.findChild(session.cwd, "one")).toBeTruthy();
    // "*" with no period to stop at, and a "*" at the end, take the rest.
    expect(run("ren one *.txt")).toBe("");
    expect(run("ren one.txt x*")).toBe("");
    expect(fs.findChild(session.cwd, "xne.txt")).toBeTruthy();
    // "?" never copies a period, nor more than the name has.
    expect(run("ren abc.x ????.??y")).toBe("");
    expect(fs.findChild(session.cwd, "abc.xy")).toBeTruthy();
    expect(run("ren \\*.nothing *.x")).toBe(
      "The system cannot find the file specified.",
    );
    expect(run("ren Missing\\*.txt *.x")).toBe(
      "The system cannot find the file specified.",
    );
  });

  test("ren goes on after a name in use, and reports it", () => {
    run("md Work");
    run("cd Work");
    for (const name of ["a.txt", "b.txt", "c.txt", "b.bak"])
      fs.createFile(session.cwd, name);
    expect(run("ren *.txt *.bak")).toBe(
      "A duplicate file name exists, or the file\ncannot be found.",
    );
    expect(
      fs
        .getChildren(session.cwd)
        .map((node) => node.name)
        .sort(),
    ).toEqual(["a.bak", "b.bak", "b.txt", "c.bak"]);
  });

  test("ren refuses the name of another file with XP's message", () => {
    fs.createFile(session.cwd, "first.txt");
    fs.createFile(session.cwd, "second.txt");
    expect(run("ren first.txt second.txt")).toBe(
      "A duplicate file name exists, or the file\ncannot be found.",
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

// The texts below come from cmd.exe in an XP SP3 virtual machine.
describe("Command Prompt like cmd.exe", () => {
  const XP_TIME = new Date(2026, 10, 14, 1, 25).getTime();
  const folderAt = (path) => {
    let id = fs.DRIVE_C;
    for (const name of path.split("\\")) {
      id = (fs.findChild(id, name) || fs.createFolder(id, name)).id;
    }
    return id;
  };
  const file = (folderId, name, size = 1, content = "a\n") => {
    const node = fs.createFile(folderId, name, { content });
    fs.getNode(node.id).size = size;
    return node;
  };
  const stamp = (id) => {
    fs.getNode(id).modified = XP_TIME;
    for (const child of fs.getChildren(id)) stamp(child.id);
  };
  // The folder of the dir screenshots: C:\t\w.
  const dirFixture = () => {
    const t = folderAt("t");
    const w = folderAt("t\\w");
    file(w, "A very long file name.text", 3);
    file(w, "a.txt", 7);
    file(w, "big.bin", 1234567);
    fs.createFolder(w, "Folder2");
    file(w, "Medium.doc", 5);
    file(fs.createFolder(w, "sub").id, "in.txt", 3);
    stamp(t);
    run("cd /d C:\\t\\w");
    return w;
  };
  const header = (path) =>
    ` Volume in drive C has no label.\n Volume Serial Number is B836-2A76\n\n Directory of ${path}\n\n`;
  const totals =
    "               4 File(s)      1,234,582 bytes\n               4 Dir(s)   5,952,212,992 bytes free";
  const line = (size, name) =>
    `11/14/2026  01:25 AM    ${size === null ? "<DIR>         " : size.padStart(14)} ${name}`;

  test("copy onto itself copies nothing, copy to a new name copies, and move to a new name renames", () => {
    run("cd /d C:\\");
    const a = file(fs.DRIVE_C, "a.txt", 2, "x\n");
    expect(run("copy a.txt a.txt")).toBe(
      "The file cannot be copied onto itself.\n        0 file(s) copied.",
    );
    expect(run("copy a.txt b.txt")).toBe("        1 file(s) copied.");
    expect(run("type b.txt")).toBe("x");
    expect(run("move a.txt c.txt")).toBe("");
    expect(fs.getNode(a.id).name).toBe("c.txt");
    expect(fs.getNode(a.id).parent).toBe(fs.DRIVE_C);
    expect(run("copy nothere.txt x.txt")).toBe(
      "The system cannot find the file specified.",
    );
    expect(run("move nothere.txt x.txt")).toBe(
      "The system cannot find the file specified.",
    );
  });

  test("an error after an overwrite answer shows as a message", () => {
    run("cd /d C:\\");
    const target = fs.createFolder(fs.DRIVE_C, "Target");
    file(fs.DRIVE_C, "a.txt");
    file(target.id, "a.txt");
    expect(run("copy a.txt Target")).toBe("");
    fs.copy = () => {
      throw new Error("The disk is full.");
    };
    expect(run("y")).toBe("The disk is full.");
    expect(session.prompt).toBe("C:\\>");
  });

  test("an overwrite answer replaces the file that has the name now", () => {
    run("cd /d C:\\");
    const target = fs.createFolder(fs.DRIVE_C, "Target");
    file(fs.DRIVE_C, "a.txt", 4, "new\n");
    const old = file(target.id, "a.txt", 4, "old\n");
    expect(run("copy a.txt Target")).toBe("");
    fs.rename(old.id, "kept.txt");
    const other = file(target.id, "a.txt", 6, "other\n");
    expect(run("y")).toBe("        1 file(s) copied.");
    expect(fs.getNode(other.id)).toBeNull();
    expect(fs.getNode(old.id).content).toBe("old\n");
    expect(run("type Target\\a.txt")).toBe("new");
    expect(fs.getChildren(target.id).map((node) => node.name)).toEqual([
      "kept.txt",
      "a.txt",
    ]);
  });

  test("copy takes a folder as its source, and asks before it overwrites", () => {
    run("cd /d C:\\");
    const src = fs.createFolder(fs.DRIVE_C, "Src");
    file(src.id, "x.txt");
    file(src.id, "y.txt");
    const dst = fs.createFolder(fs.DRIVE_C, "Dst");
    // A folder names its files.
    expect(run("copy Src Dst")).toBe(
      "Src\\x.txt\nSrc\\y.txt\n        2 file(s) copied.",
    );
    // The question shows the target as typed, like cmd.exe.
    file(fs.DRIVE_C, "a.txt");
    file(fs.DRIVE_C, "b.txt");
    file(dst.id, "a.txt");
    for (const [line, shown] of [
      ["copy a.txt b.txt", "b.txt"],
      ["copy a.txt Dst\\", "Dst\\a.txt"],
      ["copy a.txt Dst", "Dst\\a.txt"],
      ["copy Dst\\a.txt", "a.txt"],
    ]) {
      expect(run(line)).toBe("");
      expect(session.prompt).toBe(`Overwrite ${shown}? (Yes/No/All): `);
      expect(run("n")).toBe("        0 file(s) copied.");
    }
    // A name that Windows refuses.
    expect(run('copy a.txt "x<y.txt"')).toBe(
      "The filename, directory name, or volume label syntax is incorrect.\n        0 file(s) copied.",
    );
    // A folder that takes the name while the question is open stays.
    expect(run("copy a.txt b.txt")).toBe("");
    fs.destroy(fs.findChild(fs.DRIVE_C, "b.txt").id);
    const folder = fs.createFolder(fs.DRIVE_C, "b.txt");
    expect(run("y")).toBe("Access is denied.\n        0 file(s) copied.");
    expect(fs.getNode(folder.id).type).toBe("folder");
  });

  test("copy of many files onto one name joins them, and asks first", () => {
    run("cd /d C:\\");
    file(fs.DRIVE_C, "c1.log", 2, "1\n");
    file(fs.DRIVE_C, "c2.log", 2, "2\n");
    file(fs.DRIVE_C, "out.txt", 2, "o\n");
    expect(run("copy *.log out.txt")).toBe("c1.log\nc2.log");
    expect(session.prompt).toBe("Overwrite out.txt? (Yes/No/All): ");
    expect(run("n")).toBe("        0 file(s) copied.");
    expect(run("type out.txt")).toBe("o");
    run("copy *.log out.txt");
    expect(run("y")).toBe("        1 file(s) copied.");
    expect(run("type out.txt")).toBe("1\n2");
    // A folder that takes the name while the question is open stays.
    run("copy *.log out.txt");
    fs.destroy(fs.findChild(fs.DRIVE_C, "out.txt").id);
    fs.createFolder(fs.DRIVE_C, "out.txt");
    expect(run("y")).toBe("Access is denied.\n        0 file(s) copied.");
  });

  test("del, md and other commands report errors like cmd.exe", () => {
    run("cd /d C:\\");
    // A path in a drive root has one backslash.
    expect(run("del nothere.txt")).toBe("Could Not Find C:\\nothere.txt");
    fs.createFile(fs.DRIVE_C, "p.txt", { content: "", protected: true });
    expect(run("del p.txt")).toBe("C:\\p.txt\nAccess is denied.");
    // An error with no cmd.exe text shows its own message.
    fs.createFolder = () => {
      throw new Error("The disk is full.");
    };
    expect(run("md newdir")).toBe("The disk is full.");
  });

  test("md with a backslash at the start starts at the top of the drive", () => {
    run("cd /d C:\\");
    run("md Src");
    run("cd Src");
    expect(run("md \\newdir\\sub")).toBe("");
    expect(run("dir /b C:\\newdir")).toBe("sub");
  });

  test("dir takes /T with no letter and /A with a letter, and refuses a bare switch character", () => {
    run("cd /d C:\\");
    file(fs.DRIVE_C, "a.txt");
    fs.createFolder(fs.DRIVE_C, "Dst");
    expect(run("dir /-")).toBe('Invalid switch - "-".');
    expect(run("dir /t /b")).toBe("a.txt\nDocuments and Settings\nDst");
    // New files have the Archive attribute, and folders do not.
    expect(run("dir /aa /b")).toBe("a.txt");
    expect(run("dir /a-a /b")).toBe("Documents and Settings\nDst");
  });

  test("dir /d leaves out the empty last row", () => {
    const wide = fs.createFolder(fs.DRIVE_C, "wide");
    file(wide.id, `${"a".repeat(37)}.t`);
    file(wide.id, `${"b".repeat(37)}.t`);
    // A 39-character name leaves room for one column, so each name has a
    // row of its own, and the empty row after them does not show.
    expect(run("dir /d C:\\wide")).toBe(
      `${header("C:\\wide")}[.]\n[..]\n${"a".repeat(37)}.t\n${"b".repeat(37)}.t\n               2 File(s)              2 bytes\n               2 Dir(s)   5,952,212,992 bytes free`,
    );
  });

  test("protected items and deleted folders get cmd.exe's own texts", () => {
    run("cd /d C:\\");
    // REN and RD on a protected folder print only cmd.exe's text.
    expect(run('ren "Documents and Settings" x')).toBe("Access is denied.");
    expect(run('rd /s "Documents and Settings"')).toBe("Access is denied.");
    expect(fs.resolvePath("C:\\Documents and Settings")).toBeTruthy();
    // A protected file in a wildcard MOVE shows the text, and MOVE goes on.
    const t = folderAt("t");
    const d = folderAt("d");
    file(t, "a.txt");
    const locked = file(t, "b.txt");
    file(t, "c.txt");
    fs.getNode(locked.id).protected = true;
    expect(run("move C:\\t\\*.txt C:\\d")).toBe(
      "C:\\t\\a.txt\nC:\\t\\b.txt\nAccess is denied.\nC:\\t\\c.txt",
    );
    expect(fs.getChildren(d).map((node) => node.name)).toEqual([
      "a.txt",
      "c.txt",
    ]);
    // A current folder that another tab sent to the Recycle Bin takes no
    // new files.
    run("cd /d C:\\d");
    inOtherTab(() => fs.remove(d));
    expect(run("copy C:\\t\\b.txt")).toBe(
      "The system cannot find the path specified.",
    );
    expect(run("copy C:\\t\\b.txt .")).toBe(
      "The system cannot find the path specified.",
    );
    expect(fs.getChildren(d)).toHaveLength(2);
    // A folder that goes away while the question is open takes nothing.
    const e = folderAt("e");
    file(e, "b.txt");
    run("cd /d C:\\t");
    expect(run("copy b.txt C:\\e")).toBe("");
    expect(session.prompt).toBe("Overwrite C:\\e\\b.txt? (Yes/No/All): ");
    fs.remove(e);
    expect(run("y")).toBe(
      "The system cannot find the path specified.\n        0 file(s) copied.",
    );
  });

  // A current folder that another tab deleted is in the Recycle Bin. No command changes it
  // or its files, and each one shows cmd.exe's text. Commands still read
  // it, and they still write to other folders.
  test("no command writes to a current folder in the Recycle Bin", () => {
    const d = folderAt("d");
    const kept = file(d, "a.txt", 4, "old\n");
    file(d, "b.txt", 4, "bbb\n");
    const sub = folderAt("d\\sub");
    const out = folderAt("out");
    file(folderAt("src"), "s.txt");
    run("cd /d C:\\d");
    inOtherTab(() => fs.remove(d));
    const before = JSON.stringify(
      fs.getChildren(d).map((node) => [node.name, fs.getContent(node.id)]),
    );
    for (const line of [
      "echo hi >> a.txt",
      "echo hi > a.txt",
      "echo hi>new.txt",
      "del a.txt",
      "del /q *.*",
      "ren a.txt c.txt",
      "md x",
      "md x\\y",
      "rd sub",
      "move a.txt C:\\out",
      "copy C:\\src\\s.txt .",
    ])
      expect(`${line}: ${run(line)}`).toBe(
        `${line}: The system cannot find the path specified.`,
      );
    expect(
      JSON.stringify(
        fs.getChildren(d).map((node) => [node.name, fs.getContent(node.id)]),
      ),
    ).toBe(before);
    expect(fs.getNode(sub).parent).toBe(d);
    expect(fs.getChildren(out)).toEqual([]);
    // Reads work, and a copy out of the folder leaves it as it is.
    expect(run("type a.txt")).toBe("old");
    expect(run("dir /b")).toBe("a.txt\nb.txt\nsub");
    expect(run("copy a.txt C:\\out")).toBe("        1 file(s) copied.");
    expect(fs.getNode(kept.id).parent).toBe(d);
    // A command that writes to another folder works.
    expect(run("echo hi> C:\\out\\new.txt")).toBe("");
    expect(fs.getContent(fs.findChild(out, "new.txt").id)).toBe("hi\n");
  });

  // Every check comes before the old file goes. A refused item never
  // destroys the file that it would replace.
  test("a refused copy or move keeps the file that it would replace", () => {
    run("cd /d C:\\");
    const t = folderAt("t");
    const e = folderAt("e");
    const keep = (name) => file(e, name, 4, "old\n");
    // The folder goes to the Recycle Bin while the question is open.
    let old = keep("a.txt");
    file(t, "a.txt", 4, "new\n");
    expect(run("move C:\\t\\a.txt C:\\e")).toBe("");
    fs.remove(e);
    expect(run("y")).toBe("The system cannot find the path specified.");
    expect(fs.getNode(old.id).content).toBe("old\n");
    const f = folderAt("f");
    // A protected source of MOVE.
    old = file(f, "b.txt", 4, "old\n");
    const locked = file(t, "b.txt", 4, "new\n");
    fs.getNode(locked.id).protected = true;
    expect(run("move C:\\t\\b.txt C:\\f")).toBe("");
    expect(run("y")).toBe("Access is denied.");
    expect(fs.getNode(old.id).content).toBe("old\n");
    // A protected file that holds the name stays, with cmd.exe's text.
    const held = file(f, "c.txt", 4, "old\n");
    fs.getNode(held.id).protected = true;
    file(t, "c.txt", 4, "new\n");
    expect(run("copy C:\\t\\c.txt C:\\f")).toBe("");
    expect(run("y")).toBe("Access is denied.\n        0 file(s) copied.");
    expect(fs.getNode(held.id).content).toBe("old\n");
    // The source goes away while the question is open.
    old = file(f, "d.txt", 4, "old\n");
    const gone = file(t, "d.txt", 4, "new\n");
    expect(run("copy C:\\t\\d.txt C:\\f")).toBe("");
    fs.destroy(gone.id);
    expect(run("y")).toBe(
      "The system cannot find the file specified.\n        0 file(s) copied.",
    );
    expect(fs.getNode(old.id).content).toBe("old\n");
    // COPY of many files onto one name: the folder goes away, or a
    // protected file holds the name.
    file(t, "j1.log", 2, "1\n");
    file(t, "j2.log", 2, "2\n");
    const g = folderAt("g");
    old = file(g, "out.txt", 4, "old\n");
    expect(run("copy C:\\t\\*.log C:\\g\\out.txt")).toBe(
      "C:\\t\\j1.log\nC:\\t\\j2.log",
    );
    fs.remove(g);
    expect(run("y")).toBe(
      "The system cannot find the path specified.\n        0 file(s) copied.",
    );
    expect(fs.getNode(old.id).content).toBe("old\n");
    const h = folderAt("h");
    old = file(h, "out.txt", 4, "old\n");
    fs.getNode(old.id).protected = true;
    run("copy C:\\t\\*.log C:\\h\\out.txt");
    expect(run("y")).toBe("Access is denied.\n        0 file(s) copied.");
    expect(fs.getNode(old.id).content).toBe("old\n");
    // ECHO puts no new file in a folder in the Recycle Bin.
    run("cd /d C:\\h");
    inOtherTab(() => fs.remove(h));
    expect(run("echo x>new.txt")).toBe(
      "The system cannot find the path specified.",
    );
    expect(fs.findChild(h, "new.txt")).toBeNull();
  });

  // A folder can go to the Recycle Bin while a question is open, or
  // between two questions. Each question checks the folders before it is
  // asked and again after the answer.
  // Like XP, the folder a Command Prompt is in, and every folder above it,
  // cannot be deleted, moved or renamed until the session leaves it or
  // closes. The texts come from the XP VM.
  test("a session locks its folder and the folders above it, with XP's texts", async () => {
    const outer = fs.createFolder(fs.DESKTOP, "t");
    const inner = fs.createFolder(outer.id, "t2");
    const other = fs.createFolder(fs.DESKTOP, "other");
    run(`cd "${fs.getPath(inner.id)}"`);
    const IN_USE =
      "The process cannot access the file because it is being used by another process.";
    // cmd.exe's own texts. Another session gets them too.
    const second = new CommandSession(context);
    second.execute(`cd "${fs.getPath(fs.DESKTOP)}"`);
    expect(second.execute("rd t\\t2").output).toBe(IN_USE);
    // RD /S deletes all that it can. The folder in use gets cmd.exe's text
    // with its path, and the folders above it stay with no text.
    expect(second.execute("rd /s /q t").output).toBe(`t\\t2 - ${IN_USE}`);
    expect(fs.getNode(outer.id).parent).toBe(fs.DESKTOP);
    expect(second.execute("ren t\\t2 t3").output).toBe(IN_USE);
    expect(second.execute("ren t u").output).toBe("Access is denied.");
    expect(second.execute("move t\\t2 other").output).toBe(IN_USE);
    expect(second.execute("move t other").output).toBe("Access is denied.");
    // The Explorer and the desktop get XP's texts and titles.
    const MAKE_SURE =
      "\n\nMake sure the disk is not full or write-protected and that the file is not currently in use.";
    const CLOSE_PROGRAMS =
      "It is being used by another person or program.\n\nClose any programs that might be using the file and try again.";
    const failure = (action) => {
      try {
        action();
      } catch (error) {
        return [error.title, error.message];
      }
      return null;
    };
    expect(failure(() => fileOps.removeToBin([inner.id]))).toEqual([
      "Error Deleting File or Folder",
      `Cannot delete t2: ${CLOSE_PROGRAMS}`,
    ]);
    expect(failure(() => fileOps.removeToBin([other.id, outer.id]))).toEqual([
      "Error Deleting File or Folder",
      `Cannot delete t: Access is denied.${MAKE_SURE}`,
    ]);
    // Nothing goes when one item cannot.
    expect(fs.getNode(other.id).parent).toBe(fs.DESKTOP);
    expect(failure(() => fileOps.rename(inner.id, "t3"))).toEqual([
      "Error Renaming File or Folder",
      `Cannot rename t2: ${CLOSE_PROGRAMS}`,
    ]);
    expect(failure(() => fileOps.rename(outer.id, "u"))).toEqual([
      "Error Renaming File or Folder",
      `Cannot rename t: Access is denied.${MAKE_SURE}`,
    ]);
    // A move names the folder in use, for the folder and for a parent.
    for (const id of [inner.id, outer.id]) {
      fileOps.cut([id]);
      // Like XP, Paste stays on. The error comes when it runs.
      expect(fileOps.canPaste(other.id)).toBeTrue();
      await expect(fileOps.pasteWithConflicts(other.id)).rejects.toMatchObject({
        title: "Error Moving File or Folder",
        message: `Cannot remove folder t2: ${CLOSE_PROGRAMS}`,
      });
    }
    // An item that is already in the destination does not move, so like
    // XP a drop or a paste of a folder in use on its own folder is no
    // error. A rename to the same name is no error too.
    for (const id of [inner.id, outer.id]) {
      const parent = fs.getNode(id).parent;
      fileOps.cut([id]);
      await expect(fileOps.pasteWithConflicts(parent)).resolves.toMatchObject({
        cancelled: false,
      });
      expect(fileOps.canPaste(parent)).toBeTrue();
      expect(failure(() => fs.move(id, parent))).toBeNull();
      expect(failure(() => fileOps.rename(id, fs.getNode(id).name))).toBeNull();
      expect(fs.getNode(id).parent).toBe(parent);
    }
    expect(failure(() => fs.destroy(outer.id))?.[1]).toBe(
      `Cannot delete t: Access is denied.${MAKE_SURE}`,
    );
    // Items in the folder in use can still change.
    const file = fs.createFile(inner.id, "a.txt", { content: "" });
    expect(run("ren a.txt b.txt")).toBe("");
    expect(fs.getNode(file.id).name).toBe("b.txt");
    // The folders are free when the session leaves them.
    run("cd ..");
    expect(second.execute("rd /s /q t\\t2").output).toBe("");
    expect(fs.getNode(inner.id)).toBeNull();
    // And when the session closes.
    expect(second.execute("rd /s /q t").output).toBe(IN_USE);
    session.close();
    expect(second.execute("move t other").output).toBe("");
    expect(fs.getNode(outer.id).parent).toBe(other.id);
  });

  test("DEL and MOVE check the folders before and after each question", () => {
    run("cd /d C:\\");
    // DEL *.*: the folder goes after the question.
    const a = folderAt("a");
    const kept = file(a, "x.txt");
    expect(run("del C:\\a\\*.*")).toBe("");
    inOtherTab(() => fs.remove(a));
    expect(run("y")).toBe("The system cannot find the path specified.");
    expect(fs.getNode(kept.id).parent).toBe(a);
    // DEL /P: the folder goes after one answer, so no more questions.
    const b = folderAt("b");
    const first = file(b, "1.txt");
    const second = file(b, "2.txt");
    expect(run("del /p C:\\b\\*.txt")).toBe("");
    inOtherTab(() => fs.remove(b));
    expect(run("n")).toBe("The system cannot find the path specified.");
    expect(session.prompt).not.toContain("Delete (Y/N)?");
    expect(run("del /p C:\\b\\*.txt")).toBe(
      "The system cannot find the path specified.",
    );
    fs.restore(b);
    expect(run("del /p C:\\b\\*.txt")).toBe("");
    inOtherTab(() => fs.remove(b));
    expect(run("y")).toBe("The system cannot find the path specified.");
    expect([fs.getNode(first.id), fs.getNode(second.id)]).toEqual([
      expect.anything(),
      expect.anything(),
    ]);
    // MOVE of two files: the source folder goes after the first answer, so
    // the second file gets no question.
    const c = folderAt("c");
    const d = folderAt("d");
    file(c, "1.txt", 1, "new\n");
    file(c, "2.txt", 1, "new\n");
    const old1 = file(d, "1.txt", 1, "old\n");
    const old2 = file(d, "2.txt", 1, "old\n");
    expect(run("move C:\\c\\*.txt C:\\d")).toBe("C:\\c\\1.txt");
    expect(session.prompt).toBe("Overwrite C:\\d\\1.txt? (Yes/No/All): ");
    fs.remove(c);
    expect(run("n")).toBe(
      "C:\\c\\2.txt\nThe system cannot find the path specified.",
    );
    expect(session.prompt).not.toContain("Overwrite");
    expect(fs.getNode(old1.id).content).toBe("old\n");
    expect(fs.getNode(old2.id).content).toBe("old\n");
  });

  // Like cmd.exe on XP: a command that asks looks up its items again by
  // path after the answer. An item that moved is gone, and a new item at
  // the same path is the one that the command uses.
  test("commands that ask look up their items by path after the answer", () => {
    const NOT_FOUND = "The system cannot find the file specified.";
    const PATH_NOT_FOUND = "The system cannot find the path specified.";
    run("cd /d C:\\");
    // RD /S: the folder moves while the question is open.
    const r = folderAt("r");
    expect(run("rd /s r")).toBe("");
    fs.rename(r, "r2");
    expect(run("y")).toBe(NOT_FOUND);
    expect(fs.getNode(r).name).toBe("r2");
    // A new folder takes the path, so RD deletes that one.
    expect(run("rd /s r2")).toBe("");
    fs.rename(r, "r3");
    const replaced = folderAt("r2");
    expect(run("y")).toBe("");
    expect(fs.getNode(replaced)).toBeFalsy();
    expect(fs.getNode(r)).toBeTruthy();
    // A file at the path is not a folder.
    expect(run("rd /s r3")).toBe("");
    fs.rename(r, "r4");
    file(fs.DRIVE_C, "r3");
    expect(run("y")).toBe(NOT_FOUND);
    // A folder on the way that moves gives the path text.
    const deep = folderAt("p\\q");
    expect(run("rd /s p\\q")).toBe("");
    fs.rename(fs.resolvePath("C:\\p"), "p2");
    expect(run("y")).toBe(PATH_NOT_FOUND);
    expect(fs.getNode(deep)).toBeTruthy();

    // COPY: the target folder moves while the question is open.
    const s = folderAt("s");
    const t = folderAt("t");
    file(s, "a.txt", 1, "new\n");
    const old = file(t, "a.txt", 1, "old\n");
    expect(run("copy C:\\s\\a.txt C:\\t")).toBe("");
    fs.rename(t, "t2");
    expect(run("y")).toBe(`${PATH_NOT_FOUND}\n        0 file(s) copied.`);
    expect(fs.getNode(old.id).content).toBe("old\n");
    // MOVE: the file moves while the question is open.
    fs.rename(t, "t");
    expect(run("move C:\\s\\a.txt C:\\t")).toBe("");
    fs.rename(fs.resolvePath("C:\\s\\a.txt"), "b.txt");
    expect(run("y")).toBe(NOT_FOUND);
    expect(fs.getNode(old.id).content).toBe("old\n");
    // A folder at the path of the file is not the file.
    fs.createFolder(s, "a.txt");
    expect(run("move C:\\s\\b.txt C:\\t\\a.txt")).toBe("");
    fs.rename(fs.resolvePath("C:\\s\\b.txt"), "c.txt");
    fs.rename(fs.resolvePath("C:\\s\\a.txt"), "b.txt");
    expect(run("y")).toBe(NOT_FOUND);

    // COPY of many files onto one name: a file that moves gives no text,
    // and a target folder that moves gets nothing.
    const j = folderAt("j");
    file(j, "1.txt", 1, "one\n");
    file(j, "2.txt", 1, "two\n");
    const joined = file(t, "all.txt", 1, "old\n");
    expect(run("copy C:\\j\\*.txt C:\\t\\all.txt")).toBe(
      "C:\\j\\1.txt\nC:\\j\\2.txt",
    );
    fs.rename(fs.resolvePath("C:\\j\\1.txt"), "3.txt");
    expect(run("y")).toBe("        1 file(s) copied.");
    expect(fs.getNode(joined.id).content).toBe("two\n");
    expect(run("copy C:\\j\\*.txt C:\\t\\all.txt")).toBe(
      "C:\\j\\2.txt\nC:\\j\\3.txt",
    );
    fs.rename(t, "t3");
    expect(run("y")).toBe(`${PATH_NOT_FOUND}\n        0 file(s) copied.`);
    expect(fs.getNode(joined.id).content).toBe("two\n");

    // DEL /P: the file at the path after the answer is the one that goes.
    const d = folderAt("d");
    const first = file(d, "1.txt");
    expect(run("del /p C:\\d\\1.txt")).toBe("");
    fs.rename(first.id, "kept.txt");
    const newer = file(d, "1.txt");
    expect(run("y")).toBe("");
    expect(fs.getNode(first.id)).toBeTruthy();
    expect(fs.getNode(newer.id)).toBeFalsy();
    // A file that moves away is not deleted.
    expect(run("del /p C:\\d\\kept.txt")).toBe("");
    fs.rename(first.id, "other.txt");
    expect(run("y")).toBe("");
    expect(fs.getNode(first.id)).toBeTruthy();
  });

  // Like XP, DEL keeps its folder in use while it asks, so another Command
  // Prompt cannot move it then.
  test("DEL keeps its folder in use while it asks", () => {
    const IN_USE =
      "The process cannot access the file because it is being used by another process.";
    run("cd /d C:\\");
    const other = new CommandSession(context);
    other.execute("cd /d C:\\");
    const d = folderAt("dl");
    file(d, "x.txt");
    expect(run("del C:\\dl\\*.*")).toBe("");
    expect(other.execute("move dl dl2").output).toBe(IN_USE);
    expect(() => fs.rename(d, "dl2")).toThrow();
    expect(run("n")).toBe("");
    expect(() => fs.rename(d, "dl2")).not.toThrow();
    // Close frees the folder too.
    expect(run("del C:\\dl2\\*.*")).toBe("");
    expect(() => fs.rename(d, "dl3")).toThrow();
    session.close();
    expect(() => fs.rename(d, "dl3")).not.toThrow();
  });

  // Like cmd.exe on XP: "rd /s C:\\rdt" with a Command Prompt in
  // C:\\rdt\\a deletes all else, and names the folder in use.
  test("RD /S deletes all that it can around a folder in use", () => {
    const IN_USE =
      "The process cannot access the file because it is being used by another process.";
    const root = folderAt("rdt");
    const used = folderAt("rdt\\a");
    const kept = file(used, "in.txt");
    file(root, "top.txt");
    file(folderAt("rdt\\b\\c"), "deep.txt");
    const user = new CommandSession(context);
    user.execute("cd /d C:\\rdt\\a");
    run("cd /d C:\\");
    expect(run("rd /s C:\\rdt\\")).toBe("");
    expect(session.prompt).toBe("C:\\rdt\\, Are you sure (Y/N)? ");
    expect(run("y")).toBe(`C:\\rdt\\a - ${IN_USE}`);
    expect(fs.getChildren(root).map((node) => node.name)).toEqual(["a"]);
    // The files in the folder in use go.
    expect(fs.getNode(kept.id)).toBeNull();
    // With the Command Prompt in the folder itself, the text has no path.
    user.execute("cd ..");
    expect(run("rd /s /q rdt")).toBe(IN_USE);
    expect(fs.getChildren(root)).toEqual([]);
    user.close();
    expect(run("rd /s /q rdt")).toBe("");
    expect(fs.getNode(root)).toBeNull();
  });

  test("COPY checks its source folder before and after each question", () => {
    run("cd /d C:\\");
    // The source folder goes to the Recycle Bin while the question is
    // open, so the file is gone.
    const e = folderAt("e");
    const f = folderAt("f");
    file(e, "1.txt", 1, "new\n");
    const old = file(f, "1.txt", 1, "old\n");
    expect(run("copy C:\\e\\1.txt C:\\f")).toBe("");
    fs.remove(e);
    expect(run("y")).toBe(
      "The system cannot find the path specified.\n        0 file(s) copied.",
    );
    expect(fs.getNode(old.id).content).toBe("old\n");
    // A file that moves to another folder while the question is open is
    // gone too.
    const g = folderAt("g");
    const moved = file(g, "1.txt", 1, "new\n");
    expect(run("copy C:\\g\\1.txt C:\\f")).toBe("");
    fs.move(moved.id, folderAt("h"));
    expect(run("y")).toBe(
      "The system cannot find the file specified.\n        0 file(s) copied.",
    );
    expect(fs.getNode(old.id).content).toBe("old\n");
    // COPY of many files onto one name leaves out the files of a folder
    // that went to the Recycle Bin, and a file that left its folder.
    const logs = folderAt("logs");
    file(logs, "1.log", 1, "1\n");
    const left = file(logs, "2.log", 1, "2\n");
    file(folderAt("more"), "3.log", 1, "3\n");
    file(fs.DRIVE_C, "out.txt", 1, "o\n");
    expect(run("copy C:\\logs\\*.log out.txt")).toBe(
      "C:\\logs\\1.log\nC:\\logs\\2.log",
    );
    fs.move(left.id, folderAt("more"));
    expect(run("y")).toBe("        1 file(s) copied.");
    expect(run("type out.txt")).toBe("1");
    expect(run("copy C:\\logs\\*.log out.txt")).toBe("C:\\logs\\1.log");
    fs.remove(logs);
    expect(run("y")).toBe("        1 file(s) copied.");
    expect(run("type out.txt")).toBe("");
  });

  // In the XP VM, COPY lists its files when it starts. A file that is
  // gone after a question is left out with no text, and a file that is
  // new is not copied.
  test("COPY leaves out a file that goes while it asks, like XP", () => {
    run("cd /d C:\\");
    const src = folderAt("src");
    const dst = folderAt("dst");
    file(src, "a.txt", 1, "a\n");
    const b = file(src, "b.txt", 1, "b\n");
    file(src, "c.txt", 1, "c\n");
    file(dst, "a.txt", 1, "old\n");
    run("cd src");
    expect(run("copy *.txt C:\\dst")).toBe("a.txt");
    fs.move(b.id, dst);
    file(src, "bb.txt", 1, "bb\n");
    expect(run("y")).toBe("c.txt\n        2 file(s) copied.");
    expect(fs.getNode(b.id).parent).toBe(dst);
    expect(fs.findChild(dst, "bb.txt")).toBeNull();
    expect(run("type C:\\dst\\a.txt")).toBe("a");
  });

  // In the XP VM, cmd makes the full path of a path first, like
  // GetFullPathName: "." and ".." go by their text, so "nope\.." is the
  // folder itself, also when nope does not exist. ".." stops at the root.
  test("internal commands count . and .. by the text of the path, like XP", () => {
    run("cd /d C:\\");
    const w = folderAt("w");
    file(w, "a.txt", 1, "text\n");
    run("cd w");
    expect(run("type nope\\..\\a.txt")).toBe("text");
    expect(run("dir /b nope\\..\\a.txt")).toBe("a.txt");
    expect(run("copy nope\\..\\a.txt nope2\\..\\b.txt")).toBe(
      "        1 file(s) copied.",
    );
    expect(run("type .\\nope\\.\\..\\b.txt")).toBe("text");
    expect(run("type C:\\..\\..\\w\\a.txt")).toBe("text");
    expect(run("md nope3\\..\\made")).toBe("");
    expect(fs.findChild(w, "made")).toBeTruthy();
    expect(fs.findChild(w, "nope3")).toBeNull();
    expect(run("ren nope\\..\\b.txt c.txt")).toBe("");
    expect(fs.findChild(w, "c.txt")).toBeTruthy();
    expect(run("del nope\\..\\c.txt")).toBe("");
    expect(fs.findChild(w, "c.txt")).toBeNull();
    run("cd nope\\..\\made");
    expect(session.cwd).toBe(fs.findChild(w, "made").id);
    run("cd nope\\..\\..\\..");
    expect(session.cwd).toBe(fs.DRIVE_C);
  });

  test("wildcards follow the DOS rules", () => {
    expect(matchesPattern("noext", "*.*")).toBeTrue();
    expect(matchesPattern("note.txt", "note?.txt")).toBeTrue();
    expect(matchesPattern("note.txt", "note??.txt")).toBeTrue();
    expect(matchesPattern("notes.txt", "note?.txt")).toBeTrue();
    expect(matchesPattern("noext", "no?ext")).toBeFalse();
    expect(matchesPattern("notes.txt", "?ote.txt")).toBeFalse();
    expect(matchesPattern("a.b.c", "*.c")).toBeTrue();
    expect(matchesPattern("abc", "abc.")).toBeTrue();
    // A "*" before a period takes any text but the last period.
    expect(matchesPattern("a.b.tar.gz", "*.tar.gz")).toBeTrue();
    expect(matchesPattern("a.b.txt", "*.txt")).toBeTrue();
    expect(matchesPattern("notes.txt.bak", "*.txt")).toBeFalse();
    expect(matchesPattern("noext", "*.")).toBeTrue();
    expect(matchesPattern("a.txt", "*.")).toBeFalse();
    const t = folderAt("t");
    for (const name of ["noext", "note.txt", "note1.txt", "notes.txt"])
      file(t, name);
    run("cd /d C:\\t");
    expect(run("dir /b *.*")).toBe("noext\nnote.txt\nnote1.txt\nnotes.txt");
    expect(run("dir /b note?.txt")).toBe("note.txt\nnote1.txt\nnotes.txt");
    expect(run("dir /b no?ext")).toBe("File Not Found");
    expect(run("dir /b ?ote.txt")).toBe("note.txt");
  });

  test("copy, move and del take wildcards", () => {
    const t = folderAt("t");
    for (const name of ["noext", "note.txt", "note1.txt", "notes.txt"])
      file(t, name);
    run("cd /d C:\\t");
    run("md d");
    expect(run("copy *.txt d")).toBe(
      "note.txt\nnote1.txt\nnotes.txt\n        3 file(s) copied.",
    );
    expect(run("copy note?.txt d")).toBe("note.txt");
    expect(session.prompt).toBe("Overwrite d\\note.txt? (Yes/No/All): ");
    expect(run("y")).toBe("note1.txt");
    expect(session.prompt).toBe("Overwrite d\\note1.txt? (Yes/No/All): ");
    expect(run("n")).toBe("notes.txt");
    expect(run("y")).toBe("        2 file(s) copied.");
    expect(run("copy d\\*.txt e.txt")).toBe(
      "d\\note.txt\nd\\note1.txt\nd\\notes.txt\n        1 file(s) copied.",
    );
    expect(run("type e.txt")).toBe("a\na\na");
    run("del e.txt");
    expect(run("move note1.txt d")).toBe("");
    expect(session.prompt).toBe(
      "Overwrite C:\\t\\d\\note1.txt? (Yes/No/All): ",
    );
    expect(run("n")).toBe("");
    expect(run("del d\\*.txt")).toBe("");
    expect(run("dir /b d")).toBe("File Not Found");
    expect(run("del *.*")).toBe("");
    expect(session.prompt).toBe("C:\\t\\*.*, Are you sure (Y/N)? ");
    expect(run("N")).toBe("");
    expect(run("del nothere.txt")).toBe("Could Not Find C:\\t\\nothere.txt");
    expect(run("move *.txt d")).toBe(
      "C:\\t\\note.txt\nC:\\t\\note1.txt\nC:\\t\\notes.txt",
    );
    expect(run("dir /b d")).toBe("note.txt\nnote1.txt\nnotes.txt");
    expect(run("copy *.txt a.txt b.txt")).toBe(
      "The syntax of the command is incorrect.",
    );
    expect(run("move d\\*.txt one.txt")).toBe(
      "Cannot move multiple files to a single file.",
    );
    expect(run("copy d\\*.txt *.bak")).toBe(
      "d\\note.txt\nd\\note1.txt\nd\\notes.txt\n        3 file(s) copied.",
    );
    expect(fs.findChild(t, "note1.bak")).toBeTruthy();
    expect(run("del /q d")).toBe("");
    expect(fs.getChildren(fs.findChild(t, "d").id)).toEqual([]);
    expect(run("del d")).toBe("");
    expect(session.prompt).toBe("C:\\t\\d\\*, Are you sure (Y/N)? ");
    expect(run("y")).toBe("");
    expect(run("del /p *.bak")).toBe("");
    expect(session.prompt).toBe("C:\\t\\note.bak, Delete (Y/N)? ");
    expect(run("y")).toBe("");
    expect(run("n")).toBe("");
    fs.remove(fs.findChild(t, "notes.bak").id);
    expect(run("y")).toBe("");
    expect(fs.findChild(t, "note1.bak")).toBeTruthy();
    expect(run("del Missing\\*.txt")).toBe(
      "The system cannot find the path specified.",
    );
    expect(run("del")).toBe("The syntax of the command is incorrect.");
  });

  test("ren goes on after a refused name, and a target with a path is a syntax error", () => {
    const t = folderAt("t");
    for (const name of ["a.txt", "com1x.txt", "noext", "note.txt"])
      file(t, name);
    file(t, "a");
    run("cd /d C:\\t");
    expect(run("ren note.txt .")).toBe(
      "A duplicate file name exists, or the file\ncannot be found.",
    );
    expect(run("ren noext sub\\b.txt")).toBe(
      "The syntax of the command is incorrect.",
    );
    expect(run("ren noext .\\b.txt")).toBe(
      "The syntax of the command is incorrect.",
    );
    expect(run("ren noext x?y")).toBe("");
    expect(fs.findChild(t, "xoy")).toBeTruthy();
    // "a.txt" takes the name of the file "a", and "com1x.txt" the device
    // name "com1".
    expect(run("ren *.txt ????.")).toBe(
      "A duplicate file name exists, or the file\ncannot be found.\nThe syntax of the command is incorrect.",
    );
    expect(fs.findChild(t, "note")).toBeTruthy();
    expect(fs.findChild(t, "com1x.txt")).toBeTruthy();
  });

  test("the prompt and the variables show the real profile and user", () => {
    expect(session.prompt).toBe("C:\\Documents and Settings\\astro>");
    expect(run("echo %USERNAME%")).toBe("astro");
    expect(run("echo %HOMEPATH%")).toBe("\\Documents and Settings\\astro");
    expect(run("echo %TEMP%")).toBe("C:\\DOCUME~1\\astro\\LOCALS~1\\Temp");
    expect(run("echo %HOMEDRIVE%")).toBe("C:");
    expect(run("echo %nothere%")).toBe("%nothere%");
    expect(run("cd")).toBe("C:\\Documents and Settings\\astro");
    run("cd /d C:\\");
    expect(run('cd "%USERPROFILE%"')).toBe("");
    expect(session.cwd).toBe(fs.USER_PROFILE);
  });

  test("the profile of another user name gives 8.3 names in TEMP", () => {
    fs.getNode(fs.USER_PROFILE).name = "Administrator";
    session = new CommandSession(context);
    expect(session.prompt).toBe("C:\\Documents and Settings\\Administrator>");
    expect(run("echo %TEMP%")).toBe("C:\\DOCUME~1\\ADMINI~1\\LOCALS~1\\Temp");
  });

  test("dir shows the long, wide and bare formats of cmd.exe", () => {
    dirFixture();
    const long = [
      line(null, "."),
      line(null, ".."),
      line("3", "A very long file name.text"),
      line("7", "a.txt"),
      line("1,234,567", "big.bin"),
      line(null, "Folder2"),
      line("5", "Medium.doc"),
      line(null, "sub"),
    ];
    expect(run("dir")).toBe(
      `${header("C:\\t\\w")}${long.join("\n")}\n${totals}`,
    );
    expect(run("dir /on")).toBe(run("dir"));
    expect(run("dir /w")).toBe(
      `${header("C:\\t\\w")}[.]                          [..]\nA very long file name.text   a.txt\nbig.bin                      [Folder2]\nMedium.doc                   [sub]\n${totals}`,
    );
    expect(run("dir /d")).toBe(
      `${header("C:\\t\\w")}[.]                          [Folder2]\n[..]                         Medium.doc\nA very long file name.text   [sub]\na.txt\nbig.bin\n${totals}`,
    );
    expect(run("dir /b")).toBe(
      "A very long file name.text\na.txt\nbig.bin\nFolder2\nMedium.doc\nsub",
    );
    expect(run("dir /ad")).toBe(
      `${header("C:\\t\\w")}${[long[0], long[1], long[5], long[7]].join("\n")}\n               0 File(s)              0 bytes\n               4 Dir(s)   5,952,212,992 bytes free`,
    );
    expect(run("dir /a-d")).toBe(
      `${header("C:\\t\\w")}${[long[2], long[3], long[4], long[6]].join("\n")}\n               4 File(s)      1,234,582 bytes\n               0 Dir(s)   5,952,212,992 bytes free`,
    );
    expect(run("dir /o-n")).toBe(
      `${header("C:\\t\\w")}${[...long].reverse().join("\n")}\n${totals}`,
    );
    expect(run("dir /l")).toContain(line("3", "a very long file name.text"));
    expect(run("dir /l")).toContain(line(null, "folder2"));
    expect(run("dir /-c")).toBe(
      `${header("C:\\t\\w")}${long.join("\n").replace("1,234,567", "  1234567")}\n               4 File(s)        1234582 bytes\n               4 Dir(s)      5952212992 bytes free`,
    );
    expect(run("dir /z")).toBe('Invalid switch - "z".');
    expect(run("dir /bs")).toBe('Invalid switch - "bs".');
    expect(run("dir nothere")).toBe(`${header("C:\\t\\w")}File Not Found`);
  });

  test("dir /s lists each folder and the totals", () => {
    dirFixture();
    expect(run("dir /s")).toBe(
      [
        header("C:\\t\\w").trimEnd(),
        "",
        line(null, "."),
        line(null, ".."),
        line("3", "A very long file name.text"),
        line("7", "a.txt"),
        line("1,234,567", "big.bin"),
        line(null, "Folder2"),
        line("5", "Medium.doc"),
        line(null, "sub"),
        "               4 File(s)      1,234,582 bytes",
        "",
        " Directory of C:\\t\\w\\Folder2",
        "",
        line(null, "."),
        line(null, ".."),
        "               0 File(s)              0 bytes",
        "",
        " Directory of C:\\t\\w\\sub",
        "",
        line(null, "."),
        line(null, ".."),
        line("3", "in.txt"),
        "               1 File(s)              3 bytes",
        "",
        "     Total Files Listed:",
        "               5 File(s)      1,234,585 bytes",
        "               8 Dir(s)   5,952,212,992 bytes free",
      ].join("\n"),
    );
    expect(run("dir /s /b *.txt")).toBe(
      "C:\\t\\w\\a.txt\nC:\\t\\w\\sub\\in.txt",
    );
  });

  test("dir /w fits as many columns as the screen takes", () => {
    const t = folderAt("t");
    for (const name of [
      "note.bak",
      "note1.bak",
      "notes.bak",
      "notes.txt",
      "xoy",
    ])
      file(t, name, 3);
    for (const name of ["d", "sub", "w"]) fs.createFolder(t, name);
    stamp(t);
    run("cd /d C:\\t\\w");
    expect(run("dir /w ..")).toBe(
      `${header("C:\\t")}[.]         [..]        [d]         note.bak    note1.bak   notes.bak\nnotes.txt   [sub]       [w]         xoy\n               5 File(s)             15 bytes\n               5 Dir(s)   5,952,212,992 bytes free`,
    );
  });

  test("dir takes the other switches of cmd.exe", () => {
    dirFixture();
    expect(run("dir /q a.txt")).toContain(
      `${line("7", "XP\\astro").slice(0, 39)}`,
    );
    expect(run("dir /q a.txt")).toContain("XP\\astro               a.txt");
    expect(run("dir /x")).toContain(
      `${line("3", "AVERYL~1.TEX A very long file name.text")}`,
    );
    expect(run("dir /x a.txt")).toContain(`${line("7", "             a.txt")}`);
    const created = new Date(2025, 0, 2, 13, 5).getTime();
    fs.getNode(fs.findChild(session.cwd, "a.txt").id).created = created;
    expect(run("dir /t:c a.txt")).toContain("01/02/2025  01:05 PM");
    expect(run("dir /tc a.txt")).toContain("01/02/2025  01:05 PM");
    expect(run("dir /n /4 /p /c a.txt")).toContain(line("7", "a.txt"));
    expect(run("dir /os /b")).toBe(
      "Folder2\nsub\nA very long file name.text\nMedium.doc\na.txt\nbig.bin",
    );
    expect(run("dir /oe /b")).toBe(
      "Folder2\nsub\nbig.bin\nMedium.doc\nA very long file name.text\na.txt",
    );
    expect(run("dir /og-n /b")).toBe(
      "sub\nFolder2\nMedium.doc\nbig.bin\na.txt\nA very long file name.text",
    );
    expect(run("dir /o /b")).toBe(
      "Folder2\nsub\nA very long file name.text\na.txt\nbig.bin\nMedium.doc",
    );
    fs.getNode(fs.findChild(session.cwd, "a.txt").id).modified = created;
    expect(run("dir /od /b").split("\n")[0]).toBe("a.txt");
    expect(run("dir /ah /b")).toBe("File Not Found");
    expect(run("dir /a-h /b")).toBe(run("dir /b"));
    expect(run("dir /a /b")).toBe(run("dir /b"));
    expect(run("dir /o-g /-o /b")).toBe(run("dir /b"));
    expect(run("dir Missing\\*.txt")).toBe(
      "The system cannot find the path specified.",
    );
    run("cd /d D:\\");
    expect(run("dir")).toContain(" Volume in drive D has no label.");
  });
});
