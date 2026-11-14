import { defineApplication } from "../core/application.js";
import * as renderers from "./renderers/index.js";

const PROGRAM_RENDERERS = Object.freeze({
  terminal: renderers.renderTerminal,
  volume: renderers.renderVolume,
});

export const defineProgram = (metadata) => {
  const renderer = PROGRAM_RENDERERS[metadata.kind];
  if (!renderer) {
    throw new Error(`No renderer registered for application: ${metadata.id}`);
  }
  return defineApplication({
    ...metadata,
    // Renderers return { element, unmount }. The options of the launch,
    // such as a command for the Command Prompt, come with the instance.
    mount: (context, instance) =>
      renderer(context, instance.application, metadata.id, instance),
  });
};
