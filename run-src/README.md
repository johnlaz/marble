# Marble Run source

Readable source for `../run/index.html` (the built single-file game).

```
npm init -y && npm i three @dimforge/rapier3d-compat esbuild
# build.mjs expects src/ next to it:
mkdir -p src && cp main.js parts.js template.html src/
node build.mjs          # writes dist/marble-run.html -> copy to ../run/index.html
```

- `parts.js`: piece catalogue (geometry, extras, sensors) and the prebuilt run library. Adding a run = adding a `seq` array; after a `splitter`, give an array of branches (one chain per exit). A run can name a `melody` (see `MELODIES`) that the chime pieces play in order.
- `main.js`: rendering, physics (Rapier), snapping UI, recording and rewind.
- `template.html`: page shell and CSS.

## v0.2 pieces
Splitter (two exits), Paddle Wheel (real physics, recorded for rewind), Lift (carries marbles up), Chimes (4 notes), Bell Gate, Glow track, Hyper-Loop (teleports marbles back to the start so the run never ends).
Also: chrome / rainbow / gold marbles, 4 scenery themes (🎨), "fits here" suggestion chips, and insert-a-piece-before (select a piece, then tap a chip).
Notes and bells are triggered from sensors recorded during the simulation, so they play in time with playback (and stay silent while scrubbing or rewinding).

## Sound (v0.4)
Tuned against a recording of a real plastic marble run with glass marbles.
- Hits: a very short rounded click (about 1.5–3 kHz) with a soft body thock and a small tail. No harsh noise tick.
- Rolling: a continuous band of noise (about 1–4 kHz) that follows marble speed, with irregular roughness, plus faint track-seam taps.
- A short, dark room reverb and a compressor tie it together.
- The Mix panel (Hits / Rolling / Music) still controls levels and is saved on the device.
