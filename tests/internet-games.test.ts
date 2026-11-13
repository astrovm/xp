// @ts-nocheck -- The real shell UI talks to an in-memory game-library service.
import { afterEach, expect, test } from "bun:test";
import {
  cleanupShells,
  loadShell,
  login,
  flushShell,
} from "./helpers/shell-harness";
afterEach(cleanupShells);
async function setup({
  broken = false,
  brokenMessage = "library unavailable",
  documentStorage = "memory",
} = {}) {
  let notify,
    results = [],
    searchFailure,
    installFailure,
    uninstallFailure;
  const installed = {},
    records = new Map(),
    calls = [];
  const manager = {
    subscribe: (fn) => {
      notify = fn;
      return () => {};
    },
    initialize: async () => {
      if (broken) throw new Error(brokenMessage);
      return installed;
    },
    search: async (term) => {
      calls.push(["search", term]);
      if (searchFailure != null) throw new Error(searchFailure);
      return results;
    },
    details: async (uuid) => results.find((g) => g.uuid === uuid),
    install: async (details, { onProgress }) => {
      onProgress({ loaded: 30, total: 100 });
      onProgress({ loaded: 30, total: 0 });
      if (installFailure != null) throw new Error(installFailure);
      const id = `flashpoint:${details.uuid}`;
      records.set(id, details);
      installed[id] = {
        ...details,
        installed: true,
        type: "iframe",
        url: "https://xp.example/game/",
      };
      notify({ ...installed });
    },
    getRecord: (id) => records.get(id),
    uninstall: async (uuid) => {
      if (uninstallFailure != null) throw new Error(uninstallFailure);
      delete installed[`flashpoint:${uuid}`];
      records.delete(`flashpoint:${uuid}`);
      notify({ ...installed });
    },
  };
  const s = await login(
    await loadShell({ gameLibraryManager: manager, documentStorage }),
  );
  s.document
    .querySelector('[data-desktop-id="__internet-games"]')
    .dispatchEvent(new s.window.MouseEvent("dblclick", { bubbles: true }));
  const win = s.document.querySelector(
    '.xp-window[data-game="__internet-games"]',
  );
  const search = async (term) => {
    win.querySelector("#internet-games-query").value = term;
    win
      .querySelector("form")
      .dispatchEvent(
        new s.window.Event("submit", { bubbles: true, cancelable: true }),
      );
    await flushShell();
  };
  const answer = async (text) => {
    [...s.document.querySelectorAll(".xp-dialog .dlg-buttons button")]
      .find((b) => b.textContent === text)
      .click();
    await flushShell();
    await flushShell();
  };
  return {
    s,
    win,
    search,
    answer,
    calls,
    setResults: (v) => {
      results = v;
    },
    failSearch: (v) => {
      searchFailure = v;
    },
    failInstall: (v) => {
      installFailure = v;
    },
    failUninstall: (v) => {
      uninstallFailure = v;
    },
    installed,
    records,
    emit: () => notify({ ...installed }),
  };
}
test("Internet Games search handles empty results, service errors, compatibility and missing artwork", async () => {
  const h = await setup(),
    status = h.win.querySelector(".internet-games-status");
  await h.search("");
  expect(status.textContent).toBe("Type a game name.");
  await h.search("nothing");
  expect(status.textContent).toBe("No games found.");
  h.failSearch("catalog offline");
  await h.search("game");
  expect(status.textContent).toBe("catalog offline");
  h.failSearch(null);
  h.setResults([
    {
      uuid: "one",
      title: "Custom Game",
      tags: ["Puzzle"],
      compatible: false,
      incompatibleReason: "Unsupported engine",
    },
    { uuid: "two", title: "Blocked", potentiallyCompatible: false },
    { uuid: "three", title: "Big Truck Adventures", developer: "Author" },
  ]);
  await h.search("test");
  expect(status.textContent).toBe("3 games");
  const cards = [
    ...h.win.querySelectorAll(".internet-games-results .internet-game-card"),
  ];
  cards[0].querySelector("img").dispatchEvent(new h.s.window.Event("error"));
  expect(cards[0].querySelector("img").hidden).toBeTrue();
  expect(cards[1].querySelector("button").disabled).toBeTrue();
  expect(cards[2].querySelector("button").textContent).toBe("Play");
  cards[0].querySelector("button").click();
  await flushShell();
  expect(status.textContent).toBe("Unsupported engine");
});
test("Internet Games installs, opens and uninstalls a game with retryable failures", async () => {
  const h = await setup(),
    status = h.win.querySelector(".internet-games-status");
  h.setResults([
    {
      uuid: "one",
      title: "Custom Game",
      type: "iframe",
      compatible: true,
      icon: "assets/icons/freecell.png",
      tags: [],
    },
  ]);
  await h.search("custom");
  const install = h.win.querySelector(".internet-games-results button");
  h.failInstall("disk full");
  install.click();
  await flushShell();
  expect(status.textContent).toBe("disk full");
  expect(install.disabled).toBeFalse();
  h.failInstall(null);
  install.click();
  await flushShell();
  await flushShell();
  expect(install.textContent).toBe("Play");
  expect(status.textContent).toContain("is installed.");
  const tab = h.win.querySelector('[data-internet-tab="installed"]');
  tab.click();
  expect(
    h.win.querySelector(".internet-games-installed-status").textContent,
  ).toBe("1 game");
  h.win.querySelector(".internet-games-installed button").click();
  await flushShell();
  expect(
    !!h.s.document.querySelector(
      '.xp-window[data-game="flashpoint:one"] iframe',
    ),
  ).toBeTrue();
  const remove = () =>
    [...h.win.querySelectorAll(".internet-games-installed button")].find(
      (b) => b.textContent === "Uninstall",
    );
  remove().click();
  await h.answer("No");
  expect(!!remove()).toBeTrue();
  h.failUninstall("remove failed");
  remove().click();
  await h.answer("Yes");
  expect(h.s.document.querySelector(".xp-dialog").textContent).toContain(
    "remove failed",
  );
  await h.answer("OK");
  expect(remove().disabled).toBeFalse();
  h.failUninstall(null);
  remove().click();
  await h.answer("Yes");
  expect(
    h.win.querySelector(".internet-games-installed-status").textContent,
  ).toContain("No games installed");
  expect(
    h.s.document.querySelector('.xp-window[data-game="flashpoint:one"]') ===
      null,
  ).toBeTrue();
  for (const key of ["ArrowLeft", "ArrowRight"])
    tab.dispatchEvent(
      new h.s.window.KeyboardEvent("keydown", { key, bubbles: true }),
    );
  expect(
    h.win
      .querySelector('[data-internet-tab="browse"]')
      .getAttribute("aria-selected"),
  ).toBe("true");
});
test("Internet Games reports initialization failures without submitting a search", async () => {
  const h = await setup({ broken: true });
  await h.search("anything");
  expect(h.win.querySelector(".internet-games-status").textContent).toBe(
    "library unavailable",
  );
  expect(h.calls).toEqual([]);
});

test("Internet Games describes sparse results and failures without messages", async () => {
  const h = await setup(),
    status = h.win.querySelector(".internet-games-status");
  h.failSearch("");
  await h.search("game");
  expect(status.textContent).toBe("Search didn't work. Try again.");
  h.failSearch(null);
  h.setResults([{ uuid: "sparse", tags: "Flash only", compatible: false }]);
  await h.search("sparse");
  expect(status.textContent).toBe("1 game");
  const card = h.win.querySelector(
    ".internet-games-results .internet-game-card",
  );
  expect(card.textContent).toContain("Untitled game");
  expect(card.textContent).toContain("Unknown developer");
  card.querySelector("button").click();
  await flushShell();
  expect(status.textContent).toBe("This game doesn't work here.");
  h.setResults([{ uuid: "quiet", title: "Quiet", compatible: true }]);
  await h.search("quiet");
  h.failInstall("");
  h.win.querySelector(".internet-games-results button").click();
  await flushShell();
  expect(status.textContent).toBe("The game could not be installed.");

  h.setResults([{ uuid: "included", title: "Big Truck Adventures" }]);
  await h.search("big truck");
  h.win.querySelector(".internet-games-results button").click();
  await flushShell();
  expect(
    !!h.s.document.querySelector(
      '.xp-window[data-game="big-truck-adventures"]',
    ),
  ).toBeTrue();
  h.win
    .querySelector('[data-internet-tab="browse"]')
    .dispatchEvent(new h.s.window.KeyboardEvent("keydown", { key: "Enter" }));
});

test("Internet Games lists several installed games, reinstalled results, and quiet uninstall failures", async () => {
  const h = await setup(),
    status = h.win.querySelector(".internet-games-status");
  h.setResults([
    { uuid: "b", title: "Beta", compatible: true },
    { uuid: "a", compatible: true },
  ]);
  await h.search("games");
  for (const button of [
    ...h.win.querySelectorAll(".internet-games-results button"),
  ]) {
    button.click();
    await flushShell();
    await flushShell();
  }
  await h.search("games");
  expect(
    [...h.win.querySelectorAll(".internet-games-results button")].map(
      (button) => button.textContent,
    ),
  ).toEqual(["Play", "Play"]);
  h.win.querySelector('[data-internet-tab="installed"]').click();
  expect(
    h.win.querySelector(".internet-games-installed-status").textContent,
  ).toBe("2 games");
  h.failUninstall("");
  const untitled = [
    ...h.win.querySelectorAll(".internet-games-installed .internet-game-card"),
  ].find((card) => card.textContent.includes("Untitled game"));
  [...untitled.querySelectorAll("button")].at(-1).click();
  await flushShell();
  expect(h.s.document.querySelector(".xp-dialog").textContent).toContain(
    "Remove this game from this computer?",
  );
  await h.answer("Yes");
  expect(h.s.document.querySelector(".xp-dialog").textContent).toContain(
    "The game could not be uninstalled.",
  );
  await h.answer("OK");
  expect(status).toBeDefined();
});

test("removing an installed game closes it, drops it from favorites, and refreshes an open Start menu", async () => {
  const h = await setup();
  h.setResults([{ uuid: "fav", title: "Favorite", compatible: true }]);
  await h.search("fav");
  h.win.querySelector(".internet-games-results button").click();
  await flushShell();
  await flushShell();
  h.s.window.localStorage.setItem(
    "favorites",
    JSON.stringify(["flashpoint:fav"]),
  );
  h.win.querySelector(".internet-games-results button").click();
  await flushShell();
  expect(
    !!h.s.document.querySelector('.xp-window[data-game="flashpoint:fav"]'),
  ).toBeTrue();
  h.s.document.getElementById("start-button").click();
  delete h.installed["flashpoint:fav"];
  h.records.delete("flashpoint:fav");
  h.emit();
  await flushShell();
  await flushShell();
  expect(
    !!h.s.document.querySelector('.xp-window[data-game="flashpoint:fav"]'),
  ).toBeFalse();
  expect(h.s.window.localStorage.getItem("favorites")).not.toContain(
    "flashpoint:fav",
  );
});

test("Internet Games reports an unavailable service without a message", async () => {
  const h = await setup({ broken: true, brokenMessage: "" });
  await h.search("anything");
  expect(h.win.querySelector(".internet-games-status").textContent).toBe(
    "Internet Games isn't available right now.",
  );
});

test("installed games open and uninstall without desktop shortcuts when documents are read-only", async () => {
  const h = await setup({ documentStorage: "unavailable" });
  const fs = h.s.window.VirtualFS;
  await fs.ready;
  expect(fs.canWrite).toBeFalse();
  h.setResults([{ uuid: "ro", title: "Read Only", compatible: true }]);
  await h.search("read");
  h.win.querySelector(".internet-games-results button").click();
  await flushShell();
  await flushShell();
  expect(fs.findByApp("flashpoint:ro")).toEqual([]);
  h.win.querySelector(".internet-games-results button").click();
  await flushShell();
  expect(
    !!h.s.document.querySelector('.xp-window[data-game="flashpoint:ro"]'),
  ).toBeTrue();
  delete h.installed["flashpoint:ro"];
  h.records.delete("flashpoint:ro");
  h.emit();
  await flushShell();
  await flushShell();
  expect(
    !!h.s.document.querySelector('.xp-window[data-game="flashpoint:ro"]'),
  ).toBeFalse();
});

test("Internet Games shows no installed games when the library cannot be created", async () => {
  const s = await login(
    await loadShell({ gameLibraryManager: new Error("no storage") }),
  );
  s.document
    .querySelector('[data-desktop-id="__internet-games"]')
    .dispatchEvent(new s.window.MouseEvent("dblclick", { bubbles: true }));
  const win = s.document.querySelector(
    '.xp-window[data-game="__internet-games"]',
  );
  win.querySelector('[data-internet-tab="installed"]').click();
  expect(
    win.querySelector(".internet-games-installed-status").textContent,
  ).toBe("No games installed.");
  win.querySelector("#internet-games-query").value = "anything";
  win
    .querySelector("form")
    .dispatchEvent(
      new s.window.Event("submit", { bubbles: true, cancelable: true }),
    );
  await flushShell();
  expect(win.querySelector(".internet-games-status").textContent).toBe(
    "no storage",
  );
});

test("Internet Games sorts untitled installed games first and logs failed refreshes", async () => {
  const h = await setup();
  h.setResults([
    { uuid: "b", title: "Beta", compatible: true },
    { uuid: "x", compatible: true },
    { uuid: "a", title: "Alpha", compatible: true },
    { uuid: "y", compatible: true },
  ]);
  await h.search("games");
  for (const button of [
    ...h.win.querySelectorAll(".internet-games-results button"),
  ]) {
    button.click();
    await flushShell();
    await flushShell();
  }
  h.win.querySelector('[data-internet-tab="installed"]').click();
  const titles = () =>
    [
      ...h.win.querySelectorAll(
        ".internet-games-installed .internet-game-card h2",
      ),
    ].map((title) => title.textContent);
  expect(titles()).toEqual(["Untitled game", "Untitled game", "Alpha", "Beta"]);

  const errors = [];
  const originalError = h.s.window.console.error;
  h.s.window.console.error = (...args) => errors.push(args);
  const get = h.records.get;
  h.records.get = () => {
    throw new Error("corrupt record");
  };
  try {
    h.emit();
    await flushShell();
    await flushShell();
  } finally {
    h.records.get = get;
    h.s.window.console.error = originalError;
  }
  expect(errors.map(([error]) => error.message)).toEqual(["corrupt record"]);
});

test("page requests skip installed games while the game library is unavailable", async () => {
  const matched = [];
  const s = await login(
    await loadShell({
      fetchObject: async () => new Response("network"),
      gameLibraryManager: {
        subscribe: () => () => {},
        initialize: async () => {
          throw new Error("library unavailable");
        },
        match: async (request) => {
          matched.push(request);
          return new Response("installed");
        },
      },
    }),
  );
  const response = await s.window.fetch("https://game.example/asset.swf");
  expect(await response.text()).toBe("network");
  expect(matched).toEqual([]);
});

test("uninstalling a game that is not open only removes it from the library", async () => {
  const h = await setup();
  h.setResults([{ uuid: "closed", title: "Closed Game", compatible: true }]);
  await h.search("closed");
  h.win.querySelector(".internet-games-results button").click();
  await flushShell();
  await flushShell();
  expect(
    h.s.document.querySelector('.xp-window[data-game="flashpoint:closed"]'),
  ).toBeNull();
  delete h.installed["flashpoint:closed"];
  h.records.delete("flashpoint:closed");
  h.emit();
  await flushShell();
  await flushShell();
  h.win.querySelector('[data-internet-tab="installed"]').click();
  expect(
    h.win.querySelector(".internet-games-installed-status").textContent,
  ).toBe("No games installed.");
});

test("Installed games keep the keys on a button that the list draws again", async () => {
  const h = await setup();
  h.setResults([
    { uuid: "a", title: "Alpha", compatible: true },
    { uuid: "b", title: "Beta", compatible: true },
  ]);
  await h.search("games");
  for (const button of [
    ...h.win.querySelectorAll(".internet-games-results button"),
  ]) {
    button.click();
    await flushShell();
    await flushShell();
  }
  const tab = h.win.querySelector('[data-internet-tab="installed"]');
  tab.click();
  const button = (title, label) =>
    [
      ...([
        ...h.win.querySelectorAll(
          ".internet-games-installed .internet-game-card",
        ),
      ]
        .find((card) => card.querySelector("h2").textContent === title)
        ?.querySelectorAll("button") || []),
    ].find((entry) => entry.textContent === label) || null;
  const play = button("Beta", "Play");
  play.focus();
  h.emit();
  await flushShell();
  await flushShell();
  expect(play.isConnected).toBeFalse();
  expect(h.s.document.activeElement === button("Beta", "Play")).toBeTrue();

  // A game that is gone gives the keys to the Installed tab.
  const uninstall = button("Beta", "Uninstall");
  uninstall.focus();
  uninstall.click();
  await flushShell();
  await h.answer("Yes");
  expect(button("Beta", "Play")).toBeNull();
  expect(h.s.document.activeElement === tab).toBeTrue();
});
