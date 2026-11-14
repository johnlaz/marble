# Marble Games

A small collection of marble games for kids, by LAZLAB Creations. The landing page at the repo root links to each game.

| Game | Folder | What it is |
|---|---|---|
| Marble Run | [`run/`](run/) | 3D marble run builder: snap pieces together, drop marbles, rewind and replay, ride along with a marble. |
| Marble World 3D | [`world/`](world/) | Build a course, ride along with your marble, rewind. Loads Three.js, Tailwind and fonts from CDNs, so it needs an internet connection. |

## Layout

```
index.html      landing page (plain HTML, no service worker)
run/index.html  Marble Run (single self-contained file, Three.js + Rapier physics inlined)
world/index.html  Marble World 3D (single file, CDN dependencies)
README.md
```

Each game lives in its own folder so either can be edited and deployed without touching the other.

## Adding a game

1. Drop the game into a new folder, e.g. `game3/index.html`.
2. In the root `index.html`, copy one of the `<a class="game">` cards, point `href` at the folder, and update the title, description and tags.

## Notes on Marble Run

- Works offline; no external requests.
- Saved runs and the sound setting use `localStorage` in the browser.
- Source (unbundled) lives outside this repo for now; `run/index.html` is the built output.
