import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, rm, readdir, stat } from 'node:fs/promises';
import { createReadStream, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const app = Fastify({ logger: false, trustProxy: true }); // logger off: URL tidak pernah dicatat
await app.register(rateLimit, { global: false, errorResponseBuilder: (_q, c) => ({ statusCode: 429, ec: 'RATE', error: 'Too Many Requests', message: `Terlalu banyak permintaan, coba lagi dalam ${Math.ceil(c.ttl / 1000)} detik` }) }); // hanya /api/* yang dibatasi; halaman & aset statis tidak
const RL = max => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });
const PUB = fileURLToPath(new URL('./public', import.meta.url));
await app.register(fastifyStatic, {
  root: PUB, extensions: ['html'], index: false,
  setHeaders: (res, p) => res.setHeader('Cache-Control',
    /\.(css|js)$/.test(p) ? 'public, max-age=3600' : /\.(png|webmanifest)$/.test(p) ? 'public, max-age=86400' : 'no-cache'),
});

// Halaman HTML: isi __ORIGIN__ dengan domain asli (untuk canonical, Open Graph, sitemap)
const PAGES = { '/': 'index', '/grab': 'grab', '/qr': 'qr', '/legal': 'legal' };
const html = Object.fromEntries(Object.entries(PAGES).map(([p, f]) => [p, readFileSync(join(PUB, f + '.html'), 'utf8')]));
const origin = q => `${q.protocol}://${q.hostname}`;
for (const p of Object.keys(PAGES))
  app.get(p, (q, r) => r.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(html[p].replaceAll('__ORIGIN__', origin(q))));
app.get('/sitemap.xml', (q, r) => r.type('application/xml').send(
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  Object.keys(PAGES).map(p => `  <url><loc>${origin(q)}${p === '/' ? '' : p}</loc></url>`).join('\n') + `\n</urlset>\n`));
app.get('/robots.txt', (q, r) => r.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${origin(q)}/sitemap.xml\n`));
app.get('/healthz', (_q, r) => r.type('text/plain').send('ok')); // untuk UptimeRobot dkk
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
app.addHook('onSend', async (q, r) => {
  r.header('X-Content-Type-Options', 'nosniff'); r.header('Referrer-Policy', 'strict-origin-when-cross-origin'); r.header('Content-Security-Policy', CSP);
  if (q.url.startsWith('/api/') && !q.url.startsWith('/api/file/')) r.header('Cache-Control', 'no-store'); // status unduhan tidak boleh di-cache
});
app.setErrorHandler((e, _q, r) =>
  r.code(e.statusCode || 500).send({ error: e.statusCode < 500 ? e.message : 'Terjadi kesalahan server', code: e.ec }));
process.on('unhandledRejection', e => console.error('[unhandled]', e?.name)); // satu error tak terduga tidak boleh mematikan server

// ---------- Konfigurasi (semua bisa diubah lewat environment variable di Render) ----------
const MAX_MB = +process.env.MAX_MB || 700;        // instance gratis hanya 512 MB RAM: batasi ukuran file
const MAX_JOBS = +process.env.MAX_JOBS || 2;      // unduhan bersamaan
const MAX_INFO = +process.env.MAX_INFO || 3;      // pencarian info bersamaan
const MAX_STORED = +process.env.MAX_STORED || 6;  // file siap-unduh yang boleh menumpuk di disk
const DL_MS = 20 * 60e3;                          // batas waktu satu unduhan
const PROXY = process.env.PROXY_URL || '';        // opsional: proxy residensial http/https/socks5 (solusi IP datacenter diblokir)
const EXTRA = (process.env.YTDLP_EXTRA || '').split(/\s+/).filter(Boolean); // argumen tambahan yt-dlp tanpa ubah kode
const CHANNEL = process.env.YTDLP_CHANNEL || 'nightly'; // 'nightly' = perbaikan situs paling cepat, 'stable' = lebih konservatif

const MSG = {
  BAD_URL: 'Link tidak valid',
  ADDR: 'Alamat tidak diizinkan',
  BOT: 'YouTube memblokir permintaan dari server ini',
  LOGIN: 'Platform meminta login untuk video ini',
  PRIVATE: 'Video ini privat',
  BLOCKED: 'Platform memblokir permintaan dari server ini',
  EXTRACT: 'Platform mengubah sistemnya atau memblokir server ini',
  UNSUPPORTED: 'Link ini belum didukung',
  UNAVAILABLE: 'Video tidak tersedia',
  RATE: 'Platform membatasi permintaan, coba lagi nanti',
  TOO_BIG: `File terlalu besar (maks ${MAX_MB} MB)`,
  BAD_FORMAT: 'Format tidak valid',
  FORMAT: 'Format tidak tersedia',
  BUSY: 'Server sedang sibuk, coba sebentar lagi',
  EXPIRED: 'File sudah kedaluwarsa, siapkan ulang',
  TIMEOUT: 'Terlalu lama diproses',
  FAILED: 'Gagal memproses video. Coba lagi nanti.',
};
// ec = kode error yang dibaca browser; teks di MSG hanya cadangan
const err = (c, m, ec) => Object.assign(new Error(m), { statusCode: c, ec });
const fail = (c, ec) => err(c, MSG[ec], ec);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Alamat yang tidak boleh diakses dari server (lokal, privat, CGNAT, link-local, multicast, dll)
const priv = raw => {
  const ip = raw.toLowerCase();
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(ip)) return true; // IPv4-mapped bentuk hex: tolak
  const v4 = ip.replace(/^::ffff:/, '');
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || b === 0)) || (a === 198 && (b === 18 || b === 19));
  }
  return /^(::1?$|f[cd]|fe[89ab])/.test(ip);
};

async function safeUrl(raw = '') {
  let u; try { u = new URL(raw); } catch { throw fail(400, 'BAD_URL'); }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw fail(400, 'BAD_URL');
  if (u.port && u.port !== '80' && u.port !== '443') throw fail(400, 'ADDR');
  const h = u.hostname.replace(/^\[|\]$/g, '');
  const ips = isIP(h) ? [h] : (await lookup(h, { all: true }).catch(() => [])).map(a => a.address);
  if (!ips.length) throw fail(400, 'BAD_URL');
  if (ips.some(priv)) throw fail(400, 'ADDR');
  return u.href;
}

// Klasifikasi pesan error yt-dlp. URUTAN PENTING: pola yang lebih spesifik harus lebih dulu.
const codeOf = s =>
    /not a bot|only images are available/i.test(s) ? 'BOT'
  : /larger than|max-filesize/i.test(s) ? 'TOO_BIG'
  : /requested format is not available/i.test(s) ? 'FORMAT'
  : /unsupported url/i.test(s) ? 'UNSUPPORTED'
  : /private video|video is private|this (video|account) is private|is a private/i.test(s) ? 'PRIVATE'
  : /not available in your (country|region)|blocked it in your country|geo.?restrict/i.test(s) ? 'UNAVAILABLE'
  : /login required|log ?in|sign in|--cookies|authentication|age.?restrict|confirm your age|members.?only|rate-limit reached|empty media response|registered users|cookies/i.test(s) ? 'LOGIN'
  : /video unavailable|not available|has been removed|removed by|does not exist|no longer available|isn.?t available|terminated|http error 404|\b404\b|deleted/i.test(s) ? 'UNAVAILABLE'
  : /ip address is blocked|http error 403|forbidden|access denied|blocked/i.test(s) ? 'BLOCKED'
  : /429|too many requests|rate.?limit/i.test(s) ? 'RATE'
  : /unable to extract|cannot parse data|no video formats found|unable to download (webpage|json)|universal data|please report this issue/i.test(s) ? 'EXTRACT'
  : 'FAILED';

// ---------- Cookies (opsional, berlaku untuk SEMUA situs: YouTube, Instagram, Facebook, TikTok) ----------
// Sumber (urut prioritas): Secret File Render /etc/secrets/cookies.txt, env COOKIES_B64 (base64), env COOKIES / YT_COOKIES.
const COOKIES = '/tmp/cookies.txt';
function loadCookies() {
  try {
    const sec = '/etc/secrets/cookies.txt';
    let txt = existsSync(sec) ? readFileSync(sec, 'utf8')
      : process.env.COOKIES_B64 ? Buffer.from(process.env.COOKIES_B64, 'base64').toString('utf8')
      : process.env.COOKIES || process.env.YT_COOKIES || '';
    txt = txt.replace(/\r\n?/g, '\n').trim();
    if (!txt) return false;
    const isCookie = l => l.trim() && (!l.startsWith('#') || l.startsWith('#HttpOnly_'));
    // Tab sering berubah jadi spasi saat ditempel ke kolom env: pulihkan format Netscape (7 kolom dipisah tab)
    txt = txt.split('\n').map(l => {
      if (!isCookie(l) || l.includes('\t')) return l;
      const p = l.trim().split(/\s+/);
      return p.length >= 7 ? [...p.slice(0, 6), p.slice(6).join(' ')].join('\t') : l;
    }).join('\n');
    if (!/^# (Netscape )?HTTP Cookie File/m.test(txt)) txt = '# Netscape HTTP Cookie File\n' + txt;
    writeFileSync(COOKIES, txt + '\n', { mode: 0o600 });
    return true;
  } catch { return false; }
}
const hasCookies = loadCookies();

const YTDLP = process.env.YTDLP_BIN || 'yt-dlp';
const BASE = [
  '-4', '--js-runtimes', 'node', '--remote-components', 'ejs:github', // JS runtime + solver n-challenge YouTube (cadangan bila tidak ikut ter-bundle)
  '--no-playlist', '--no-warnings', '--cache-dir', '/tmp/yt-dlp-cache', // cache player/solver: jauh lebih cepat dibanding --no-cache-dir
  '--socket-timeout', '20', '--retries', '3', '--fragment-retries', '3', '--extractor-retries', '2',
  ...(PROXY ? ['--proxy', PROXY] : []),
  ...(hasCookies ? ['--cookies', COOKIES] : []),
  ...EXTRA,
];

const run = (args, { ms = DL_MS, onOut } = {}) => new Promise((ok, no) => {
  const p = spawn(YTDLP, [...BASE, ...args]);
  let out = '', e = '', buf = '', timedOut = false;
  const t = setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, ms);
  p.stdout.on('data', d => {
    out += d;
    if (onOut) { // baca progres baris demi baris (\r dan \n)
      buf += d; let i;
      while ((i = buf.search(/[\r\n]/)) >= 0) { onOut(buf.slice(0, i)); buf = buf.slice(i + 1); }
      if (out.length > 60000) out = out.slice(-20000);
    }
  });
  p.stderr.on('data', d => { e += d; if (e.length > 30000) e = e.slice(-15000); });
  p.on('error', () => { clearTimeout(t); no(err(500, 'yt-dlp tidak ditemukan')); });
  p.on('close', c => {
    clearTimeout(t);
    if (c || timedOut) {
      if (process.env.DEBUG_YTDLP) console.error('[yt-dlp]', timedOut ? 'TIMEOUT' : 'exit ' + c, e.split('\n').filter(l => /ERROR/.test(l)).slice(-3).join(' | ').slice(0, 500));
      return no(timedOut ? fail(504, 'TIMEOUT') : fail(422, codeOf(e || out)));
    }
    ok(out);
  });
});

const short = c => !c || c === 'none' || c === 'unknown' ? null
  : /^avc/.test(c) ? 'H.264' : /^(hev|hvc)/.test(c) ? 'H.265' : /^av01/.test(c) ? 'AV1'
  : /^vp0?9/.test(c) ? 'VP9' : /^mp4a/.test(c) ? 'AAC' : /^opus/.test(c) ? 'Opus' : c.split('.')[0].toUpperCase();

// YouTube sering memblokir IP datacenter. Coba beberapa player client, ingat yang berhasil (hash, bukan URL).
const isYT = u => { try { return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(new URL(u).hostname); } catch { return false; } };
const CLIENTS = [['tv'], [], ['android_vr'], ['mweb'], ['web_safari']]; // [] = pilihan bawaan yt-dlp (selalu diperbarui pembuatnya)
const RETRY_YT = new Set(['BOT', 'LOGIN', 'PRIVATE', 'BLOCKED', 'FORMAT', 'EXTRACT', 'FAILED']); // client salah -> coba client lain
const RETRY_OTHER = new Set(['EXTRACT', 'FAILED', 'RATE']); // situs lain: gangguan sesaat, coba satu kali lagi
const good = new Map();
let lastGood = -1; // client terakhir yang berhasil (pemblokiran IP berlaku global, bukan per video)
async function tryClients(url, fn, budget = 0) {
  if (!isYT(url)) {
    try { return await fn([]); }
    catch (e) { if (!RETRY_OTHER.has(e.ec)) throw e; await sleep(1500); return fn([]); }
  }
  const t0 = Date.now(), key = createHash('sha1').update(url).digest('hex');
  const pref = good.get(key) ?? lastGood;
  const order = CLIENTS.map((_, i) => i);
  if (pref >= 0) order.sort((a, b) => (a === pref ? -1 : b === pref ? 1 : 0));
  let last;
  for (const i of order) {
    if (last && budget && Date.now() - t0 > budget) break; // jangan membuat pengguna menunggu terlalu lama
    const c = CLIENTS[i];
    try {
      const r = await fn(['--http-chunk-size', '10M', ...(c.length ? ['--extractor-args', 'youtube:player_client=' + c.join(',')] : [])]);
      if (good.size > 500) good.clear();
      good.set(key, i); lastGood = i;
      return r;
    } catch (e) {
      last = e;
      if (!RETRY_YT.has(e.ec)) throw e; // tidak tersedia / tidak didukung / dll: tidak perlu coba lagi
    }
  }
  // Semua client gagal. Tanpa cookies, "perlu login" dari IP datacenter hampir selalu berarti diblokir, bukan video privat.
  if ((last.ec === 'PRIVATE' || last.ec === 'LOGIN') && !hasCookies) throw fail(422, 'BOT');
  throw last;
}

// ---------- /api/info ----------
// Pilih entri yang punya video (kiriman Instagram bisa berupa carousel / playlist)
function pick(j) {
  const ok = x => x && (x.formats?.length || x.url);
  if (ok(j)) return [j, 1];
  const i = (j.entries || []).findIndex(ok);
  if (i < 0) return [j, 1];
  const x = j.entries[i];
  return [{ ...x, title: x.title || j.title, uploader: x.uploader || j.uploader, thumbnail: x.thumbnail || j.thumbnail }, i + 1];
}

let infoBusy = 0;
app.get('/api/info', RL(40), async req => {
  const url = await safeUrl(req.query.url);
  if (infoBusy >= MAX_INFO) throw fail(503, 'BUSY');
  infoBusy++;
  let raw;
  try { raw = await tryClients(url, ex => run([...ex, '-J', url], { ms: 80000 }), 120000); } finally { infoBusy--; }
  let j; try { j = JSON.parse(raw); } catch { throw fail(422, 'EXTRACT'); }
  const [v, item] = pick(j);
  const dur = v.duration || 0;
  let list = v.formats || [];
  // Beberapa situs hanya memberi satu URL langsung tanpa daftar format
  if (!list.length && v.url) list = [{ format_id: 'best', ext: v.ext || 'mp4', vcodec: v.vcodec, acodec: v.acodec, height: v.height, width: v.width, fps: v.fps, tbr: v.tbr, filesize: v.filesize || v.filesize_approx }];
  const map = new Map();
  for (const x of list) {
    if (!x.format_id || x.ext === 'mhtml' || x.has_drm) continue;
    const noV = x.vcodec === 'none', noA = x.acodec === 'none';
    if (noV && noA) continue;
    // Codec "tidak diketahui" (null) BUKAN berarti tanpa video: yt-dlp menganggapnya video+audio (mis. format sd/hd Facebook)
    const dims = !!(x.vcodec || x.height || x.width);
    const k = noV ? 'a' : noA ? 'v' : dims ? 'av' : x.acodec ? 'a' : 'av';
    // filesize asli bila ada; filesize_approx dari yt-dlp sering melenceng (HLS), jadi pakai bitrate x durasi
    const ex = !!x.filesize;
    const size = Math.round(x.filesize || (x.tbr && dur ? x.tbr * 125 * dur : x.filesize_approx || 0));
    const f = { id: x.format_id, k, ext: x.ext || 'mp4', h: x.height || 0, fps: x.fps || 0, vc: short(x.vcodec), ac: short(x.acodec),
      br: Math.round(x.tbr || x.abr || 0), size, ex, hdr: !!x.dynamic_range && x.dynamic_range !== 'SDR' };
    const key = [k, f.h, f.fps, f.ext, f.vc, f.ac, f.hdr].join('|');
    if (!map.has(key) || map.get(key).br < f.br) map.set(key, f);
  }
  const formats = [...map.values()];
  if (!formats.length) throw fail(422, 'UNSUPPORTED'); // mis. kiriman foto: tidak ada video yang bisa diunduh
  const bestA = formats.filter(f => f.k === 'a').sort((a, b) => b.br - a.br)[0];
  if (bestA) formats.forEach(f => { if (f.k === 'v' && f.size) { f.size += bestA.size; f.ex = f.ex && bestA.ex; } });
  if (dur) formats.push({ id: 'mp3', k: 'a', ext: 'mp3', h: 0, fps: 0, vc: null, ac: 'MP3', br: 192, size: dur * 24000, ex: false, hdr: false });
  return { title: v.title || j.title, thumb: v.thumbnail || j.thumbnail, dur, who: v.uploader || v.channel || j.uploader || '', formats, item };
});

// ---------- /api/prepare + /api/status + /api/file ----------
// Unduhan berjalan di latar belakang; browser mengecek progres tiap ~1 detik. Koneksi tidak perlu terbuka
// berminggu-menit (yang sering diputus proxy/jaringan HP), dan pengguna bisa melihat persentase asli.
let busy = 0;
const jobs = new Map(); // id -> { st: 'run'|'done'|'err', pct, dir, name, size, ec, exp, dl }
const clean = async id => { const j = jobs.get(id); if (j) { jobs.delete(id); await rm(j.dir, { recursive: true, force: true }).catch(() => {}); } };
setInterval(() => jobs.forEach((j, id) => { if (j.exp < Date.now() && !j.dl && j.st !== 'run') clean(id); }), 30000);
readdir(tmpdir()).then(l => l.filter(n => /^dl-/.test(n)).forEach(n => rm(join(tmpdir(), n), { recursive: true, force: true }))).catch(() => {}); // sisa file dari restart sebelumnya

const int = (v, a, b) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : 0; };
// Selektor format dengan cadangan: bila ID format dari /api/info sudah hilang (ID bisa berubah antar permintaan,
// terutama YouTube bila client berganti), tetap ambil yang terdekat alih-alih gagal "Requested format is not available".
function selector(f, k, e, h) {
  const H = h ? `[height<=${h}]` : '';
  if (f === 'mp3') return 'ba/b';
  if (f === 'best') return 'b/bv*+ba';
  if (k === 'v') return `${f}+ba[ext=${e === 'mp4' ? 'm4a' : 'webm'}]/${f}+ba/bv*${H}+ba/b${H}/b`;
  if (k === 'a') return `${f}/ba/b`;
  return `${f}/b${H}/b`;
}
function track(job, line) {
  let m;
  if (/^\[download\] Destination:/.test(line)) { job.idx++; return; }
  if ((m = /^\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line))) {
    const p = Math.round(((Math.max(job.idx, 1) - 1 + Math.min(100, +m[1]) / 100) / job.total) * 100);
    if (p > job.pct) job.pct = Math.min(p, 98);
  } else if (/^\[(Merger|ExtractAudio|VideoConvertor|Fixup)/.test(line)) job.pct = Math.max(job.pct, 98);
}
async function work(job, url, { f, k, e, h, item }) {
  try {
    const a = ['--max-filesize', MAX_MB + 'M', '--restrict-filenames', '--newline', '--playlist-items', String(item),
      '-o', join(job.dir, '%(title).80B.%(ext)s'), '-f', selector(f, k, e, h)];
    if (f === 'mp3') a.push('-x', '--audio-format', 'mp3', '--audio-quality', '0'); // hanya audio yang diunduh, bukan seluruh video
    else if (k === 'v') a.push('--merge-output-format', e === 'mp4' || e === 'webm' ? e : 'mkv');
    const log = await tryClients(url, ex => { job.idx = 0; job.pct = 0; return run([...ex, ...a, url], { ms: DL_MS, onOut: l => track(job, l) }); });
    const all = (await readdir(job.dir)).filter(n => !/\.(part|ytdl|temp)$/i.test(n));
    const names = all.filter(n => !/\.f[\w-]+\.[a-z0-9]+$/i.test(n)); // buang sisa potongan video/audio yang belum digabung
    const sizes = await Promise.all((names.length ? names : all).map(async n => [n, (await stat(join(job.dir, n))).size]));
    const best = sizes.sort((x, y) => y[1] - x[1])[0]; // file hasil akhir = yang terbesar
    if (!best) throw fail(422, /larger than/i.test(log) ? 'TOO_BIG' : 'FAILED'); // yt-dlp melewati file yang melebihi batas tanpa error
    Object.assign(job, { st: 'done', pct: 100, name: best[0], size: best[1], exp: Date.now() + 600000 });
  } catch (x) {
    await rm(job.dir, { recursive: true, force: true }).catch(() => {});
    Object.assign(job, { st: 'err', ec: x.ec || 'FAILED', exp: Date.now() + 120000 });
  } finally { busy--; }
}

app.get('/api/prepare', RL(15), async req => {
  const { f, k, e } = req.query;
  const url = await safeUrl(req.query.url);
  if (!/^[\w.+-]{1,40}$/.test(f || '')) throw fail(400, 'BAD_FORMAT');
  if (busy >= MAX_JOBS) throw fail(503, 'BUSY');
  busy++;
  let dir;
  try {
    // Disk terbatas: bila file siap-unduh menumpuk, buang yang terlama (yang tak diambil), jangan menolak pengguna baru
    const live = [...jobs].filter(([, j]) => j.st !== 'err');
    if (live.length >= MAX_STORED) {
      const old = live.filter(([, j]) => j.st === 'done' && !j.dl).sort((a, b) => a[1].exp - b[1].exp)[0];
      if (!old) throw fail(503, 'BUSY');
      await clean(old[0]);
    }
    dir = await mkdtemp(join(tmpdir(), 'dl-'));
  } catch (x) { busy--; throw x; }
  const id = randomUUID();
  const job = { st: 'run', pct: 0, idx: 0, total: k === 'v' ? 2 : 1, dir, exp: Date.now() + DL_MS + 300000, dl: 0 };
  jobs.set(id, job);
  work(job, url, { f, k, e, h: int(req.query.h, 0, 8000), item: int(req.query.i, 1, 50) || 1 });
  return { id };
});

app.get('/api/status/:id', RL(200), req => {
  const j = jobs.get(req.params.id);
  if (!j) throw fail(404, 'EXPIRED');
  if (j.st === 'run') return { st: 'run', pct: j.pct };
  if (j.st === 'err') return { st: 'err', code: j.ec };
  return { st: 'done', token: req.params.id, name: j.name, size: j.size };
});

const MIME = { mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4', opus: 'audio/ogg', ogg: 'audio/ogg', wav: 'audio/wav' };
app.get('/api/file/:t', RL(60), (req, reply) => {
  const j = jobs.get(req.params.t);
  if (!j || j.st !== 'done') throw fail(404, 'EXPIRED');
  const size = j.size;
  let start = 0, end = size - 1, code = 200;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || ''); // dukung Range: pengelola unduhan & Safari bisa melanjutkan / mengecek ulang
  if (m && (m[1] || m[2])) {
    if (m[1] === '') start = Math.max(0, size - +m[2]);
    else { start = +m[1]; if (m[2]) end = Math.min(end, +m[2]); }
    if (start > end || start >= size) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
    code = 206;
  }
  const ext = (j.name.split('.').pop() || '').toLowerCase();
  reply.code(code).type(MIME[ext] || 'application/octet-stream').header('Accept-Ranges', 'bytes').header('Content-Length', end - start + 1)
    .header('Content-Disposition', `attachment; filename="${j.name.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(j.name)}`);
  if (code === 206) reply.header('Content-Range', `bytes ${start}-${end}/${size}`);
  j.dl++;
  // File TIDAK lagi dihapus saat koneksi terputus (Safari/pengelola unduhan sering memutus lalu mengulang -> dulu jadi "kedaluwarsa").
  // Hapus hanya setelah terkirim penuh (+1 menit toleransi) atau saat masa berlakunya habis.
  reply.raw.on('close', () => { j.dl--; if (reply.raw.writableFinished && start === 0 && end === size - 1) j.exp = Math.min(j.exp, Date.now() + 60000); });
  return reply.send(createReadStream(join(j.dir, j.name), { start, end }));
});

// yt-dlp diperbarui otomatis (instance free selalu mulai dari image build, jadi perlu dicek saat start)
const upd = () => execFile(YTDLP, ['-U', '--update-to', CHANNEL], { timeout: 120000 }, () => {});
upd(); setInterval(upd, 12 * 3600e3);

app.listen({ port: +process.env.PORT || 3000, host: '0.0.0.0' });
