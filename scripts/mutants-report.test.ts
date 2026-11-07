import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The weekly report is shell inside the workflow. These tests run that very
// text against fake results, so a part whose job died is checked on every
// pull request instead of on a Saturday.
const STEP = "List what lived in the open issue";
type Kind = { artifact: string; label: string };
const KINDS: [Kind, ...Kind[]] = [{ artifact: "mutants-part-", label: "" }];

function reportScript(): string {
  const lines = readFileSync(
    join(import.meta.dir, "..", ".github", "workflows", "mutants.yml"),
    "utf8",
  ).split("\n");
  const indentOf = (line: string) => line.length - line.trimStart().length;
  const step = lines.findIndex((line) => line.trim() === `- name: ${STEP}`);
  expect(step).toBeGreaterThanOrEqual(0);
  const run = lines.findIndex(
    (line, i) => i > step && line.trim() === "run: |",
  );
  expect(run).toBeGreaterThan(step);
  const base = indentOf(lines[run] ?? "");
  const body: string[] = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== "" && indentOf(line) <= base) break;
    body.push(line.slice(base + 2));
  }
  return body.join("\n");
}

type Part = { part: number; kind: Kind };

function runReport(
  parts: number[],
  missing: Part[] = [],
  lived: Record<string, string> = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "mutants-report-"));
  try {
    for (const part of parts) {
      for (const kind of KINDS) {
        if (missing.some((m) => m.part === part && m.kind === kind)) continue;
        const name = `${kind.artifact}${part}`;
        const out = join(dir, "results", name, "build", "mutants");
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, "lived.txt"), lived[name] ?? "");
      }
    }
    mkdirSync(join(dir, "scripts"));
    writeFileSync(
      join(dir, "scripts", "mutants-post.sh"),
      '#!/usr/bin/env bash\ncp "$1" posted.md\nprintf "%s" "$2" > has_findings.txt\n',
      { mode: 0o755 },
    );
    writeFileSync(join(dir, "summary.md"), "");
    // The shell GitHub Actions uses for a run step.
    const result = Bun.spawnSync(
      [
        "bash",
        "--noprofile",
        "--norc",
        "-eo",
        "pipefail",
        "-c",
        reportScript(),
      ],
      {
        cwd: dir,
        env: {
          PATH: process.env.PATH ?? "",
          GH_TOKEN: "fake",
          GH_REPO: "o/r",
          RUN: "https://example.test/run",
          PARTS: JSON.stringify(parts),
          JOBS: "failure",
          GITHUB_STEP_SUMMARY: join(dir, "summary.md"),
        },
      },
    );
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    return {
      posted: readFileSync(join(dir, "posted.md"), "utf8"),
      hasFindings: readFileSync(join(dir, "has_findings.txt"), "utf8"),
      summary: readFileSync(join(dir, "summary.md"), "utf8"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const named = ({ part, kind }: Part) =>
  kind.label === "" ? `${part}` : `${part} (${kind.label})`;
const lostLine = (lost: Part[]) =>
  `**No results from part ${lost.map(named).join(", ")}, so its mutants are not listed.** Rerun the failed jobs of the run.`;

test("a run with every part is clean and names nothing lost", () => {
  const { posted, hasFindings } = runReport([0, 1, 2]);
  expect(posted).toContain("Every change in these parts was caught by a test.");
  expect(posted).not.toContain("No results from part");
  expect(hasFindings).toBe("false");
});

for (const kind of KINDS) {
  test(`a lost part is named${kind.label ? ` (${kind.label})` : ""} and counts as a finding`, () => {
    const lost = [{ part: 1, kind }];
    const { posted, hasFindings, summary } = runReport([0, 1, 2], lost);
    expect(posted).toContain(lostLine(lost));
    expect(summary).toContain(lostLine(lost));
    // Nothing was seen of that part, so the report cannot call it all caught.
    expect(posted).not.toContain("Every change in these parts was caught");
    expect(hasFindings).toBe("true");
  });
}

test("several lost parts are all named next to the rows that did arrive", () => {
  const first = KINDS[0];
  const last = KINDS.at(-1) ?? first;
  const lost = [
    { part: 0, kind: first },
    { part: 2, kind: last },
  ];
  const { posted, hasFindings } = runReport([0, 1, 2, 3], lost, {
    [`${first.artifact}1`]: "src/a.ts:3  lived: x\n",
  });
  expect(posted).toContain(lostLine(lost));
  expect(posted).toContain("src/a.ts:3  lived: x");
  expect(hasFindings).toBe("true");
});
