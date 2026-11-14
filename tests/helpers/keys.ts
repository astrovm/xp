// @ts-nocheck -- Keyboard events that Happy DOM cannot make by itself.

// The keydown events of AltGr and a key. AltGr types characters, such as
// "ś" on the S key of a Polish keyboard. Windows sends it as Ctrl and Alt.
// A browser can also show it as the AltGraph state, with Ctrl. Happy DOM
// keeps no AltGraph state, so the second event gives its own.
export const altGrEvents = (window, key, code) => [
  new window.KeyboardEvent("keydown", {
    key,
    code,
    ctrlKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
  }),
  Object.defineProperty(
    new window.KeyboardEvent("keydown", {
      key,
      code,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
    "getModifierState",
    { value: (name) => name === "AltGraph" },
  ),
];

// Sends each AltGr event of the key to the element. It gives the events,
// so a test can check that no handler took them.
export const pressAltGr = (window, element, key, code) =>
  altGrEvents(window, key, code).map((event) => {
    element.dispatchEvent(event);
    return event;
  });
