FROM node:22-slim

# - ffmpeg: menggabung video+audio, konversi MP3
# - python3 + venv + curl_cffi: "impersonasi browser" yang WAJIB untuk TikTok dan Facebook. Biner resmi `yt-dlp`
#   (zipimport) tidak menyertakannya, jadi tanpa ini TikTok gagal dengan "Unable to extract webpage video data".
# - yt-dlp channel nightly: perbaikan situs (TikTok/IG/FB sering berubah) tiba lebih cepat daripada rilis stable.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir curl-cffi pycryptodomex brotli certifi \
 && mkdir -p /opt/ytdlp \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp -o /opt/ytdlp/yt-dlp \
 && chmod a+rx /opt/ytdlp/yt-dlp \
 && chown -R node:node /opt/ytdlp
# venv di depan PATH: skrip yt-dlp memakai python3 milik venv, sehingga curl_cffi terbaca
ENV PATH="/opt/venv/bin:/opt/ytdlp:${PATH}" NODE_ENV=production
# Gagalkan build lebih awal (bukan saat dipakai pengguna) bila yt-dlp / impersonasi tidak berfungsi
RUN yt-dlp --version && python3 -c "import curl_cffi; print('curl_cffi', curl_cffi.__version__)" && (yt-dlp --list-impersonate-targets 2>&1 | head -8 || true)
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node . .
USER node
EXPOSE 3000
CMD ["node", "server.js"]
