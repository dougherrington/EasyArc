// ~/easyarc/src/scraper/HashComputer.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yauzl = require('yauzl');

// CRC32 implementation (standard IEEE polynomial)
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32Update(crc, buf) {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function formatCrc32(num) {
  return num.toString(16).toUpperCase().padStart(8, '0');
}

function isZipExtension(ext) {
  return ext.toLowerCase() === '.zip';
}

function isCandidateRomEntry(entry) {
  if (entry.fileName.endsWith('/')) return false;
  if (entry.fileName.startsWith('__MACOSX/')) return false;
  const base = path.basename(entry.fileName);
  if (base.startsWith('.')) return false;

  const ext = path.extname(base).toLowerCase();
  const romExts = [
    '.nes', '.sfc', '.smc', '.gba', '.gb', '.gbc',
    '.gen', '.md', '.bin', '.pce', '.n64', '.z64',
    '.v64', '.iso', '.cue', '.gdi',
    '.a26', '.rom', '.int', '.col', '.sms', '.sg'
  ];
  return romExts.includes(ext);
}

function hashReadableStream(stream) {
  return new Promise((resolve, reject) => {
    const sha1 = crypto.createHash('sha1');
    const md5 = crypto.createHash('md5');
    let crc = 0;

    stream.on('data', chunk => {
      sha1.update(chunk);
      md5.update(chunk);
      crc = crc32Update(crc, chunk);
    });

    stream.on('error', err => reject(err));

    stream.on('end', () => {
      resolve({
        crc32: formatCrc32(crc),
        sha1: sha1.digest('hex'),
        md5: md5.digest('hex')
      });
    });
  });
}

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      resolve(zipfile);
    });
  });
}

function collectZipEntries(zipfile) {
  return new Promise((resolve, reject) => {
    const entries = [];
    zipfile.readEntry();
    zipfile.on('entry', entry => {
      entries.push(entry);
      zipfile.readEntry();
    });
    zipfile.on('end', () => resolve(entries));
    zipfile.on('error', reject);
  });
}

function openZipEntryStream(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      resolve(stream);
    });
  });
}

class HashComputer {
  static async compute(romEntry) {
    const filePath = romEntry.path;
    const ext = (romEntry.extension || path.extname(filePath) || '').toLowerCase();

    try {
      if (isZipExtension(ext)) {
        let zipfile;
        try {
          zipfile = await openZip(filePath);
        } catch (err) {
          return { success: false, error: 'Invalid ZIP archive (unreadable)' };
        }

        let entries;
        try {
          entries = await collectZipEntries(zipfile);
        } catch (err) {
          zipfile.close();
          return { success: false, error: 'Invalid ZIP archive (failed to enumerate entries)' };
        }

        const candidates = entries.filter(isCandidateRomEntry);

        if (candidates.length !== 1) {
          zipfile.close();
          return { success: false, error: 'Invalid ZIP archive (0 or multiple ROMs)' };
        }

        const romEntryInZip = candidates[0];

        let stream;
        try {
          stream = await openZipEntryStream(zipfile, romEntryInZip);
        } catch (err) {
          zipfile.close();
          return { success: false, error: 'Failed to extract ROM from ZIP' };
        }

        try {
          const hashes = await hashReadableStream(stream);
          zipfile.close();
          return {
            success: true,
            crc32: hashes.crc32,
            sha1: hashes.sha1,
            md5: hashes.md5,
            size: romEntry.size,
            fileName: romEntry.filename
          };
        } catch (err) {
          zipfile.close();
          return { success: false, error: 'Hash computation failed' };
        }

      } else {
        let stream;
        try {
          stream = fs.createReadStream(filePath);
        } catch (err) {
          return { success: false, error: 'Failed to open file for hashing' };
        }

        try {
          const hashes = await hashReadableStream(stream);
          return {
            success: true,
            crc32: hashes.crc32,
            sha1: hashes.sha1,
            md5: hashes.md5,
            size: romEntry.size,
            fileName: romEntry.filename
          };
        } catch (err) {
          return { success: false, error: 'Hash computation failed' };
        }
      }

    } catch (err) {
      return { success: false, error: 'Unexpected error in HashComputer' };
    }
  }
}

module.exports = HashComputer;
