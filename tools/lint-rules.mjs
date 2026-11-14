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

export const localRules = {
  rules: { "expect-needs-matcher": expectNeedsMatcher },
};
