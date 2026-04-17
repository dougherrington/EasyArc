// ~/easyarc/src/scraper/LookupClient.js

const https = require('https');

class LookupClient {
  constructor(config) {
    this.baseUrl = config.baseUrl || 'https://www.screenscraper.fr/api2';
    this.devId = config.devId;
    this.devPassword = config.devPassword;
    this.softName = config.softName || 'EasyArc';
    this.ssid = config.ssid || null;
  }

  async lookup({ crc32, sha1, md5, cleanedTitle, system }) {
    try {
      const hashResult = await this.lookupByHash({ crc32, sha1, md5, system });
      if (hashResult.success) return hashResult;
      const titleResult = await this.searchByTitle({ cleanedTitle, system });
      if (!titleResult.success) return titleResult;
      return await this.fetchFullMetadata(titleResult.gameId);
    } catch (err) {
      return { success: false, error: 'Unexpected error in LookupClient' };
    }
  }

  async lookupByHash({ crc32, sha1, md5, system }) {
    const url = new URL(`${this.baseUrl}/jeuInfos.php`);
    if (crc32) url.searchParams.set('crc', crc32);
    if (sha1)  url.searchParams.set('sha1', sha1);
    if (md5)   url.searchParams.set('md5', md5);
    if (system) url.searchParams.set('systemeid', system);
    this.addAuthParams(url);
    const response = await this.safeFetch(url);
    if (!response.success) return response;
    const game = response.data?.response?.jeu;
    if (!game) return { success: false, error: 'No hash match' };
    return { success: true, ...this.normalizeGame(game) };
  }

  async searchByTitle({ cleanedTitle, system }) {
    const url = new URL(`${this.baseUrl}/jeuRecherche.php`);
    url.searchParams.set('recherche', cleanedTitle);
    if (system) url.searchParams.set('systemeid', system);
    this.addAuthParams(url);
    const response = await this.safeFetch(url);
    if (!response.success) return response;
    const list = response.data?.response?.jeux;
    if (!Array.isArray(list) || list.length === 0) {
      return { success: false, error: 'No match found for title/system' };
    }
    const best = list[0];
    const gameId = best?.id;
    if (!gameId) return { success: false, error: 'Invalid candidate from title search' };
    return { success: true, gameId };
  }

  async fetchFullMetadata(gameId) {
    const url = new URL(`${this.baseUrl}/jeuInfos.php`);
    url.searchParams.set('gameid', gameId);
    this.addAuthParams(url);
    const response = await this.safeFetch(url);
    if (!response.success) return response;
    const game = response.data?.response?.jeu;
    if (!game) return { success: false, error: 'Failed to fetch full game metadata' };
    return { success: true, ...this.normalizeGame(game) };
  }

  addAuthParams(url) {
    url.searchParams.set('devid', this.devId);
    url.searchParams.set('devpassword', this.devPassword);
    url.searchParams.set('softname', this.softName);
    if (this.ssid) url.searchParams.set('ssid', this.ssid);
    url.searchParams.set('output', 'json');
  }

  safeFetch(url) {
    return new Promise(resolve => {
      https.get(url, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({ success: true, data: json });
          } catch {
            resolve({ success: false, error: 'Invalid JSON response' });
          }
        });
      }).on('error', () => {
        resolve({ success: false, error: 'Network error' });
      });
    });
  }

  normalizeGame(game) {
    return {
      gameId: game.id,
      gameTitle: game.nom || null,
      releaseYear: game.annee || null,
      systemId: game.systemeid || null,
      mediaList: game.medias || [],
      regionOrder: game.regions || [],
      metadata: {
        synopsis: game.synopsis || null,
        publisher: game.editeur || null,
        developer: game.developpeur || null,
        players: game.joueurs || null,
        genres: game.genres || null
      }
    };
  }
}

module.exports = LookupClient;
