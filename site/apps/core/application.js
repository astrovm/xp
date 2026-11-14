const requiredText = (value, field) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Application ${field} must be a non-empty string`);
  }
  return value;
};

export const defineApplication = (definition) => {
  if (typeof definition.mount !== "function") {
    throw new TypeError(
      `Application ${definition.id || "definition"} must define mount()`,
    );
  }
  const mount = definition.mount;
  const application = {
    ...definition,
    id: requiredText(definition.id, "id"),
    title: requiredText(definition.title, "title"),
    icon: requiredText(definition.icon, "icon"),
    kind: requiredText(definition.kind, "kind"),
    // The taskbar groups the windows of a program with many windows under
    // this title, like XP, which takes the description of the program file.
    ...(definition.window?.manyWindows && {
      groupTitle: requiredText(definition.groupTitle, "groupTitle"),
    }),
    fileTypes: Object.freeze([
      ...new Set(
        (definition.fileTypes || []).map((extension) =>
          extension.toLowerCase(),
        ),
      ),
    ]),
    window: Object.freeze({
      width: 640,
      height: 470,
      ...definition.window,
    }),
    mount(context, instance) {
      const mounted = mount(context, instance);
      if (!mounted?.element || mounted.element.nodeType !== 1) {
        throw new TypeError(
          `Application ${definition.id} mount() must return an element`,
        );
      }
      return { unmount() {}, ...mounted };
    },
  };
  return Object.freeze(application);
};
