# Marble Games

A small collection of marble games for kids, by LAZLAB Creations. The landing page at the repo root links to each game.

| Game | Folder | What it is |
|---|---|---|
| Marble Run | [`run/`](run/) | 3D marble run builder: snap pieces together, drop marbles, rewind and replay, ride along with a marble. |
| Game 2 | _coming soon_ | Placeholder card on the landing page. |

## Layout

```
index.html      landing page (plain HTML, no service worker)
run/index.html  Marble Run (single self-contained file, Three.js + Rapier physics inlined)
README.md
```

Each game lives in its own folder so either can be edited and deployed without touching the other.

## Adding a game

1. Drop the game into a new folder, e.g. `game2/index.html`.
2. In the root `index.html`, edit the placeholder card: set `href` to the folder, update the title, description and tags, and remove the `soon` class.

## Notes on Marble Run

- Works offline; no external requests.
- Saved runs and the sound setting use `localStorage` in the browser.
- Source (unbundled) lives outside this repo for now; `run/index.html` is the built output.
