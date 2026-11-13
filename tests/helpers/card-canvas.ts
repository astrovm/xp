// @ts-nocheck -- Canvas stand-ins for the card games, played through Happy DOM.

// The board's canvas reports the game's client area. Its drawing calls are
// recorded per frame, and card images keep their file names so a frame shows
// which card is drawn where.
export const recordCardCanvas = (
  window,
  {
    board: boardClass,
    width: boardWidth,
    height: boardHeight,
    failImages = false,
    screenHeight,
  },
) => {
  const frames = [[]];
  const proto = window.HTMLCanvasElement.prototype;
  const getContext = proto.getContext;
  const rendered = new Map();
  proto.getContext = function () {
    const canvas = this as HTMLCanvasElement;
    const context = getContext.call(canvas);
    const board = () => canvas.classList.contains(boardClass);
    context.drawImage = (image, x, y, ...size) => {
      if (board()) {
        frames.at(-1).push([image.dataset?.face ?? image.src, x, y, ...size]);
        return;
      }
      const count = (rendered.get(image.src) || 0) + 1;
      rendered.set(image.src, count);
      canvas.dataset.face = `${image.src}${count === 2 ? " inverted" : ""}`;
    };
    // The board's last transform: its scale shows how the deal fits.
    context.setTransform = (...values) => {
      if (board()) frames.transform = values;
    };
    context.fillRect = (x, y, width) => {
      if (board() && x === 0 && y === 0 && width >= 500) frames.push([]);
    };
    // White and black pixels, so the inverted faces swap both.
    context.getImageData = (x, y, width, height) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let index = 0; index < data.length; index += 8)
        data.fill(255, index, index + 4);
      return { data, width, height };
    };
    return context;
  };
  for (const [property, value] of [
    ["clientWidth", boardWidth],
    ["clientHeight", boardHeight],
  ])
    Object.defineProperty(proto, property, {
      configurable: true,
      get() {
        return this.classList.contains(boardClass) ? value : 0;
      },
    });
  proto.getBoundingClientRect = function () {
    return {
      left: 0,
      top: 0,
      width: boardWidth,
      height: boardHeight,
      right: boardWidth,
      bottom: boardHeight,
    };
  };
  if (screenHeight)
    Object.defineProperty(window.screen, "height", { get: () => screenHeight });
  window.Image = class extends window.EventTarget {
    complete = false;
    get src() {
      return this.source;
    }
    set src(value) {
      this.source = value.replace(/^.*?assets\//, "assets/");
      queueMicrotask(() => {
        if (
          failImages &&
          (value.includes("assets/xp/cards") ||
            value.includes("assets/xp/spider"))
        )
          return this.onerror?.();
        this.complete = true;
        this.onload?.();
        this.dispatchEvent(new window.Event("load"));
      });
    }
  };
  // Happy DOM never resizes, so tests call the observer themselves.
  window.ResizeObserver = class {
    constructor(callback) {
      window.cardGameResize = callback;
    }
    observe() {}
    disconnect() {}
  };
  return frames;
};

const SUITS = "CDHS";
const RANKS = "A23456789TJQK";
// cards.dll numbers its faces by suit, then rank.
export const face = (name, inverted = false) =>
  `assets/xp/cards/faces/${SUITS.indexOf(name[1]) * 13 + RANKS.indexOf(name[0]) + 1}.png${inverted ? " inverted" : ""}`;

// The games read their font files from the disk. A read can take longer than
// a few turns of the event loop when other tests run at the same time, so
// `read()` waits until every read is done.
export const siteFiles = ({ failFont = false } = {}) => {
  let reading = 0;
  const fetchObject = async (url) => {
    if (failFont) return new Response(null, { status: 404 });
    const path = String(url).replace(/^.*?assets\//, "assets/");
    reading += 1;
    try {
      return new Response(
        await Bun.file(
          new URL(`../../site/${path}`, import.meta.url),
        ).arrayBuffer(),
      );
    } finally {
      reading -= 1;
    }
  };
  const read = async () => {
    while (reading) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { fetchObject, read };
};
