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
      "yesAllNoCancel",
      "yesNo",
      "yesNoCancel",
      "yesNoClosable",
    ]);
  });

  test("gives no Ctrl shortcut letter while Alt or AltGr is down, like XP", () => {
    const { shortcutKeyOf, accessKeyOf } = loadDialogs();
    const key = (init) => ({
      code: "KeyS",
      key: "s",
      getModifierState: () => false,
      ...init,
    });
    // A Russian layout types "ы" on the S key. The place gives the letter.
    expect(shortcutKeyOf(key({ key: "ы", ctrlKey: true }))).toBe("s");
    // AltGr sends Ctrl and Alt. A Polish layout types "ś" with it.
    expect(shortcutKeyOf(key({ key: "ś", ctrlKey: true, altKey: true }))).toBe(
      "",
    );
    expect(
      shortcutKeyOf(
        key({ key: "ś", getModifierState: (name) => name === "AltGraph" }),
      ),
    ).toBe("");
    // An event with no modifier state, such as one from a script, gives
    // the letter.
    expect(shortcutKeyOf({ key: "S", code: "KeyS" })).toBe("s");
    // Alt+letter is an access key. It keeps the place of a key in a text
    // box, so Alt+F works with each layout.
    expect(
      accessKeyOf(
        key({
          key: "а",
          code: "KeyF",
          altKey: true,
          target: { tagName: "TEXTAREA" },
        }),
      ),
    ).toBe("f");
  });

  test("tells AltGr from Alt with each shape of the event", () => {
    const { isAltGr, isAccessKeyPress, typedCharacterOf } = loadDialogs();
    const event = (init, altGraph = false) => ({
      key: "ę",
      code: "KeyE",
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      getModifierState: (name) => name === "AltGraph" && altGraph,
      ...init,
    });
    // AltGr types "ę" with each shape: Ctrl and Alt, Ctrl and the AltGraph
    // state, or only the AltGraph state.
    for (const shape of [
      event({ ctrlKey: true, altKey: true }),
      event({ ctrlKey: true }, true),
      event({}, true),
    ]) {
      expect(isAltGr(shape)).toBeTrue();
      expect(isAccessKeyPress(shape)).toBeFalse();
      expect(typedCharacterOf(shape)).toBe("ę");
    }
    // Alt with no Ctrl is Alt, also when the engine gives the AltGraph
    // state for it.
    for (const alt of [
      event({ key: "e", altKey: true }),
      event({ key: "e", altKey: true }, true),
    ]) {
      expect(isAltGr(alt)).toBeFalse();
      expect(isAccessKeyPress(alt)).toBeTrue();
      expect(typedCharacterOf(alt)).toBe("");
    }
    // Ctrl, Meta and named keys type nothing.
    expect(typedCharacterOf(event({ key: "e", ctrlKey: true }))).toBe("");
    expect(typedCharacterOf(event({ key: "e", metaKey: true }))).toBe("");
    expect(typedCharacterOf(event({ key: "Enter" }))).toBe("");
    expect(typedCharacterOf(event({ key: "e", isComposing: true }))).toBe("");
    expect(typedCharacterOf(event({ key: "e" }))).toBe("e");
    // An event with no modifier state is not AltGr.
    expect(isAltGr({ key: "e" })).toBeFalse();
  });

  // A Russian keyboard sends Ctrl+Alt+A as "ф" on KeyA. With no layout
  // map and no learned key, the letter of another script is the plain
  // letter of the key, so Ctrl+Alt+A is no AltGr key there, like on a US
  // keyboard. AltGr on such a layout types signs and Latin letters.
  test("tells Ctrl+Alt from AltGr on a layout that the shell did not learn", () => {
    const { isAltGr, typedCharacterOf } = loadDialogs();
    const ctrlAlt = (key, code) => ({
      key,
      code,
      ctrlKey: true,
      altKey: true,
      metaKey: false,
      getModifierState: () => false,
    });
    for (const [key, code] of [
      ["ф", "KeyA"],
      ["Ф", "KeyA"],
      ["ς", "KeyW"],
      ["a", "KeyA"],
    ]) {
      expect(isAltGr(ctrlAlt(key, code))).toBeFalse();
      expect(typedCharacterOf(ctrlAlt(key, code))).toBe("");
    }
    for (const [key, code] of [
      ["€", "KeyE"],
      ["ę", "KeyE"],
      ["@", "KeyQ"],
      ["ф", "Digit1"],
    ]) {
      expect(isAltGr(ctrlAlt(key, code))).toBeTrue();
      expect(typedCharacterOf(ctrlAlt(key, code))).toBe(key);
    }
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
    // Like XP's message box, Yes and No has no Escape target. XP's own
    // shell questions, such as Confirm File Delete, close with Esc as No.
    expect(sets.yesNo.some((b) => b.isCancel)).toBeFalse();
    expect(sets.yesNoClosable.find((b) => b.id === "no").isCancel).toBe(true);
    expect(sets.yesNoClosable.find((b) => b.id === "yes").isCancel).toBeFalsy();
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

  test("names file types and Details dates like XP", () => {
    const dialogs = loadDialogs();
    expect(dialogs.describeFileType(".JPG")).toBe("JPEG Image");
    expect(dialogs.describeFileType(".txt")).toBe("Text Document");
    expect(dialogs.describeFileType(".zip")).toBe("ZIP File");
    expect(dialogs.describeFileType("")).toBe("File");
    expect(dialogs.describeFileType(undefined)).toBe("File");
    expect(
      dialogs.formatDetailsDate(new Date(2008, 3, 14, 9, 5).getTime()),
    ).toBe("4/14/2008 9:05 AM");
    expect(
      dialogs.formatDetailsDate(new Date(2008, 11, 1, 0, 0).getTime()),
    ).toBe("12/1/2008 12:00 AM");
    expect(
      dialogs.formatDetailsDate(new Date(2008, 0, 2, 12, 30).getTime()),
    ).toBe("1/2/2008 12:30 PM");
    expect(
      dialogs.formatDetailsDate(new Date(2008, 0, 2, 23, 59).getTime()),
    ).toBe("1/2/2008 11:59 PM");
  });

  test("formats negative and non-numeric sizes as zero bytes", () => {
    const dialogs = loadDialogs();
    expect(dialogs.formatBytes(-1)).toBe("0 bytes");
    expect(dialogs.formatBytes(NaN)).toBe("0 bytes");
  });
});
