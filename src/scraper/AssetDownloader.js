// ~/easyarc/src/scraper/AssetDownloader.js
const https = require('https');
const fs = require('fs');
const path = require('path');

class AssetDownloader {
  constructor(config = {}) {
    this.maxRedirects = config.maxRedirects || 5;
  }

  async download({ assets }) {
    try {
      if (!Array.isArray(assets) || assets.length === 0) {
        return { success: false, results: [] };
      }
      const results = [];
      for (const asset of assets) {
        const result = await this.downloadSingle(asset);
        results.push(result);
      }
      const allOk = results.every(r => r.success);
      return { success: allOk, results };
    } catch {
      return { success: false, results: [] };
    }
  }

  async downloadSingle(asset) {
    const { role, url, targetPath } = asset;
    const baseResult = { role, url, targetPath, success: false, error: null };
    if (!url || !targetPath) {
      return { ...baseResult, error: 'Missing url or targetPath' };
    }
    const dir = path.dirname(targetPath);
    const tmpPath = targetPath + '.tmp';
    try {
      fs.mkdirSync(dir, { recursive: true });
      await this.downloadToFile(url, tmpPath, this.maxRedirects);
      const stats = fs.statSync(tmpPath);
      if (!stats.isFile() || stats.size === 0) {
        fs.unlinkSync(tmpPath);
        return { ...baseResult, error: 'Empty file' };
      }
      fs.renameSync(tmpPath, targetPath);
      return { ...baseResult, success: true, error: null };
    } catch (err) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {}
      return { ...baseResult, error: err && err.message ? err.message : 'Download error' };
    }
  }

  downloadToFile(url, filePath, redirectsLeft) {
    return new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(filePath);
      const handleError = (err) => {
        fileStream.close(() => { reject(err); });
      };
      const makeRequest = (currentUrl, remainingRedirects) => {
        const req = https.get(currentUrl, (res) => {
          const status = res.statusCode || 0;
          if ([301, 302, 303, 307, 308].includes(status)) {
            res.resume();
            const location = res.headers.location;
            if (!location) return handleError(new Error('Redirect with no Location header'));
            if (remainingRedirects <= 0) return handleError(new Error('Too many redirects'));
            return makeRequest(location, remainingRedirects - 1);
          }
          if (status < 200 || status >= 300) {
            res.resume();
            return handleError(new Error(`HTTP ${status}`));
          }
          res.pipe(fileStream);
          res.on('error', handleError);
          fileStream.on('finish', () => { fileStream.close(resolve); });
          fileStream.on('error', handleError);
        });
        req.on('error', handleError);
      };
      makeRequest(url, redirectsLeft);
    });
  }
}

module.exports = AssetDownloader;
