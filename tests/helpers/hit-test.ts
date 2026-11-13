// @ts-nocheck -- Happy DOM has no layout, so it reads the site's CSS here.
import { readdirSync, readFileSync } from "node:fs";

// The site's pointer-events rules, as [selector, value] pairs.
const cssRoot = new URL("../../site/css/", import.meta.url);
const pointerRules = readdirSync(cssRoot, { recursive: true })
  .filter((file) => file.endsWith(".css"))
  .flatMap((file) =>
    [
      ...readFileSync(new URL(file, cssRoot), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .matchAll(/([^{}]+)\{([^{}]*)\}/g),
    ].flatMap(([, selectors, body]) => {
      const value = /pointer-events:\s*(\w+)/.exec(body)?.[1];
      if (!value) return [];
      return selectors.split(",").map((selector) => [selector.trim(), value]);
    }),
  );

const matches = (element, selector) => {
  try {
    return element.matches(selector);
  } catch {
    // A selector that Happy DOM cannot read, such as a pseudo-element.
    return false;
  }
};

// The pointer-events value of an element. Like in CSS, it inherits.
const pointerEvents = (element) => {
  for (let node = element; node; node = node.parentElement) {
    const rule = pointerRules.findLast(([selector]) => matches(node, selector));
    if (rule) return rule[1];
  }
  return "auto";
};

// The element that gets the pointer at an element's spot in Chrome: the
// element, or the first parent that takes the pointer.
export const hitTarget = (element) => {
  let node = element;
  while (node.parentElement && pointerEvents(node) === "none")
    node = node.parentElement;
  return node;
};

// A pointer event where Chrome would send it.
export const pointerAt = (s, element, type) => {
  const target = hitTarget(element);
  target.dispatchEvent(
    new s.window.PointerEvent(type, { bubbles: true, cancelable: true }),
  );
  return target;
};
