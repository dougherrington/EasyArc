// ~/easyarc/src/scraper/MediaSelector.js

class MediaSelector {
  constructor(config = {}) {
    this.preferences = config.preferences || {
      box: ["box-2D", "box-3D", "box-textless", "box"],
      screenshot: ["screenshot-title", "screenshot-gameplay", "screenshot"],
      marquee: ["marquee"],
      wheel: ["wheel-hd", "wheel"]
    };
  }

  select({ systemId, regionOrder, mediaList, gameId }) {
    try {
      if (!Array.isArray(mediaList) || mediaList.length === 0) {
        return { success: false, error: "No media available", assets: [] };
      }
      const grouped = this.groupByRole(mediaList);
      const regionFiltered = this.applyRegionPriority(grouped, regionOrder);
      const selected = this.applyFormatPreferences(regionFiltered);
      const assets = this.buildAssets(selected, { systemId, gameId });
      if (assets.length === 0) {
        return { success: false, error: "No suitable media found", assets: [] };
      }
      return { success: true, assets };
    } catch (err) {
      return { success: false, error: "Unexpected error in MediaSelector", assets: [] };
    }
  }

  groupByRole(mediaList) {
    const grouped = {};
    for (const m of mediaList) {
      const role = ROLE_MAP[m.type];
      if (!role) continue;
      if (!grouped[role]) grouped[role] = [];
      grouped[role].push(m);
    }
    return grouped;
  }

  applyRegionPriority(grouped, regionOrder) {
    const regionFiltered = {};
    for (const role of Object.keys(grouped)) {
      const candidates = grouped[role];
      let bestRegion = null;
      for (const region of regionOrder) {
        if (candidates.some(c => c.region === region)) {
          bestRegion = region;
          break;
        }
      }
      if (!bestRegion) {
        regionFiltered[role] = [...candidates];
      } else {
        regionFiltered[role] = candidates.filter(c => c.region === bestRegion);
      }
    }
    return regionFiltered;
  }

  applyFormatPreferences(regionFiltered) {
    const selected = {};
    for (const role of Object.keys(regionFiltered)) {
      const candidates = regionFiltered[role];
      const prefs = this.preferences[role] || [];
      let winner = null;
      for (const pref of prefs) {
        winner = candidates.find(c => c.type === pref);
        if (winner) break;
      }
      if (!winner) winner = candidates[0];
      selected[role] = winner;
    }
    return selected;
  }

  buildAssets(selected, { systemId, gameId }) {
    const assets = [];
    for (const role of Object.keys(selected)) {
      const m = selected[role];
      assets.push({
        role,
        url: m.url,
        format: m.format || "png",
        region: m.region || null,
        systemId,
        gameId,
        targetPath: null
      });
    }
    return assets;
  }
}

const ROLE_MAP = {
  "box": "box",
  "box-2D": "box",
  "box-2D-US": "box",
  "box-2D-EU": "box",
  "box-3D": "box",
  "box-textless": "box",
  "screenshot": "screenshot",
  "screenshot-title": "screenshot",
  "screenshot-gameplay": "screenshot",
  "sstitle": "screenshot",
  "ssgameplay": "screenshot",
  "wheel": "wheel",
  "wheel-hd": "wheel",
  "marquee": "marquee"
};

module.exports = MediaSelector;
