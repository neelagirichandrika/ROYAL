
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const OUTPUT = path.join(ROOT, 'dist');
const PLAYER_ASSETS = path.join(PUBLIC, 'assets', 'players');

// Only allow the build output inside this project's dist folder.
if (OUTPUT !== path.join(ROOT, 'dist')) {
  throw new Error('Invalid build output directory.');
}

// Read the public backend URL, if configured.
const apiBaseUrl = String(process.env.RR_API_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '');

if (apiBaseUrl) {
  const parsed = new URL(apiBaseUrl);

  if (
    parsed.protocol !== 'https:' ||
    parsed.pathname !== '/' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      'RR_API_BASE_URL must be an HTTPS origin without credentials, path, query, or fragment.'
    );
  }
}

// Create a fresh frontend build.
fs.rmSync(OUTPUT, { recursive: true, force: true });
fs.mkdirSync(OUTPUT, { recursive: true });

// Copy public frontend files, excluding player images.
fs.cpSync(PUBLIC, OUTPUT, {
  recursive: true,
  filter: (source) =>
    source !== PLAYER_ASSETS &&
    !source.startsWith(`${PLAYER_ASSETS}${path.sep}`),
});

// Player images are excluded until public redistribution rights are verified.
const copiedPortraits = 0;

console.log(
  'Player images excluded from public build pending licence verification.'
);

// Generate the public frontend configuration.
fs.writeFileSync(
  path.join(OUTPUT, 'config.js'),
  `window.RR_CONFIG = Object.freeze({ apiBaseUrl: ${JSON.stringify(apiBaseUrl)} });\n`
);

// Prevent GitHub Pages from using Jekyll processing.
fs.writeFileSync(path.join(OUTPUT, '.nojekyll'), '');

// Collect all generated frontend files.
const files = [];

function collectFiles(directory, prefix = '') {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, item.name);

    if (item.isDirectory()) {
      collectFiles(path.join(directory, item.name), relative);
    } else {
      files.push(relative);
    }
  }
}

collectFiles(OUTPUT);

// Refuse to publish competition data, CSV files, or environment files.
const unsafeFiles = files.filter((file) =>
  /(^|[\\/])data([\\/]|$)|\.csv$|(^|[\\/])\.env(?:\.|$)/i.test(file)
);

if (unsafeFiles.length > 0) {
  throw new Error(
    `Production frontend contains private files: ${unsafeFiles.join(', ')}`
  );
}

// Confirm that no player images entered the public build.
const imageFiles = files.filter((file) =>
  /\.(jpg|jpeg|png|webp)$/i.test(file)
);

if (imageFiles.length > 0) {
  throw new Error(
    `Unexpected image files in public build: ${imageFiles.join(', ')}`
  );
}

console.log(
  `Build successful: ${files.length} frontend files, ${copiedPortraits} player images.`
);

console.log(
  `Backend API: ${apiBaseUrl ? 'configured' : 'not configured yet'}.`
);
