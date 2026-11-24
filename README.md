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

- `models.js` contains the fixed room, round pedestal table, chairs and seated shadow figures, plus the existing game prop and status machine models.
- `main.js` positions the seats around the round table, uses a lower seated-player camera angle, and keeps scene lighting stable across turns and animations.
- `index.html` is the game entry point.

The table and casino environment are created once and are not attached to round or player animations. The figures remain dark silhouettes; the room lights reveal their outlines rather than making them glow.

## Validation

The updated JavaScript files pass Node syntax checks. The server's HTTP routes for the game page, `main.js` and `models.js` were checked locally. A full visual browser render has not been independently verified in this environment, so check the scene in-browser after extracting the package.


## Upload to GitHub

Upload the repository files to the root of your GitHub repository. Do not upload an archive as a source-code file. Keep `server.js`, `package.json`, `index.html`, `main.js`, `models.js`, and `README.md` at the repository root.

## Run on a Node.js host

Use Node.js 18 or newer and run `npm start`. GitHub stores the source code; it does not run the multiplayer server by itself.
