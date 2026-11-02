import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "mutants-comment-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// A fake gh: logs each call without its body, keeps the last body, and lists comment 7 as ours
// when OLD=1.
const gh = join(dir, "gh");
writeFileSync(
  gh,
  [
    "#!/usr/bin/env bash",
    'all="$*"',
    'echo "${all%% -f *}" >> "$LOG"',
    '[[ $all == *" -f body="* ]] && echo "${all#* -f body=}" > "$LOG.body"',
    "[[ $* == *--paginate* && $OLD == 1 ]] && echo 7",
    "exit 0",
  ].join("\n"),
);
chmodSync(gh, 0o755);

let body = "";

function comment(lived: string, old: boolean, fork = false): string[] {
  const results = mkdtempSync(join(dir, "results-"));
  const log = join(results, "log");
  writeFileSync(log, "");
  writeFileSync(join(results, "lived.txt"), lived);
  writeFileSync(join(results, "tally.txt"), "1 of 2\n");
  const run = spawnSync(
    "bash",
    [join(import.meta.dir, "mutants-comment.sh"), results],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}:${process.env["PATH"]}`,
        LOG: log,
        OLD: old ? "1" : "0",
        FORK: String(fork),
        GITHUB_REPOSITORY: "o/r",
        PR: "5",
        RUN: "https://run",
      },
    },
  );
  expect(run.stderr).toBe("");
  expect(run.status).toBe(0);
  body = existsSync(`${log}.body`) ? readFileSync(`${log}.body`, "utf8") : "";
  return readFileSync(log, "utf8").split("\n").filter(Boolean);
}

describe("mutants comment", () => {
  const list = "api --paginate repos/o/r/issues/5/comments --jq";
  test("what lived is posted once, then edited in place", () => {
    const first = comment("catalog/a.ts:3  survived: X\n", false);
    expect(first[0]).toStartWith(list);
    expect(first.slice(1)).toEqual(["api repos/o/r/issues/5/comments"]);
    expect(body).toStartWith(
      "<!-- mutants -->\n**Mutation testing:** 1 of 2 changes caught",
    );
    expect(body).toContain("\ncatalog/a.ts:3  survived: X\n");
    expect(body).toContain("[Full report](https://run)");
    expect(comment("catalog/a.ts:3  survived: X\n", true).slice(1)).toEqual([
      "api -X PATCH repos/o/r/issues/comments/7",
    ]);
  });

  test("the comment goes once every change is caught", () => {
    expect(comment("", true).slice(1)).toEqual([
      "api -X DELETE repos/o/r/issues/comments/7",
    ]);
    expect(comment("", false).slice(1)).toEqual([]);
  });

  test("a fork's run only summarizes", () => {
    expect(comment("catalog/a.ts:3  survived: X\n", false, true)).toEqual([]);
  });
});
