// @ts-nocheck
import { expect, test } from "bun:test";

import shellCache from "../site/js/shell-cache.js";

const manifest = [
  { integrity: "sha384-a", revision: "aaaaaaaa", url: "js/a.11111111.js" },
  {
    fixed: true,
    integrity: "sha384-i",
    revision: "iiiiiiii",
    url: "index.html",
  },
];

test("reads the file list from a worker script", () => {
  const source = [
    'self.__ASTRO_XP_VERSION__="26.10.19-abcdef1";',
    `self.__ASTRO_XP_PRECACHE__=${JSON.stringify(manifest)};`,
    'importScripts("js/shell-cache.12345678.js");',
  ].join("\n");
  expect(shellCache.parseWorkerManifest(source)).toEqual(manifest);
  expect(() => shellCache.parseWorkerManifest("importScripts();")).toThrow(
    "The update file list is missing.",
  );
});

test("finds the entry for a request", () => {
  const shell = shellCache.createShellCache({
    base: "https://xp.example/sw.26.10.19-abcdef1.js",
    caches: {},
    fetch: () => {},
    manifest,
  });
  const ignored = [/^utm_/];
  expect(shell.entryFor("https://xp.example/", ignored)).toBe(manifest[1]);
  expect(shell.entryFor("https://xp.example/index", ignored)).toBe(manifest[1]);
  expect(
    shell.entryFor("https://xp.example/js/a.11111111.js?utm_x=1", ignored),
  ).toBe(manifest[0]);
  expect(
    shell.entryFor("https://xp.example/js/a.11111111.js?x=1", ignored),
  ).toBe(null);
  expect(shell.entryFor("https://xp.example/js/", ignored)).toBe(null);
  expect(shell.cacheKey(manifest[0])).toBe(
    "https://xp.example/js/a.11111111.js?__rev=aaaaaaaa",
  );
});

test("waits between retries by default", async () => {
  let attempts = 0;
  const stored = [];
  const shell = shellCache.createShellCache({
    base: "https://xp.example/sw.js",
    caches: {
      open: async () => ({
        keys: async () => [],
        put: async (key) => stored.push(key),
      }),
      keys: async () => [],
    },
    fetch: async () => {
      attempts += 1;
      return new Response("", { status: attempts === 1 ? 503 : 200 });
    },
    manifest: [manifest[0]],
  });
  const started = Date.now();
  expect(await shell.install()).toBe(1);
  expect(Date.now() - started).toBeGreaterThanOrEqual(450);
  expect(stored).toEqual([shell.cacheKey(manifest[0])]);
});
