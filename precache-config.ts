// Which release files the service worker downloads on install. Everything else
// loads on demand or through the optional game downloads.
export const PRECACHE_EXTENSIONS = [
  "ttf",
  "woff",
  "woff2",
  "css",
  "ico",
  "svg",
  "bmp",
  "mp3",
  "wav",
  "fnt",
  "png",
  "jpg",
  "jpeg",
  "cur",
  "json",
  "html",
  "js",
  "mjs",
  "wasm",
  "data",
  "swf",
  "jsdos",
  "xml",
  "phtml",
] as const;

export const PRECACHE_IGNORES = [
  "version.json",
  // Asset provenance manifests; nothing loads them at runtime.
  "assets/*/SOURCES*.json",
  "swf/**",
  "iframe/**",
  "dos/**",
  "vendor/scummvm/**",
  "js/*.wasm",
  "js/core.ruffle.*.js",
  // The worker scripts load through importScripts, not the precache.
  "js/offline-worker.*.js",
  "js/shell-worker.*.js",
] as const;

export const PRECACHE_MAXIMUM_FILE_SIZE = 25_000_000;
