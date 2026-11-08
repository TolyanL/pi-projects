/** Render the M0 panel offscreen, print it and assert exact widths. */
import { renderPanel, visibleWidth } from "./m0.js";

const state = {
  activePath: "/home/tolyan/Projects/pi-extensions",
  working: true,
  projects: [
    { name: "pi-extensions", path: "/home/tolyan/Projects/pi-extensions", sessions: 4, sessionAge: "2m", notes: true, stale: false, subagents: 0, error: false },
    { name: "pi-sounds", path: "/home/tolyan/Projects/pi-sounds", sessions: 1, sessionAge: "3d", notes: false, stale: false, subagents: 0, error: false },
    { name: "a-very-long-project-name-here", path: "/x", sessions: 12, sessionAge: "1h", notes: true, stale: false, subagents: 2, error: false },
    { name: "gone", path: "/gone", sessions: 0, sessionAge: undefined, notes: false, stale: true, subagents: 0, error: true },
  ],
};

let failed = 0;
for (const width of [30, 24, 40]) {
  const lines = renderPanel(state, width, 12);
  console.log(`\n=== width ${width} ===`);
  console.log(lines.join("\n"));
  for (const line of lines) {
    if (visibleWidth(line) !== width) {
      console.log(`  ! line width ${visibleWidth(line)} instead of ${width}: ${JSON.stringify(line)}`);
      failed += 1;
    }
  }
}
console.log(failed === 0 ? "\nWIDTHS OK" : `\n${failed} WIDTH PROBLEM(S)`);
process.exitCode = failed === 0 ? 0 : 1;
