FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /opt/ytdlp \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /opt/ytdlp/yt-dlp \
 && chmod a+rx /opt/ytdlp/yt-dlp \
 && chown -R node:node /opt/ytdlp
ENV PATH="/opt/ytdlp:${PATH}" NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node . .
USER node
EXPOSE 3000
CMD ["node", "server.js"]
