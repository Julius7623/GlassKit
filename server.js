import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, rm, readdir, stat } from 'node:fs/promises';
import { createReadStream, readFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const app = Fastify({ logger: false, trustProxy: true }); // logger off: URL tidak pernah dicatat
await app.register(rateLimit, { global: false, errorResponseBuilder: (_q, c) => ({ statusCode: 429, error: 'Too Many Requests', message: `Terlalu banyak permintaan, coba lagi dalam ${Math.ceil(c.ttl / 1000)} detik` }) }); // hanya /api/* yang dibatasi; halaman & aset statis tidak
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
app.addHook('onSend', async (_q, r) => { r.header('X-Content-Type-Options', 'nosniff'); r.header('Referrer-Policy', 'strict-origin-when-cross-origin'); });
app.setErrorHandler((e, _q, r) =>
  r.code(e.statusCode || 500).send({ error: e.statusCode < 500 ? e.message : 'Terjadi kesalahan server' }));

const err = (c, m) => Object.assign(new Error(m), { statusCode: c });
const priv = ip => /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1?$|f[cd]|fe80)/i.test(ip.replace(/^::ffff:/i, ''));

async function safeUrl(raw = '') {
  let u; try { u = new URL(raw); } catch { throw err(400, 'Link tidak valid'); }
  if (!/^https?:$/.test(u.protocol)) throw err(400, 'Hanya link http/https');
  const h = u.hostname.replace(/^\[|\]$/g, '');
  const ips = isIP(h) ? [h] : (await lookup(h, { all: true }).catch(() => [])).map(a => a.address);
  if (!ips.length || ips.some(priv)) throw err(400, 'Alamat tidak diizinkan');
  return u.href;
}

const BOT = 'YouTube memblokir permintaan dari server ini';
const friendly = s =>
  /confirm you.?re not a bot|not a bot/i.test(s) ? BOT
  : /private|log ?in|sign in|cookies/i.test(s) ? 'Video ini privat atau perlu login'
  : /unsupported url/i.test(s) ? 'Link ini belum didukung'
  : /unavailable|removed|not exist|404/i.test(s) ? 'Video tidak tersedia'
  : /429|too many/i.test(s) ? 'Platform membatasi permintaan, coba lagi nanti'
  : /larger than/i.test(s) ? 'File terlalu besar (maks 2 GB)'
  : 'Gagal memproses video. Coba lagi nanti.';

// Cookies YouTube (opsional): isi env YT_COOKIES dengan isi cookies.txt format Netscape
const COOKIES = '/tmp/yt-cookies.txt';
const hasCookies = !!process.env.YT_COOKIES;
if (hasCookies) writeFileSync(COOKIES, process.env.YT_COOKIES, { mode: 0o600 });

const run = (args, ms = 600000) => new Promise((ok, no) => {
  const p = spawn('yt-dlp', ['-4', '--js-runtimes', 'node', '--no-playlist', '--no-warnings', '--no-cache-dir', '--socket-timeout', '15', ...args]);
  let out = '', e = '';
  const t = setTimeout(() => p.kill('SIGKILL'), ms);
  p.stdout.on('data', d => out += d);
  p.stderr.on('data', d => e += d);
  p.on('error', () => no(err(500, 'yt-dlp tidak ditemukan')));
  p.on('close', c => {
    clearTimeout(t);
    if (c && process.env.DEBUG_YTDLP) console.error('[yt-dlp]', e.trim().split('\n').slice(-3).join(' | ').slice(0, 400));
    c ? no(err(422, friendly(e))) : ok(out);
  });
});

const short = c => !c || c === 'none' ? null
  : /^avc/.test(c) ? 'H.264' : /^(hev|hvc)/.test(c) ? 'H.265' : /^av01/.test(c) ? 'AV1'
  : /^vp0?9/.test(c) ? 'VP9' : /^mp4a/.test(c) ? 'AAC' : /^opus/.test(c) ? 'Opus' : c.split('.')[0].toUpperCase();

// YouTube sering memblokir IP datacenter. Coba beberapa player client, ingat yang berhasil (hash, bukan URL).
const isYT = u => { try { return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(new URL(u).hostname); } catch { return false; } };
const CLIENTS = [['tv'], [], ['mweb'], ['web_safari']];
const good = new Map();
async function tryClients(url, fn) {
  if (!isYT(url)) return fn([]);
  const key = createHash('sha1').update(url).digest('hex');
  const g = good.get(key);
  const order = CLIENTS.map((_, i) => i);
  if (g !== undefined) order.sort((a, b) => (a === g ? -1 : b === g ? 1 : 0));
  const base = hasCookies ? ['--cookies', COOKIES] : [];
  let last;
  for (const i of order) {
    const c = CLIENTS[i];
    try {
      const r = await fn([...base, ...(c.length ? ['--extractor-args', 'youtube:player_client=' + c.join(',')] : [])]);
      if (good.size > 500) good.clear();
      good.set(key, i);
      return r;
    } catch (e) {
      last = e;
      if (e.message !== BOT && !/^Gagal memproses/.test(e.message)) throw e; // video privat/hilang/dll: tidak perlu coba lagi
    }
  }
  throw last;
}

app.get('/api/info', RL(40), async req => {
  const url = await safeUrl(req.query.url);
  const j = JSON.parse(await tryClients(url, ex => run([...ex, '-J', url], 40000)));
  const dur = j.duration || 0;
  const map = new Map();
  for (const x of j.formats || []) {
    if (!x.format_id || x.ext === 'mhtml' || (x.vcodec === 'none' && x.acodec === 'none')) continue;
    const hasV = x.vcodec && x.vcodec !== 'none', hasA = x.acodec && x.acodec !== 'none';
    const k = hasV && hasA ? 'av' : hasV ? 'v' : 'a';
    // filesize asli bila ada; filesize_approx dari yt-dlp sering melenceng (HLS), jadi pakai bitrate x durasi
    const ex = !!x.filesize;
    const size = Math.round(x.filesize || (x.tbr && dur ? x.tbr * 125 * dur : x.filesize_approx || 0));
    const f = { id: x.format_id, k, ext: x.ext, h: x.height || 0, fps: x.fps || 0, vc: short(x.vcodec), ac: short(x.acodec),
      br: Math.round(x.tbr || x.abr || 0), size, ex, hdr: !!x.dynamic_range && x.dynamic_range !== 'SDR' };
    const key = [k, f.h, f.fps, f.ext, f.vc, f.ac, f.hdr].join('|');
    if (!map.has(key) || map.get(key).br < f.br) map.set(key, f);
  }
  const formats = [...map.values()];
  const bestA = formats.filter(f => f.k === 'a').sort((a, b) => b.br - a.br)[0];
  if (bestA) formats.forEach(f => { if (f.k === 'v' && f.size) { f.size += bestA.size; f.ex = f.ex && bestA.ex; } });
  if (dur) formats.push({ id: 'mp3', k: 'a', ext: 'mp3', h: 0, fps: 0, vc: null, ac: 'MP3', br: 192, size: dur * 24000, ex: false, hdr: false });
  return { title: j.title, thumb: j.thumbnail, dur, who: j.uploader || j.channel || '', formats };
});

let busy = 0;
const jobs = new Map();
const clean = async t => { const j = jobs.get(t); if (j) { jobs.delete(t); await rm(j.dir, { recursive: true, force: true }); } };
setInterval(() => jobs.forEach((j, t) => j.exp < Date.now() && clean(t)), 60000);

app.get('/api/prepare', RL(15), async req => {
  const { f, k, e } = req.query;
  const url = await safeUrl(req.query.url);
  if (!/^[\w.+-]{1,40}$/.test(f || '')) throw err(400, 'Format tidak valid');
  if (busy >= 3) throw err(503, 'Server sedang sibuk, coba sebentar lagi');
  busy++;
  const dir = await mkdtemp(join(tmpdir(), 'dl-'));
  try {
    const a = ['--max-filesize', '2G', '--restrict-filenames', '-o', join(dir, '%(title).80B.%(ext)s')];
    if (f === 'mp3') a.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
    else if (k === 'v') a.push('-f', `${f}+ba[ext=${e === 'mp4' ? 'm4a' : 'webm'}]/${f}+ba`, '--merge-output-format', e === 'mp4' || e === 'webm' ? e : 'mkv');
    else a.push('-f', f);
    await tryClients(url, ex => run([...ex, ...a, url]));
    const [name] = await readdir(dir);
    const { size } = await stat(join(dir, name));
    const token = randomUUID();
    jobs.set(token, { dir, name, size, exp: Date.now() + 600000 });
    return { token, name, size };
  } catch (x) { await rm(dir, { recursive: true, force: true }); throw x; }
  finally { busy--; }
});

app.get('/api/file/:t', RL(60), (req, reply) => {
  const j = jobs.get(req.params.t);
  if (!j) throw err(404, 'File sudah kedaluwarsa, siapkan ulang');
  reply.raw.on('close', () => clean(req.params.t)); // sekali unduh, lalu dihapus
  return reply.type('application/octet-stream').header('Content-Length', j.size)
    .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(j.name)}`)
    .send(createReadStream(join(j.dir, j.name)));
});

const upd = () => execFile('yt-dlp', ['-U'], () => {}); // yt-dlp selalu terbaru
upd(); setInterval(upd, 12 * 3600e3);

app.listen({ port: +process.env.PORT || 3000, host: '0.0.0.0' });
