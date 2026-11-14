// The menu bar of a program that draws its own menus. It keeps the keys and
// mouse rules of the shell's game menus, like XP.
//
// A title opens a menu when it has aria-haspopup="menu". A title without it
// is a command, such as Spider's Deal!. Items are the menu's direct children
// with a menuitem role. An item with aria-haspopup="menu" holds a submenu,
// which shows with the "open" class.
const ITEM =
  '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';
const SUBMENU = '[role="menu"]';
// Keys that the shell runs from anywhere: the Windows key, Ctrl+Esc,
// Ctrl+Shift+Esc, Alt+Tab, Alt+Esc, Alt+F4 and Alt+Space.
const shellKey = ({ key, ctrlKey, altKey }) =>
  key === "Meta" ||
  (ctrlKey && key === "Escape") ||
  (altKey && ["Tab", "Escape", "F4", " "].includes(key));

export const wireMenuBar = ({
  windowElement,
  bar,
  // Shows the title's menu and returns it. A program that builds its menus
  // on open builds it here.
  showMenu,
  // Hides a menu that showMenu returned.
  hideMenu = (menu) => {
    menu.hidden = true;
  },
}) => {
  let openTitle = null;
  let openMenu = null;
  // The control that had the keys before the menus gets them back, like XP.
  let returnFocus = null;

  const titles = () =>
    [...bar.querySelectorAll(ITEM)].filter((item) => !item.closest(SUBMENU));
  const items = (menu) =>
    [...menu.children].filter((item) => item.matches(ITEM) && !item.disabled);
  const hasMenu = (title) => title.getAttribute("aria-haspopup") === "menu";
  // The item under the pointer. A submenu sits inside its parent item, so a
  // spot in the submenu that is not one of its items is no item at all.
  const itemAt = (target) => {
    const item = target.closest(ITEM);
    return item && !item.contains(target.closest(SUBMENU)) ? item : null;
  };
  const accessKey = (title) =>
    title.querySelector(".menu-accesskey")?.textContent.toLowerCase();

  windowElement.addEventListener("focusin", (event) => {
    const target = event.target;
    if (
      target === document.activeElement &&
      target !== windowElement &&
      !bar.contains(target)
    )
      returnFocus = target;
  });
  const giveKeysBack = () => {
    if (returnFocus?.isConnected && windowElement.contains(returnFocus))
      returnFocus.focus({ preventScroll: true });
    // The frame passes the keys on to the window's control.
    if (bar.contains(document.activeElement))
      windowElement.focus({ preventScroll: true });
  };

  const closeSubmenu = (parent) => {
    parent.setAttribute("aria-expanded", "false");
    parent.querySelector(SUBMENU).classList.remove("open");
  };
  const openSubmenu = (parent, focusFirst) => {
    const submenu = parent.querySelector(SUBMENU);
    parent.setAttribute("aria-expanded", "true");
    submenu.classList.add("open");
    if (focusFirst) items(submenu)[0]?.focus();
  };
  const hideMenus = () => {
    if (openMenu) hideMenu(openMenu);
    openMenu = null;
    openTitle = null;
    titles().forEach((title) => {
      if (hasMenu(title)) title.setAttribute("aria-expanded", "false");
    });
  };
  // Keys in the menus go back to the program first, so a close never
  // leaves them on the page.
  const close = () => {
    if (bar.contains(document.activeElement)) giveKeysBack();
    hideMenus();
  };
  const open = (title, focusFirst) => {
    hideMenus();
    openTitle = title;
    openMenu = showMenu(title);
    // The shell closes the menus on a press outside them and when the page
    // loses the keys.
    openMenu.closeMenus = close;
    title.setAttribute("aria-expanded", "true");
    if (focusFirst) items(openMenu)[0]?.focus();
  };
  // The keys move to the next title first, so they never leave the menus.
  const moveTo = (title, keepOpen) => {
    title.focus({ preventScroll: true });
    if (keepOpen && hasMenu(title)) open(title, true);
    else hideMenus();
  };
  const nextTitle = (title, direction) => {
    const list = titles();
    const index = list.indexOf(title);
    return list[(index + direction + list.length) % list.length];
  };

  // Keys that move to another window close the menus, like XP. They are
  // already gone, so they stay where they went.
  windowElement.addEventListener("focusout", (event) => {
    if (event.relatedTarget && !windowElement.contains(event.relatedTarget))
      hideMenus();
  });

  bar.addEventListener("click", (event) => {
    const item = itemAt(event.target);
    if (!item || !hasMenu(item)) return;
    if (item.closest(SUBMENU)) {
      if (item.getAttribute("aria-expanded") === "true") closeSubmenu(item);
      else openSubmenu(item, false);
      return;
    }
    if (item === openTitle) {
      close();
      return;
    }
    item.focus({ preventScroll: true });
    open(item, false);
  });

  bar.addEventListener("pointerover", (event) => {
    const item = itemAt(event.target);
    const menu = item?.closest(SUBMENU);
    if (!menu || !bar.contains(document.activeElement)) return;
    // A submenu that the keys opened closes when the pointer moves to
    // another item of its menu. Keys in it go to its parent first.
    menu
      .querySelectorAll(':scope > [aria-expanded="true"]')
      .forEach((parent) => {
        if (parent === item) return;
        if (parent.contains(document.activeElement))
          parent.focus({ preventScroll: true });
        closeSubmenu(parent);
      });
    if (!item.disabled) item.focus({ preventScroll: true });
  });

  const titleKey = (event, title) => {
    const key = event.key;
    // Tab does nothing while a menu is open, like XP.
    if (key === "Tab" && openMenu) event.preventDefault();
    else if (key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault();
      moveTo(nextTitle(title, key === "ArrowRight" ? 1 : -1), openMenu);
    } else if (
      hasMenu(title) &&
      (key === "ArrowDown" || key === "Enter" || key === " ")
    ) {
      event.preventDefault();
      open(title, true);
    } else if (key === "Escape") {
      event.preventDefault();
      // A first Escape closes the menu and keeps its title. A second one
      // gives the keys back to the program.
      if (openMenu) hideMenus();
      else giveKeysBack();
    }
  };
  const itemKey = (event, item) => {
    const key = event.key;
    const menu = item.closest(SUBMENU);
    // A submenu's parent is the item that holds it.
    const parent = menu.parentElement.closest(ITEM);
    const list = items(menu);
    const index = list.indexOf(item);
    if (key === "Escape") {
      event.preventDefault();
      // The keys move first, so the program never gets them for a moment.
      if (parent) {
        parent.focus();
        closeSubmenu(parent);
      } else {
        openTitle.focus({ preventScroll: true });
        hideMenus();
      }
    } else if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      const step = key === "ArrowDown" ? 1 : -1;
      list[(index + step + list.length) % list.length]?.focus();
    } else if (key === "Home" || key === "End") {
      event.preventDefault();
      (key === "Home" ? list[0] : list.at(-1))?.focus();
    } else if (hasMenu(item) && ["ArrowRight", "Enter", " "].includes(key)) {
      event.preventDefault();
      openSubmenu(item, true);
    } else if (key === "ArrowLeft" && parent) {
      event.preventDefault();
      parent.focus();
      closeSubmenu(parent);
    } else if (key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault();
      moveTo(nextTitle(openTitle, key === "ArrowRight" ? 1 : -1), true);
    }
  };

  // The window sees the keys first. Alt and a title's letter open its menu
  // from anywhere in the window, like XP.
  windowElement.addEventListener(
    "keydown",
    (event) => {
      const inBar = bar.contains(event.target);
      // The shell's own keys work from the menus too. The menus close
      // first, like XP, and the shell gets the key.
      if (inBar && shellKey(event)) {
        close();
        return;
      }
      const title =
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        titles().find(
          (entry) =>
            accessKey(entry) === globalThis.XPDialogs.accessKeyOf(event),
        );
      if (title) {
        event.preventDefault();
        event.stopPropagation();
        if (!hasMenu(title)) {
          close();
          title.click();
          return;
        }
        title.focus({ preventScroll: true });
        open(title, true);
        return;
      }
      if (!inBar) return;
      // The menus own the keys, like XP: the program never sees them, and
      // no shortcut of the program runs.
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey || event.altKey) {
        event.preventDefault();
        return;
      }
      const item = event.target.closest(ITEM);
      if (!item) return;
      if (item.closest(SUBMENU)) itemKey(event, item);
      else titleKey(event, item);
    },
    true,
  );

  return {
    close,
    isOpen: () => Boolean(openMenu),
  };
};
