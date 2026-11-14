// @ts-nocheck -- Exercise the real Run and Search UI with browser fixtures.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  loadShell,
  login,
  flushShell,
  clickStartAction,
} from "./helpers/shell-harness";
import { IDBFactory } from "fake-indexeddb";
afterEach(cleanupShells);
const run = async (s, command) => {
  clickStartAction(s, "run");
  const dialog = s.document.querySelector(".run-dialog");
  dialog.querySelector(".run-dialog .shell-dialog-input").value = command;
  dialog.querySelector('[data-action="run"]').click();
  await flushShell();
};
test("Run opens shell applications and keeps case-insensitive recent history", async () => {
  const s = await login(
    await loadShell({
      initialStorage: { runHistory: '["DOCUMENTS","pictures"]' },
    }),
  );
  for (const [command, id] of [
    ["documents", "__my-documents"],
    ["pictures", "__my-pictures"],
    ["music", "__my-music"],
    ["computer", "__my-computer"],
    ["control panel", "__control-panel"],
    ["search", "__search"],
    ["internet games", "__internet-games"],
  ]) {
    await run(s, command);
    expect(
      s.document.querySelector(`.xp-window[data-game="${id}"]`),
    ).not.toBeNull();
  }
  await run(s, "Documents");
  const history = JSON.parse(s.window.localStorage.getItem("runHistory"));
  expect(history[0]).toBe("Documents");
  expect(
    history.filter((entry) => entry.toLowerCase() === "documents"),
  ).toHaveLength(1);
  clickStartAction(s, "run");
  expect(
    s.document.querySelectorAll(".run-dialog datalist option").length,
  ).toBe(history.length);
  s.document.querySelector('.run-dialog [data-action="cancel"]').click();
});
test("Run resolves filesystem paths and reports unknown commands without recording them", async () => {
  const s = await login(
    await loadShell({ initialStorage: { runHistory: "[17]" } }),
  );
  const fs = s.window.VirtualFS;
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Run Fixture");
  await run(s, fs.getPath(folder.id));
  expect(
    s.document.querySelector(
      '.xp-window[data-game="__my-documents"] .explorer-address input',
    ).value,
  ).toBe(fs.getPath(folder.id));
  await run(s, "unknown synthetic program");
  expect(s.document.querySelectorAll(".xp-dialog").length).toBe(2);
  const error = [...s.document.querySelectorAll(".xp-dialog")].at(-1);
  // XP names only the program, and hides Run while the error is open.
  expect(error.querySelector(".title-text").textContent).toBe("unknown");
  expect(error.textContent).toContain(
    "Windows cannot find 'unknown'. Make sure you typed the name correctly, and then try again. To search for a file, click the Start button, and then click Search.",
  );
  const runDialog = s.document.querySelector(".run-dialog");
  expect(runDialog.parentElement.hidden).toBeTrue();
  expect(error.classList.contains("active")).toBeTrue();
  error.querySelector('[data-action="ok"]').click();
  await flushShell();
  // Run comes back with its text selected.
  const input = runDialog.querySelector(".run-dialog .shell-dialog-input");
  expect(runDialog.parentElement.hidden).toBeFalse();
  expect(s.document.activeElement === input).toBeTrue();
  expect([input.selectionStart, input.selectionEnd]).toEqual([
    0,
    "unknown synthetic program".length,
  ]);
  expect(runDialog.classList.contains("active")).toBeTrue();
  runDialog.querySelector('[data-action="cancel"]').click();
  expect(JSON.parse(s.window.localStorage.getItem("runHistory"))).toEqual([
    fs.getPath(folder.id),
  ]);
});
test("Search filters by type and location and opens selected results with Enter", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Search Fixture");
  fs.createFile(folder.id, "matching.txt", { content: "searched" });
  clickStartAction(s, "search");
  const win = s.document.querySelector('.xp-window[data-game="__search"]');
  win.querySelector("[data-search-kind]").click();
  const query = win.querySelector("#search-filename");
  const type = win.querySelector("#search-type");
  const location = win.querySelector("#search-location");
  const search = async (text, kind = "all") => {
    query.value = text;
    type.value = kind;
    query.dispatchEvent(
      new s.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await flushShell();
    return [...win.querySelectorAll(".search-result")];
  };
  await search("Search Fixture", "folders");
  let result = win.querySelector(".search-results-list").firstElementChild;
  expect(result.textContent).toContain("Search Fixture");
  result.click();
  expect(result.classList.contains("selected")).toBeTrue();
  result.dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  await flushShell();
  expect(
    s.document.querySelector(
      '.xp-window[data-game="__my-documents"] .explorer-address input',
    ).value,
  ).toBe(fs.getPath(folder.id));
  location.value = fs.MY_DOCUMENTS;
  await search("matching", "files");
  expect(win.querySelector(".search-results-list").textContent).toContain(
    "matching.txt",
  );
  location.value = fs.DESKTOP;
  await search("matching", "files");
  expect(win.querySelector(".search-results-list").children.length).toBe(0);
  // Like XP, Alt+Enter shows the Properties of a file, and opens nothing.
  location.value = fs.MY_DOCUMENTS;
  await search("matching", "files");
  result = win.querySelector(".search-results-list").firstElementChild;
  const altEnter = new s.window.KeyboardEvent("keydown", {
    key: "Enter",
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  result.dispatchEvent(altEnter);
  await flushShell();
  expect(altEnter.defaultPrevented).toBeTrue();
  expect(
    [...s.document.querySelectorAll(".xp-dialog")].at(-1).textContent,
  ).toContain("matching.txt Properties");
  expect(s.document.querySelector(".notepad-window")).toBeNull();
  s.document.querySelector('.xp-dialog [data-action="ok"]').click();
  await flushShell();
  // Other keys do nothing.
  const other = new s.window.KeyboardEvent("keydown", {
    key: "a",
    bubbles: true,
    cancelable: true,
  });
  result.dispatchEvent(other);
  expect(other.defaultPrevented).toBeFalse();
  await search("Notepad", "applications");
  result = win.querySelector(".search-results-list").firstElementChild;
  expect(result.textContent).toContain("Notepad");
  // A program has no Properties here, and Alt+Enter does not start it.
  const windows = s.document.querySelectorAll(".xp-window").length;
  result.dispatchEvent(
    new s.window.KeyboardEvent("keydown", {
      key: "Enter",
      altKey: true,
      bubbles: true,
    }),
  );
  await flushShell();
  expect(s.document.querySelectorAll(".xp-window").length).toBe(windows);
  expect(s.document.querySelector(".xp-dialog")).toBeNull();
  win.querySelector('[data-search-action="back"]').click();
  expect(win.querySelector(".search-form-panel").hidden).toBeTrue();
});

test("Run opens games, Notepad, and Run itself, and ignores empty commands", async () => {
  const s = await login(await loadShell());
  const gameId = Object.keys(s.window.FLASH_GAMES)[0];
  await run(s, gameId);
  expect(
    !!s.document.querySelector(`.xp-window[data-game="${gameId}"]`),
  ).toBeTrue();
  await run(s, "notepad");
  expect(
    [...s.document.querySelectorAll(".xp-window")].some((win) =>
      /Notepad/.test(win.textContent),
    ),
  ).toBeTrue();
  await run(s, "run");
  expect(s.document.querySelectorAll(".run-dialog").length).toBeGreaterThan(0);
  s.document.querySelector('.run-dialog [data-action="cancel"]').click();
  await run(s, "   ");
  expect(s.window.localStorage.getItem("runHistory")).not.toContain('"   "');
});

test("Search lists games and applications and opens them", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const title = "Bike Mania";
  clickStartAction(s, "search");
  const win = s.document.querySelector('.xp-window[data-game="__search"]');
  const kinds = [...win.querySelectorAll("[data-search-kind]")];
  kinds.at(-1).click();
  const query = win.querySelector("#search-filename");
  const type = win.querySelector("#search-type");
  const results = () => [...win.querySelector(".search-results-list").children];
  const search = async (text, kind) => {
    query.value = text;
    type.value = kind;
    type.dispatchEvent(new s.window.Event("change"));
    await flushShell();
    return results();
  };
  query.dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "a", bubbles: true }),
  );
  const games = await search(title, "games");
  expect(games.some((item) => item.textContent.includes("Game"))).toBeTrue();
  expect(win.querySelector(".search-results-status").textContent).toMatch(
    /result/,
  );
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Unique Search Folder");
  expect(await search("Unique Search Folder", "folders")).toHaveLength(1);
  expect(win.querySelector(".search-results-status").textContent).toBe(
    "1 result found.",
  );
  expect(await search("Unique Search Folder", "files")).toHaveLength(0);
  fs.createFile(folder.id, "Unique Search File.txt");
  const mixed = await search("Unique Search", "all");
  expect(mixed.map((item) => item.querySelector("b").textContent)).toEqual([
    "Unique Search File.txt",
    "Unique Search Folder",
  ]);
  mixed[0].click();
  mixed[1].click();
  expect(win.querySelectorAll(".search-results-list .selected")).toHaveLength(
    1,
  );
  mixed[1].dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  const [game] = (await search(title, "games")).filter((item) =>
    item.textContent.includes("Game"),
  );
  game.dispatchEvent(new s.window.MouseEvent("dblclick"));
  await flushShell();
  expect(
    !!s.document.querySelector('.xp-window[data-game^="bike-mania"]'),
  ).toBeTrue();
  const [application] = await search("Control Panel", "applications");
  application.dispatchEvent(new s.window.MouseEvent("dblclick"));
  await flushShell();
  expect(
    !!s.document.querySelector('.xp-window[data-game="__control-panel"]'),
  ).toBeTrue();
});

// The last dialog on the page, such as a program's message.
const lastDialog = (s) => [...s.document.querySelectorAll(".xp-dialog")].at(-1);
const answer = async (s, action) => {
  lastDialog(s).querySelector(`[data-action="${action}"]`).click();
  await flushShell();
};
const windowTitles = (s) =>
  [...s.document.querySelectorAll(".xp-window[data-game] .title-text")].map(
    (title) => title.textContent,
  );

test("Run opens a program with the file or folder that follows it, like XP", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const folder = fs.createFolder(fs.MY_DOCUMENTS, "Run Args");
  const note = fs.createFile(folder.id, "a b.txt", { content: "hello" });
  const folderPath = fs.getPath(folder.id);
  await run(s, `notepad "${fs.getPath(note.id)}" "C:\\other.txt"`);
  expect(windowTitles(s)).toContain("a b.txt - Notepad");
  await run(s, `"explorer.exe" "${folderPath}"`);
  expect(
    s.document.querySelector(
      '.xp-window[data-game="__my-documents"] .explorer-address input',
    ).value,
  ).toBe(folderPath);
  await run(s, "CALC extra words");
  expect(
    !!s.document.querySelector('.xp-window[data-game="__calculator"]'),
  ).toBeTrue();
  await run(s, "taskmgr");
  expect(
    !!s.document.querySelector('.xp-window[data-game="__task-manager"]'),
  ).toBeTrue();
  await run(s, "explorer");
  expect(
    s.document.querySelector(
      '.xp-window[data-game="__my-documents"] .explorer-address input',
    ).value,
  ).toBe("My Documents");
  expect(JSON.parse(s.window.localStorage.getItem("runHistory"))[0]).toBe(
    "explorer",
  );
});

test("Run gives XP's messages for a program's missing file or folder", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const folderPath = fs.getPath(fs.MY_DOCUMENTS);
  const windows = () => s.document.querySelectorAll(".xp-window[data-game]");
  const before = windows().length;
  await run(s, `mspaint "${folderPath}\\no file.bmp"`);
  expect(lastDialog(s).querySelector(".title-text").textContent).toBe("Paint");
  expect(lastDialog(s).textContent).toContain(
    `${folderPath}\\no file.bmp was not found.`,
  );
  await answer(s, "ok");
  await run(s, 'explorer "C:\\no such"');
  expect(lastDialog(s).querySelector(".title-text").textContent).toBe(
    "Windows Explorer",
  );
  expect(lastDialog(s).textContent).toContain(
    "The path 'C:\\no such' does not exist or is not a directory.",
  );
  await answer(s, "ok");
  expect(windows().length).toBe(before);

  const missing = `${folderPath}\\new note.txt`;
  await run(s, `notepad ${missing}`);
  expect(lastDialog(s).querySelector(".title-text").textContent).toBe(
    "Notepad",
  );
  expect(lastDialog(s).textContent).toContain(
    `Cannot find the ${missing} file.\n\nDo you want to create a new file?`,
  );
  await answer(s, "cancel");
  expect(windows().length).toBe(before);
  expect(fs.resolvePath(missing)).toBeNull();
  await run(s, `notepad "${missing}"`);
  await answer(s, "yes");
  expect(fs.getNode(fs.resolvePath(missing)).type).toBe("file");
  expect(windowTitles(s)).toContain("new note.txt - Notepad");
  s.document
    .querySelector('.xp-window[data-game="__notepad"] .close-btn')
    .click();
  await flushShell();
  await run(s, 'notepad "C:\\No Folder\\x.txt"');
  await answer(s, "yes");
  expect(lastDialog(s).textContent).toContain(
    "The system cannot find the path specified.",
  );
  await answer(s, "ok");
  await run(s, 'notepad "C:\\No Folder\\x.txt"');
  await answer(s, "no");
  expect(windowTitles(s)).toContain("Untitled - Notepad");
});

// XP's Run starts programs in the user's profile folder, so a name with no
// drive is a file in that folder.
test("Run gives a program's relative path from the profile folder, like XP", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const profile = fs.getPath(fs.USER_PROFILE);
  const closeNotepad = async () => {
    s.document
      .querySelector('.xp-window[data-game="__notepad"] .close-btn')
      .click();
    await flushShell();
  };
  await run(s, "notepad a.txt");
  expect(lastDialog(s).textContent).toContain(
    "Cannot find the a.txt file.\n\nDo you want to create a new file?",
  );
  await answer(s, "yes");
  expect(fs.resolvePath(`${profile}\\a.txt`) === null).toBeFalse();
  expect(windowTitles(s)).toContain("a.txt - Notepad");
  await closeNotepad();
  fs.createFile(fs.USER_PROFILE, "b.txt", { content: "in the profile" });
  await run(s, "notepad b.txt");
  expect(windowTitles(s)).toContain("b.txt - Notepad");
  await closeNotepad();
  // A name with no extension gets ".txt", like XP's Notepad.
  await run(s, "notepad b");
  expect(windowTitles(s)).toContain("b.txt - Notepad");
  await closeNotepad();
  await run(s, "notepad foo");
  expect(lastDialog(s).textContent).toContain(
    "Cannot find the foo.txt file.\n\nDo you want to create a new file?",
  );
  await answer(s, "yes");
  expect(fs.resolvePath(`${profile}\\foo.txt`) === null).toBeFalse();
  expect(windowTitles(s)).toContain("foo.txt - Notepad");
  await closeNotepad();
  // Paint finds a picture in the profile folder too. The empty file is no
  // picture, so Paint's own message shows: Paint got the file.
  fs.createFile(fs.USER_PROFILE, "pic.bmp");
  await run(s, "mspaint pic.bmp");
  await flushShell();
  expect(lastDialog(s).textContent).toContain("Paint cannot read this file.");
  await answer(s, "ok");
  // A path that starts with "\" is on drive C.
  await run(s, "notepad \\c.txt");
  await answer(s, "yes");
  expect(fs.resolvePath("C:\\c.txt") === null).toBeFalse();
});

test("Run gives Explorer its switches, like XP", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const explorer = () =>
    s.document.querySelector('.xp-window[data-game="__my-documents"]');
  const address = () => explorer().querySelector(".explorer-address input");
  const folders = () =>
    explorer()
      .querySelector(".explorer-content")
      .classList.contains("folders-visible");
  const close = async () => {
    explorer().querySelector(".close-btn").click();
    await flushShell();
  };
  // With no path, Explorer opens My Documents with the Folders bar.
  await run(s, "explorer");
  expect(address().value).toBe("My Documents");
  expect(folders()).toBeTrue();
  expect(
    explorer()
      .querySelector('[data-explorer-action="folders"]')
      .getAttribute("aria-pressed"),
  ).toBe("true");
  await close();
  await run(s, "explorer /e,C:\\");
  expect(address().value).toBe("C:\\");
  expect(folders()).toBeTrue();
  await close();
  await run(s, "explorer /root,C:\\");
  expect(address().value).toBe("C:\\");
  expect(folders()).toBeFalse();
  await close();
  // /select opens the folder of the item, with the item selected.
  const note = fs.createFile(fs.USER_PROFILE, "pick.txt");
  await run(s, `explorer /select,"${fs.getPath(note.id)}"`);
  expect(address().value).toBe(fs.getPath(fs.USER_PROFILE));
  expect(folders()).toBeFalse();
  const item = explorer().querySelector(
    `.explorer-item[data-node-id="${note.id}"]`,
  );
  expect(item.classList.contains("selected")).toBeTrue();
  expect(explorer().querySelectorAll(".explorer-item.selected")).toHaveLength(
    1,
  );
  await close();
  // The hidden Recent folder has no icon to select. /n changes nothing.
  await run(s, "explorer /select,Recent,/n");
  expect(address().value).toBe(fs.getPath(fs.USER_PROFILE));
  expect(explorer().querySelectorAll(".explorer-item.selected")).toHaveLength(
    0,
  );
  await close();
  // A file opens with its program.
  await run(s, `explorer ${fs.getPath(note.id)}`);
  expect(windowTitles(s)).toContain("pick.txt - Notepad");
});

test("Run gives cmd its /c and /k commands, like XP", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const prompt = () =>
    s.document.querySelector('.xp-window[data-game="__command-prompt"]');
  const output = () => prompt().querySelector(".xp-terminal-output");
  const settle = async () => {
    for (let index = 0; index < 4; index += 1) await flushShell();
  };
  // /k runs the command and stays open. Like XP, there is no banner and
  // no typed command on the screen.
  await run(s, "cmd /k dir");
  await settle();
  expect(output().textContent).toContain(
    ` Directory of ${fs.getPath(fs.USER_PROFILE)}`,
  );
  expect(output().textContent).not.toContain("Microsoft Windows XP");
  expect(output().textContent).not.toContain(">dir");
  // An open Command Prompt runs the next command.
  await run(s, '"cmd" /K echo again');
  await settle();
  expect(output().textContent).toContain("again");
  expect(
    s.document.querySelectorAll('.xp-window[data-game="__command-prompt"]'),
  ).toHaveLength(1);
  prompt().querySelector(".close-btn").click();
  await settle();
  // /c runs the command and closes.
  await run(s, "cmd.exe /c md made");
  await settle();
  expect(
    fs.resolvePath(`${fs.getPath(fs.USER_PROFILE)}\\made`) === null,
  ).toBeFalse();
  expect(prompt() === null).toBeTrue();
  // Other arguments open the Command Prompt as it is.
  await run(s, "cmd /q");
  await settle();
  expect(output().textContent).toContain("Microsoft Windows XP");
});

// Like XP, the games and Calculator do not use their arguments, and Hearts
// shows an empty error for one.
test("Run gives the games their XP answers to arguments", async () => {
  const s = await login(await loadShell());
  await run(s, "winmine missing.txt");
  expect(
    !!s.document.querySelector('.xp-window[data-game="__minesweeper"]'),
  ).toBeTrue();
  expect(s.document.querySelector(".xp-dialog") === null).toBeTrue();
  await run(s, "calc missing.txt");
  expect(
    !!s.document.querySelector('.xp-window[data-game="__calculator"]'),
  ).toBeTrue();
  await run(s, "mshearts missing.txt");
  expect(lastDialog(s).querySelector(".title-text").textContent).toBe(
    "The Microsoft Hearts Network",
  );
  expect(lastDialog(s).querySelector(".dlg-text").textContent).toBe("");
  await answer(s, "ok");
  expect(
    s.document.querySelector('.xp-window[data-game="__hearts"]') === null,
  ).toBeTrue();
});

// In a browser, VirtualFS stores the documents, so a change ends later.
// Notepad opens the new file when it is stored.
test("Run's Notepad opens the file that it creates in stored documents", async () => {
  const s = await login(
    await loadShell({
      documentStorage: "indexeddb",
      beforeScripts: (window) => {
        window.indexedDB = new IDBFactory();
      },
    }),
  );
  const settle = async () => {
    for (let index = 0; index < 20; index += 1) await flushShell();
  };
  await settle();
  await run(s, "notepad stored.txt");
  await settle();
  await answer(s, "yes");
  await settle();
  expect(s.document.querySelector(".xp-dialog") === null).toBeTrue();
  expect(windowTitles(s)).toContain("stored.txt - Notepad");
});
