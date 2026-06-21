const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

// Render 在前面有 proxy，要設定 trust proxy 才能讓 express-rate-limit 正常讀取 X-Forwarded-For
app.set('trust proxy', 1);

const DOWNLOAD_DIR = path.join(__dirname, 'tmp_downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

app.use(cors()); // 如需限制來源，改成 cors({ origin: '你的前端網域' })
app.use(express.json());

// 限流：避免被濫用 / 避免你的 Render IP 被 Threads 封鎖
const fetchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: '請求太頻繁，請稍後再試' }
});

// 模擬真實瀏覽器的 headers，Threads 對沒有這些 header 的請求容易直接擋掉或回傳精簡版頁面
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

// 清理過期暫存檔（保險機制，避免 setTimeout 因重啟而失效）
function cleanupOldFiles() {
  fs.readdir(DOWNLOAD_DIR, (err, files) => {
    if (err) return;
    const now = Date.now();
    files.forEach(file => {
      const filePath = path.join(DOWNLOAD_DIR, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        if (now - stats.mtimeMs > 15 * 60 * 1000) {
          fs.unlink(filePath, () => {});
        }
      });
    });
  });
}
setInterval(cleanupOldFiles, 5 * 60 * 1000);

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Threads video backend running' });
});

function extractOgVideo(html) {
  let m = html.match(/<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i);
  if (!m) m = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::secure_url)?["']/i);
  if (m && m[1]) return m[1].replace(/&amp;/g, '&');

  // 備用方案：直接從頁面內嵌的 JSON 找 video_url（Threads 常把資料塞在 script 裡）
  m = html.match(/"video_url":"([^"]+)"/);
  if (m && m[1]) {
    try {
      return JSON.parse('"' + m[1] + '"');
    } catch (e) {
      return m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
    }
  }
  return null;
}

app.post('/api/fetch-video', fetchLimiter, async (req, res) => {
  const { url } = req.body || {};

  if (!url || typeof url !== 'string' || !/^https?:\/\/(www\.)?threads\.(net|com)\//.test(url)) {
    return res.status(400).json({ error: '請提供有效的 Threads 貼文連結' });
  }

  try {
    // 1. 先抓貼文頁面 HTML
    const pageRes = await fetch(url, { headers: BROWSER_HEADERS });
    if (!pageRes.ok) {
      return res.status(500).json({
        error: '無法讀取貼文頁面',
        detail: `HTTP ${pageRes.status}`
      });
    }
    const html = await pageRes.text();

    // 2. 解析出影片網址
    const videoUrl = extractOgVideo(html);
    if (!videoUrl) {
      return res.status(404).json({
        error: '找不到影片，可能是純文字貼文、私人貼文，或頁面結構已變動',
        detail: 'og:video meta tag 與內嵌 JSON 都沒找到 video_url'
      });
    }

    // 3. 下載影片本體（伺服器對伺服器，沒有 CORS 問題）
    const videoRes = await fetch(videoUrl, { headers: BROWSER_HEADERS });
    if (!videoRes.ok) {
      return res.status(500).json({
        error: '影片下載失敗',
        detail: `HTTP ${videoRes.status}`
      });
    }

    const contentLength = parseInt(videoRes.headers.get('content-length') || '0', 10);
    if (contentLength > 50 * 1024 * 1024) {
      return res.status(413).json({ error: '影片超過 50MB 限制' });
    }

    const id = crypto.randomBytes(8).toString('hex');
    const outputPath = path.join(DOWNLOAD_DIR, `${id}.mp4`);

    const buffer = Buffer.from(await videoRes.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);

    res.json({ videoUrl: `/tmp_downloads/${id}.mp4` });

    // 10 分鐘後自動刪除
    setTimeout(() => {
      fs.unlink(outputPath, () => {});
    }, 10 * 60 * 1000);

  } catch (err) {
    console.error('fetch-video error:', err);
    return res.status(500).json({
      error: '抓取失敗',
      detail: String(err.message || err).slice(-500)
    });
  }
});

// 靜態提供暫存影片檔
app.use('/tmp_downloads', express.static(DOWNLOAD_DIR));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});