const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

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

app.post('/api/fetch-video', fetchLimiter, (req, res) => {
  const { url } = req.body || {};

  if (!url || typeof url !== 'string' || !/^https?:\/\/(www\.)?threads\.(net|com)\//.test(url)) {
    return res.status(400).json({ error: '請提供有效的 Threads 貼文連結' });
  }

  const id = crypto.randomBytes(8).toString('hex');
  const outputTemplate = path.join(DOWNLOAD_DIR, `${id}.%(ext)s`);

  // 用 execFile 而非 exec，避免 shell 注入風險；參數陣列傳入
  const args = [
    url,
    '-f', 'mp4/best',
    '--no-playlist',
    '--max-filesize', '50M',
    '-o', outputTemplate
  ];

  execFile('yt-dlp', args, { timeout: 60000 }, (err, stdout, stderr) => {
    if (err) {
      console.error('yt-dlp error:', stderr || err.message);
      return res.status(500).json({ error: '抓取失敗，可能是私人貼文、純文字貼文，或連結錯誤' });
    }

    // yt-dlp 可能輸出 .mp4 之外的副檔名，找出實際產生的檔案
    fs.readdir(DOWNLOAD_DIR, (readErr, files) => {
      if (readErr) return res.status(500).json({ error: '伺服器讀取錯誤' });

      const match = files.find(f => f.startsWith(id));
      if (!match) {
        return res.status(500).json({ error: '抓取失敗，找不到輸出檔案' });
      }

      res.json({ videoUrl: `/tmp_downloads/${match}` });

      // 10 分鐘後自動刪除
      setTimeout(() => {
        fs.unlink(path.join(DOWNLOAD_DIR, match), () => {});
      }, 10 * 60 * 1000);
    });
  });
});

// 靜態提供暫存影片檔
app.use('/tmp_downloads', express.static(DOWNLOAD_DIR));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});