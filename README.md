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

The browser loads Three.js r160 from jsDelivr, so an internet connection is required.

## Updated scene models

- `models.js` contains the fixed room, round pedestal table, chairs, seated figures and a per-player life monitor with animated needles and status lamps.
- `main.js` positions the seats around the round table, uses a desaturated industrial palette with hard warm/cool lighting, and layers subtle bloom, film grain, chromatic fringing and lens breathing over the scene.
- `index.html` is the game entry point.

The table and casino environment are created once and are not attached to round or player animations. Room fixtures stay fixed; dreamlike post-processing swells during spins, aiming and shots.

## Validation

The JavaScript files pass Node syntax checks, and the Three.js post-processing module URLs were checked. A full visual browser render has not been independently verified in this environment, so check the scene in-browser after extracting the package.


## Upload to GitHub

Upload the repository files to the root of your GitHub repository. Do not upload an archive as a source-code file. Keep `server.js`, `package.json`, `index.html`, `main.js`, `models.js`, and `README.md` at the repository root.

## Run on a Node.js host

Use Node.js 18 or newer and run `npm start`. GitHub stores the source code; it does not run the multiplayer server by itself.
