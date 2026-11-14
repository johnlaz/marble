# Marble Run source

Readable source for `../run/index.html` (the built single-file game).

```
npm init -y && npm i three @dimforge/rapier3d-compat esbuild
# build.mjs expects src/ next to it:
mkdir -p src && cp main.js parts.js template.html src/
node build.mjs          # writes dist/marble-run.html -> copy to ../run/index.html
```

- `parts.js`: piece catalogue (geometry, extras) and the prebuilt run library. Adding a run = adding a `seq` array.
- `main.js`: rendering, physics (Rapier), snapping UI, recording and rewind.
- `template.html`: page shell and CSS.
