(() => {
  "use strict";

  // Serves the application shell listed in self.__ASTRO_XP_PRECACHE__. The
  // download itself lives in shell-cache.js, which the page also runs.
  const IGNORED_PARAMETERS = [/^utm_/, /^fbclid$/, /^v$/];

  const fetchFile = self.AstroShellCache.reportMissingFiles({
    clients: self.clients,
    fetch: (request) => fetch(request),
  });
  const shell = self.AstroShellCache.createShellCache({
    base: self.location.href,
    caches,
    fetch: (request) => fetch(request),
    manifest: self.__ASTRO_XP_PRECACHE__,
  });

  const activate = async () => {
    await shell.removeOtherFiles();
    await self.clients.claim();
  };

  const respond = async (request, entry) =>
    (await shell.match(entry)) || fetchFile(request);

  self.addEventListener("install", (event) => {
    event.waitUntil(shell.install());
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
    const entry = shell.entryFor(url, IGNORED_PARAMETERS);
    if (entry) event.respondWith(respond(event.request, entry));
  });
})();
