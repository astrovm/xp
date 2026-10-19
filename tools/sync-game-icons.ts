/** Download curated Flashpoint game icons and record their provenance. */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const ICONS_DIR = join(PROJECT_DIR, "site", "assets", "icons");
const GAMES_PATH = join(PROJECT_DIR, "site", "js", "games.js");
const SOURCES_PATH = join(ICONS_DIR, "SOURCES.json");
const FIREWALL_ICON_PATH = join(
  PROJECT_DIR,
  "site",
  "iframe",
  "inside-the-firewall",
  "icon.png",
);
const FLASHPOINT_IMAGE_ROOT = "https://infinity.unstable.life/images/Logos";

const FLASHPOINT_UUIDS: Record<string, string> = {
  "big-truck-adventures": "2f48d53a-89da-1672-66c1-3f958ab39193",
  "big-truck-adventures-2": "89340168-558c-cb56-2d61-b3c5ad6a1796",
  "bike-mania": "021cace3-95d8-4575-9a9f-046e9323c728",
  "bike-mania-2": "609d817d-a54a-2e6c-0951-7d8d50781527",
  "bike-mania-3": "6ad53148-33c7-0fd0-9c7b-5baa815b752d",
  "bike-mania-4": "6200998e-6896-4eda-f798-b7fe47dd4d12",
  "bike-mania-5": "561ad92d-2c21-ee23-6fce-113a37448dea",
  "bike-mania-arena": "a2fb012a-b14c-6921-b688-403571e42bb0",
  "bike-mania-arena-2": "c072304c-658e-843b-e2f4-7edef76331a9",
  "bike-mania-arena-3": "3a1443e9-3dad-433c-a397-4c5e5870984d",
  "bike-mania-arena-4": "0104043d-b50e-b030-cea6-411ddebc530c",
  "bike-mania-arena-5": "147d9148-b069-551a-15e9-0656978b17ea",
  "dirt-bike": "f28836a1-3a61-483b-b76c-4be6b8926046",
  "dirt-bike-2": "aa4fb7df-e7f2-45be-bf52-1e3bcde75ca8",
  "dirt-bike-3": "7187f551-f688-4ee3-86bd-4bc77857ba97",
  "stunt-dirt-bike": "31c31fc3-2201-4823-8e54-7a5d52f8bf7c",
  "captain-usa": "96e0d6c4-a1d8-75fa-c0a9-834ec2e0e354",
  "dark-cut": "b0dcd08d-59c4-4cf1-90f6-93871f80d97f",
  "metal-slug-brutal": "71044857-0aff-479e-afba-60d4dd45e16a",
  "simpsons-wrecking-ball": "9fb4b4ae-a0bc-4c49-9be1-8b776b8151bf",
  "super-smash-flash": "53c978f6-9ddb-4dc5-bf6e-c06f1052bd7f",
  "ultimate-flash-sonic": "aab8ff04-e593-47c9-8186-a9e7c72f668e",
  "knd-operation-startup": "415be82a-a9c2-4dfc-9a50-1bf726f46db3",
  "knd-operation-startup-final": "415be82a-a9c2-4dfc-9a50-1bf726f46db3",
  "la-isla-de-lo-mono": "57e5752e-2d53-4d76-9699-408c9a111845",
  "dexter-runaway-robot": "a7e551f0-448a-1b44-f440-e5bf877a6484",
  "riddle-school": "e76eec88-dac8-4f8e-96e0-bf11ece64140",
  "riddle-school-2": "90bc0495-1394-4d37-b7cc-d719595bc083",
  "portal-flash": "b0d2b9a9-ab00-465e-b5a3-56031b92f070",
  "do-not-press": "b197a304-c553-4f63-9e47-e0f5f4c7ae60",
  "sugar-sugar": "4b9444a4-5545-4fc3-b03a-48b493d77890",
  "learn-to-fly": "11ee16a3-dadb-4d54-84dd-a3dcf124ee1d",
  "learn-to-fly-2": "891ac9f2-93da-4141-bd51-6a61c4aeea38",
  "learn-to-fly-3": "95b9df8c-59ce-45d1-ae0b-696e190d9e14",
  "whack-a-kass": "00d4f9a7-1453-4da3-a5d9-3c980abd9f17",
  "eds-candy-machine": "3421a170-8008-8f7a-90b9-f52629627b01",
  "knd-numbuh-generator": "ca9a5052-41bb-0d9a-2156-8a4746057099",
};

type IconSource = {
  file: string;
  source: string;
  retrieved: string;
  sha256: string;
};
function flashpointUrl(uuid: string): string {
  return `${FLASHPOINT_IMAGE_ROOT}/${uuid.slice(0, 2)}/${uuid.slice(2, 4)}/${uuid}.png`;
}
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

async function writeIcon(
  gameId: string,
  content: ArrayBuffer | Uint8Array,
  source: string,
): Promise<IconSource> {
  const normalized = await sharp(content)
    .ensureAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const file = `${gameId}.png`;
  await writeFile(join(ICONS_DIR, file), normalized);
  return {
    file,
    source,
    retrieved: today(),
    sha256: createHash("sha256").update(normalized).digest("hex"),
  };
}

function addIconMetadata(gameSource: string, gameId: string): string {
  const iconValue = `icon: "assets/icons/${gameId}.png"`;
  if (gameSource.includes(iconValue)) return gameSource;
  const expression = new RegExp(
    `("${gameId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}":\\s*\\{)(?![^}]*\\bicon:)`,
  );
  const updated = gameSource.replace(
    expression,
    `$1 icon: "assets/icons/${gameId}.png",`,
  );
  if (updated === gameSource)
    throw new Error(`Could not add icon metadata for ${gameId}`);
  return updated;
}

async function fetchIcon(source: string): Promise<ArrayBuffer> {
  const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok)
    throw new Error(`Request failed with status ${response.status}: ${source}`);
  return response.arrayBuffer();
}

async function main() {
  await mkdir(ICONS_DIR, { recursive: true });
  const sources = JSON.parse(await readFile(SOURCES_PATH, "utf8")) as Record<
    string,
    IconSource
  >;
  let gameSource = await readFile(GAMES_PATH, "utf8");
  for (const [gameId, uuid] of Object.entries(FLASHPOINT_UUIDS)) {
    const source = flashpointUrl(uuid);
    sources[gameId] = await writeIcon(gameId, await fetchIcon(source), source);
    gameSource = addIconMetadata(gameSource, gameId);
  }
  const gameId = "inside-the-firewall";
  sources[gameId] = await writeIcon(
    gameId,
    await readFile(FIREWALL_ICON_PATH),
    "iframe/inside-the-firewall/icon.png",
  );
  gameSource = addIconMetadata(gameSource, gameId);
  await writeFile(
    SOURCES_PATH,
    `${JSON.stringify(Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`,
  );
  await writeFile(GAMES_PATH, gameSource);
  console.log(`Synced ${Object.keys(FLASHPOINT_UUIDS).length + 1} icons.`);
}

if (import.meta.main) await main();
