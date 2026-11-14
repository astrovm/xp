// Local ESLint rules for this project.

// An expect(...) call checks nothing until a matcher is called on it, such
// as expect(value).toBe(1) or expect(value).not.toBeNull(). This rule finds
// each expect(...) that has no matcher call.
const expectNeedsMatcher = {
  meta: {
    type: "problem",
    docs: {
      description: "Each expect(...) call must end in a matcher call.",
    },
    schema: [],
    messages: {
      noMatcher:
        "This expect(...) checks nothing. Call a matcher on it, such as .toBe(...) or .toBeTrue().",
    },
  },
  create(context) {
    return {
      CallExpression(call) {
        if (call.callee.type !== "Identifier" || call.callee.name !== "expect")
          return;
        let node = call;
        let members = 0;
        while (
          node.parent.type === "MemberExpression" &&
          node.parent.object === node
        ) {
          node = node.parent;
          members += 1;
        }
        const called =
          members > 0 &&
          node.parent.type === "CallExpression" &&
          node.parent.callee === node;
        if (!called) context.report({ node: call, messageId: "noMatcher" });
      },
    };
  },
};

// expect(promise).rejects and expect(promise).resolves give a promise. The
// test does not wait for it unless it is awaited or returned, so a failed
// check can come after the test ends, or never. This rule finds each such
// check that is not awaited or returned.
const awaitAsyncExpect = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Each expect(...).rejects or .resolves check must be awaited or returned.",
    },
    schema: [],
    messages: {
      notAwaited:
        "The test does not wait for this .{{name}} check. Put await before it, or return it.",
    },
  },
  create(context) {
    return {
      CallExpression(call) {
        if (call.callee.type !== "Identifier" || call.callee.name !== "expect")
          return;
        let node = call;
        let name = null;
        while (
          node.parent.type === "MemberExpression" &&
          node.parent.object === node
        ) {
          node = node.parent;
          const { property } = node;
          if (
            !node.computed &&
            (property.name === "rejects" || property.name === "resolves")
          )
            name ??= property.name;
        }
        if (!name) return;
        // The check is the matcher call at the end of the chain. With no
        // matcher, expect-needs-matcher reports it.
        if (
          node.parent.type === "CallExpression" &&
          node.parent.callee === node
        )
          node = node.parent;
        const { parent } = node;
        const waited =
          parent.type === "AwaitExpression" ||
          parent.type === "ReturnStatement" ||
          (parent.type === "ArrowFunctionExpression" && parent.body === node);
        if (!waited)
          context.report({
            node: call,
            messageId: "notAwaited",
            data: { name },
          });
      },
    };
  },
};

export const localRules = {
  rules: {
    "expect-needs-matcher": expectNeedsMatcher,
    "await-async-expect": awaitAsyncExpect,
  },
};
