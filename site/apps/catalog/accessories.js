import { defineProgram } from "../programs/define-program.js";

const program = (id, title, icon, kind, extra) =>
  defineProgram({ id, title, icon, kind, ...extra });

export const accessoryApplications = [
  program(
    "__command-prompt",
    "Command Prompt",
    "CommandPrompt.png",
    "terminal",
    {
      // XP names a taskbar group by the description of the program file.
      groupTitle: "Windows Command Processor",
      window: {
        width: 668,
        height: 338,
        left: 24,
        top: 30,
        resizable: true,
        maximizable: true,
        className: "xp-command-prompt-window",
        // Each Command Prompt is its own window, like XP.
        manyWindows: true,
      },
    },
  ),
];
