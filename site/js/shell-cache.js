"use strict";

// Downloads the application shell listed in a worker's precache manifest.
// Each file is stored under its path plus its content revision, so a file
// already stored by an earlier version is never downloaded again. The service
// worker runs this on install, and the page runs it first because Chrome
// slows down fetches made by an installing worker.
(function exposeShellCache(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.AstroShellCache = api;
  }
})(globalThis, () => {
  const CACHE_NAME = "astro-xp-shell-v1";
  // The Workbox precache used before this cache. Its files are reused once.
  const LEGACY_CACHE_PREFIX = "astro-xp-precache-";
  // HTTP/2 runs these side by side; 64 measured fastest against 16 and 32.
  const CONCURRENCY = 64;
  const ATTEMPTS = 3;
  const RETRY_DELAY = 500;
  // Releases used to live under /releases/<version>/.
  const RELEASE_PREFIX = /^\/releases\/[^/]+(?=\/)/;
  const MANIFEST_LINE = /^self\.__ASTRO_XP_PRECACHE__=(.*);$/m;
  const MISSING_FILE_MESSAGE = "ASTRO_FILE_MISSING";

  const stablePath = (pathname) => pathname.replace(RELEASE_PREFIX, "");

  const parseWorkerManifest = (source) => {
    const match = source.match(MANIFEST_LINE);
    if (!match) throw new Error("The update file list is missing.");
    return JSON.parse(match[1]);
  };

  const toBase64 = (buffer) => {
    let binary = "";
    for (const byte of new Uint8Array(buffer)) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  };

  // Cloudflare redirects .html paths, and a redirected response cannot answer
  // a navigation, so it is stored as a plain response.
  const cleanResponse = (response) =>
    response.redirected
      ? new Response(response.body, {
          headers: response.headers,
          status: response.status,
          statusText: response.statusText,
        })
      : response;

  const retryable = (status) =>
    status === 408 || status === 429 || status >= 500;

  // An open tab of an older release asks for files the newest deploy removed.
  // The page offers a reload when it hears about one.
  const reportMissingFiles =
    ({ clients, fetch }) =>
    async (request) => {
      const response = await fetch(request);
      if (response.status === 404) {
        for (const client of await clients.matchAll({ type: "window" })) {
          client.postMessage({ type: MISSING_FILE_MESSAGE });
        }
      }
      return response;
    };

  const createShellCache = ({
    manifest,
    base,
    caches,
    fetch,
    wait = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  }) => {
    const entryUrl = (entry) => new URL(entry.url, base);
    const cacheKey = (entry) => {
      const url = entryUrl(entry);
      url.pathname = stablePath(url.pathname);
      url.search = `__rev=${entry.revision}`;
      return url.href;
    };
    const routes = new Map(
      manifest.map((entry) => [stablePath(entryUrl(entry).pathname), entry]),
    );

    const download = async (entry) => {
      for (let attempt = 1; ; attempt += 1) {
        let response;
        try {
          response = await fetch(
            new Request(entryUrl(entry), {
              // Most files never change, but the fixed entry points do.
              cache: attempt > 1 || entry.fixed ? "reload" : "default",
              credentials: "same-origin",
              integrity: entry.integrity,
            }),
          );
        } catch (error) {
          if (attempt >= ATTEMPTS) throw error;
          await wait(RETRY_DELAY * attempt);
          continue;
        }
        if (response.ok) return cleanResponse(response);
        if (attempt >= ATTEMPTS || !retryable(response.status)) {
          throw new Error(`${entry.url} failed (${response.status})`);
        }
        await wait(RETRY_DELAY * attempt);
      }
    };

    const legacyFiles = async () => {
      const files = new Map();
      for (const name of await caches.keys()) {
        if (!name.startsWith(LEGACY_CACHE_PREFIX)) continue;
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          files.set(stablePath(new URL(request.url).pathname), {
            cache,
            request,
          });
        }
      }
      return files;
    };

    // A legacy copy is used only when its bytes match the expected integrity.
    const reuseLegacyFile = async (legacy, entry) => {
      const response = await legacy?.cache.match(legacy.request);
      if (!response) return null;
      const body = await response.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-384", body);
      return `sha384-${toBase64(digest)}` === entry.integrity
        ? new Response(body, {
            headers: response.headers,
            status: response.status,
            statusText: response.statusText,
          })
        : null;
    };

    const install = async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = new Set(
        (await cache.keys()).map((request) => request.url),
      );
      const missing = manifest.filter((entry) => !cached.has(cacheKey(entry)));
      const legacy = missing.length ? await legacyFiles() : new Map();
      let next = 0;
      let failed = false;
      const worker = async () => {
        while (!failed && next < missing.length) {
          const entry = missing[next];
          next += 1;
          try {
            const response =
              (await reuseLegacyFile(
                legacy.get(stablePath(entryUrl(entry).pathname)),
                entry,
              )) || (await download(entry));
            await cache.put(cacheKey(entry), response);
          } catch (error) {
            failed = true;
            throw error;
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker),
      );
      return missing.length;
    };

    const removeOtherFiles = async () => {
      const cache = await caches.open(CACHE_NAME);
      const current = new Set(manifest.map(cacheKey));
      await Promise.all(
        (await cache.keys())
          .filter((request) => !current.has(request.url))
          .map((request) => cache.delete(request)),
      );
      await Promise.all(
        (await caches.keys())
          .filter((name) => name.startsWith(LEGACY_CACHE_PREFIX))
          .map((name) => caches.delete(name)),
      );
    };

    const entryFor = (url, ignoredParameters) => {
      const route = new URL(url);
      for (const name of [...route.searchParams.keys()]) {
        if (ignoredParameters.some((pattern) => pattern.test(name))) {
          route.searchParams.delete(name);
        }
      }
      if (route.search) return null;
      const path = stablePath(route.pathname);
      return (
        routes.get(path) ||
        routes.get(path.endsWith("/") ? `${path}index.html` : `${path}.html`) ||
        null
      );
    };

    const match = async (entry) =>
      (await caches.open(CACHE_NAME)).match(cacheKey(entry));

    return { cacheKey, entryFor, install, match, removeOtherFiles };
  };

  return {
    CACHE_NAME,
    LEGACY_CACHE_PREFIX,
    MISSING_FILE_MESSAGE,
    cleanResponse,
    createShellCache,
    parseWorkerManifest,
    reportMissingFiles,
    stablePath,
  };
});
