// Calculator's engine, as calc.exe runs it: number entry, the operator
// queue with Scientific's precedence, parentheses, memory, statistics and
// the display string. Commands are named after the buttons.
import {
  CalculatorError,
  ZERO,
  absolute,
  acos,
  acosh,
  add,
  asin,
  asinh,
  atan,
  atanh,
  cos,
  cosh,
  decimalPlaces,
  divide,
  exp,
  factorial,
  fraction,
  integer,
  isInteger,
  isZero,
  ln,
  log10,
  multiply,
  negate,
  number,
  pi,
  power,
  root,
  significantDigits,
  sin,
  sinh,
  squareRoot,
  subtract,
  tan,
  tanh,
  toBigInt,
  truncate,
  twoPi,
} from "./numbers.js";

export const PRECISION = 32;
export const RADIXES = { hex: 16, dec: 10, oct: 8, bin: 2 };
export const WORD_BITS = { qword: 64, dword: 32, word: 16, byte: 8 };
export const ANGLES = ["degrees", "radians", "grads"];
export const BINARY = ["and", "or", "xor", "lsh", "div", "mul", "add", "sub"];
BINARY.push("mod", "pow");
// calc.exe's precedence table; Inv Lsh shifts right.
const PRECEDENCE = {
  or: 0,
  xor: 0,
  and: 1,
  add: 2,
  sub: 2,
  rsh: 3,
  lsh: 3,
  mod: 3,
  div: 3,
  mul: 3,
  pow: 4,
};
export const FUNCTIONS = ["int", "not", "sin", "cos", "tan", "ln", "log"];
FUNCTIONS.push("sqrt", "square", "cube", "factorial", "reciprocal", "dms");
FUNCTIONS.push("percent");
const STATISTICS = ["ave", "sum", "s", "dat"];
// Mode switches, which do not count as the last command.
const SETTINGS = new Set(["inv", "hyp", "sta", "fe", "mc", "back", "exp"]);
[RADIXES, WORD_BITS].forEach((table) =>
  Object.keys(table).forEach((name) => SETTINGS.add(name)),
);
ANGLES.forEach((name) => SETTINGS.add(name));
// Commands that end number entry.
const ENDS_ENTRY = new Set([
  ...BINARY,
  ...FUNCTIONS,
  ...STATISTICS,
  "fe",
  "pi",
  "equals",
  "mc",
  "mr",
  "ms",
  "mplus",
  "open",
  "close",
  "inv",
  "hyp",
  ...SETTINGS,
]);
["sta", "back", "exp"].forEach((name) => ENDS_ENTRY.delete(name));
// Inv flips these and is used up by them; Hyp by the three trig keys.
const USES_INV = ["int", "sin", "cos", "tan", "square", "cube", "log", "ln"];
USES_INV.push("dms");
const TRIG = ["sin", "cos", "tan"];
const MAX_DEPTH = 25;
const MAX_EXPONENT_DIGITS = 4;

const digitValue = (command) => Number.parseInt(command.slice(5), 10);
const isDigit = (command) => command.startsWith("digit");

// ---- Display strings ----
const group = (text, size, separator) => {
  let grouped = "";
  for (let end = text.length; end > 0; end -= size)
    grouped =
      text.slice(Math.max(0, end - size), end) +
      (grouped && separator) +
      grouped;
  return grouped;
};
const groupInteger = (text, radix, grouping) => {
  if (!grouping) return text;
  return radix === 10
    ? group(text, 3, ",")
    : group(text, radix === 8 ? 3 : 4, " ");
};

// calc.exe's number to string: 32 significant digits, rounded half away
// from zero, in scientific notation past 32 whole digits, past 34
// decimals, or with F-E on.
export const formatDecimal = (x, { fe = false, grouping = false } = {}) => {
  if (isZero(x)) return fe ? "0.e+0" : "0.";
  const sign = x.n < 0n ? "-" : "";
  let { digits, point } = significantDigits(x, PRECISION + 2);
  digits = digits.replace(/0+$/, "");
  const scientific =
    fe ||
    point > PRECISION ||
    Math.min(digits.length, PRECISION) - point > PRECISION + 2;
  if (digits.length >= PRECISION) {
    const kept =
      BigInt(digits.slice(0, PRECISION)) + (digits[PRECISION] >= "5" ? 1n : 0n);
    digits = kept.toString();
    if (digits.length > PRECISION) {
      point += 1;
      if (!fe && point > PRECISION)
        return formatDecimal(
          number(BigInt(sign + digits), 1n, point - digits.length),
          { fe: true, grouping },
        );
    }
    digits = digits.slice(0, PRECISION).replace(/0+$/, "");
  }
  if (scientific) {
    const exponent = point - 1;
    return `${sign}${digits[0]}.${digits.slice(1)}e${exponent < 0 ? "-" : "+"}${Math.abs(exponent)}`;
  }
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  const whole = digits.slice(0, point).padEnd(point, "0");
  return `${sign}${groupInteger(whole, 10, grouping)}.${digits.slice(point)}`;
};

export const formatNumber = (x, { radix, fe, grouping }) =>
  radix === 10
    ? formatDecimal(x, { fe, grouping })
    : groupInteger(toBigInt(x).toString(radix).toUpperCase(), radix, grouping);

// ---- Number entry ----
const maxDigits = (radix, bits) =>
  radix === 10 ? PRECISION : Math.floor(bits / Math.log2(radix));

const entryLength = (entry) =>
  entry.whole.length +
  (entry.decimals === null ? 0 : entry.decimals.length + 1);

const entryValue = (entry, radix) => {
  const negative = entry.negative ? -1n : 1n;
  if (radix !== 10)
    return number(
      negative * BigInt(`0${{ 16: "x", 8: "o", 2: "b" }[radix]}${entry.whole}`),
    );
  const decimals = entry.decimals || "";
  const exponent = entry.exponent
    ? Number(entry.exponent.digits || "0") * (entry.exponent.negative ? -1 : 1)
    : 0;
  return number(
    negative * BigInt(entry.whole + decimals),
    1n,
    exponent - decimals.length,
  );
};

const entryText = (entry, radix, grouping) => {
  const sign = entry.negative ? "-" : "";
  const whole = groupInteger(entry.whole, radix, grouping);
  if (radix !== 10) return sign + whole;
  const exponent = entry.exponent
    ? `e${entry.exponent.negative ? "-" : "+"}${entry.exponent.digits || "0"}`
    : "";
  return `${sign}${whole}.${entry.decimals || ""}${exponent}`;
};

// ---- Paste: calc.exe reads the clipboard as key presses ----
const PASTE_KEYS = {
  "!": "factorial",
  S: "sin",
  O: "cos",
  T: "tan",
  R: "reciprocal",
  Y: "pow",
  "#": "cube",
  "@": "square",
  // calc.exe's paste table sends Degrees for M.
  M: "degrees",
  N: "ln",
  L: "log",
  V: "fe",
  X: "exp",
  I: "inv",
  H: "hyp",
  P: "pi",
  "/": "div",
  "*": "mul",
  "%": "mod",
  "-": "sub",
  "=": "equals",
  "+": "add",
  "&": "and",
  "|": "or",
  "^": "xor",
  "~": "not",
  ";": "int",
  "<": "lsh",
  "(": "open",
  ")": "close",
  "\\": "dat",
  Q: "clear",
  ":Q": "clear",
  ":S": "sta",
  ":M": "ms",
  ":P": "mplus",
  ":C": "mc",
  ":R": "mr",
  ":A": "ave",
  ":T": "sum",
  ":D": "s",
  ":2": "dword",
  ":3": "radians",
  ":4": "grads",
  ":5": "hex",
  ":6": "dec",
  ":7": "oct",
  ":8": "bin",
  ":9": "sign",
  ":<": "qword",
};
"0123456789ABCDEF".split("").forEach((digit, value) => {
  PASTE_KEYS[digit] = `digit${value}`;
});
// Turns clipboard text into commands. Spaces, line breaks and commas are
// skipped; the first character calc.exe has no key for ends the paste.
export const pasteCommands = (text, radix) => {
  const commands = [];
  let previous = "";
  let negate = false;
  for (const character of text) {
    if (" \n\r,".includes(character)) continue;
    let command;
    if (character === ".") command = "point";
    else if (!previous && character === "-") {
      negate = true;
      continue;
    } else if ("XxEe".includes(character) && radix === 10) {
      command = "exp";
      previous = "x";
      commands.push(command);
      continue;
    } else if (previous === "x" && character === "+" && radix === 10) {
      continue;
    } else if (previous === "x" && character === "-" && radix === 10) {
      command = "sign";
    } else {
      const prefix = previous === ":" ? ":" : "";
      previous = character;
      if (character === ":") continue;
      command = PASTE_KEYS[prefix + character.toUpperCase()];
      if (!command) break;
    }
    previous = character;
    commands.push(command);
    if (negate && command !== "digit0") {
      commands.push("sign");
      negate = false;
    }
  }
  return commands;
};

// ---- The calculator ----
export const createCalculator = ({ scientific = false } = {}) => {
  const state = {
    scientific,
    radix: 10,
    bits: 64,
    angle: "degrees",
    current: ZERO,
    last: ZERO,
    hold: ZERO,
    memory: ZERO,
    op: null,
    pending: false,
    repeat: false,
    stack: [],
    parens: [],
    entry: { whole: "0", decimals: null, negative: false, exponent: null },
    inv: false,
    hyp: false,
    fe: false,
    error: null,
    stats: [],
    statsOpen: false,
    command: null,
    previous: null,
    recording: true,
    grouping: false,
    text: "0.",
    beeps: 0,
  };
  const integerMode = () => state.radix !== 10;
  const beep = () => {
    state.beeps += 1;
  };
  // Hex, octal and binary keep whole numbers within the word size.
  const fit = (x) => {
    if (!integerMode()) return x;
    const size = 1n << BigInt(state.bits);
    return number(((toBigInt(x) % size) + size) % size);
  };
  const show = () => {
    state.text = formatNumber(state.current, {
      radix: state.radix,
      fe: state.fe,
      grouping: state.grouping,
    });
  };
  const showEntry = () => {
    state.text = entryText(state.entry, state.radix, state.grouping);
  };
  const setError = (code) => {
    state.error = code;
    state.text = new CalculatorError(code).message;
  };
  const attempt = (work) => {
    try {
      return work();
    } catch (error) {
      setError(error.code);
      return state.current;
    }
  };

  // Decimal And, Or and Xor follow ratpak's digit by digit operation:
  // the left operand, flattened, keeps its decimals as zero digits.
  const flattened = (x, places) =>
    toBigInt(absolute(truncate(x))) * 10n ** BigInt(places);
  const bitwise = (op, right, left) => {
    if (integerMode()) {
      const [a, b] = [toBigInt(right), toBigInt(left)];
      return number(op === "and" ? a & b : op === "or" ? a | b : a ^ b);
    }
    const places = isInteger(right) ? 0 : decimalPlaces(right, PRECISION);
    const a = flattened(right, places);
    const b = flattened(
      left,
      isInteger(left) ? 0 : decimalPlaces(left, PRECISION),
    );
    const result = op === "and" ? a & b : op === "or" ? a | b : a ^ b;
    return number(right.n < 0n ? -result : result, 1n, -places);
  };

  // right is the number just entered, left the one before the operator.
  const operate = (op, right, left) =>
    attempt(() => {
      switch (op) {
        case "add":
          return fit(add(left, right));
        case "sub":
          return fit(subtract(left, right));
        case "mul":
          return fit(multiply(left, right));
        case "div":
          return fit(divide(left, right));
        case "mod": {
          // Even 0 Mod 0 cannot divide by zero.
          if (isZero(right)) throw new CalculatorError("divide");
          const quotient = truncate(divide(left, right));
          return fit(subtract(left, multiply(quotient, right)));
        }
        case "pow":
          if (state.inv) {
            state.inv = false;
            return fit(root(left, right));
          }
          return fit(power(left, right));
        case "lsh":
        case "rsh": {
          // Shifts past 400000 bits overflow anyway.
          const shift = BigInt(
            Math.max(-400000, Math.min(400000, Number(toBigInt(right)))),
          );
          const value = toBigInt(left);
          return fit(number(op === "lsh" ? value << shift : value >> shift));
        }
        default:
          return fit(bitwise(op, right, left));
      }
    });

  const angleFunction = (name, x) => {
    const unit = state.angle;
    if (state.hyp)
      return state.inv
        ? { sin: asinh, cos: acosh, tan: atanh }[name](x)
        : { sin: sinh, cos: cosh, tan: tanh }[name](x);
    return state.inv
      ? { sin: asin, cos: acos, tan: atan }[name](x, unit)
      : { sin, cos, tan }[name](x, unit);
  };

  // dms: degrees to degrees, minutes and seconds written as D.MMSS; Inv
  // turns D.MMSS back into degrees.
  const dms = (x) => {
    const [from, to] = state.inv ? [100, 60] : [60, 100];
    const whole = truncate(x);
    const minutes = multiply(fraction(x), integer(from));
    const seconds = multiply(fraction(minutes), integer(from));
    return add(
      whole,
      divide(add(truncate(minutes), divide(seconds, integer(to))), integer(to)),
    );
  };

  const calculate = (name, x) => {
    const inv = state.inv;
    switch (name) {
      case "int":
        return inv ? fraction(x) : truncate(x);
      case "not":
        if (integerMode())
          return number(toBigInt(x) ^ ((1n << BigInt(state.bits)) - 1n));
        return negate(add(truncate(x), integer(1)));
      case "sin":
      case "cos":
      case "tan":
      case "dms":
        if (integerMode()) {
          beep();
          return x;
        }
        return name === "dms" ? dms(x) : angleFunction(name, x);
      case "ln":
        return inv ? exp(x) : ln(x);
      case "log":
        return inv ? power(integer(10), x) : log10(x);
      case "sqrt":
      case "square":
        return inv || !state.scientific ? squareRoot(x) : multiply(x, x);
      case "cube":
        return inv ? root(x, integer(3)) : multiply(multiply(x, x), x);
      case "factorial":
        return factorial(x);
      case "reciprocal":
        return divide(integer(1), x);
      default:
        // Percent: the number as a percentage of the one before.
        return multiply(x, divide(state.last, integer(100)));
    }
  };

  const statistic = (name) => {
    const values = state.stats;
    const count = integer(values.length);
    const sumOf = (squares) =>
      values.reduce(
        (total, { value }) =>
          add(total, squares ? multiply(value, value) : value),
        ZERO,
      );
    if (name === "dat") {
      values.push({
        value: state.current,
        text: formatNumber(state.current, {
          radix: state.radix,
          fe: state.fe,
          grouping: state.grouping,
        }),
      });
      return;
    }
    if (name === "sum") state.current = sumOf(state.inv);
    else if (name === "ave") {
      if (!values.length) {
        setError("divide");
        return;
      }
      state.current = divide(sumOf(state.inv), count);
    } else if (values.length < 2) state.current = ZERO;
    else {
      const total = sumOf(false);
      const spread = subtract(
        sumOf(true),
        divide(multiply(total, total), count),
      );
      const n = state.inv ? count : subtract(count, integer(1));
      state.current = squareRoot(divide(spread, n));
    }
    state.current = fit(state.current);
    state.inv = false;
    show();
  };

  const clearEntry = () => {
    state.current = ZERO;
    if (state.scientific) {
      state.inv = false;
      state.hyp = false;
    }
    state.error = null;
    state.entry = {
      whole: "0",
      decimals: null,
      negative: false,
      exponent: null,
    };
    state.recording = true;
    showEntry();
  };

  const clearAll = () => {
    state.last = ZERO;
    state.pending = false;
    state.parens = [];
    state.op = null;
    state.previous = null;
    state.command = null;
    state.stack = [];
    state.fe = false;
    state.repeat = false;
    clearEntry();
  };

  const binary = (command) => {
    let op = command;
    if (state.inv && op === "lsh") {
      state.inv = false;
      op = "rsh";
    }
    if (BINARY.includes(state.previous)) {
      state.op = op;
      return;
    }
    if (state.pending)
      for (;;) {
        if (state.scientific && PRECEDENCE[op] > PRECEDENCE[state.op]) {
          // A full queue overwrites its top entry.
          if (state.stack.length >= MAX_DEPTH) {
            beep();
            state.stack.pop();
          }
          state.stack.push({ op: state.op, value: state.last });
          break;
        }
        state.current = operate(state.op, state.current, state.last);
        const top = state.stack.at(-1);
        if (top?.op) {
          state.stack.pop();
          state.op = top.op;
          state.last = top.value;
          continue;
        }
        if (!state.error) show();
        break;
      }
    state.last = state.current;
    state.current = ZERO;
    state.pending = true;
    state.repeat = false;
    state.op = op;
  };

  const equals = () => {
    for (;;) {
      if (BINARY.includes(state.previous)) state.current = state.last;
      if (!state.op) {
        if (!state.error) show();
      } else {
        if (state.repeat) state.current = state.hold;
        else state.hold = state.current;
        state.current = operate(state.op, state.current, state.last);
        state.last = state.current;
        if (!state.error) show();
        state.repeat = true;
      }
      if (!state.stack.length || !state.scientific) break;
      const top = state.stack.pop();
      state.op = top.op;
      state.last = top.op ? top.value : ZERO;
      state.repeat = false;
    }
    state.pending = false;
  };

  const parenthesis = (open) => {
    const top = state.stack.at(-1);
    if (
      (open && state.parens.length >= MAX_DEPTH) ||
      (!open && !state.parens.length) ||
      (state.stack.length >= MAX_DEPTH && top.op)
    ) {
      beep();
      return;
    }
    if (open) {
      state.parens.push({ value: state.last, op: state.op });
      state.stack.push({ op: null });
      state.last = ZERO;
      state.command = null;
      state.op = "add";
      state.pending = false;
      state.text = "(".repeat(state.parens.length);
      return;
    }
    for (;;) {
      if (state.op)
        state.current = operate(state.op, state.current, state.last);
      const entry = state.stack.pop() || { op: null };
      state.op = entry.op;
      if (!state.op) break;
      state.last = entry.value;
    }
    const outer = state.parens.pop();
    state.last = outer.value;
    state.op = outer.op;
    state.pending = Boolean(state.op);
    if (!state.error) show();
  };

  const setRadix = (name) => {
    state.radix = state.scientific ? RADIXES[name] : 10;
    state.current = fit(state.current);
    show();
  };

  const typeDigit = (value) => {
    const { entry } = state;
    if (value >= state.radix) {
      beep();
      return;
    }
    if (entry.exponent) {
      if (entry.exponent.digits.length >= MAX_EXPONENT_DIGITS) beep();
      else entry.exponent.digits = `${Number(entry.exponent.digits + value)}`;
      showEntry();
      return;
    }
    const digit = value.toString(state.radix).toUpperCase();
    if (entry.decimals === null && entry.whole === "0") entry.whole = digit;
    else if (entryLength(entry) >= maxDigits(state.radix, state.bits)) beep();
    else if (entry.decimals === null) entry.whole += digit;
    else entry.decimals += digit;
    showEntry();
  };

  const entryCommand = (command) => {
    const { entry } = state;
    if (command === "point") {
      if (integerMode() || entry.decimals !== null || entry.exponent)
        return beep();
      if (entryLength(entry) >= PRECISION) return beep();
      entry.decimals = "";
    } else if (command === "sign") {
      if (entry.exponent) entry.exponent.negative = !entry.exponent.negative;
      // Zero takes no sign.
      else if (!isZero(entryValue(entry, state.radix)))
        entry.negative = !entry.negative;
    } else if (command === "back") {
      if (entry.exponent) {
        if (entry.exponent.digits)
          entry.exponent.digits = entry.exponent.digits.slice(0, -1);
        else entry.exponent = null;
      } else if (entry.decimals) entry.decimals = entry.decimals.slice(0, -1);
      else if (entry.decimals === "") entry.decimals = null;
      else if (entry.whole.length > 1) entry.whole = entry.whole.slice(0, -1);
      else if (entry.whole !== "0") {
        entry.whole = "0";
        entry.negative = false;
      } else return beep();
    } else {
      // Exp.
      if (integerMode() || entry.exponent) return beep();
      entry.exponent = { digits: "", negative: false };
    }
    showEntry();
  };

  const press = (command) => {
    if (!SETTINGS.has(command)) {
      state.previous = state.command;
      state.command = command;
    }
    if (state.error && command !== "clear" && command !== "clearEntry") {
      beep();
      return;
    }
    if (!state.recording) {
      if (isDigit(command) || command === "point") {
        state.recording = true;
        state.entry = {
          whole: "0",
          decimals: null,
          negative: false,
          exponent: null,
        };
      }
    } else if (ENDS_ENTRY.has(command)) {
      state.recording = false;
      state.current = fit(entryValue(state.entry, state.radix));
      show();
    }

    if (STATISTICS.includes(command)) {
      if (!state.statsOpen) {
        beep();
        state.inv = false;
        return;
      }
      attempt(() => statistic(command));
      return;
    }
    if (BINARY.includes(command)) {
      binary(command);
      return;
    }
    if (FUNCTIONS.includes(command)) {
      if (BINARY.includes(state.previous)) state.current = state.last;
      state.current = attempt(() => fit(calculate(command, state.current)));
      if (state.error) return;
      show();
      if (USES_INV.includes(command)) state.inv = false;
      if (TRIG.includes(command)) state.hyp = false;
      state.repeat = false;
      return;
    }
    if (isDigit(command)) {
      typeDigit(digitValue(command));
      return;
    }
    if (command in RADIXES) {
      setRadix(command);
      return;
    }
    if (command in WORD_BITS) {
      state.bits = WORD_BITS[command];
      state.current = fit(state.current);
      if (integerMode()) show();
      return;
    }
    if (ANGLES.includes(command)) {
      // Outside decimal, F2 to F4 pick word sizes instead.
      if (integerMode())
        press({ degrees: "dword", radians: "word", grads: "byte" }[command]);
      else state.angle = command;
      return;
    }
    switch (command) {
      case "point":
      case "exp":
      case "back":
        if (!state.recording) return beep();
        return entryCommand(command);
      case "sign":
        if (state.recording) return entryCommand(command);
        state.current = fit(negate(state.current));
        return show();
      case "clear":
        return clearAll();
      case "clearEntry":
        return clearEntry();
      case "sta":
        state.statsOpen = true;
        return;
      case "fe":
        state.fe = !state.fe;
        return show();
      case "pi":
        if (integerMode()) return beep();
        state.current = state.inv ? twoPi() : pi();
        state.inv = false;
        return show();
      case "equals":
        return equals();
      case "mc":
        state.memory = ZERO;
        return;
      case "mr":
        state.current = fit(state.memory);
        return show();
      case "ms":
        state.memory = fit(state.current);
        return;
      case "mplus":
        state.memory = attempt(() => fit(add(state.memory, state.current)));
        return;
      case "open":
      case "close":
        return parenthesis(command === "open");
      case "inv":
        state.inv = !state.inv;
        return;
      default:
        state.hyp = !state.hyp;
    }
  };

  return {
    press,
    get display() {
      return state.text;
    },
    get memory() {
      return !isZero(state.memory);
    },
    get parentheses() {
      return state.parens.length;
    },
    get inv() {
      return state.inv;
    },
    get hyp() {
      return state.hyp;
    },
    get radix() {
      return state.radix;
    },
    get bits() {
      return state.bits;
    },
    get angle() {
      return state.angle;
    },
    get error() {
      return state.error;
    },
    get beeps() {
      return state.beeps;
    },
    get value() {
      return state.current;
    },
    get statistics() {
      return state.stats.map(({ text }) => text);
    },
    setScientific(value) {
      state.scientific = value;
      if (!value) {
        state.inv = false;
        state.hyp = false;
        if (state.radix !== 10) setRadix("dec");
      }
    },
    setGrouping(value) {
      state.grouping = value;
      if (state.recording && !state.error) showEntry();
      else if (!state.error) show();
    },
    setStatisticsOpen(value) {
      state.statsOpen = value;
    },
    // The Statistics Box's list commands.
    loadStatistic(index) {
      if (state.error) return;
      state.recording = false;
      state.current = fit(state.stats[index].value);
      show();
    },
    removeStatistic(index) {
      state.stats.splice(index, 1);
    },
    clearStatistics() {
      state.stats = [];
    },
  };
};
