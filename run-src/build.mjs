import { build } from 'esbuild';
import fs from 'node:fs';

const r = await build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2020', legalComments: 'none' });
let js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = fs.readFileSync('src/template.html', 'utf8').replace('/*__SCRIPT__*/', () => js);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/marble-run.html', html);
console.log('built', (html.length / 1024 / 1024).toFixed(2), 'MB');
