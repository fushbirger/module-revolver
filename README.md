# 2-Chamber Roulette - GitHub-ready project

## Run locally

```bash
node server.js
```

Open `http://localhost:3000` (Node 18+, no npm install required).

Create a named party from the **MAKE PARTY** screen or join an open party from the party list. Parties hold 3–12 players to start. The red **EXIT** sign returns to the party list. The party leader can add bots and starts the match with **START**; other members wait in the lobby until then.

For a quick test with three bots:

```bash
http://localhost:3000/?quick=3
```

Optional server settings:

```bash
SPEED=10 node server.js          # faster server timing for testing
TURN_SECONDS=15 node server.js   # shorten the 20 s turn cap (it cannot be raised)
```

A turn is capped at 20 seconds. Running out of time is not a death: the gun is handed to the nearest living neighbour, who then plays out their own turn.

## Run in StackBlitz

Use the **Server** template (not a browser-only static template). StackBlitz is configured to start the server with `npm start` when the project opens. If it does not start automatically, run:

```bash
npm start
```

The server listens on `0.0.0.0`, so StackBlitz can expose both its HTTP and WebSocket ports. Open the preview from the terminal or StackBlitz port panel.

Spins automatically stop after 10 seconds, so a player cannot keep the wheel spinning indefinitely.

The browser loads Three.js r160 from jsDelivr, so an internet connection is required.

## Scene models and art direction

The game ships two derived variants of every 3D asset. Both are committed so the game runs without a build step:

| Asset | Realistic | Low poly (default) |
| --- | --- | --- |
| `casino_environment` | `casino_environment_realistic.bbmodel` | `casino_environment_lowpoly.bbmodel` |
| `seated_mafioso` | `seated_mafioso_realistic.bbmodel` | `seated_mafioso_lowpoly.bbmodel` |
| `twin_chamber_revolver` | `twin_chamber_revolver_realistic.bbmodel` | `twin_chamber_revolver_lowpoly.bbmodel` |
| `chess_clock_monitor` | `chess_clock_monitor_realistic.bbmodel` | `chess_clock_monitor_lowpoly.bbmodel` |

Regenerate everything with:

```bash
node scripts/build_blockbench_assets.mjs
```

The generator builds the realistic models first, then derives the low-poly variants from them. Every `mesh` element is reduced with a quadric edge-collapse decimator (boundary-weighted, normal-flip guarded, roughly 35% of the source triangles) and its per-corner UVs are rescaled from the 512x640 realistic atlas into the 128x160 low-poly atlas; `cube` elements keep their geometry and only have their UVs rescaled. The low-poly file is therefore a simplification of the realistic mesh, not a second independent build, so the silhouettes match.

It writes both variants plus albedo atlases (`assets/blockbench/textures/realistic_albedo.png`, `lowpoly_albedo.png`) and, for the realistic variant, matching normal/roughness/metalness atlases. Switch at runtime with `?models=realistic` (default is the derived `lowpoly`).

- `models.js` parses the `.bbmodel` JSON, rebuilds indexed geometry (welding vertices for the realistic variant), builds PBR materials from the atlases, and places the revolver in the holder's hand.
- `main.js` runs a first-person seat camera, gives every player a three-needle life clock, animates self-aiming, hit reactions and the body collapse, and projects the revolver's muzzle flash. The click-to-target path raycasts player bodies and falls back to nearby head/torso screen positions when a click misses a mesh.
- The table is the 1.35 m round pedestal scaled 3x (8.1 m across) with the seats ringed just outside its edge, so the far side reads as a long stretch of felt instead of a dinner table. Drag anywhere to look around (yaw ~66 degrees each way, pitch down 29 / up 32), arrow keys nudge the head, double-click or `c` recentres. A drag longer than 8 px is a look, a shorter one is still a click on a target.
- Two separate layers carry the look. The desaturated ULTRAKILL palette is baked into the albedo atlas at generation time (chroma reduced to 36%, contrast pushed, a little grain, plus a slow hue bleed and melt wave), so the materials read correctly on their own. The Buckshot Roulette lighting is staging, not the definition: a single warm practical sitting just under the pendant glass, a red rim light behind the table, near-black walls, film grain, a heavy vignette and a bloom pass. The grade tops up saturation (0.55) and contrast, then adds the hallucination layer: a slow liquid ripple over the frame, a breathing zoom, drifting channels and a pulsing exposure. `?post=0` drops the hallucination and the grade together, leaving the baked palette.
- `index.html` is the entry point and shows a boot overlay with the full error if a module fails to load.
- `server.js` blocks dotfiles (`.git`, `.devcontainer`) and exposes a `leaveTable` action so any player can return to the party list after a match.

## Validation

`node --check` passes for every JavaScript file, the asset generator runs cleanly, and the build was verified in headless Chromium (WebGL renders, no console or page errors, full match played to a winner). Check the scene in a real browser after deploying; the headless run uses SwiftShader, so frame rate is not representative.

## Blockbench 3D editor

Open this repository in a Codespace or VS Code Dev Container to launch the Blockbench web app. The container setup clones the Blockbench source into `/workspaces/blockbench`, installs it with Node.js 22, and opens Blockbench on port `3001` so the game server can keep using port `3000`. To edit a game asset, open a `.bbmodel` file from `assets/blockbench/` in Blockbench.

After the container starts, Blockbench opens on port `3001`. Run `npm start` in the repository to serve the game on port `3000`.


## Upload to GitHub

Upload the repository files to the root of your GitHub repository. Do not upload an archive as a source-code file. Keep `server.js`, `package.json`, `index.html`, `main.js`, `models.js`, and `README.md` at the repository root.

## Run on a Node.js host

Use Node.js 18 or newer and run `npm start`. GitHub stores the source code; it does not run the multiplayer server by itself.
