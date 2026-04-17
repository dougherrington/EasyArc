// ~/easyarc/src/scraper/TitleCleaner.js
/**
 * TitleCleaner
 * Input: rawName (string)
 * Output: { success: true, cleanedTitle }
 * Never throws. Worst case: returns filename without extension.
 */
const path = require('path');

class TitleCleaner {
  static clean(rawName) {
    try {
      if (!rawName || typeof rawName !== 'string') {
        return { success: true, cleanedTitle: '' };
      }
      let title = rawName;

      // STEP 1 — Strip file extension
      const ext = path.extname(title);
      if (ext) {
        title = title.slice(0, -ext.length);
      }

      // STEP 2 — Remove bracketed metadata: (...), [...], {...}
      title = title.replace(/\s*[\(\[{].*?[\)\]}]\s*/g, ' ');

      // STEP 3 — Remove scene/dump tags (whole words only)
      const sceneTags = [
        'Rev', 'Rev\\s?\\d+',
        'v\\d+\\.\\d+',
        'Beta', 'Proto', 'Sample',
        'Alt', 'Unl', 'Unlicensed',
        'Hack', 'Translation', 'FanFix'
      ];
      const sceneRegex = new RegExp(`\\b(${sceneTags.join('|')})\\b`, 'gi');
      title = title.replace(sceneRegex, ' ');

      // STEP 4 — Normalize separators
      // Only " - " (space-hyphen-space) — never touch hyphens inside words
      title = title.replace(/\s-\s/g, ' ');
      title = title.replace(/_/g, ' ');
      title = title.replace(/\s\.\s/g, ' ');

      // STEP 5 — Collapse multiple spaces
      title = title.replace(/\s+/g, ' ');

      // STEP 6 — Trim
      title = title.trim();

      // STEP 7 — Conditional titlecase (ALL CAPS or all lowercase only)
      if (title && (title === title.toUpperCase() || title === title.toLowerCase())) {
        title = TitleCleaner.toTitleCase(title);
      }

      // STEP 8 — Return result
      return { success: true, cleanedTitle: title };

    } catch (err) {
      // Fallback: never throw
      const ext = path.extname(rawName || '');
      const fallback = ext ? rawName.slice(0, -ext.length) : rawName;
      return { success: true, cleanedTitle: fallback || '' };
    }
  }

  static toTitleCase(str) {
    return str.replace(/\w\S*/g, word => {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });
  }
}

module.exports = TitleCleaner;
