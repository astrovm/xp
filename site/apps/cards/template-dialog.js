// Builds a dialog from a Win32 dialog template: sizes and positions in
// dialog units, which XP's 8-point MS Shell Dlg (Tahoma) turns into 6 by 13
// pixels per four horizontal and eight vertical units.
export const dialogUnitsX = (value) => Math.round((value * 6) / 4);
export const dialogUnitsY = (value) => Math.round((value * 13) / 8);

const place = (element, [x, y, width, height]) => {
  element.classList.add("xp-template-control");
  Object.assign(element.style, {
    left: `${dialogUnitsX(x)}px`,
    top: `${dialogUnitsY(y)}px`,
    width: `${dialogUnitsX(width)}px`,
    height: `${dialogUnitsY(height)}px`,
  });
};

// Controls: { type: "button" | "checkbox" | "radio" | "group" | "edit" |
// "text" | "image", id, label, group (a radio button's set), src (an
// image's file, shown at its own size), rect: [x, y, width, height],
// isDefault, center }. `owner` holds the owning window and its client area.
// `position` is the dialog's corner in dialog units from the client area;
// "center", the way freecell.exe centers its dialogs: over the client area,
// below a 26-pixel caption and a 20-pixel menu bar; or a function that
// takes the dialog's size and returns its corner. Modeless dialogs, such as
// Calculator's Statistics Box, leave their owner usable.
export const openTemplateDialog = ({
  dialogs,
  setAccessKeyText,
  owner,
  title,
  size,
  controls,
  position = "center",
  systemMenu = true,
  help = false,
  modal = true,
}) => {
  // A modeless dialog stays above its owner window, like XP.
  const dialog = dialogs.createDialog({
    title,
    systemMenu,
    help,
    modal,
    owner: modal ? null : owner.window.dataset.game,
  });
  dialog.el.classList.add("xp-template-dialog");
  const { body } = dialog;
  body.classList.add("xp-template-body");
  body.style.width = `${dialogUnitsX(size[0])}px`;
  body.style.height = `${dialogUnitsY(size[1])}px`;
  const elements = {};
  const registerKey = (label, target) => {
    const { key } = dialogs.parseAccessKey(label);
    if (key) dialog.accessKeys.set(key, target);
  };
  controls.forEach((control) => {
    let element;
    if (control.type === "button") {
      element = dialogs.createDialogButton(control, (id) => dialog.close(id));
      if (control.isDefault) dialog.defaultButton = element;
      registerKey(control.label, element);
    } else if (control.type === "group") {
      element = document.createElement("fieldset");
      element.className = "dlg-group xp-template-group";
      const legend = document.createElement("legend");
      setAccessKeyText(legend, control.label);
      element.append(legend);
    } else if (control.type === "checkbox" || control.type === "radio") {
      element = document.createElement("label");
      element.className = "xp-template-checkbox";
      const box = document.createElement("input");
      box.type = control.type;
      if (control.group) box.name = control.group;
      const text = document.createElement("span");
      setAccessKeyText(text, control.label);
      element.append(box, text);
      // Windows centers the box and text vertically, rounding down.
      element.style.setProperty(
        "--inset",
        `${Math.floor((dialogUnitsY(control.rect[3]) - 13) / 2)}px`,
      );
      registerKey(control.label, box);
      elements[control.id] = box;
    } else if (control.type === "image") {
      element = document.createElement("img");
      element.className = "xp-template-image";
      element.src = control.src;
      element.alt = "";
    } else if (control.type === "edit") {
      element = document.createElement("input");
      element.type = "text";
      element.className = "xp-input";
      element.setAttribute("aria-label", control.label);
    } else {
      element = document.createElement("div");
      element.className = "xp-template-text";
      element.classList.toggle("center", Boolean(control.center));
      element.textContent = control.label;
    }
    place(element, control.rect);
    // Icons keep their own size, whatever the control's rectangle.
    if (control.type === "image")
      element.style.width = element.style.height = "";
    if (control.id && !["checkbox", "radio"].includes(control.type))
      elements[control.id] = element;
    body.append(element);
  });
  const clientRect = owner.client.getBoundingClientRect();
  let left;
  let top;
  if (typeof position === "function") {
    const dialogRect = dialog.el.getBoundingClientRect();
    ({ left, top } = position({
      width: dialogRect.width,
      height: dialogRect.height,
    }));
  } else if (position === "center") {
    const windowRect = owner.window.getBoundingClientRect();
    left =
      windowRect.left +
      Math.floor((clientRect.width - dialogUnitsX(size[0])) / 2);
    top =
      windowRect.top +
      46 +
      Math.floor((clientRect.height - dialogUnitsY(size[1])) / 2);
  } else {
    left = clientRect.left + dialogUnitsX(position[0]);
    top = clientRect.top + dialogUnitsY(position[1]);
  }
  dialog.el.style.position = "absolute";
  dialog.el.style.left = `${Math.max(0, Math.round(left))}px`;
  dialog.el.style.top = `${Math.max(0, Math.round(top))}px`;
  dialog.defaultButton.focus();
  return { dialog, elements };
};
