# threejs-fps-02

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/stfu-onad/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/stfu-onad/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

**PORT OF SABLE** — a round-based tactical FPS built with three.js, set in a dusk container terminal. Two teams of five (Wardens defend, Jackals attack) fight over two bomb sites — the Bay A loading dock and the Bay B freezer hall — with a buy-phase economy, five weapons plus frag/flash/smoke grenades, defuse kits, and bot teammates and opponents that plan around waypoints, hold posts, react to sight and sound, plant and defuse. First to 7 rounds wins. Desktop (keyboard + mouse) and touch controls are both supported, and every texture and sound is generated procedurally in code — no external assets.

## Run it

```sh
node serve.ts
```

then open http://localhost:8080 in a browser. The game is the static `game/` folder (three.js 0.187.0 vendored under `game/vendor/three/`, wired through an import map); there is no build step. `node main.ts` is the entry hand-in program: it copies `game/` and `screenshots/` to the output directory and writes the `dossier.json` summary there.

---

<sub>Entered on [make.fun](https://make.fun/?ref=hwzvnj8a&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
