# reVCDOS runtime

- Project: https://github.com/Lolendor/reVCDOS
- Commit: `95f14ef3c1d0a872ecd0881544cc7e1f55cb1946`
- Runtime package: `vc-sky-en-v6`
- Retrieved: 2026-07-29
- WASM SHA-256: `db6aa7b9169a638e06b17f7bed5a6b3e473e00ae7bbb47354729fa94b971ebf2`

The browser runtime, page, modules, and package manifest are vendored from that
Lolendor commit. Original-game media from the upstream distribution is not
bundled. Astro XP does not bundle the compatible game-data package.

Files selected or downloaded by the user are streamed once into a single
indexed OPFS file. The offline service worker serves slices of that file through
same-origin HTTP-like requests, including byte ranges. The upstream
135,355,111-byte preload and remaining runtime assets therefore use normal
`fetch()`/XHR paths without per-file parent-frame messages. After a torrent is
packed successfully, its peer connections and piece store are destroyed.

The upstream MIT license is stored in `LOLENDOR-LICENSE`.

Automatic downloads use the torrent metadata published by DOS.Zone at
`https://br.cdn.dos.zone/launcher/revcdoseng.2.torrent` (info hash
`489dae72cb4433fadd7d38a12bb52a23b5a7cc1e`). The torrent metadata contains file
names, hashes, and tracker addresses, but not the game data itself.

The browser downloader is WebTorrent from the `webtorrent` npm package.
The build copies its browser bundle into `vendor/webtorrent/`.

The DOS.Zone Team attribution, in-game logo, and `jsdos-cloud-sdk.js` cloud-save
integration required by the upstream project are preserved.

Astro XP starts the game with `fullscreen=0`, so it opens in its window. The
window's fullscreen button still works. `game.js` is changed to lock the mouse
for the camera in a window too.
