// @ts-nocheck -- Application definitions accept loosely typed plugin metadata.
import { describe, expect, test } from "bun:test";

import { defineApplication } from "../site/apps/core/application.js";
import {
  createRetryingLoader,
  defineLazyApplication,
} from "../site/apps/core/lazy-application.js";
import { createApplicationRegistry } from "../site/apps/core/registry.js";
import { defineProgram } from "../site/apps/programs/define-program.js";

const element = { nodeType: 1 };
const metadata = {
  id: "example",
  title: "Example",
  icon: "Example.png",
  kind: "program",
};

describe("application definitions", () => {
  test("require a mount function and non-empty text fields", () => {
    expect(() => defineApplication({ id: "example" })).toThrow(
      "Application example must define mount()",
    );
    expect(() => defineApplication({})).toThrow(
      "Application definition must define mount()",
    );
    expect(() =>
      defineApplication({
        ...metadata,
        title: " ",
        mount: () => ({ element }),
      }),
    ).toThrow("Application title must be a non-empty string");
  });

  test("require a group title for a program with many windows", () => {
    const mount = () => ({ element });
    expect(() =>
      defineApplication({ ...metadata, mount, window: { manyWindows: true } }),
    ).toThrow("Application groupTitle must be a non-empty string");
    expect(
      defineApplication({
        ...metadata,
        mount,
        groupTitle: "Example Processor",
        window: { manyWindows: true },
      }).groupTitle,
    ).toBe("Example Processor");
    expect(
      defineApplication({ ...metadata, mount }).groupTitle,
    ).toBeUndefined();
  });

  test("normalize file types and supply a default unmount", () => {
    const application = defineApplication({
      ...metadata,
      fileTypes: [".TXT", ".txt"],
      mount: () => ({ element }),
    });
    expect(application.fileTypes).toEqual([".txt"]);
    expect(application.window).toEqual({ width: 640, height: 470 });
    const mounted = application.mount({}, {});
    expect(mounted.element).toBe(element);
    expect(mounted.unmount()).toBeUndefined();
    expect(() =>
      defineApplication({ ...metadata, mount: () => ({}) }).mount(),
    ).toThrow("mount() must return an element");
  });

  test("lazy applications refuse to mount before loading and retry failed loads", async () => {
    let attempts = 0;
    const lazy = defineLazyApplication(metadata, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("network");
      return defineApplication({ ...metadata, mount: () => ({ element }) });
    });
    expect(() => lazy.mount()).toThrow("Example is still loading.");
    await expect(lazy.load()).rejects.toThrow("network");
    expect(lazy.loaded).toBeNull();
    await lazy.load();
    expect(lazy.mount().element).toBe(element);
    expect(attempts).toBe(2);
  });

  test("retrying loaders share one load and retry after a failure", async () => {
    const results = [Promise.reject(new Error("offline")), Promise.resolve(1)];
    let calls = 0;
    const load = createRetryingLoader(() => results[calls++]);
    const failed = load();
    expect(load()).toBe(failed);
    await expect(failed).rejects.toThrow("offline");
    const loaded = load();
    expect(await loaded).toBe(1);
    expect(load()).toBe(loaded);
    expect(calls).toBe(2);
  });

  test("programs require a renderer for their kind", () => {
    expect(() => defineProgram({ ...metadata, kind: "spreadsheet" })).toThrow(
      "No renderer registered for application: example",
    );
    expect(defineProgram({ ...metadata, kind: "volume" }).mount).toBeFunction();
  });

  test("registries reject duplicate identifiers", () => {
    expect(() =>
      createApplicationRegistry([{ id: "same" }, { id: "same" }]),
    ).toThrow("Duplicate application id: same");
    expect(createApplicationRegistry([{ id: "one" }]).get("two")).toBeNull();
  });
});
