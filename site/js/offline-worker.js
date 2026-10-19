(() => {
  "use strict";

  // The generated sw.js imports this file. shell-worker.js owns the small,
  // automatic application-shell precache; this handler serves only the
  // optional bundled games and shared Ruffle runtime selected by the user.
  const BUNDLED_GAME_CACHE = "astro-bundled-games-v1";
  const OPTIONAL_PATHS = ["/swf/", "/iframe/", "/dos/", "/vendor/scummvm/"];
  // Games whose data the user packs into one browser-storage file. Each has
  // its own directory, update message and the folder names its engine asks
  // for, which map onto the packed paths.
  const PACKED_GAMES = [
    {
      id: "revcdos",
      route: /\/iframe\/revcdos(?:\.[a-f0-9]{16})?\/local-assets\//,
      directory: "astro-xp-revcdos",
      message: "REVCDOS_PACK_UPDATED",
      title: "reVC",
      aliases: [
        [/^fetched\//, "vc-assets/local/"],
        [/^vcsky\/fetched\//, "vc-assets/local/"],
      ],
    },
  ];
  const PACKED_MANIFEST = "manifest.json";
  const SCUMMVM_ROUTE = "/iframe/scummvm/local-games/";
  const SCUMMVM_DIRECTORY = "astro-xp-scummvm";
  const packedStores = new Map();
  const scummvmStores = new Map();
  const releasePath = (path) => path.replace(/^\/releases\/[^/]+(?=\/)/, "");

  const normalizeAssetPath = (path) =>
    decodeURIComponent(path)
      .replaceAll("\\", "/")
      .replace(/^\/+/, "")
      .toLowerCase();

  const findPackedAsset = (files, requestedPath, aliases) => {
    const path = normalizeAssetPath(requestedPath);
    const candidates = [
      path,
      ...aliases.map(([pattern, target]) => path.replace(pattern, target)),
    ];
    for (const candidate of candidates) {
      if (files[candidate]) return files[candidate];
    }
    return null;
  };

  const openPackedStore = async ({ directory: name, title }) => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(name);
    const manifestHandle = await directory.getFileHandle(PACKED_MANIFEST);
    const manifest = JSON.parse(await (await manifestHandle.getFile()).text());
    if (
      manifest.version !== 1 ||
      typeof manifest.dataFile !== "string" ||
      typeof manifest.files !== "object"
    ) {
      throw new Error(`Invalid ${title} packed manifest`);
    }
    const dataHandle = await directory.getFileHandle(manifest.dataFile);
    const data = await dataHandle.getFile();
    if (data.size !== manifest.size) {
      throw new Error(`Incomplete ${title} packed data`);
    }
    return { data, files: manifest.files };
  };

  const parseRange = (header, length) => {
    if (!header) return { start: 0, end: length - 1, partial: false };
    const match = /^bytes=(\d*)-(\d*)$/.exec(header);
    if (!match) return null;
    let start = match[1] ? Number(match[1]) : null;
    let end = match[2] ? Number(match[2]) : null;
    if (start === null) {
      const suffix = end;
      if (!suffix) return null;
      start = Math.max(0, length - suffix);
      end = length - 1;
    } else {
      end = end === null ? length - 1 : Math.min(end, length - 1);
    }
    if (start < 0 || start > end || start >= length) return null;
    return { start, end, partial: true };
  };

  const servePackedAsset = async (game, request, url) => {
    try {
      if (!packedStores.has(game.id))
        packedStores.set(game.id, openPackedStore(game));
      const { data, files } = await packedStores.get(game.id);
      // The fetch handler only routes matching paths here.
      const [route] = url.pathname.match(game.route);
      const requestedPath = url.pathname.slice(
        url.pathname.indexOf(route) + route.length,
      );
      const asset = findPackedAsset(files, requestedPath, game.aliases);
      if (!asset) return new Response("Asset not found", { status: 404 });
      const range = parseRange(request.headers.get("range"), asset.length);
      if (!range) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${asset.length}` },
        });
      }
      const length = range.end - range.start + 1;
      const headers = new Headers({
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Length": String(length),
        "Content-Type": "application/octet-stream",
      });
      if (range.partial) {
        headers.set(
          "Content-Range",
          `bytes ${range.start}-${range.end}/${asset.length}`,
        );
      }
      return new Response(
        data.slice(asset.offset + range.start, asset.offset + range.end + 1),
        { status: range.partial ? 206 : 200, headers },
      );
    } catch (error) {
      packedStores.delete(game.id);
      return new Response(`Packed asset unavailable: ${error.message}`, {
        status: 503,
      });
    }
  };

  const openScummvmStore = async (gameId) => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(SCUMMVM_DIRECTORY);
    const manifestHandle = await directory.getFileHandle(
      `${gameId}-manifest.json`,
    );
    const manifest = JSON.parse(await (await manifestHandle.getFile()).text());
    if (
      manifest.version !== 1 ||
      typeof manifest.isoFile !== "string" ||
      typeof manifest.isoSize !== "number" ||
      typeof manifest.files !== "object"
    ) {
      throw new Error("Invalid ScummVM game manifest");
    }
    const isoHandle = await directory.getFileHandle(manifest.isoFile);
    const iso = await isoHandle.getFile();
    if (iso.size !== manifest.isoSize) {
      throw new Error("Incomplete ScummVM CD image");
    }
    return { files: manifest.files, iso };
  };

  const serveScummvmAsset = async (url) => {
    const path = url.pathname.slice(
      url.pathname.indexOf(SCUMMVM_ROUTE) + SCUMMVM_ROUTE.length,
    );
    const slash = path.indexOf("/");
    if (slash < 1) return new Response("Game not found", { status: 404 });
    const gameId = decodeURIComponent(path.slice(0, slash));
    const requestedName = decodeURIComponent(path.slice(slash + 1));
    try {
      if (!scummvmStores.has(gameId)) {
        scummvmStores.set(gameId, openScummvmStore(gameId));
      }
      const { files, iso } = await scummvmStores.get(gameId);
      if (requestedName === "index.json") {
        return new Response(
          JSON.stringify(
            Object.fromEntries(
              Object.entries(files).map(([name, entry]) => [name, entry.size]),
            ),
          ),
          {
            headers: {
              "Cache-Control": "no-store",
              "Content-Type": "application/json",
            },
          },
        );
      }
      const entry = files[requestedName.toUpperCase()];
      if (
        !entry ||
        !Number.isSafeInteger(entry.offset) ||
        !Number.isSafeInteger(entry.size) ||
        entry.offset < 0 ||
        entry.size < 0 ||
        entry.offset + entry.size > iso.size
      ) {
        return new Response("Game file not found", { status: 404 });
      }
      return new Response(iso.slice(entry.offset, entry.offset + entry.size), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Length": String(entry.size),
          "Content-Type": "application/octet-stream",
        },
      });
    } catch (error) {
      scummvmStores.delete(gameId);
      return new Response(`ScummVM game data unavailable: ${error.message}`, {
        status: 503,
      });
    }
  };

  const fetchFile = self.AstroShellCache.reportMissingFiles({
    clients: self.clients,
    fetch: (request) => fetch(request),
  });

  self.addEventListener("message", (event) => {
    const packed = PACKED_GAMES.find(
      ({ message }) => message === event.data?.type,
    );
    if (packed) {
      packedStores.delete(packed.id);
    } else if (event.data?.type === "SCUMMVM_GAME_UPDATED") {
      scummvmStores.delete(event.data.gameId);
    }
  });

  self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;
    const path = releasePath(url.pathname);
    const packedGame = PACKED_GAMES.find(({ route }) =>
      route.test(url.pathname),
    );
    if (packedGame) {
      event.respondWith(servePackedAsset(packedGame, event.request, url));
      return;
    }
    if (path.startsWith(SCUMMVM_ROUTE)) {
      event.respondWith(serveScummvmAsset(url));
      return;
    }
    const isGameFile = OPTIONAL_PATHS.some((prefix) => path.startsWith(prefix));
    const isRuffleRuntime =
      path.startsWith("/js/") &&
      (path.endsWith(".wasm") || /\/core\.ruffle\.[^/]+\.js$/.test(path));
    if (!isGameFile && !isRuffleRuntime) return;

    event.respondWith(
      caches.open(BUNDLED_GAME_CACHE).then(async (cache) => {
        // Downloads made before files were named by content were stored
        // under release paths without the release prefix (see offline.js).
        const key = new URL(url.href);
        key.pathname = path;
        // Paths are named by content, so a downloaded copy is always current.
        // Folder links open the index.html stored for them.
        const cached =
          (await cache.match(key.href, { ignoreSearch: true })) ||
          (key.pathname.endsWith("/") &&
            (await cache.match(`${key.origin}${key.pathname}index.html`)));
        // Downloads of .html files followed Cloudflare's redirect, and a
        // redirected response cannot open a page.
        return cached
          ? self.AstroShellCache.cleanResponse(cached)
          : fetchFile(event.request);
      }),
    );
  });
})();
