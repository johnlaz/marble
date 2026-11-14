/* Marble Games service worker: precaches the landing page and both games so they work offline.
   Stale-while-revalidate: cached copy shows instantly, fresh copy arrives on the next open.
   Bump VERSION to force a clean cache. Only touches caches starting with "marble-". */
const PREFIX='marble-', VERSION=PREFIX+'v1';
const CORE=['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png','run/index.html','world/index.html'];
self.addEventListener('install',e=>{e.waitUntil((async()=>{
  const c=await caches.open(VERSION);
  await Promise.allSettled(CORE.map(u=>c.add(new Request(u,{cache:'reload'}))));
  await self.skipWaiting();})());});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{
  for(const k of await caches.keys()) if(k.startsWith(PREFIX)&&k!==VERSION) await caches.delete(k);
  await self.clients.claim();})());});
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET'||new URL(r.url).origin!==location.origin) return;
  e.respondWith((async()=>{
    const c=await caches.open(VERSION), hit=await c.match(r,{ignoreSearch:true});
    const net=fetch(r).then(res=>{if(res&&res.ok)c.put(r,res.clone());return res}).catch(()=>null);
    return hit||(await net)||(r.mode==='navigate'?await c.match('index.html'):Response.error());
  })());});
