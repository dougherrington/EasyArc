// ~/easyarc/src/scraper/PathBuilder.js
const path = require('path');

class PathBuilder {
  constructor({ baseDir }) {
    this.baseDir = baseDir;
  }

  build({ systemId, gameId, role, format }) {
    // Defensive fallback — format should never be null, but if it is,
    // we avoid generating filenames like "box.null"
    const safeFormat = format || 'png';
    return path.join(
      this.baseDir,
      systemId,
      String(gameId),
      `${role}.${safeFormat}`
    );
  }
}

module.exports = PathBuilder;
