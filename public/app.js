const state = { meta: null, view: 'overview', timer: null, searchTimer: null, format: 'All', season: 'All', threshold: 0.45, minimumBalls: 30, minimumMatches: 3, analysis: null, pressureMatches: [], playerId: null, playerProfile: null, compareId: null };
const IS_GITHUB_PAGES = location.hostname === 'neelagirichandrika.github.io';
const API_BASE_URL = String(window.RR_CONFIG?.apiBaseUrl || '').replace(/\/+$/, '');
const $ = (selector) => document.querySelector(selector);
const fmt = (value, digits = 0) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function navigate(view) {
  if (!document.getElementById(`view-${view}`)) return;
  state.view = view;
  document.querySelectorAll('.view').forEach((element) => element.classList.toggle('active', element.id === `view-${view}`));
  document.querySelectorAll('.nav-item').forEach((element) => element.classList.toggle('active', element.dataset.view === view));
  const titles = { overview: 'OVERVIEW', batters: 'BATTING UNDER PRESSURE', bowlers: 'BOWLING UNDER PRESSURE', method: 'MODEL & METHODOLOGY', quality: 'DATA QUALITY', player: 'PLAYER INTELLIGENCE' };
  $('#breadcrumb-current').textContent = titles[view] || 'OVERVIEW';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bindNavigation() {
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
  document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.open)));
  $('#method-shortcut').addEventListener('click', () => navigate('method'));
  document.addEventListener('click', (event) => {
    const playerLink = event.target.closest('.player-profile-open');
    if (playerLink) openPlayer(playerLink.dataset.playerId);
  });
}

async function fetchJson(url) {
  if (IS_GITHUB_PAGES && !API_BASE_URL) {
    throw new Error('The GitHub Pages frontend is deployed, but its separately hosted data API is not configured.');
  }
  const requestUrl = API_BASE_URL ? new URL(url, `${API_BASE_URL}/`).href : url;
  const response = await fetch(requestUrl);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return rewriteHostedAssetUrls(await response.json());
}

function rewriteHostedAssetUrls(value) {
  if (typeof value === 'string') return IS_GITHUB_PAGES && value.startsWith('/assets/players/') ? `/rr${value}` : value;
  if (Array.isArray(value)) return value.map(rewriteHostedAssetUrls);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewriteHostedAssetUrls(entry)]));
  }
  return value;
}

function setupFilters(meta) {
  const formats = $('#format-filter');
  meta.formats.forEach((format) => formats.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(format)}">${escapeHtml(format)}</option>`));
  const seasons = $('#season-filter');
  meta.seasons.forEach((season) => seasons.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(season)}">${escapeHtml(season)}</option>`));
  formats.addEventListener('change', () => { state.format = formats.value; scheduleAnalysis(); loadPressureMatches(); if (state.playerId) loadPlayerProfile(); });
  seasons.addEventListener('change', () => { state.season = seasons.value; scheduleAnalysis(); loadPressureMatches(); if (state.playerId) loadPlayerProfile(); });
  $('#minimum-balls-filter').addEventListener('change', (event) => { state.minimumBalls = Number(event.target.value); scheduleAnalysis(); });
  $('#minimum-matches-filter').addEventListener('change', (event) => { state.minimumMatches = Number(event.target.value); scheduleAnalysis(); });
  $('#threshold-filter').addEventListener('input', (event) => {
    state.threshold = Number(event.target.value);
    $('#threshold-value').value = state.threshold.toFixed(2);
    document.querySelectorAll('.dynamic-threshold').forEach((element) => element.textContent = state.threshold.toFixed(2));
    scheduleAnalysis();
    loadPressureField();
    if (state.playerId) loadPlayerProfile();
  });
  $('#reset-filters').addEventListener('click', () => {
    state.format = 'All'; state.season = 'All'; state.threshold = 0.45; state.minimumBalls = 30; state.minimumMatches = 3;
    formats.value = 'All'; seasons.value = 'All'; $('#threshold-filter').value = '0.45';
    $('#minimum-balls-filter').value = '30'; $('#minimum-matches-filter').value = '3';
    $('#threshold-value').value = '0.45';
    document.querySelectorAll('.dynamic-threshold').forEach((element) => element.textContent = '0.45');
    scheduleAnalysis(); loadPressureMatches(); if (state.playerId) loadPlayerProfile(); toast('Analysis filters reset');
  });
  $('#pressure-match-select').addEventListener('change', loadPressureField);
  $('#pressure-match-search').addEventListener('input', renderPressureMatchOptions);
  const playerSearch = $('#player-search');
  playerSearch.addEventListener('input', () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => searchPlayerOptions(playerSearch.value), 180);
  });
  playerSearch.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter') {
      const first = $('#player-search-results [data-player-id]');
      if (first) { event.preventDefault(); await openPlayer(first.dataset.playerId); }
    }
    if (event.key === 'Escape') $('#player-search-results').classList.add('hidden');
  });
  $('#player-search-results').addEventListener('click', (event) => {
    const result = event.target.closest('[data-player-id]');
    if (result) openPlayer(result.dataset.playerId);
  });
  const compareSearch = $('#profile-compare-search');
  compareSearch.addEventListener('input', () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => searchPlayerOptions(compareSearch.value, '#compare-search-results'), 180);
  });
  $('#compare-search-results').addEventListener('click', (event) => {
    const result = event.target.closest('[data-player-id]');
    if (result) openPlayerComparison(result.dataset.playerId);
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.player-search-wrap')) $('#player-search-results').classList.add('hidden');
    if (!event.target.closest('.compare-search-wrap')) $('#compare-search-results').classList.add('hidden');
  });
}

async function searchPlayerOptions(query, target = '#player-search-results') {
  const host = $(target);
  if (query.trim().length < 2) { host.classList.add('hidden'); host.innerHTML = ''; return; }
  try {
    const players = await fetchJson(`/api/players?query=${encodeURIComponent(query)}&limit=10`);
    host.innerHTML = players.length ? players.map((player) => `<button type="button" role="option" data-player-id="${escapeHtml(player.id)}">${player.photoUrl ? `<img class="search-player-thumb" src="${escapeHtml(player.photoUrl)}" alt="" loading="lazy">` : `<span class="search-player-thumb search-player-initials">${escapeHtml(player.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase())}</span>`}<b>${escapeHtml(player.name)}</b><span>${escapeHtml(player.teams.join(' Â· ') || player.formats.join(' Â· '))}</span><small>ID ${escapeHtml(player.id)}</small></button>`).join('') : '<div class="search-empty">No matching player or supplied team.</div>';
    host.classList.remove('hidden');
  } catch (error) {
    host.innerHTML = `<div class="search-empty">Search unavailable: ${escapeHtml(error.message)}</div>`;
    host.classList.remove('hidden');
  }
}

async function openPlayer(playerId) {
  state.playerId = String(playerId);
  state.compareId = null;
  $('#profile-comparison').classList.add('hidden');
  $('#player-search-results').classList.add('hidden');
  await loadPlayerProfile();
  navigate('player');
}

function valueOrDash(value, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? 'â€”' : fmt(value, digits);
}

function statGrid(target, items) {
  $(target).innerHTML = items.map(([label, value, note = '']) => `<div class="profile-stat"><span>${escapeHtml(label)}</span><b>${escapeHtml(String(value))}</b>${note ? `<small>${escapeHtml(note)}</small>` : ''}</div>`).join('');
}

async function loadPlayerProfile() {
  if (!state.playerId) return;
  const params = new URLSearchParams({ format: state.format, season: state.season, threshold: state.threshold.toFixed(2) });
  try {
    const p = await fetchJson(`/api/player/${encodeURIComponent(state.playerId)}?${params}`);
    state.playerProfile = p;
    const b = p.batting, w = p.bowling, pb = p.pressure.batting, pw = p.pressure.bowling;
    $('#profile-name').innerHTML = `${escapeHtml(p.name)} <em>profile.</em>`;
    $('#dossier-name').textContent = p.name;
    $('#profile-summary').textContent = `${p.scope.matches} player matches in ${p.scope.format === 'All' ? 'all supplied formats' : p.scope.format}, ${p.scope.season === 'All' ? 'all seasons' : p.scope.season}. Historical evidence only.`;
    $('#profile-scope').textContent = `${p.scope.format.toUpperCase()} Â· ${p.scope.season === 'All' ? 'ALL SEASONS' : p.scope.season} Â· PRESSURE â‰¥ ${Number(p.scope.threshold).toFixed(2)}`;
    $('#profile-coverage').textContent = `${p.scope.matches} player matches Â· ${p.identity.competitions.length} competitions in player record`;
    $('#profile-pressure-scope').textContent = `Chase innings only Â· pressure index â‰¥ ${Number(p.scope.threshold).toFixed(2)} Â· sample reliability shown.`;
    $('#profile-monogram').textContent = p.photo.initials || 'RR';
    $('#profile-monogram').innerHTML = p.photo.verifiedUrl
      ? `<img src="${escapeHtml(p.photo.verifiedUrl)}" alt="Portrait of ${escapeHtml(p.name)}" loading="lazy" onerror="this.remove()">`
      : escapeHtml(p.photo.initials || 'RR');
    const heroPhoto = $('#profile-monogram img');
    if (heroPhoto) heroPhoto.addEventListener('error', () => { $('#profile-monogram').textContent = p.photo.initials || 'RR'; }, { once: true });
    $('#dossier-affiliation').textContent = p.identity.teams.length ? p.identity.teams.join(' Â· ') : 'Team affiliation not supplied';
    $('#dossier-role').textContent = 'Not supplied';
    const styles = [...p.identity.battingStyles.map((x) => `Bat: ${x}`), ...p.identity.bowlingStyles.map((x) => `Bowl: ${x}`)];
    $('#dossier-styles').textContent = styles.length ? styles.join(' Â· ') : 'Not supplied';
    $('#dossier-photo-source').innerHTML = p.photo.sourcePageUrl
      ? `<a href="${escapeHtml(p.photo.sourcePageUrl)}" target="_blank" rel="noreferrer">${escapeHtml(p.photo.attribution || 'Wikimedia Commons')}</a> Â· ${p.photo.licenseUrl ? `<a href="${escapeHtml(p.photo.licenseUrl)}" target="_blank" rel="noreferrer">${escapeHtml(p.photo.license || 'License')}</a>` : escapeHtml(p.photo.license || '')}`
      : 'Verified photo not available';
    $('#dossier-tags').innerHTML = [...p.identity.formats, ...p.identity.seasons].map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
    statGrid('#profile-batting', [
      ['Matches', fmt(b.matches)], ['Innings', fmt(b.innings)], ['Runs', fmt(b.runs)], ['Highest', valueOrDash(b.highestScore, 0)],
      ['Dismissals', fmt(b.dismissals)], ['AverageÂ¹', valueOrDash(b.average)], ['Strike rate', valueOrDash(b.strikeRate)], ['Balls faced', fmt(b.ballsFaced)],
      ['Fours', fmt(b.fours)], ['Sixes', fmt(b.sixes)], ['Boundary runs %', valueOrDash(b.boundaryRunShare)], ['Dot balls %', valueOrDash(b.dotBallPercentage)],
    ]);
    statGrid('#profile-bowling', [
      ['Matches', fmt(w.matches)], ['Innings', fmt(w.innings)], ['Overs', w.overs], ['Legal balls', fmt(w.legalBalls)],
      ['Wickets', fmt(w.wickets)], ['Runs conceded', fmt(w.runsConceded)], ['Economy', valueOrDash(w.economy)], ['Average', valueOrDash(w.average)],
      ['Strike rate', valueOrDash(w.strikeRate)], ['Dot balls %', valueOrDash(w.dotBallPercentage)],
    ]);
    statGrid('#profile-pressure-batting', [
      ['Pressure runs', fmt(pb.runs, 0)], ['Pressure balls', fmt(pb.balls)], ['Pressure strike rate', valueOrDash(pb.strikeRate)], ['Pressure dismissals', fmt(pb.dismissals)],
      ['Pressure appearances', fmt(pb.appearances)], ['Baseline runs', fmt(pb.baselineRuns, 0)], ['Baseline strike rate', valueOrDash(pb.baselineStrikeRate)], ['Reliability factor', `${valueOrDash(pb.reliability * 100)}%`],
    ]);
    statGrid('#profile-pressure-bowling', [
      ['Pressure runs conceded', fmt(pw.runsConceded, 0)], ['Pressure legal balls', fmt(pw.legalBalls)], ['Pressure economy', valueOrDash(pw.economy)], ['Pressure wickets', fmt(pw.wickets)],
      ['Pressure appearances', fmt(pw.appearances)], ['Baseline runs conceded', fmt(pw.baselineRunsConceded, 0)], ['Baseline economy', valueOrDash(pw.baselineEconomy)], ['Reliability factor', `${valueOrDash(pw.reliability * 100)}%`],
    ]);
    const phaseRow = (name, value, metrics) => `<div class="phase-row"><b>${escapeHtml(name)}</b><span>${metrics.map(([label, number]) => `${escapeHtml(label)} ${escapeHtml(String(number))}`).join(' Â· ')}</span><small>${escapeHtml(String(value))}</small></div>`;
    $('#profile-phases-batting').innerHTML = ['powerplay', 'middle', 'death'].map((key) => { const x = p.phases.batting[key]; return x ? phaseRow(key, `${valueOrDash(x.strikeRate)} SR`, [['runs', fmt(x.runs, 0)], ['balls', fmt(x.balls)], ['matches', fmt(x.matches)]]) : phaseRow(key, 'No data', []); }).join('');
    $('#profile-phases-bowling').innerHTML = ['powerplay', 'middle', 'death'].map((key) => { const x = p.phases.bowling[key]; return x ? phaseRow(key, `${fmt(x.wickets)} wkts Â· ${valueOrDash(x.economy)} econ`, [['balls', fmt(x.legalBalls)], ['matches', fmt(x.matches)]]) : phaseRow(key, 'No data', []); }).join('');
    const segmentTable = (rows) => rows.length ? `<table><thead><tr><th>SEASON / COMPETITION</th><th>M</th><th>RUNS</th><th>BAT SR</th><th>WKTS</th><th>BOWL ECON</th></tr></thead><tbody>${rows.map((x) => `<tr><td>${escapeHtml(x.label)}</td><td>${fmt(x.matches)}</td><td>${fmt(x.battingRuns)}</td><td>${valueOrDash(x.battingStrikeRate)}</td><td>${fmt(x.bowlingWickets)}</td><td>${valueOrDash(x.bowlingEconomy)}</td></tr>`).join('')}</tbody></table>` : '<div class="segment-empty">No player records in this scope.</div>';
    $('#profile-season-table').innerHTML = segmentTable(p.seasonStats);
    $('#profile-competition-table').innerHTML = segmentTable(p.competitionStats);
    const matchupTable = (rows, role) => rows.length ? `<table><thead><tr><th>OPPONENT / STYLE</th><th>M</th><th>BALLS</th><th>RUNS</th><th>${role === 'batting' ? 'SR' : 'ECON'}</th><th>W / OUT</th></tr></thead><tbody>${rows.map((x) => `<tr><td>${escapeHtml(x.name)}</td><td>${fmt(x.matches)}</td><td>${fmt(x.balls)}</td><td>${fmt(x.runs)}</td><td>${valueOrDash(role === 'batting' ? x.strikeRate : x.economy)}</td><td>${fmt(role === 'batting' ? x.dismissals : x.wickets)}</td></tr>`).join('')}</tbody></table>` : '<div class="segment-empty">No matchup group clears the minimum sample in this scope.</div>';
    $('#profile-batting-matchups').innerHTML = matchupTable(p.matchups.battingByBowlingType, 'batting');
    $('#profile-bowling-matchups').innerHTML = matchupTable(p.matchups.bowlingByBattingType, 'bowling');
    $('#profile-h2h-matchups').innerHTML = matchupTable(p.matchups.battingVsBowlers, 'batting');
    const standardDeviation = p.consistency.matchRunsVariance === null ? null : Math.sqrt(p.consistency.matchRunsVariance);
    $('#profile-consistency').innerHTML = `<div class="consistency-stat"><span>MATCHES WITH BATTING DATA</span><b>${fmt(p.consistency.matchesWithBattingData)}</b></div><div class="consistency-stat"><span>MEAN RUNS / MATCH</span><b>${valueOrDash(p.consistency.matchRunsMean)}</b></div><div class="consistency-stat"><span>RUNS STANDARD DEVIATION</span><b>${valueOrDash(standardDeviation)}</b></div><p>Descriptive match-to-match variation; it is affected by batting opportunities and is not adjusted for role, innings entry point, or dismissal state.</p>`;
    $('#profile-evidence').textContent = `${styles.length ? `Observed delivery styles: ${styles.join(', ')}. ` : ''}${p.identity.competitions.length} competition records, ${p.identity.seasons.length} seasons, and ${p.consistency.matchesWithBattingData} match score samples are represented. No psychological or fitness attributes are inferred.`;
    $('#profile-prediction').textContent = p.prediction.reason;
    $('#profile-limitations').innerHTML = p.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    if (state.compareId) renderPlayerComparison();
  } catch (error) {
    $('#profile-name').textContent = 'Player profile unavailable';
    $('#profile-summary').textContent = error.message;
  }
}

async function openPlayerComparison(playerId) {
  if (String(playerId) === state.playerId) { toast('Choose a different player to compare'); return; }
  state.compareId = String(playerId);
  $('#compare-search-results').classList.add('hidden');
  $('#profile-compare-search').value = '';
  await renderPlayerComparison();
}

async function renderPlayerComparison() {
  if (!state.playerId || !state.compareId || state.playerId === state.compareId) return;
  const params = new URLSearchParams({ format: state.format, season: state.season, threshold: state.threshold.toFixed(2) });
  try {
    const [a, b] = await Promise.all([state.playerProfile ? Promise.resolve(state.playerProfile) : fetchJson(`/api/player/${encodeURIComponent(state.playerId)}?${params}`), fetchJson(`/api/player/${encodeURIComponent(state.compareId)}?${params}`)]);
    const metrics = [
      ['Batting runs', a.batting.runs, b.batting.runs, 0], ['Batting average', a.batting.average, b.batting.average, 1], ['Batting strike rate', a.batting.strikeRate, b.batting.strikeRate, 1],
      ['Pressure batting SR', a.pressure.batting.strikeRate, b.pressure.batting.strikeRate, 1], ['Pressure batting balls', a.pressure.batting.balls, b.pressure.batting.balls, 0],
      ['Bowling wickets', a.bowling.wickets, b.bowling.wickets, 0], ['Bowling economy', a.bowling.economy, b.bowling.economy, 1], ['Pressure bowling economy', a.pressure.bowling.economy, b.pressure.bowling.economy, 1],
    ];
    const show = (value, digits) => value === null || value === undefined ? 'â€”' : fmt(value, digits);
    const comparison = $('#profile-comparison');
    comparison.innerHTML = `<div class="compare-player-head"><div class="compare-avatar">${a.photo.verifiedUrl ? `<img src="${escapeHtml(a.photo.verifiedUrl)}" alt="" loading="lazy">` : escapeHtml(a.photo.initials)}</div><div><b>${escapeHtml(a.name)}</b><span>${escapeHtml(a.identity.teams.join(' Â· ') || 'Team not supplied')}</span></div><i>VS</i><div class="compare-avatar compare-avatar-alt">${b.photo.verifiedUrl ? `<img src="${escapeHtml(b.photo.verifiedUrl)}" alt="" loading="lazy">` : escapeHtml(b.photo.initials)}</div><div><b>${escapeHtml(b.name)}</b><span>${escapeHtml(b.identity.teams.join(' Â· ') || 'Team not supplied')}</span></div></div><div class="compare-metrics"><div class="compare-metric compare-header"><span>MEASURE</span><b>${escapeHtml(a.name)}</b><b>${escapeHtml(b.name)}</b><span>Î” (Bâˆ’A)</span></div>${metrics.map(([label, left, right, digits]) => `<div class="compare-metric"><span>${escapeHtml(label)}</span><b>${show(left, digits)}</b><b>${show(right, digits)}</b><span>${left === null || right === null ? 'â€”' : `${Number(right) - Number(left) >= 0 ? '+' : ''}${show(Number(right) - Number(left), digits)}`}</span></div>`).join('')}</div><p class="compare-note">Observed sample sizes: ${fmt(a.scope.matches)} vs ${fmt(b.scope.matches)} player matches Â· role is not supplied. Differences are descriptive; they do not adjust for role, opposition, venue, or era.</p>`;
    comparison.classList.remove('hidden');
  } catch (error) {
    const comparison = $('#profile-comparison');
    comparison.innerHTML = `<p class="compare-note">Comparison unavailable: ${escapeHtml(error.message)}</p>`;
    comparison.classList.remove('hidden');
  }
}

function setDatasetHeader(meta) {
  $('#metric-deliveries').textContent = fmt(meta.deliveries);
  $('#metric-matches').textContent = fmt(meta.matches);
  const start = meta.dateRange?.start || '2022';
  const end = meta.dateRange?.end || '2026';
  $('#metric-period').textContent = `${start.slice(0, 4)}â€“${end.slice(0, 4)}`;
  $('#sidebar-period').textContent = `${meta.formats.join(' + ')} Â· ${start.slice(0, 4)}â€“${end.slice(0, 4)}`;
  $('#hero-season-range').textContent = `${start.slice(0, 4)}â€“${end.slice(0, 4)}`;
  $('#hero-match-count').textContent = fmt(meta.matches);
  renderSeasonChart(meta);
  renderQuality(meta);
}

function renderSeasonChart(meta) {
  const counts = meta.matchesBySeason || {};
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...entries.map(([, value]) => Number(value)));
  $('#season-chart').innerHTML = entries.map(([season, count]) => {
    const height = Math.max(4, Number(count) / max * 76);
    return `<div class="season-column"><div class="season-bar-track"><div class="season-bar" style="height:${height}%" data-value="${fmt(count)}"></div></div><span class="season-year">${escapeHtml(season)}</span></div>`;
  }).join('');
}

function renderQuality(meta) {
  const q = meta.quality;
  const badge = (element) => {
    element.classList.toggle('review', q.status !== 'passed');
    element.innerHTML = `<i></i> ${q.status === 'passed' ? 'STRUCTURE PASSED' : 'REVIEW NEEDED'}`;
  };
  badge($('#integrity-badge')); badge($('#quality-badge'));
  const checks = [
    ['Ball-by-ball delivery rows', fmt(meta.deliveries), 'passed'],
    ['Matches linked to competition records', `${fmt(meta.matches - q.unmatchedCompetitionRecords)} / ${fmt(meta.matches)}`, q.unmatchedCompetitionRecords ? 'warn' : 'passed'],
    ['Match rows without competition metadata', fmt(q.unmatchedCompetitionRecords), q.unmatchedCompetitionRecords ? 'warn' : 'passed'],
    ['Duplicate delivery keys', fmt(q.duplicateDeliveries), q.duplicateDeliveries ? 'warn' : 'passed'],
    ['Ball rows without a match record', fmt(q.missingMatchRows), q.missingMatchRows ? 'warn' : 'passed'],
    ['Malformed numeric delivery fields', fmt(q.invalidNumericRows), q.invalidNumericRows ? 'warn' : 'passed'],
  ];
  $('#integrity-summary').innerHTML = checks.slice(2).map(([label, value]) => `<div><b>${value}</b><span>${label}</span></div>`).join('');
  $('#quality-check-list').innerHTML = checks.map(([label, value, status]) => `<div class="quality-check"><span class="check-icon ${status === 'warn' ? 'warn' : ''}">${status === 'warn' ? '!' : 'âœ“'}</span><span>${escapeHtml(label)}</span><b class="${status === 'warn' ? 'warn' : ''}">${escapeHtml(value)}</b></div>`).join('');
  const inventory = [
    ['ball_by_ball.csv', `${fmt(meta.deliveries)} delivery records`, 'DELIVERY ENGINE'],
    ['matches.csv', `${fmt(meta.matches)} match records`, 'MATCH CONTEXT'],
    ['competitions.csv', `${fmt(meta.competitions)} competition records`, 'FORMAT / SEASON'],
    ['competition_team_player_mapping.csv', `${fmt(meta.playersMapped)} distinct players`, 'PLAYER LINKAGE'],
    ['playing_eleven.csv', `${fmt(meta.playingXIRows)} XI records`, 'SELECTION CONTEXT'],
    ['teams.csv', `${fmt(meta.teamRows)} team records`, 'TEAM LINKAGE'],
  ];
  $('#source-inventory').innerHTML = inventory.map(([name, detail, type]) => `<div class="source-file"><span class="source-file-name">${escapeHtml(name)}</span><span class="source-file-detail">${escapeHtml(detail)}</span><span class="source-file-count">${escapeHtml(type)}</span></div>`).join('');
  const photos = meta.imageReport || { totalPlayers: meta.playersMapped || 0, verified: 0, missing: meta.playersMapped || 0, unverified: 0, broken: 0, sources: {} };
  $('#player-image-audit').innerHTML = [
    ['PLAYERS', fmt(photos.totalPlayers)], ['VERIFIED', fmt(photos.verified)], ['MISSING', fmt(photos.missing)],
    ['NEEDS REVIEW', fmt(photos.unverified)], ['BROKEN LOCAL FILES', fmt(photos.broken)],
  ].map(([label, value]) => `<div><span>${label}</span><b>${value}</b></div>`).join('');
  $('#player-image-sources').textContent = `IMAGE SOURCES Â· ${Object.entries(photos.sources || {}).map(([source, count]) => `${source} ${fmt(count)}`).join(' Â· ') || 'No verified source entries yet'}`;
  $('#caveat-list').innerHTML = q.caveats.map((text, index) => `<div class="caveat-item"><span class="caveat-number">0${index + 1} / LIMITATION</span>${escapeHtml(text)}</div>`).join('');
}

function buildAnalysisUrl() {
  const params = new URLSearchParams({ format: state.format, season: state.season, threshold: state.threshold.toFixed(2), minimumBalls: String(state.minimumBalls), minimumMatches: String(state.minimumMatches) });
  return `/api/analysis?${params}`;
}

function scheduleAnalysis() {
  window.clearTimeout(state.timer);
  state.timer = window.setTimeout(loadAnalysis, 110);
}

async function loadAnalysis() {
  try {
    const analysis = await fetchJson(buildAnalysisUrl());
    state.analysis = analysis;
    renderAnalysis(analysis);
  } catch (error) {
    toast(`Analysis unavailable: ${error.message}`);
  }
}

async function loadPressureMatches() {
  const select = $('#pressure-match-select');
  const params = new URLSearchParams({ format: state.format, season: state.season });
  try {
    const matches = await fetchJson(`/api/matches?${params}`);
    state.pressureMatches = matches;
    const previous = select.value;
    if (!matches.length) {
      select.innerHTML = '<option value="">No chase records in this scope</option>';
      $('#pressure-field-chart').innerHTML = '<div class="pressure-loading">No second-innings chase is available for the selected scope.</div>';
      return;
    }
    renderPressureMatchOptions();
    select.value = matches.some((match) => match.id === previous) ? previous : matches[0].id;
    await loadPressureField();
  } catch (error) {
    select.innerHTML = '<option value="">Match list unavailable</option>';
    $('#pressure-field-chart').innerHTML = `<div class="pressure-loading">${escapeHtml(error.message)}</div>`;
  }
}

function renderPressureMatchOptions() {
  const select = $('#pressure-match-select');
  const previous = select.value;
  const query = $('#pressure-match-search').value.trim().toLocaleLowerCase();
  const matches = state.pressureMatches.filter((match) => `${match.date} ${match.label} ${match.format} ${match.venue || ''}`.toLocaleLowerCase().includes(query));
  select.innerHTML = matches.length
    ? matches.map((match) => `<option value="${escapeHtml(match.id)}">${escapeHtml(match.date)} Â· ${escapeHtml(match.label)} Â· ${escapeHtml(match.format)}</option>`).join('')
    : '<option value="">No matches found</option>';
  if (matches.some((match) => match.id === previous)) select.value = previous;
  else if (matches.length) select.value = matches[0].id;
  if (matches.length && previous !== select.value) loadPressureField();
}

async function loadPressureField() {
  const matchId = $('#pressure-match-select').value;
  if (!matchId) return;
  const params = new URLSearchParams({ matchId, threshold: state.threshold.toFixed(2) });
  try {
    const field = await fetchJson(`/api/pressure-field?${params}`);
    renderPressureField(field);
  } catch (error) {
    $('#pressure-field-chart').innerHTML = `<div class="pressure-loading">Pressure progression unavailable: ${escapeHtml(error.message)}</div>`;
  }
}

function renderPressureField(field) {
  const last = field.final;
  $('#pressure-match-title').textContent = field.match.label;
  $('#pressure-match-context').textContent = `${field.match.date} Â· ${field.match.format || 'T20'} Â· ${field.match.venue || 'Venue not supplied'}`;
  $('#pressure-match-subtitle').textContent = field.match.result || 'Actual chase-state sequence from the supplied deliveries.';
  $('#field-threshold').textContent = Number(field.threshold).toFixed(2);
  $('#field-target').textContent = fmt(field.target);
  $('#field-score').textContent = last ? `${fmt(last.score)} / ${fmt(last.wickets)}` : 'â€”';
  $('#field-wickets').textContent = last ? fmt(last.wicketsRemaining) : 'â€”';
  $('#field-balls').textContent = last ? fmt(last.ballsRemaining) : 'â€”';
  $('#field-rrr').textContent = last?.requiredRate == null ? 'â€”' : fmt(last.requiredRate, 1);
  $('#pressure-field-note').textContent = field.limitation;
  const maxPressure = Math.max(.02, ...field.innings.map((over) => Number(over.pressureIndex || 0)));
  $('#pressure-field-chart').innerHTML = field.innings.map((over) => {
    const height = Math.max(3, Number(over.pressureIndex || 0) / maxPressure * 100);
    const tooltip = `Over ${over.over}: ${over.runs} runs, score ${over.score}/${over.wickets}, RRR ${over.requiredRate == null ? 'complete' : fmt(over.requiredRate, 1)}, pressure index ${fmt(over.pressureIndex, 2)}`;
    return `<div class="pressure-over"><div class="pressure-bar-box" title="${escapeHtml(tooltip)}"><span class="pressure-bar ${over.pressured ? 'pressured' : ''}" style="height:${height}%"></span><b>${fmt(over.pressureIndex, 2)}</b></div><span class="pressure-score">${fmt(over.score)}</span><span class="pressure-over-label">${String(over.over).padStart(2, '0')}</span></div>`;
  }).join('');
}

function renderAnalysis(analysis) {
  const { batters, bowlers } = analysis;
  $('#metric-matches').textContent = fmt(analysis.scopedMatches);
  $('#metric-pressure').textContent = fmt(analysis.pressureDeliveries);
  $('#pressure-share').textContent = `${fmt((analysis.pressuredShare || 0) * 100, 1)}%`;
  $('#metric-eligible').textContent = fmt(analysis.batterEligible + analysis.bowlerEligible);
  $('#eligible-split').textContent = `${fmt(analysis.batterEligible)} / ${fmt(analysis.bowlerEligible)}`;
  $('#scope-label').textContent = `${state.season === 'All' ? 'ALL SEASONS' : state.season} / ${state.format === 'All' ? 'ALL FORMATS' : state.format}`;
  $('#top-scope').textContent = $('#scope-label').textContent;
  $('#batter-count').textContent = fmt(analysis.batterEligible);
  $('#bowler-count').textContent = fmt(analysis.bowlerEligible);
  $('#minimum-note-bat').textContent = `${analysis.settings.minimumBalls} BALLS Â· ${analysis.settings.minimumMatches} MATCHES`;
  $('#minimum-note-bowl').textContent = `${analysis.settings.minimumBalls} BALLS Â· ${analysis.settings.minimumMatches} MATCHES`;
  const eligibilityValues = document.querySelectorAll('.eligibility-stat b');
  if (eligibilityValues[0]) eligibilityValues[0].textContent = String(analysis.settings.minimumBalls);
  if (eligibilityValues[1]) eligibilityValues[1].textContent = String(analysis.settings.minimumMatches);
  renderLeaderList('#batter-leaders', batters, 'batter');
  renderLeaderList('#bowler-leaders', bowlers, 'bowler');
  renderTable('#batting-table', batters, 'batter');
  renderTable('#bowling-table', bowlers, 'bowler');
  $('#empty-batters').classList.toggle('hidden', batters.length > 0);
  $('#empty-bowlers').classList.toggle('hidden', bowlers.length > 0);
  document.querySelectorAll('.dynamic-threshold').forEach((element) => element.textContent = state.threshold.toFixed(2));
}

function renderLeaderList(selector, players, role) {
  const host = $(selector);
  if (!players.length) {
    host.innerHTML = '<div class="no-eligible"><b>No eligible players in this scope</b><span>Try all seasons or lower the pressure threshold.</span></div>';
    return;
  }
  host.innerHTML = players.slice(0, 5).map((player, index) => `<div class="leader-row"><span class="rank-no">${String(index + 1).padStart(2, '0')}</span><span class="leader-avatar">${player.photoUrl ? `<img src="${escapeHtml(player.photoUrl)}" alt="" loading="lazy">` : escapeHtml(player.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase())}</span><div><button class="leader-name player-profile-open" data-player-id="${escapeHtml(player.playerId)}">${escapeHtml(player.name)}</button><div class="leader-sub">${fmt(player.pressureMatches)} MATCHES Â· ${fmt(player.pressureBalls)} BALLS</div></div><span class="leader-impact ${player.impact < 0 ? '' : 'impact-positive'}">${signed(player.impact)}</span><span class="leader-sample">${fmt(player.pressureRate, 1)}<small>${role === 'batter' ? 'PRESS SR' : 'PRESS ECON'}</small></span></div>`).join('');
}

function signed(value, digits = 1) { return `${Number(value) >= 0 ? '+' : ''}${fmt(value, digits)}`; }

function renderTable(selector, players, role) {
  const host = $(selector);
  if (!players.length) { host.innerHTML = ''; return; }
  const maxImpact = Math.max(1, ...players.map((player) => Math.abs(player.impact || 0)));
  host.innerHTML = players.slice(0, 10).map((player, index) => {
    const impact = Number(player.impact || 0);
    const negative = impact < 0;
    const width = Math.max(3, Math.abs(impact) / maxImpact * 100);
    const rate = `${fmt(player.pressureRate, 1)}`;
    const baseline = `${fmt(player.baselineRate, 1)}`;
    const interval = player.confidenceLow === null || player.confidenceHigh === null ? 'n/a' : `${signed(player.confidenceLow)} to ${signed(player.confidenceHigh)}`;
    const intervalPos = player.confidenceLow === null ? 50 : Math.max(4, Math.min(96, (player.confidenceLow / (Math.abs(player.confidenceHigh) + Math.abs(player.confidenceLow) + .1) * 92) + 50));
    const initials = player.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
    const avatar = player.photoUrl ? `<img src="${escapeHtml(player.photoUrl)}" alt="" loading="lazy">` : escapeHtml(initials);
    return `<tr><td><div class="rank-cell"><span class="table-rank ${index < 3 ? 'top-rank' : ''}">${String(index + 1).padStart(2, '0')}</span><span class="table-player-avatar">${avatar}</span><div><button class="player-name player-profile-open" data-player-id="${escapeHtml(player.playerId)}">${escapeHtml(player.name)}</button><span class="player-id">PLAYER ID ${escapeHtml(player.playerId)}</span></div></div></td><td><div class="impact-cell ${negative ? 'negative' : ''}">${signed(impact)}<div class="impact-meter"><i class="${negative ? 'negative' : ''}" style="width:${width}%"></i></div></div></td><td><span class="table-rate">${rate}<small>${role === 'batter' ? 'RUNS / 100 BALLS' : 'RUNS / 100 LEGAL'}</small></span></td><td><span class="table-rate">${baseline}<small>BASELINE Â· ${fmt(player.baselineBalls)} BALLS / ${fmt(player.baselineMatches)} MATCHES</small></span></td><td><span class="table-rate">${fmt(player.pressureWicketRate, 1)}<small>${role === 'batter' ? 'OUTS' : 'WICKETS'} / 100 BALLS</small><small>BASELINE ${fmt(player.baselineWicketRate, 1)}</small></span></td><td><span class="sample-cell">${fmt(player.pressureBalls)} <small>${role === 'batter' ? 'BALLS FACED' : 'LEGAL BALLS'}</small><small>${fmt(player.pressureMatches)} PRESSURE MATCHES</small></span></td><td><span class="interval-cell">${interval}<div class="interval-bar"><i style="left:${intervalPos}%"></i></div></span></td></tr>`;
  }).join('');
}

function toast(message) {
  const element = $('#toast'); element.textContent = message; element.classList.add('show');
  window.setTimeout(() => element.classList.remove('show'), 2300);
}

async function start() {
  bindNavigation();
  try {
    const meta = await fetchJson('/api/summary');
    state.meta = meta;
    setupFilters(meta);
    setDatasetHeader(meta);
    await loadPressureMatches();
    await loadAnalysis();
  } catch (error) {
    const productionHint = IS_GITHUB_PAGES
      ? 'Host the Node.js API separately, keep any restricted match data on that protected backend, then configure the RR_API_BASE_URL repository variable.'
      : 'Check the local CSV files in data/raw and restart the app.';
    document.querySelector('.content').innerHTML = `<div class="empty-state"><div class="empty-icon">!</div><h3>${IS_GITHUB_PAGES ? 'Production API is unavailable' : 'Dataset could not be loaded'}</h3><p>${escapeHtml(error.message)} ${escapeHtml(productionHint)}</p></div>`;
  }
}

start();

