const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { loadDataset } = require('./src/analysis');

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const ALLOWED_ORIGIN = String(process.env.ALLOWED_ORIGIN || '').replace(/\/+$/, '');
const PUBLIC_DIR = path.join(__dirname, 'public');

let model;
try {
  model = loadDataset();
  console.log(`Project RR loaded ${model.meta.deliveries.toLocaleString()} deliveries across ${model.meta.matches} matches.`);
} catch (error) {
  console.error(`Could not load the local cricket dataset. ${error.message}`);
  process.exitCode = 1;
  throw error;
}

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
function send(res, status, body, type = 'application/json; charset=utf-8', cacheControl = 'no-store') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const requestOrigin = String(req.headers.origin || '');
  if (ALLOWED_ORIGIN && requestOrigin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    if (ALLOWED_ORIGIN && requestOrigin === ALLOWED_ORIGIN) {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '600' });
      res.end();
    } else {
      send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
    }
    return;
  }
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (url.pathname === '/api/summary') {
    send(res, 200, JSON.stringify({ ...model.meta, imageReport: model.getImageReport(), pressureScores: undefined }));
    return;
  }
  if (url.pathname === '/api/analysis') {
    const numberParam = (name, fallback, min, max) => {
      const value = Number(url.searchParams.get(name));
      return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
    };
    const analysis = model.calculate({
      format: url.searchParams.get('format') || 'All',
      season: url.searchParams.get('season') || 'All',
      threshold: numberParam('threshold', 0.45, 0.2, 0.85),
      minimumBalls: numberParam('minimumBalls', 30, 10, 300),
      minimumMatches: numberParam('minimumMatches', 3, 1, 20),
    });
    send(res, 200, JSON.stringify(analysis));
    return;
  }
  if (url.pathname === '/api/matches') {
    const matches = model.getMatches({
      format: url.searchParams.get('format') || 'All',
      season: url.searchParams.get('season') || 'All',
    });
    send(res, 200, JSON.stringify(matches));
    return;
  }
  if (url.pathname === '/api/pressure-field') {
    const matchId = url.searchParams.get('matchId');
    const threshold = Math.max(0.2, Math.min(0.85, Number(url.searchParams.get('threshold')) || 0.45));
    const field = matchId ? model.getPressureField(matchId, threshold) : null;
    if (!field) { send(res, 404, JSON.stringify({ error: 'No chase record is available for this match.' })); return; }
    send(res, 200, JSON.stringify(field));
    return;
  }
  if (url.pathname === '/api/players') {
    const query = url.searchParams.get('query') || '';
    const players = model.searchPlayers(query, Number(url.searchParams.get('limit')) || 12);
    send(res, 200, JSON.stringify(players));
    return;
  }
  if (url.pathname.startsWith('/api/player/')) {
    const playerId = decodeURIComponent(url.pathname.slice('/api/player/'.length));
    const threshold = Math.max(0.2, Math.min(0.85, Number(url.searchParams.get('threshold')) || 0.45));
    const profile = model.getPlayerProfile(playerId, {
      format: url.searchParams.get('format') || 'All',
      season: url.searchParams.get('season') || 'All',
      threshold,
    });
    if (!profile) { send(res, 404, JSON.stringify({ error: 'Player is not present in the supplied dataset.' })); return; }
    send(res, 200, JSON.stringify(profile));
    return;
  }
  if (url.pathname.startsWith('/api/')) { send(res, 404, JSON.stringify({ error: 'Unknown API route' })); return; }
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const fullPath = path.resolve(PUBLIC_DIR, relative);
  if (!fullPath.startsWith(`${PUBLIC_DIR}${path.sep}`) && fullPath !== path.join(PUBLIC_DIR, 'index.html')) {
    send(res, 403, 'Forbidden', 'text/plain; charset=utf-8'); return;
  }
  fs.readFile(fullPath, (error, content) => {
    if (error) { send(res, 404, 'Not found', 'text/plain; charset=utf-8'); return; }
    const cache = relative.startsWith('assets/players/') ? 'public, max-age=86400' : 'no-store';
    send(res, 200, content, types[path.extname(fullPath)] || 'application/octet-stream', cache);
  });
});

server.listen(PORT, HOST, () => console.log(`Project RR is ready at http://${HOST}:${PORT}`));

