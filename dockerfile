FROM node:20-slim

# 安裝 python3、ffmpeg、curl（yt-dlp 需要）
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 ffmpeg ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# 直接抓 yt-dlp 官方最新 binary release（比 pip 版本更新更快，新網站支援更即時）
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    /usr/local/bin/yt-dlp --version

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV NODE_ENV=production

EXPOSE 10000

CMD ["node", "server.js"]