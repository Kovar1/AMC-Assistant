// Package the Claude Skill for upload to claude.ai.
//   npm run skill:zip     ->  skills/amc-showtimes.zip
//
// SKILL.md must sit at the archive root, not inside a folder, or claude.ai won't recognise it.
// Uses the OS zip tool (PowerShell's Compress-Archive on Windows, `zip` elsewhere) so there's no
// dependency to install.

import { execFileSync } from "node:child_process";
import { existsSync, rmSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = join(root, "skills", "amc-showtimes");
const out = join(root, "skills", "amc-showtimes.zip");

if (!existsSync(join(src, "SKILL.md"))) {
  console.error(`No SKILL.md in ${src}`);
  process.exit(1);
}
if (existsSync(out)) rmSync(out);

if (process.platform === "win32") {
  // Compress-Archive on the directory's contents keeps SKILL.md at the root.
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `Compress-Archive -Path '${src}\\*' -DestinationPath '${out}'`],
    { stdio: "inherit" },
  );
} else {
  execFileSync("zip", ["-r", out, "."], { cwd: src, stdio: "inherit" });
}

const files = readdirSync(src, { recursive: true }).filter((f) => String(f).includes("."));
console.log(`\nPacked ${files.length} file(s) -> skills/amc-showtimes.zip`);
console.log("Upload: claude.ai -> Settings -> Capabilities -> Skills -> Upload skill");
