// COLDSTORE — a three.js tactical FPS (Node 22, standard library only).
// The game itself is this directory's game/ folder: plain static files the
// browser loads as ES modules, three.js 0.187.0 vendored under
// game/vendor/three/ and wired through an import map. This program hands
// the entry in: it copies game/ and screenshots/ from beside this file to
// /output and writes /output/dossier.json — the summary the judge reads —
// with buildDossier from the vendored make.fun library, so the dossier is
// byte for byte the one the gate rebuilds.
//
// Play it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The caps below are the scorer's own (reference/gate.json): they make this
// program refuse, loudly and locally, an entry the scorer would refuse —
// more than 4 screenshots or one over 256 KiB, more than 993 files or
// 48 MiB under game/ — instead of handing in a zero.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
