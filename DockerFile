FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Standalone compiled binary — no external Python dependency
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

COPY start.sh ./
RUN chmod +x start.sh

ENV YTDLP_BIN=yt-dlp
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["./start.sh"]