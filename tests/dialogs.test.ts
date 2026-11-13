// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadDialogs() {
  const dialogsPath = require.resolve("../site/js/dialogs.js");
  delete require.cache[dialogsPath];
  return require(dialogsPath);
}

describe("XP dialogs", () => {
  test("hides DOM APIs when loaded under Node", () => {
    const dialogs = loadDialogs();
    expect(dialogs.message).toBeUndefined();
    expect(dialogs.openFile).toBeUndefined();
  });

  test("provides the info, warning, error and question icon variants", () => {
    const dialogs = loadDialogs();
    ["info", "warning", "error", "question"].forEach((icon) => {
      expect(dialogs.ICONS).toContain(icon);
    });
  });

  test("defines the standard XP button sets", () => {
    const dialogs = loadDialogs();
    expect(Object.keys(dialogs.BUTTON_SETS).sort()).toEqual([
      "ok",
      "okCancel",
      "retryCancel",
      "yesNo",
      "yesNoCancel",
    ]);
  });

  test("gives each button set exactly one default button", () => {
    const dialogs = loadDialogs();
    Object.values(dialogs.BUTTON_SETS).forEach((buttons) => {
      expect(buttons.filter((b) => b.isDefault)).toHaveLength(1);
    });
  });

  test("gives every button an id and label", () => {
    const dialogs = loadDialogs();
    Object.values(dialogs.BUTTON_SETS).forEach((buttons) => {
      buttons.forEach((b) => {
        expect(b.id).toBeTruthy();
        expect(b.label).toBeTruthy();
      });
    });
  });

  test("marks the dismissing button of each set as the Escape target", () => {
    const sets = loadDialogs().BUTTON_SETS;
    expect(sets.ok[0].isCancel).toBe(true);
    expect(sets.okCancel.find((b) => b.id === "cancel").isCancel).toBe(true);
    expect(sets.yesNo.find((b) => b.id === "no").isCancel).toBe(true);
    expect(sets.yesNo.find((b) => b.id === "yes").isCancel).toBeFalsy();
    expect(sets.retryCancel.find((b) => b.id === "cancel").isCancel).toBe(true);
  });

  test("parses ampersand access keys from button labels", () => {
    const dialogs = loadDialogs();
    expect(dialogs.parseAccessKey("&Yes")).toEqual({ text: "Yes", key: "y" });
    expect(dialogs.parseAccessKey("&No")).toEqual({ text: "No", key: "n" });
    expect(dialogs.parseAccessKey("&Retry")).toEqual({
      text: "Retry",
      key: "r",
    });
    expect(dialogs.parseAccessKey("F&avorites")).toEqual({
      text: "Favorites",
      key: "a",
    });
    expect(dialogs.parseAccessKey("Cancel")).toEqual({
      text: "Cancel",
      key: null,
    });
  });

  test("formats byte sizes with XP units", () => {
    const dialogs = loadDialogs();
    expect(dialogs.formatBytes(0)).toBe("0 bytes");
    expect(dialogs.formatBytes(1)).toBe("1 byte");
    expect(dialogs.formatBytes(5)).toBe("5 bytes");
    expect(dialogs.formatBytes(1023)).toBe("1023 bytes");
    expect(dialogs.formatBytes(1536)).toBe("1.50 KB (1,536 bytes)");
    expect(dialogs.formatBytes(1048576)).toBe("1.00 MB (1,048,576 bytes)");
  });

  test("formats Details sizes in whole KB, rounded up, like XP", () => {
    const dialogs = loadDialogs();
    expect(dialogs.formatKilobytes(0)).toBe("0 KB");
    expect(dialogs.formatKilobytes(-5)).toBe("0 KB");
    expect(dialogs.formatKilobytes(1)).toBe("1 KB");
    expect(dialogs.formatKilobytes(1024)).toBe("1 KB");
    expect(dialogs.formatKilobytes(1025)).toBe("2 KB");
    expect(dialogs.formatKilobytes(28521)).toBe("28 KB");
    expect(dialogs.formatKilobytes(2048 * 1024)).toBe("2,048 KB");
  });

  test("formats negative and non-numeric sizes as zero bytes", () => {
    const dialogs = loadDialogs();
    expect(dialogs.formatBytes(-1)).toBe("0 bytes");
    expect(dialogs.formatBytes(NaN)).toBe("0 bytes");
  });
});
