// Run inside a test container with a dev server and a disposable Chrome CDP
// endpoint: bun tools/check-flash-input.mjs http://127.0.0.1:8000 http://127.0.0.1:9222
import { setTimeout as delay } from "node:timers/promises";

const site = process.argv[2] || "http://127.0.0.1:8000";
const endpoint = process.argv[3] || "http://127.0.0.1:9222";
let target;
let socket;
try {
  target = await fetch(`${endpoint}/json/new?about:blank`, {
    method: "PUT",
  }).then((response) => response.json());
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Chrome WebSocket connection timed out")),
      15000,
    );
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("Chrome WebSocket connection failed"));
      },
      { once: true },
    );
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails)
      throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  const waitFor = async (expression) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`Page did not reach: ${expression}`);
  };

  // A generated, silent SWF reports its real ActionScript mouse coordinates.
  // It contains no third-party game data and needs no Flashpoint download.
  const u16 = (value) => [value & 255, (value >> 8) & 255];
  const action = (code, data) => [code, ...u16(data.length), ...data];
  const push = (value) => action(0x96, [0, ...Buffer.from(value), 0]);
  const handler = (name, label) => {
    const body = [
      ...push(label),
      0x26,
      ...push("_xmouse"),
      0x1c,
      0x26,
      ...push("_ymouse"),
      0x1c,
      0x26,
      0,
    ];
    return [
      ...push(name),
      ...action(0x9b, [0, 0, 0, ...u16(body.length)]),
      ...body,
      0x1d,
    ];
  };
  const tag = (code, data) => [
    ...u16((code << 6) | 63),
    ...new Uint8Array(new Uint32Array([data.length]).buffer),
    ...data,
  ];
  const bits = `${(14).toString(2).padStart(5, "0")}${[0, 7000, 0, 5000]
    .map((value) => value.toString(2).padStart(14, "0"))
    .join("")}`.padEnd(64, "0");
  const rect = Array.from({ length: 8 }, (_, index) =>
    Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2),
  );
  const signed = (value) => (value & 16383).toString(2).padStart(14, "0");
  const edges = `000100000000101${[
    [false, 7000],
    [true, 5000],
    [false, -7000],
    [true, -5000],
  ]
    .map(([vertical, value]) => `1111000${vertical ? 1 : 0}${signed(value)}`)
    .join("")}000000`;
  const shapeBits = edges.padEnd(Math.ceil(edges.length / 8) * 8, "0");
  const shape = Array.from({ length: shapeBits.length / 8 }, (_, index) =>
    Number.parseInt(shapeBits.slice(index * 8, index * 8 + 8), 2),
  );
  const bytes = Buffer.from([
    70,
    87,
    83,
    7,
    0,
    0,
    0,
    0,
    ...rect,
    0,
    30,
    2,
    0,
    ...tag(2, [1, 0, ...rect, 1, 0, 0, 0, 0, 0, ...shape]),
    ...tag(26, [6, 1, 0, 1, 0, 0]),
    ...tag(12, [
      ...handler("onMouseDown", "down"),
      ...push("frame"),
      0x26,
      ...push("_xmouse"),
      0x1c,
      0x26,
      ...push("_ymouse"),
      0x1c,
      0x26,
      0,
    ]),
    ...u16(64),
    ...u16(64),
    ...u16(0),
  ]);
  bytes.writeUInt32LE(bytes.length, 4);
  const data = JSON.stringify(bytes.toString("base64"));

  for (const ratio of [1, 1.25, 1.5, 1.75, 2, 2.625]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: ratio,
      mobile: false,
    });
    await send("Page.navigate", { url: site });
    await waitFor(
      "typeof gameLibraryReady !== 'undefined' && gameLibraryReady",
    );
    await evaluate(`(async () => {
      await login(false);
      const id = 'flash-input-probe';
      const bytes = Uint8Array.from(atob(${data}), c => c.charCodeAt(0));
      gamesList[id] = {
        title: 'Flash input probe', type: 'swf', category: 'Tests',
        url: URL.createObjectURL(new Blob([bytes])),
        base: location.origin + '/', aspectRatio: 1.4,
      };
      setGameVolume(id, 0, true);
      openGameWindow(id);
    })()`);
    await waitFor("!!document.querySelector('ruffle-player')?.metadata");
    await waitFor(
      "getComputedStyle(document.querySelector('ruffle-player').shadowRoot.querySelector('#splash-screen')).display === 'none'",
    );
    await evaluate(`(() => {
      window.inputTraces = [];
      const player = document.querySelector('ruffle-player');
      player.traceObserver = value => inputTraces.push(value);
      player.shadowRoot.querySelector('canvas').addEventListener('pointerdown', event => {
        window.inputEvent = { trusted: event.isTrusted, captured: event.currentTarget.hasPointerCapture(event.pointerId) };
      });
      player.shadowRoot.querySelector('#hardware-acceleration-modal .close-modal')?.click();
    })()`);
    await waitFor("inputTraces.includes('frame')");
    const position = await evaluate(`(() => {
      const rect = document.querySelector('ruffle-player').getBoundingClientRect();
      const scale = Math.min(rect.width / 350, rect.height / 250);
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + (rect.height - 250 * scale) / 2 + 116 * scale,
      };
    })()`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...position });
    await evaluate(`(() => {
      document.querySelector('ruffle-player').shadowRoot.querySelector('#hardware-acceleration-modal .close-modal')?.click();
      inputTraces.length = 0;
    })()`);
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: position.x + 1,
      y: position.y + 1,
    });
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", {
        type,
        ...position,
        button: "left",
        clickCount: 1,
      });
    }
    await delay(200);
    const traces = await evaluate("inputTraces");
    const inputEvent = await evaluate("window.inputEvent");
    if (!inputEvent?.trusted || !inputEvent.captured)
      throw new Error(
        "Flash did not receive trusted input with pointer capture",
      );
    for (const label of ["frame", "down"]) {
      const index = traces.lastIndexOf(label);
      const x = Number(traces[index + 1]);
      const y = Number(traces[index + 2]);
      const error = Math.max(Math.abs(x - 175), Math.abs(y - 116));
      console.log(
        `${ratio} DPR, ${label}: (${x}, ${y}), error ${error.toFixed(2)} SWF px`,
      );
      if (index < 0 || !Number.isFinite(error) || error > 0.5)
        throw new Error(
          `Flash ${label} coordinates miss the visible point at ${ratio} DPR`,
        );
    }
  }
} finally {
  socket?.close();
  if (target?.id) await fetch(`${endpoint}/json/close/${target.id}`);
}
