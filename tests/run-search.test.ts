// @ts-nocheck -- Exercise the real Run and Search UI with browser fixtures.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  loadShell,
  login,
  flushShell,
  clickStartAction,
} from "./helpers/shell-harness";
afterEach(cleanupShells);
const run = async (s, command) => {
  clickStartAction(s, "run");
  const dialog = s.document.querySelector(".run-dialog");
  dialog.querySelector("#run-command").value = command;
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
    s.document.querySelectorAll("#run-command-history option").length,
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
  expect(error.querySelector(".title-text").textContent).toBe(
    "unknown synthetic program",
  );
  expect(error.textContent).toContain(
    "Windows cannot find 'unknown synthetic program'. Make sure you typed the name correctly, and then try again. To search for a file, click the Start button, and then click Search.",
  );
  expect(
    s.document.querySelectorAll(".xp-dialog")[0].classList.contains("active"),
  ).toBeFalse();
  expect(error.classList.contains("active")).toBeTrue();
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
