import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, rm, readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const app = Fastify({ logger: false, trustProxy: true }); // logger off: URL tidak pernah dicatat
await app.register(rateLimit, { max: 20, timeWindow: '1 minute' });
await app.register(fastifyStatic, { root: fileURLToPath(new URL('./public', import.meta.url)), extensions: ['html'] });
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

const friendly = s =>
  /private|log ?in|sign in|cookies/i.test(s) ? 'Video ini privat atau perlu login'
  : /unsupported url/i.test(s) ? 'Link ini belum didukung'
  : /unavailable|removed|not exist|404/i.test(s) ? 'Video tidak tersedia'
  : /429|too many/i.test(s) ? 'Platform membatasi permintaan, coba lagi nanti'
  : /larger than/i.test(s) ? 'File terlalu besar (maks 2 GB)'
  : 'Gagal memproses video. Coba lagi nanti.';

const run = (args, ms = 600000) => new Promise((ok, no) => {
  const p = spawn('yt-dlp', ['--no-playlist', '--no-warnings', '--no-cache-dir', '--socket-timeout', '15', ...args]);
  let out = '', e = '';
  const t = setTimeout(() => p.kill('SIGKILL'), ms);
  p.stdout.on('data', d => out += d);
  p.stderr.on('data', d => e += d);
  p.on('error', () => no(err(500, 'yt-dlp tidak ditemukan')));
  p.on('close', c => { clearTimeout(t); c ? no(err(422, friendly(e))) : ok(out); });
});

const short = c => !c || c === 'none' ? null
  : /^avc/.test(c) ? 'H.264' : /^(hev|hvc)/.test(c) ? 'H.265' : /^av01/.test(c) ? 'AV1'
  : /^vp0?9/.test(c) ? 'VP9' : /^mp4a/.test(c) ? 'AAC' : /^opus/.test(c) ? 'Opus' : c.split('.')[0].toUpperCase();

app.get('/api/info', async req => {
  const url = await safeUrl(req.query.url);
  const j = JSON.parse(await run(['-J', url], 60000));
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

app.get('/api/prepare', async req => {
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
    await run([...a, url]);
    const [name] = await readdir(dir);
    const { size } = await stat(join(dir, name));
    const token = randomUUID();
    jobs.set(token, { dir, name, size, exp: Date.now() + 600000 });
    return { token, name, size };
  } catch (x) { await rm(dir, { recursive: true, force: true }); throw x; }
  finally { busy--; }
});

app.get('/api/file/:t', (req, reply) => {
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
