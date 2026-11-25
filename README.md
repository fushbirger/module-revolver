# 2-Chamber Roulette - GitHub-ready project

## Run locally

```bash
node server.js
```

Open `http://localhost:3000` (Node 18+, no npm install required).

Create a named party from the **MAKE PARTY** screen or join an open party from the party list. Parties hold 3–12 players to start. The green **EXIT** sign returns to the party list. The party leader can add bots and starts the match with **START**; other members wait in the lobby until then.

For a quick test with three bots:

```bash
http://localhost:3000/?quick=3
```

Optional server settings:

```bash
SPEED=10 node server.js          # faster server timing for testing
TURN_SECONDS=20 node server.js  # shorter inactivity limit
```

## Run in StackBlitz

Use the **Server** template (not a browser-only static template). StackBlitz is configured to start the server with `npm start` when the project opens. If it does not start automatically, run:

```bash
npm start
```

The server listens on `0.0.0.0`, so StackBlitz can expose both its HTTP and WebSocket ports. Open the preview from the terminal or StackBlitz port panel.

Spins automatically stop after 10 seconds, so a player cannot keep the wheel spinning indefinitely.

The browser loads Three.js r160 from jsDelivr, so an internet connection is required.

## Updated scene models

- `assets/blockbench/` contains editable low-poly Blockbench projects for the casino environment, veneer table, seated trenchcoat silhouettes and chairs, chess-clock life monitor, and twin-chamber revolver. A shared, desaturated atlas gives the models hard-worn treatments: pitted oxide steel, abraded gunmetal, scratched walnut, bruised velvet, cracked concrete, and blood-dark enamel.
- `models.js` loads the Blockbench assets, scales seated players to at least 3× their previous size, and positions the revolver in the holder's hand.
- `scripts/build_blockbench_assets.mjs` regenerates the Blockbench projects and texture atlas with continuous UVs across round surfaces, so the veneer reads as a single tabletop rather than repeated wedges.
- `main.js` gives each player a three-needle life clock, removes one needle immediately on a hit, and lets the active player click another player's body or use the lower-center self-shot button. Targeting falls back to nearby head/torso screen positions when a click misses a model mesh; rejected targets are reported without advancing the turn. It also animates self-aiming and hit reactions, spaces oversized seats, moves the room behind the table, and uses a compact gold key light with a red rim light.
- `index.html` is the game entry point.

The table and casino environment are created once and are not attached to round or player animations. Room fixtures stay fixed, and the scene renders directly without post-processing to reduce GPU load.

## Validation

The JavaScript files pass Node syntax checks. A full visual browser render has not been independently verified in this environment, so check the scene in-browser after extracting the package.

## Blockbench 3D editor

Open this repository in a Codespace or VS Code Dev Container to launch the Blockbench web app. The container setup clones the Blockbench source into `/workspaces/blockbench`, installs it with Node.js 22, and opens Blockbench on port `3001` so the game server can keep using port `3000`. To edit a game asset, open a `.bbmodel` file from `assets/blockbench/` in Blockbench.

After the container starts, Blockbench opens on port `3001`. Run `npm start` in the repository to serve the game on port `3000`.


## Upload to GitHub

Upload the repository files to the root of your GitHub repository. Do not upload an archive as a source-code file. Keep `server.js`, `package.json`, `index.html`, `main.js`, `models.js`, and `README.md` at the repository root.

## Run on a Node.js host

Use Node.js 18 or newer and run `npm start`. GitHub stores the source code; it does not run the multiplayer server by itself.
