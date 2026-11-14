export const applicationMetadata = {
  id: "__calculator",
  title: "Calculator",
  icon: "Calculator.png",
  kind: "native-game",
  deepLinkId: "calculator",
  // calc.exe opens in Standard view: dialog 102's 254 by 208 client area,
  // a menu bar, and a fixed dialog frame. Scientific resizes the window.
  window: {
    width: 260,
    height: 260,
    maximizable: false,
    // In the XP VM, calc.exe opens at its own size with START /MAX.
    opensRestored: true,
    resizable: false,
    className: "xp-calculator-window",
  },
};
