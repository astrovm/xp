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
// check that is not awaited or returned. It follows the promise through a
// variable, an array in Promise.all, a .map callback, a callback of .then,
// .catch or .finally, a test callback, a function that returns it, to each
// call of that function, and a method of an object in a variable, to each
// call of that method. A promise that a callback gives to forEach or
// another call is lost.
// Only Promise.all fails when one check fails. Promise.allSettled,
// Promise.any and Promise.race can hide a failed check.
const PROMISE_GROUPS = new Set(["all"]);
// The promise that .then, .catch and .finally give waits for the promise
// that their callback gives.
const PROMISE_CHAINS = new Set(["then", "catch", "finally"]);
const TEST_FUNCTIONS = new Set(["test", "it"]);
const isMethodCall = (node, names) =>
  node?.type === "CallExpression" &&
  node.callee.type === "MemberExpression" &&
  !node.callee.computed &&
  names.has(node.callee.property.name);
// True for test(...), it(...), test.only(...) and the like: the test runner
// waits for what the callback gives.
const isTestCall = (node) => {
  if (node?.type !== "CallExpression") return false;
  let callee = node.callee;
  while (callee.type === "MemberExpression") callee = callee.object;
  return callee.type === "Identifier" && TEST_FUNCTIONS.has(callee.name);
};

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
    const { sourceCode } = context;
    // True when something waits for the value of this node.
    const waited = (node, seen = new Set()) => {
      if (seen.has(node)) return false;
      seen.add(node);
      const { parent } = node;
      switch (parent.type) {
        case "AwaitExpression":
          return true;
        case "ReturnStatement":
          return returnWaited(parent, seen);
        case "ArrowFunctionExpression":
          return parent.body === node && functionWaited(parent, seen);
        case "ArrayExpression":
          return arrayWaited(parent, seen);
        case "VariableDeclarator":
          return readLater(parent, node, (read) => waited(read, seen));
        case "MemberExpression":
          return chainWaited(parent, seen);
        default:
          return false;
      }
    };
    // A promise is waited for when a waited .finally(...) or .then(f)
    // comes after it: a failed check fails that promise too. .catch and
    // .then(f, g) take the failure, so the check is lost then.
    const chainWaited = (member, seen) => {
      const call = member.parent;
      return (
        call.type === "CallExpression" &&
        call.callee === member &&
        !member.computed &&
        (member.property.name === "finally" ||
          (member.property.name === "then" && call.arguments.length < 2)) &&
        waited(call, seen)
      );
    };
    // True when a later read of the variable that this node sets passes the
    // test.
    const readLater = (declarator, node, test) =>
      declarator.init === node &&
      sourceCode
        .getDeclaredVariables(declarator)
        .some((variable) =>
          variable.references.some(
            (reference) => reference.isRead() && test(reference.identifier),
          ),
        );
    // An array of checks is waited for in Promise.all(...) and the like,
    // also through a variable.
    const arrayWaited = (array, seen) => {
      const { parent } = array;
      if (parent.type === "VariableDeclarator")
        return readLater(parent, array, (read) => arrayWaited(read, seen));
      return (
        isMethodCall(parent, PROMISE_GROUPS) &&
        parent.arguments[0] === array &&
        waited(parent, seen)
      );
    };
    // A returned value is waited for when the function that returns it is
    // waited for. A return outside a function ends the test file's code.
    const returnWaited = (statement, seen) => {
      let fn = statement.parent;
      while (fn && !/Function/.test(fn.type)) fn = fn.parent;
      if (!fn) return true;
      return fn.type === "FunctionDeclaration"
        ? callsWaited(fn, seen)
        : functionWaited(fn, seen);
    };
    // A function's result is waited for when each call of it is waited
    // for. A function in a variable, or a declared function, is followed
    // to each place that reads it. A function with no reads is never
    // called, so it loses nothing.
    const callsWaited = (declaration, seen) =>
      sourceCode
        .getDeclaredVariables(declaration)
        // A declared function also declares its parameters.
        .filter((variable) => variable.defs[0].type !== "Parameter")
        .every((variable) =>
          variable.references.every(
            (reference) =>
              !reference.isRead() || functionWaited(reference.identifier, seen),
          ),
        );
    // Each this.name in the code of an object, such as a call of one of
    // its methods from another one.
    const thisReads = (root, name) => {
      const found = [];
      const visit = (node) => {
        if (
          node.type === "MemberExpression" &&
          node.object.type === "ThisExpression" &&
          !node.computed &&
          node.property.name === name
        )
          found.push(node);
        for (const key of sourceCode.visitorKeys[node.type]) {
          const child = node[key];
          for (const item of [child].flat()) if (item) visit(item);
        }
      };
      visit(root);
      return found;
    };
    // A method of an object in a variable is waited for when each call of
    // it, as variable.name(...) or this.name(...), is waited for. An object
    // that goes somewhere else, or that is read with [...], can have its
    // method called with no wait, so the method is not waited for then.
    const methodWaited = (property, seen) => {
      const object = property.parent;
      const declarator = object.parent;
      if (
        property.computed ||
        property.key.type !== "Identifier" ||
        declarator.type !== "VariableDeclarator" ||
        declarator.init !== object
      )
        return false;
      const name = property.key.name;
      const reads = [];
      for (const variable of sourceCode.getDeclaredVariables(declarator))
        for (const reference of variable.references) {
          if (!reference.isRead()) continue;
          const member = reference.identifier.parent;
          if (
            member.type !== "MemberExpression" ||
            member.object !== reference.identifier ||
            member.computed
          )
            return false;
          if (member.property.name === name) reads.push(member);
        }
      return [...reads, ...thisReads(object, name)].every(
        (member) =>
          member.parent.type === "CallExpression" &&
          member.parent.callee === member &&
          waited(member.parent, seen),
      );
    };
    // The value of this node is a function. Its result is waited for when
    // a waited call calls it, when it is the callback of a test, of a .map
    // whose array is waited for, or of a waited .then, .catch or .finally,
    // when it goes in a variable whose calls are waited for, or when it is
    // a method whose calls are waited for.
    const functionWaited = (fn, seen) => {
      if (seen.has(fn)) return false;
      seen.add(fn);
      const { parent } = fn;
      if (parent.type === "VariableDeclarator")
        return parent.init === fn && callsWaited(parent, seen);
      if (parent.type === "Property")
        return parent.value === fn && methodWaited(parent, seen);
      if (parent.type !== "CallExpression") return false;
      if (parent.callee === fn) return waited(parent, seen);
      if (isTestCall(parent)) return true;
      if (isMethodCall(parent, PROMISE_CHAINS))
        return parent.arguments.includes(fn) && waited(parent, seen);
      return (
        isMethodCall(parent, new Set(["map"])) &&
        parent.arguments[0] === fn &&
        arrayWaited(parent, seen)
      );
    };
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
        if (!waited(node))
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
