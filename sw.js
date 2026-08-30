/* 答え合わせノート — offline shell
   ネットワーク優先・キャッシュ予備。更新は次回起動時に反映される。
   更新したら VERSION を必ず上げる（上げ忘れると既訪端末に旧版が配られ続ける）。
   VERSION は build.py が index.html の APP_VERSION へ転記する。 */
const VERSION = "v1.17.1";
const CACHE = "awn-" + VERSION;
const SHELL = [
  "./", "./index.html", "./manifest.webmanifest",
  "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith((async () => {
    /* ★2.5秒で諦めてキャッシュへ ── 病棟の端など電波の悪い場所で、起動が
       fetch のタイムアウトまで（数十秒）待たされるのを防ぐ。良好な回線では従来どおり最新優先 */
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    try {
      const res = await fetch(e.request, { signal: ctl.signal });
      clearTimeout(timer);
      /* ★成功した同一オリジンの応答だけをキャッシュする ── 病院のゲスト Wi-Fi の
         ログインページ（キャプティブポータル）が 200 で返す HTML を index.html として
         取り込むと、以後オフライン起動のたびにポータル画面が出て実質起動不能になる。
         リダイレクト先が別オリジンのときは res.url で弾く */
      if (res.ok && res.type === "basic" && new URL(res.url).origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      const r = await caches.match(e.request);
      return r || caches.match("./index.html");
    }
  })());
});
