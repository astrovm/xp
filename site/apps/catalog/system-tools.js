import { defineProgram } from "../programs/define-program.js";
import { defineLazyApplication } from "../core/lazy-application.js";
import { applicationMetadata as taskManagerMetadata } from "../task-manager/metadata.js";

const program = (id, title, icon, kind, extra) =>
  defineProgram({ id, title, icon, kind, ...extra });

export const systemToolApplications = [
  program("__volume-control", "Volume Control", "VolumeControl.png", "volume", {
    window: {
      width: 247,
      height: 302,
      // sndvol32 opens one pixel above the screen's top edge.
      left: 0,
      top: -1,
      resizable: false,
      maximizable: false,
      // In the XP VM, sndvol32.exe opens at its own size with START /MAX.
      opensRestored: true,
      className: "xp-volume-window",
    },
  }),
  defineLazyApplication(taskManagerMetadata, () =>
    import("../task-manager/index.js").then(
      (module) => module.taskManagerApplication,
    ),
  ),
];
