// ~/easyarc/src/scraper/ScraperPipeline.js

const fs = require('fs');
const path = require('path');

const HashComputer = require('./HashComputer');
const TitleCleaner = require('./TitleCleaner');
const LookupClient = require('./LookupClient');
const MediaSelector = require('./MediaSelector');
const AssetDownloader = require('./AssetDownloader');
const PathBuilder = require('./PathBuilder');

class ScraperPipeline {
  constructor(config) {
    this.baseDir = config.baseDir;
    this.regionOrderDefault = config.regionOrder || ['us','eu','jp','wor','xx'];

    this.lookup = new LookupClient({
      devId: config.devId,
      devPassword: config.devPassword,
      ssid: config.ssid,
      ssPassword: config.ssPassword
    });

    this.mediaSelector = new MediaSelector();
    this.downloader = new AssetDownloader();
    this.pathBuilder = new PathBuilder({ baseDir: this.baseDir });

    this.cleanupTempFiles();
  }

  cleanupTempFiles() {
    try {
      const walk = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir)) {
          const full = path.join(dir, entry);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            walk(full);
          } else if (entry.endsWith('.tmp')) {
            try { fs.unlinkSync(full); } catch {}
          }
        }
      };
      walk(this.baseDir);
    } catch {}
  }

  async scrape(input) {
    try {
      return await this._scrapeInternal(input);
    } catch (err) {
      return {
        success: false,
        stage: 'pipeline',
        error: err?.message || 'Unexpected pipeline error',
        lookup: null,
        assets: []
      };
    }
  }

  async _scrapeInternal({ systemId, romPath, regionOrder, overrides = {} }) {
    if (!systemId || !romPath) {
      return {
        success: false,
        stage: 'validation',
        error: 'Missing systemId or romPath',
        lookup: null,
        assets: []
      };
    }

    let extension = path.extname(romPath);
    let size = 0;

    try {
      size = fs.statSync(romPath).size;
    } catch {
      return {
        success: false,
        stage: 'hash',
        error: 'ROM file not found or unreadable',
        lookup: null,
        assets: []
      };
    }

    const hashResult = await HashComputer.compute({
      path: romPath,
      extension,
      size,
      system: systemId
    });

    if (!hashResult.success) {
      return {
        success: false,
        stage: 'hash',
        error: hashResult.error,
        lookup: null,
        assets: []
      };
    }

    const cleanedTitle = overrides.title ||
      TitleCleaner.clean(path.basename(romPath)).cleanedTitle;

    const lookup = await this.lookup.lookup({
      systemId,
      hash: hashResult,
      title: cleanedTitle
    });

    if (!lookup.success) {
      return {
        success: false,
        stage: 'lookup',
        error: lookup.error,
        lookup,
        assets: []
      };
    }

    const { gameId, mediaList } = lookup;

    let finalRegionOrder = regionOrder || this.regionOrderDefault;
    if (overrides.region) {
      finalRegionOrder = [overrides.region, ...finalRegionOrder];
    }

    const media = this.mediaSelector.select({
      systemId,
      regionOrder: finalRegionOrder,
      mediaList,
      gameId
    });

    if (!media.success) {
      return {
        success: false,
        stage: 'media',
        error: media.error,
        lookup,
        assets: []
      };
    }

    const assetsWithPaths = media.assets.map(a => ({
      ...a,
      targetPath: this.pathBuilder.build({
        baseDir: this.baseDir,
        systemId,
        gameId,
        role: a.role,
        format: a.format
      })
    }));

    const downloadResult = await this.downloader.download({
      assets: assetsWithPaths
    });

    const allOk = downloadResult.success;

    return {
      success: allOk,
      stage: allOk ? 'done' : 'assets',
      systemId,
      romPath,
      gameId,
      lookup,
      assets: downloadResult.results
    };
  }
}

module.exports = ScraperPipeline;
