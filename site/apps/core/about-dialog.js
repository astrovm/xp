export const showXPAboutDialog = (
  dialogs,
  {
    title,
    product,
    version,
    copyright,
    icon,
    licensedTo = globalThis.VirtualFS.USER_NAME,
  },
) => {
  const dialog = dialogs.createDialog({ title, wide: true });
  dialog.el.classList.add("xp-about-dialog");

  const banner = document.createElement("img");
  banner.className = "xp-about-banner";
  banner.src = "/assets/xp/AboutWindows.png";
  banner.alt = "Microsoft Windows XP Professional";

  const productRow = document.createElement("div");
  productRow.className = "xp-about-product";
  const productIcon = document.createElement("img");
  productIcon.src = icon;
  productIcon.alt = "";
  const details = document.createElement("div");
  for (const line of [product, version, copyright]) {
    const text = document.createElement("div");
    text.textContent = line;
    details.appendChild(text);
  }
  productRow.append(productIcon, details);

  const license = document.createElement("p");
  license.className = "xp-about-license";
  license.append("This product is licensed under the terms of the ");
  const licenseLink = document.createElement("a");
  licenseLink.href = "https://www.microsoft.com/en-us/legal/terms-of-use";
  licenseLink.target = "_blank";
  licenseLink.rel = "noreferrer";
  licenseLink.textContent = "End-User License Agreement";
  license.append(licenseLink, " to:");
  const licensee = document.createElement("span");
  licensee.textContent = licensedTo;
  license.append(licensee);

  const memory = document.createElement("p");
  memory.className = "xp-about-memory";
  memory.textContent = "Physical memory available to Windows:   523,696 KB";
  dialog.body.append(banner, productRow, license, memory);
  dialogs.addButtonRow(dialog, [
    { id: "ok", label: "OK", isDefault: true, isCancel: true },
  ]);
  return dialog;
};
