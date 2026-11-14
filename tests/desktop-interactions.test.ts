// @ts-nocheck -- Happy DOM supplies the browser objects.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { cleanupShells, loadShell, login } from "./helpers/shell-harness";
afterEach(cleanupShells);

describe("desktop", () => {
  test("preserves text and binary contents of uploaded files", async () => {
    const s = await login(await loadShell());
    const pickers = [];
    const pickerClick = spyOn(
      s.window.HTMLInputElement.prototype,
      "click",
    ).mockImplementation(function () {
      pickers.push(this);
    });
    try {
      openMenu(s).querySelector('[data-action="upload"]').click();
    } finally {
      pickerClick.mockRestore();
    }
    const [picker] = pickers;
    expect(picker.multiple).toBeTrue();
    Object.defineProperty(picker, "files", {
      value: [
        new s.window.File(["hello"], "note.txt"),
        new s.window.File([new Uint8Array([0, 255, 128, 42])], "bytes.bin", {
          type: "application/octet-stream",
        }),
      ],
    });
    picker.dispatchEvent(new s.window.Event("change"));
    const fs = s.window.VirtualFS;
    for (
      let attempt = 0;
      attempt < 50 && !fs.findChild(fs.DESKTOP, "bytes.bin");
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(fs.findChild(fs.DESKTOP, "note.txt").content).toBe("hello");
    const binary = fs.findChild(fs.DESKTOP, "bytes.bin");
    expect(binary.content).toBe(
      "data:application/octet-stream;base64,AP+AKg==",
    );
    expect(binary.size).toBe(4);
  });

  test("reports an uploaded file that the browser cannot read", async () => {
    const s = await login(await loadShell());
    const pickers = [];
    const pickerClick = spyOn(
      s.window.HTMLInputElement.prototype,
      "click",
    ).mockImplementation(function () {
      pickers.push(this);
    });
    try {
      openMenu(s).querySelector('[data-action="upload"]').click();
    } finally {
      pickerClick.mockRestore();
    }
    s.window.FileReader = class extends s.window.EventTarget {
      readAsDataURL() {
        this.error = new Error("");
        queueMicrotask(() => this.dispatchEvent(new s.window.Event("error")));
      }
    };
    Object.defineProperty(pickers[0], "files", {
      value: [
        new s.window.File([new Uint8Array([1])], "locked.bin", {
          type: "application/octet-stream",
        }),
      ],
    });
    pickers[0].dispatchEvent(new s.window.Event("change"));
    // The Copying progress box closes, then the error opens.
    const error = () =>
      [...s.document.querySelectorAll(".xp-dialog")].find((dialog) =>
        dialog.textContent.includes("The file operation failed."),
      );
    for (let attempt = 0; attempt < 50 && !error(); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(Boolean(error())).toBeTrue();
    expect(s.document.querySelectorAll(".xp-dialog")).toHaveLength(1);
    const fs = s.window.VirtualFS;
    expect(fs.findChild(fs.DESKTOP, "locked.bin")).toBeNull();
  });

  // Like XP, an uploaded file with a name in use asks Confirm File
  // Replace. It never gets a new name such as "note (2).txt".
  test("asks Confirm File Replace for an uploaded file with a name in use", async () => {
    const s = await login(await loadShell());
    const fs = s.window.VirtualFS;
    fs.createFile(fs.DESKTOP, "note.txt", { content: "old" });
    const pickers = [];
    const pickerClick = spyOn(
      s.window.HTMLInputElement.prototype,
      "click",
    ).mockImplementation(function () {
      pickers.push(this);
    });
    try {
      openMenu(s).querySelector('[data-action="upload"]').click();
    } finally {
      pickerClick.mockRestore();
    }
    Object.defineProperty(pickers[0], "files", {
      value: [new s.window.File(["new"], "note.txt")],
    });
    pickers[0].dispatchEvent(new s.window.Event("change"));
    const question = () =>
      [...s.document.querySelectorAll(".xp-dialog")].find(
        (dialog) =>
          dialog.querySelector(".title-text")?.textContent ===
          "Confirm File Replace",
      );
    for (let attempt = 0; attempt < 50 && !question(); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(question().textContent).toContain(
      "This folder already contains a file named 'note.txt'.",
    );
    question().querySelector('[data-action="yes"]').click();
    for (
      let attempt = 0;
      attempt < 50 && fs.findChild(fs.DESKTOP, "note.txt").content !== "new";
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(
      fs.getChildren(fs.DESKTOP).filter((node) => /^note/.test(node.name)),
    ).toHaveLength(1);
    expect(fs.findChild(fs.DESKTOP, "note.txt").content).toBe("new");
  });

  const openMenu = (shell) => {
    shell.document.getElementById("desktop-icons").dispatchEvent(
      new shell.window.MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 300,
        clientY: 200,
      }),
    );
    return shell.document.getElementById("desktop-context-menu");
  };
  const key = (shell, element, value, options = {}) =>
    element.dispatchEvent(
      new shell.window.KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    );

  test("toggles an icon with Ctrl-click without clearing other selections", async () => {
    const s = await login(await loadShell());
    const [a, b] = s.document.querySelectorAll(".desktop-icon");
    a.click();
    for (const icon of [b, b]) {
      icon.dispatchEvent(
        new s.window.PointerEvent("pointerdown", { button: 0, ctrlKey: true }),
      );
      icon.dispatchEvent(new s.window.PointerEvent("pointerup", { button: 0 }));
      icon.dispatchEvent(new s.window.MouseEvent("click", { ctrlKey: true }));
    }
    expect(a.classList.contains("selected")).toBeTrue();
    expect(b.classList.contains("selected")).toBeFalse();
  });

  test("keeps context menu arrow keys at their own submenu level", async () => {
    const s = await login(await loadShell());
    const menu = openMenu(s);
    const parent = menu.querySelector(".context-submenu-button");
    key(s, parent, "ArrowDown");
    expect(s.document.activeElement.dataset.action).toBe("refresh");
    parent.focus();
    key(s, parent, "ArrowRight");
    expect(s.document.activeElement.dataset.action).toBe("sort-name");
    key(s, s.document.activeElement, "ArrowDown");
    expect(s.document.activeElement.dataset.action).toBe("sort-size");
    key(s, s.document.activeElement, "ArrowLeft");
    expect(s.document.activeElement).toBe(parent);
    expect(parent.getAttribute("aria-expanded")).toBe("false");
  });

  test("sorts icons without enabling Auto Arrange", async () => {
    const s = await login(await loadShell());
    openMenu(s).querySelector('[data-action="sort-type"]').click();
    const settings = JSON.parse(
      s.window.localStorage.getItem("desktopLayoutSettings"),
    );
    expect(settings.sort).toBe("type");
    expect(settings.autoArrange).toBeFalse();
  });

  test("enters the icon list and toggles selection from the keyboard", async () => {
    const s = await login(await loadShell());
    const container = s.document.getElementById("desktop-icons");
    const icons = [...container.querySelectorAll(".desktop-icon")];
    container.focus();
    key(s, container, "ArrowDown");
    expect(s.document.activeElement).toBe(icons[0]);
    key(s, icons[0], " ", { ctrlKey: true });
    expect(icons[0].classList.contains("selected")).toBeFalse();
    key(s, icons[0], "End");
    expect(s.document.activeElement).toBe(icons.at(-1));
  });

  test("selects a range from the selection anchor with Shift-click", async () => {
    const s = await login(await loadShell());
    const icons = [...s.document.querySelectorAll(".desktop-icon")];
    icons[0].click();
    icons[3].dispatchEvent(
      new s.window.MouseEvent("click", { shiftKey: true }),
    );
    expect(
      icons.slice(0, 4).every((icon) => icon.classList.contains("selected")),
    ).toBeTrue();
    expect(icons[4].classList.contains("selected")).toBeFalse();
  });

  test("restores icon positions without saving them when a drag is cancelled", async () => {
    const s = await login(await loadShell());
    const icon = s.document.querySelector(".desktop-icon");
    const container = s.document.getElementById("desktop-icons");
    for (const [key, value] of Object.entries({
      clientWidth: 1024,
      clientHeight: 738,
    }))
      Object.defineProperty(container, key, { get: () => value });
    for (const [key, value] of Object.entries({
      offsetLeft: 20,
      offsetTop: 30,
      offsetWidth: 75,
      offsetHeight: 54,
    }))
      Object.defineProperty(icon, key, { get: () => value });
    icon.dispatchEvent(
      new s.window.PointerEvent("pointerdown", {
        button: 0,
        clientX: 30,
        clientY: 40,
      }),
    );
    icon.dispatchEvent(
      new s.window.PointerEvent("pointermove", { clientX: 100, clientY: 100 }),
    );
    expect(icon.style.left).toBe("90px");
    icon.dispatchEvent(new s.window.PointerEvent("pointercancel", {}));
    expect(icon.style.left).toBe("20px");
    expect(icon.style.top).toBe("30px");
    expect(s.window.localStorage.getItem("desktopIconPositions")).toBeNull();
  });

  test("keeps icons as one tab stop while arrow keys move focus", async () => {
    const s = await login(await loadShell());
    const icons = [...s.document.querySelectorAll(".desktop-icon")];
    icons[0].focus();
    expect(icons.filter((icon) => icon.tabIndex === 0)).toEqual([icons[0]]);
    icons[2].focus();
    expect(icons.filter((icon) => icon.tabIndex === 0)).toEqual([icons[2]]);
    expect(s.document.getElementById("desktop-icons").tabIndex).toBe(-1);
  });

  test("asks once before recycling the selected file on delete", async () => {
    const s = await login(await loadShell());
    openMenu(s).querySelector('[data-action="new-folder"]').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const input = s.document.querySelector(".desktop-rename");
    key(s, input, "Enter");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const icon = [...s.document.querySelectorAll(".desktop-icon")].find(
      (icon) => icon.textContent === "New Folder",
    );
    icon.dispatchEvent(
      new s.window.MouseEvent("contextmenu", { bubbles: true }),
    );
    s.document
      .querySelector('#desktop-context-menu [data-action="delete"]')
      .click();
    const yes = [
      ...s.document.querySelectorAll(".xp-dialog-overlay button"),
    ].find((button) => button.textContent === "Yes");
    expect(yes).toBeDefined();
    yes.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(s.document.querySelector(".xp-dialog-overlay")).toBeNull();
    expect(
      [...s.document.querySelectorAll(".desktop-icon")].some(
        (icon) => icon.textContent === "New Folder",
      ),
    ).toBeFalse();
  });
});

test("a desktop rebuild keeps an open rename box without renaming", async () => {
  const s = await login(await loadShell());
  const fs = s.window.VirtualFS;
  const file = fs.createFile(fs.DESKTOP, "keep.txt", { content: "" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const icon = (id) =>
    s.document.querySelector(`.desktop-icon[data-desktop-id="${id}"]`);
  const rename = (id) => {
    icon(id).dispatchEvent(
      new s.window.MouseEvent("contextmenu", { bubbles: true }),
    );
    s.document
      .querySelector(
        `#desktop-context-menu [data-action="${
          id === "__my-computer" ? "rename-my-computer" : "rename"
        }"]`,
      )
      .click();
    return s.document.querySelector(".desktop-rename");
  };
  // A change from another window rebuilds the icons.
  const rebuild = async () => {
    fs.createFile(fs.DESKTOP, `other${Math.random()}.txt`, { content: "" });
    await new Promise((resolve) => setTimeout(resolve, 20));
  };

  let input = rename(file.id);
  input.value = "typed.txt";
  input.setSelectionRange(0, 5);
  await rebuild();
  // Chrome fires blur on the box that the rebuild removed.
  input.dispatchEvent(new s.window.FocusEvent("blur"));
  expect(fs.getNode(file.id).name).toBe("keep.txt");
  input = s.document.querySelector(".desktop-rename");
  expect(input.dataset.desktopId).toBe(file.id);
  expect(input.value).toBe("typed.txt");
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
  // A box with no change shows the name that another window gave.
  input.value = input.dataset.originalName;
  fs.rename(file.id, "other.txt");
  await new Promise((resolve) => setTimeout(resolve, 20));
  input = s.document.querySelector(".desktop-rename");
  expect(input.value).toBe("other.txt");
  // A file that is gone takes its box with it.
  fs.delete(file.id);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(s.document.querySelector(".desktop-rename")).toBeNull();
  expect(fs.getNode(file.id).name).toBe("other.txt");

  // The same for My Computer, whose name is a setting.
  input = rename("__my-computer");
  input.value = "Computer";
  await rebuild();
  input.dispatchEvent(new s.window.FocusEvent("blur"));
  input = s.document.querySelector(".desktop-rename");
  expect(input.dataset.desktopId).toBe("__my-computer");
  expect(input.value).toBe("Computer");
  input.dispatchEvent(
    new s.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(icon("__my-computer").textContent).toBe("Computer");
});
