// Elang Laut — Archipelago Flight: main.ts
//
// The grader entrypoint. It copies the game (game/) and the screenshots
// (screenshots/) into the output directory and writes output/dossier.json
// with buildDossier from the kit's vendored library — the dossier the judge
// reads. Node 22 standard library only, plus that one vendored library.
//
// Usage:
//   MAKEFUN_OUTPUT_DIR=/path/to/out node main.ts

import { mkdirSync, readdirSync, statSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');

function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  let files = 0;
  for (const entry of readdirSync(src)) {
    // Never copy dotfiles into the output: the grader rejects output paths
    // that are not plain relative names (a screenshots/.gitkeep fails the run).
    if (entry.startsWith('.')) continue;
    const from = join(src, entry);
    const to = join(dest, entry);
    const st = statSync(from);
    if (st.isDirectory()) {
      files += copyTree(from, to);
    } else {
      copyFileSync(from, to);
      files += 1;
    }
  }
  return files;
}

const gameFiles = copyTree(join(scriptDir, 'game'), join(outDir, 'game'));

let shotFiles = 0;
try {
  shotFiles = copyTree(join(scriptDir, 'screenshots'), join(outDir, 'screenshots'));
} catch (e) {
  shotFiles = 0;
}

// The scorer's own caps: only text_max_bytes shapes the bytes; the others
// refuse an entry the scorer would refuse (more than 4 screenshots or one
// over 256 KiB; more than 993 files in game/ or 48 MiB of game files, in
// all, or a path under game/ over 1000 bytes).
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

console.log(`Elang Laut packaged: ${gameFiles} game files, ${shotFiles} screenshots -> ${outDir}`);
