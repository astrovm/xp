(() => {
  "use strict";

  // Caches the application shell listed in self.__ASTRO_XP_PRECACHE__. Each
  // file is stored under its path without the release prefix plus its content
  // revision, so an update only downloads the files whose content changed.
  const CACHE_NAME = "astro-xp-shell-v1";
  // The Workbox precache used before this worker. Its files are reused once.
  const LEGACY_CACHE_PREFIX = "astro-xp-precache-";
  const CONCURRENCY = 16;
  const ATTEMPTS = 3;
  const RETRY_DELAY = 500;
  const RELEASE_PREFIX = /^\/releases\/[^/]+(?=\/)/;
  const IGNORED_PARAMETERS = [/^utm_/, /^fbclid$/, /^v$/];

  const manifest = self.__ASTRO_XP_PRECACHE__;
  const stablePath = (pathname) => pathname.replace(RELEASE_PREFIX, "");
  const entryUrl = (entry) => new URL(entry.url, self.location.href);
  const cacheKey = (entry) => {
    const url = entryUrl(entry);
    url.pathname = stablePath(url.pathname);
    url.search = `__rev=${entry.revision}`;
    return url.href;
  };
  const routes = new Map(
    manifest.map((entry) => [stablePath(entryUrl(entry).pathname), entry]),
  );

  const wait = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

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

  const download = async (entry) => {
    for (let attempt = 1; ; attempt += 1) {
      let response;
      try {
        response = await fetch(
          new Request(entryUrl(entry), {
            // Release files never change, but the root page does.
            cache:
              attempt > 1 || !RELEASE_PREFIX.test(entryUrl(entry).pathname)
                ? "reload"
                : "default",
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

  const toBase64 = (buffer) => {
    let binary = "";
    for (const byte of new Uint8Array(buffer)) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
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
    const cached = new Set((await cache.keys()).map((request) => request.url));
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
  };

  const activate = async () => {
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
    await self.clients.claim();
  };

  const routeFor = (url) => {
    for (const name of [...url.searchParams.keys()]) {
      if (IGNORED_PARAMETERS.some((pattern) => pattern.test(name))) {
        url.searchParams.delete(name);
      }
    }
    if (url.search) return null;
    const path = stablePath(url.pathname);
    return (
      routes.get(path) ||
      routes.get(path.endsWith("/") ? `${path}index.html` : `${path}.html`)
    );
  };

  const respond = async (request, entry) => {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(cacheKey(entry))) || fetch(request);
  };

  self.addEventListener("install", (event) => {
    event.waitUntil(install());
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(activate());
  });

  self.addEventListener("message", (event) => {
    if (event.data?.type === "SKIP_WAITING") {
      self.skipWaiting();
    } else if (event.data?.type === "GET_VERSION") {
      event.ports[0]?.postMessage({ version: self.__ASTRO_XP_VERSION__ });
    }
  });

  self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;
    const entry = routeFor(url);
    if (entry) event.respondWith(respond(event.request, entry));
  });
})();
