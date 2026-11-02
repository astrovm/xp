import { afterEach, expect, test } from "bun:test";
import { cleanupShells, loadShell } from "./helpers/shell-harness";

afterEach(cleanupShells);

test("a test that fakes the clock in a shell window leaves the runner's clock alone", async () => {
  const realNow = Date.now;
  const s = await loadShell({
    beforeScripts: (window) => {
      window.Date.now = () => 1000;
    },
  });
  expect(s.window.Date.now()).toBe(1000);
  expect(Date.now).toBe(realNow);
  expect(Date.now()).toBeGreaterThan(1000);
  // Dates made in the window still read as Dates to the runner.
  expect(new s.window.Date(0)).toBeInstanceOf(Date);
});
