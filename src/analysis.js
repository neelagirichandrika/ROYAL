const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'raw');
const IMAGE_MANIFEST = path.join(__dirname, '..', 'data', 'player_images', 'manifest.json');
const files = {
  balls: 'ball_by_ball.csv',
  matches: 'matches.csv',
  competitions: 'competitions.csv',
  teams: 'teams.csv',
  players: 'competition_team_player_mapping.csv',
  playingEleven: 'playing_eleven.csv',
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { value += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(value); value = ''; }
    else if (char === '\n') {
      row.push(value.replace(/\r$/, ''));
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = []; value = '';
    } else value += char;
  }
  if (value.length || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map((header) => header.trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function readCsv(filename) {
  const fullPath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(fullPath)) throw new Error(`Required dataset not found: ${fullPath}`);
  return parseCsv(fs.readFileSync(fullPath, 'utf8').replace(/^\uFEFF/, ''));
}

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const bool = (value) => String(value).toLowerCase() === 'true';
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const byes = new Set(['byes', 'legbyes', 'penalty']);
const nonBowlerDismissals = new Set(['runout', 'retire out', 'obstracting the field', 'obstructing the field']);

function oversToBalls(value) {
  const [overs, balls = '0'] = String(value || '20').split('.');
  return Math.max(1, number(overs) * 6 + Math.min(5, number(balls)));
}

function keyFor(playerId, fallbackName) {
  return String(playerId || fallbackName || 'unknown');
}

function pushStat(map, key, player, matchId, kind, values) {
  if (!map.has(key)) map.set(key, {
    playerId: String(player.id), name: player.name, matches: new Set(), pressureMatches: new Set(), baselineMatches: new Set(),
    pressureEvents: 0, pressureBalls: 0, pressureOutput: 0, pressureWickets: 0,
    baselineEvents: 0, baselineBalls: 0, baselineOutput: 0, baselineWickets: 0,
    pressureSumSq: 0, baselineSumSq: 0,
    role: kind,
  });
  const stat = map.get(key);
  stat.matches.add(matchId);
  const prefix = values.pressure ? 'pressure' : 'baseline';
  stat[`${prefix}Events`] += 1;
  stat[`${prefix}Balls`] += values.balls;
  stat[`${prefix}Output`] += values.output;
  stat[`${prefix}SumSq`] += values.output * values.output;
  stat[`${prefix}Wickets`] += values.wicket ? 1 : 0;
  if (values.pressure) {
    stat.pressureMatches.add(matchId);
    stat.pressureScoreTotal = (stat.pressureScoreTotal || 0) + values.pressureScore;
  } else stat.baselineMatches.add(matchId);
}

function verifiedImageUrl(imageManifest, playerId) {
  const image = imageManifest[String(playerId)];
  return image?.verification_status === 'verified' && image.local_image_path
    && fs.existsSync(path.join(__dirname, '..', image.local_image_path)) ? image.app_image_url || null : null;
}

function finalizeStat(stat, role, minimumBalls, minimumMatches) {
  const pressureRate = stat.pressureBalls ? stat.pressureOutput / stat.pressureBalls * 100 : null;
  const baselineRate = stat.baselineBalls ? stat.baselineOutput / stat.baselineBalls * 100 : null;
  const pressureWicketRate = stat.pressureBalls ? stat.pressureWickets / stat.pressureBalls * 100 : 0;
  const baselineWicketRate = stat.baselineBalls ? stat.baselineWickets / stat.baselineBalls * 100 : 0;
  const rawImpact = pressureRate === null || baselineRate === null ? null : role === 'batter'
    ? pressureRate - baselineRate
    : baselineRate - pressureRate;
  const reliability = stat.pressureBalls / (stat.pressureBalls + 45);
  const impact = rawImpact === null ? null : rawImpact * reliability;
  const matches = stat.matches.size;
  const pressureMatches = stat.pressureMatches.size;
  const baselineMatches = stat.baselineMatches.size;
  const eligible = stat.pressureBalls >= minimumBalls && pressureMatches >= minimumMatches
    && stat.baselineBalls >= minimumBalls && baselineMatches >= minimumMatches && rawImpact !== null;
  const pressureVariance = stat.pressureBalls > 1 ? Math.max(0, (stat.pressureSumSq - stat.pressureOutput ** 2 / stat.pressureBalls) / (stat.pressureBalls - 1)) : 0;
  const baselineVariance = stat.baselineBalls > 1 ? Math.max(0, (stat.baselineSumSq - stat.baselineOutput ** 2 / stat.baselineBalls) / (stat.baselineBalls - 1)) : 0;
  const standardError = rawImpact === null || !stat.pressureBalls || !stat.baselineBalls ? null
    : 100 * Math.sqrt(pressureVariance / stat.pressureBalls + baselineVariance / stat.baselineBalls);
  return {
    playerId: stat.playerId, name: stat.name, role, matches, pressureMatches, baselineMatches,
    pressureBalls: stat.pressureBalls, baselineBalls: stat.baselineBalls, pressureEvents: stat.pressureEvents,
    pressureRate, baselineRate, rawImpact, impact, reliability,
    pressureWickets: stat.pressureWickets, baselineWickets: stat.baselineWickets,
    pressureWicketRate, baselineWicketRate,
    confidenceLow: rawImpact === null || standardError === null ? null : impact - 1.96 * standardError * reliability,
    confidenceHigh: rawImpact === null || standardError === null ? null : impact + 1.96 * standardError * reliability,
    meanPressure: stat.pressureEvents ? stat.pressureScoreTotal / stat.pressureEvents : null,
    eligible,
  };
}

function loadDataset() {
  const started = Date.now();
  const competitions = readCsv(files.competitions);
  const matches = readCsv(files.matches);
  const balls = readCsv(files.balls);
  const playerMappings = readCsv(files.players);
  let imageManifest = {};
  try { imageManifest = JSON.parse(fs.readFileSync(IMAGE_MANIFEST, 'utf8')); } catch { imageManifest = {}; }

  const playerNameCounts = new Map();
  for (const player of playerMappings) {
    const id = String(player.player_id || '');
    const name = String(player.player_name || '').trim();
    if (!id || !name) continue;
    if (!playerNameCounts.has(id)) playerNameCounts.set(id, new Map());
    const names = playerNameCounts.get(id);
    names.set(name, (names.get(name) || 0) + 1);
  }

  const playerNameById = new Map([...playerNameCounts.entries()].map(([id, names]) => [
    id, [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
  ]));
  const playerName = (id, fallback) => playerNameById.get(String(id)) || fallback || 'Unknown';
  const competitionById = new Map(competitions.map((competition) => [String(competition.comp_id), competition]));
  const matchById = new Map(matches.map((match) => {
    const competition = competitionById.get(String(match.comp_id)) || {};
    return [String(match.match_id), {
      ...match,
      match_format: competition.match_format || 'Unknown',
      season: competition.season || (match.match_date || '').slice(0, 4),
    }];
  }));

  const inningsState = new Map();
  const duplicateKeys = new Set();
  let duplicateDeliveries = 0;
  let missingMatchRows = 0;
  const unmatchedCompetitionRecords = matches.filter((match) => !competitionById.has(String(match.comp_id))).length;
  let invalidNumericRows = 0;
  const runsByInnings = new Map();
  const validBalls = [];

  // Memory optimization: enrich the existing ball objects instead of
  // creating a second array of wrapper objects for every delivery.
  for (const ball of balls) {
    const matchId = String(ball.match_id);
    const match = matchById.get(matchId);
    if (!match) { missingMatchRows += 1; continue; }

    const innings = number(ball.innings);
    const inningKey = `${matchId}:${innings}`;
    const runs = number(ball.runs);
    const extras = number(ball.extras1_runs) + number(ball.extras_2_runs);
    const totalRuns = runs + extras;

    if ([ball.innings, ball.runs, ball.extras1_runs].some((value) => value !== '' && !Number.isFinite(Number(value)))) {
      invalidNumericRows += 1;
    }

    runsByInnings.set(inningKey, (runsByInnings.get(inningKey) || 0) + totalRuns);

    const deliveryKey = `${matchId}:${innings}:${ball.innings_ball_num || `${ball.overid}.${ball.over_ball_num}`}`;
    if (duplicateKeys.has(deliveryKey)) duplicateDeliveries += 1;
    duplicateKeys.add(deliveryKey);

    if (!inningsState.has(inningKey)) {
      inningsState.set(inningKey, { legalBalls: 0, wickets: 0, score: 0 });
    }

    const state = inningsState.get(inningKey);
    const legal = !['wide', 'overstep'].includes(String(ball.extras_type).toLowerCase());
    const wicket = bool(ball.is_wicket);
    const before = {
      legalBalls: state.legalBalls,
      wickets: state.wickets,
      score: state.score,
    };

    if (legal) state.legalBalls += 1;
    if (wicket) state.wickets += 1;
    state.score += totalRuns;

    Object.assign(ball, { match, inningKey, legal, wicket, before, runs, extras, totalRuns });
    validBalls.push(ball);
  }

  let chaseDeliveries = 0;
  let pressuredDeliveries = 0;
  let missingTargetChases = 0;
  let latestDate = '';
  let earliestDate = '9999';
  const validFormats = new Set(['T20', 'T20I']);

  for (const entry of validBalls) {
    const { match, before } = entry;
    if (number(entry.innings) !== 2 || !validFormats.has(match.match_format)) continue;

    const firstInningsRuns = runsByInnings.get(`${entry.match_id}:1`);
    const target = number(match.revised_target) || (firstInningsRuns ? firstInningsRuns + 1 : 0);
    if (!target) { missingTargetChases += 1; continue; }

    const maxBalls = oversToBalls(match.second_inn_revised_overs || 20);
    const ballsRemaining = Math.max(1, maxBalls - before.legalBalls);
    const required = Math.max(0, target - before.score);
    const requiredRate = required * 6 / ballsRemaining;
    const ratePressure = clamp((requiredRate - 6) / 9);
    const wicketPressure = clamp(before.wickets / 6);
    const latePressure = clamp((maxBalls - ballsRemaining) / Math.max(1, maxBalls * 0.75));
    const pressureScore = 0.65 * ratePressure + 0.2 * wicketPressure + 0.15 * latePressure;
    const pressure = pressureScore >= 0.45;

    chaseDeliveries += 1;
    if (pressure) pressuredDeliveries += 1;

    const date = match.match_date || '';
    if (date && date < earliestDate) earliestDate = date;
    if (date && date > latestDate) latestDate = date;
  }

  const availableSeasons = [...new Set(matches.map((match) => {
    const comp = competitionById.get(String(match.comp_id));
    return comp?.season || (match.match_date || '').slice(0, 4);
  }).filter(Boolean))].sort();

  const availableFormats = [...new Set(competitions
    .map((competition) => competition.match_format)
    .filter((format) => validFormats.has(format)))].sort();

  const matchesBySeason = matches.reduce((counts, match) => {
    const competition = competitionById.get(String(match.comp_id));
    const season = String(competition?.season || (match.match_date || '').slice(0, 4));
    if (season) counts[season] = (counts[season] || 0) + 1;
    return counts;
  }, {});

  function getMatches({ format = 'All', season = 'All' } = {}) {
    return matches.filter((match) => {
      const competition = competitionById.get(String(match.comp_id));
      const matchFormat = competition?.match_format || 'Unknown';
      const matchSeason = String(competition?.season || (match.match_date || '').slice(0, 4));
      return runsByInnings.has(`${match.match_id}:2`)
        && validFormats.has(matchFormat)
        && (format === 'All' || matchFormat === format)
        && (season === 'All' || matchSeason === String(season));
    }).sort((a, b) => String(b.match_date).localeCompare(String(a.match_date))).map((match) => {
      const competition = competitionById.get(String(match.comp_id)) || {};
      return {
        id: String(match.match_id),
        date: match.match_date,
        format: competition.match_format || 'Unknown',
        season: competition.season || (match.match_date || '').slice(0, 4),
        label: `${match.home_team || 'Team A'} vs ${match.away_team || 'Team B'}`,
        venue: match.venue_country || 'Venue not supplied',
        result: match.result || 'Result not supplied',
      };
    });
  }
    function getPressureField(matchId, threshold = 0.45) {
    const match = matchById.get(String(matchId));
    if (!match || !validFormats.has(match.match_format)) return null;

    const firstInningsRuns = runsByInnings.get(`${matchId}:1`);
    const target = number(match.revised_target) || (firstInningsRuns ? firstInningsRuns + 1 : 0);
    if (!target) return null;

    const maxBalls = oversToBalls(match.second_inn_revised_overs || 20);
    const overs = new Map();

    for (const entry of validBalls) {
      const ball = entry;
      if (String(ball.match_id) !== String(matchId) || number(ball.innings) !== 2) continue;

      const ballsRemaining = Math.max(1, maxBalls - entry.before.legalBalls);
      const requiredRuns = Math.max(0, target - entry.before.score);
      const requiredRate = requiredRuns * 6 / ballsRemaining;
      const pressureIndex = 0.65 * clamp((requiredRate - 6) / 9)
        + 0.2 * clamp(entry.before.wickets / 6)
        + 0.15 * clamp((maxBalls - ballsRemaining) / Math.max(1, maxBalls * 0.75));

      const overNumber = Math.max(1, number(ball.overid));
      if (!overs.has(overNumber)) overs.set(overNumber, {
        over: overNumber,
        runs: 0,
        deliveries: 0,
        legalBalls: 0,
        pressureTotal: 0,
        pressureDeliveries: 0,
        score: 0,
        wickets: 0,
        ballsRemaining,
        requiredRuns,
        requiredRate,
      });

      const summary = overs.get(overNumber);
      summary.runs += entry.totalRuns;
      summary.deliveries += 1;
      summary.legalBalls += entry.legal ? 1 : 0;
      summary.pressureTotal += pressureIndex;
      summary.pressureDeliveries += pressureIndex >= threshold ? 1 : 0;
      summary.score = entry.before.score + entry.totalRuns;
      summary.wickets = entry.before.wickets + (entry.wicket ? 1 : 0);
      summary.ballsRemaining = Math.max(0, maxBalls - entry.before.legalBalls - (entry.legal ? 1 : 0));
      summary.requiredRuns = Math.max(0, target - summary.score);
      summary.requiredRate = summary.ballsRemaining ? summary.requiredRuns * 6 / summary.ballsRemaining : null;
    }

    const innings = [...overs.values()].sort((a, b) => a.over - b.over).map((summary) => ({
      ...summary,
      pressureIndex: summary.deliveries ? summary.pressureTotal / summary.deliveries : 0,
      pressured: summary.pressureDeliveries > 0,
      wicketsRemaining: Math.max(0, 10 - summary.wickets),
    }));

    const last = innings.at(-1);
    const option = getMatches().find((item) => item.id === String(matchId));

    return {
      match: option || {
        id: String(matchId),
        label: `${match.home_team} vs ${match.away_team}`,
        date: match.match_date,
      },
      target,
      firstInningsRuns,
      maxBalls,
      threshold,
      innings,
      final: last ? {
        score: last.score,
        wickets: last.wickets,
        wicketsRemaining: last.wicketsRemaining,
        ballsRemaining: last.ballsRemaining,
        runsNeeded: last.requiredRuns,
        pressureIndex: last.pressureIndex,
        requiredRate: last.requiredRate,
      } : null,
      limitation: 'A tactical chase-state estimate derived from run rate, wickets lost, and innings progress; not a direct psychological measurement.',
    };
  }

  const playerDirectory = new Map();

  const ensurePlayer = (id, name = '') => {
    const playerId = String(id || '');
    if (!playerId) return null;

    if (!playerDirectory.has(playerId)) playerDirectory.set(playerId, {
      id: playerId,
      name: playerName(playerId, name),
      aliases: new Set(),
      teams: new Set(),
      competitions: new Set(),
      formats: new Set(),
      seasons: new Set(),
      battingStyles: new Set(),
      bowlingStyles: new Set(),
    });

    const player = playerDirectory.get(playerId);
    if (name) player.aliases.add(String(name).trim());
    return player;
  };

  for (const mapping of playerMappings) {
    const player = ensurePlayer(mapping.player_id, mapping.player_name);
    if (!player) continue;

    if (mapping.player_name) player.aliases.add(mapping.player_name);
    if (mapping.team_name) player.teams.add(mapping.team_name);
    if (mapping.comp_name) player.competitions.add(mapping.comp_name);

    const comp = competitionById.get(String(mapping.comp_id)) || {};
    if (comp.match_format) player.formats.add(comp.match_format);
    if (comp.season) player.seasons.add(String(comp.season));
  }

  for (const entry of validBalls) {
    const ball = entry;
    const { match } = entry;
    const comp = competitionById.get(String(match.comp_id)) || {};

    const fields = [
      [ball.striker_id, ball.striker_name],
      [ball.non_striker_id, ball.non_striker_name],
      [ball.bowler_id, ball.bowler_name],
    ];

    for (const [id, name] of fields) {
      const player = ensurePlayer(id, name);
      if (!player) continue;

      if (match.match_format) player.formats.add(match.match_format);
      if (match.season) player.seasons.add(String(match.season));
      if (comp.comp_name) player.competitions.add(comp.comp_name);
    }

    const batter = ensurePlayer(ball.striker_id, ball.striker_name);
    const bowler = ensurePlayer(ball.bowler_id, ball.bowler_name);

    if (batter && ball.batting_type) batter.battingStyles.add(ball.batting_type);
    if (bowler && ball.bowling_type) bowler.bowlingStyles.add(ball.bowling_type);
  }

  function searchPlayers(query, limit = 12) {
    const q = String(query || '').trim().toLocaleLowerCase();
    if (q.length < 2) return [];

    const countryNames = {
      indian: 'india',
      australian: 'australia',
      english: 'england',
      pakistani: 'pakistan',
      bangladeshi: 'bangladesh',
      sri: 'sri lanka',
      afghan: 'afghanistan',
      afghanistani: 'afghanistan',
      irish: 'ireland',
      dutch: 'netherlands',
      scottish: 'scotland',
      nepalese: 'nepal',
      nepali: 'nepal',
      canadian: 'canada',
      american: 'united states of america',
      emirati: 'united arab emirates',
      zimbabwean: 'zimbabwe',
      namibian: 'namibia',
      westindian: 'west indies',
    };

    const normalizedQuery = countryNames[q.replace(/\s+/g, '')] || countryNames[q] || q;
    const scored = [];

    for (const player of playerDirectory.values()) {
      const names = [player.name, ...player.aliases].map((value) => value.toLocaleLowerCase());
      const teamNames = [...player.teams].map((value) => value.toLocaleLowerCase());
      const styles = [...player.battingStyles, ...player.bowlingStyles].map((value) => value.toLocaleLowerCase());

      let score = 0;
      if (names.some((value) => value === q)) score = 100;
      else if (names.some((value) => value.startsWith(q))) score = 80;
      else if (names.some((value) => value.includes(q))) score = 60;
      else if (teamNames.some((value) => value.includes(normalizedQuery))) score = 30;
      else if (styles.some((value) => value.includes(q))) score = 20;

      if (score) scored.push({ player, score });
    }

    return scored.sort((a, b) => b.score - a.score || a.player.name.localeCompare(b.player.name))
      .slice(0, Math.max(1, Math.min(30, limit))).map(({ player }) => ({
        id: player.id,
        name: player.name,
        teams: [...player.teams].slice(0, 3),
        formats: [...player.formats].sort(),
        photoUrl: verifiedImageUrl(imageManifest, player.id),
      }));
  }

  function listPlayers() {
    return [...playerDirectory.values()].map((player) => ({
      id: player.id,
      name: player.name,
      aliases: [...player.aliases],
      teams: [...player.teams].sort(),
      formats: [...player.formats].sort(),
      seasons: [...player.seasons].sort(),
    })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  function getImageReport() {
    const players = listPlayers();
    const report = {
      totalPlayers: players.length,
      verified: 0,
      missing: 0,
      unverified: 0,
      broken: 0,
      sources: {},
    };

    for (const player of players) {
      const entry = imageManifest[player.id];

      if (entry?.verification_status === 'verified') {
        if (entry.local_image_path && fs.existsSync(path.join(__dirname, '..', entry.local_image_path))) {
          report.verified += 1;
        } else {
          report.broken += 1;
          report.unverified += 1;
        }
      } else if (['unverified', 'ambiguous'].includes(entry?.verification_status)) {
        report.unverified += 1;
      } else {
        report.missing += 1;
      }

      if (entry?.source_name) {
        report.sources[entry.source_name] = (report.sources[entry.source_name] || 0) + 1;
      }
    }

    return report;
  }

  function getPlayerProfile(playerId, { format = 'All', season = 'All', threshold = 0.45 } = {}) {
    const directory = playerDirectory.get(String(playerId));
    if (!directory) return null;

    const batting = {
      innings: new Map(),
      matches: new Set(),
      runs: 0,
      balls: 0,
      fours: 0,
      sixes: 0,
      dots: 0,
      dismissals: 0,
    };

    const bowling = {
      innings: new Map(),
      matches: new Set(),
      legalBalls: 0,
      runs: 0,
      wickets: 0,
      dots: 0,
    };

    const phaseStats = { batting: {}, bowling: {} };

    const pressure = {
      batting: {
        runs: 0,
        balls: 0,
        dismissals: 0,
        matches: new Set(),
        baselineRuns: 0,
        baselineBalls: 0,
        baselineDismissals: 0,
      },
      bowling: {
        runs: 0,
        legalBalls: 0,
        wickets: 0,
        matches: new Set(),
        baselineRuns: 0,
        baselineLegalBalls: 0,
        baselineWickets: 0,
      },
    };

    const matchStats = new Map();
    const seasonStats = new Map();
    const competitionStats = new Map();
    const matchups = {
      battingVsBowlingType: new Map(),
      battingVsBowlers: new Map(),
      bowlingVsBatters: new Map(),
    };

    const addMatchup = (map, key, name, matchId, {
      runs = 0,
      balls = 0,
      dismissals = 0,
      wickets = 0,
    } = {}) => {
      if (!map.has(key)) {
        map.set(key, { name, matches: new Set(), runs: 0, balls: 0, dismissals: 0, wickets: 0 });
      }

      const row = map.get(key);
      row.matches.add(matchId);
      row.runs += runs;
      row.balls += balls;
      row.dismissals += dismissals;
      row.wickets += wickets;
    };

    const breakdown = (map, key) => {
      if (!map.has(key)) {
        map.set(key, {
          matches: new Set(),
          battingInnings: new Set(),
          bowlingInnings: new Set(),
          battingRuns: 0,
          battingBalls: 0,
          battingDismissals: 0,
          bowlingBalls: 0,
          bowlingRuns: 0,
          bowlingWickets: 0,
        });
      }
      return map.get(key);
    };

    const phaseName = (over) => over <= 6 ? 'powerplay' : over <= 15 ? 'middle' : 'death';
    const scoped = (match) => (format === 'All' || match.match_format === format)
      && (season === 'All' || String(match.season) === String(season));

    const inScopeMatches = new Set();

    for (const entry of validBalls) {
      const ball = entry;
      const { match } = entry;
      const id = String(playerId);

      if (!scoped(match)) continue;

      const matchId = String(ball.match_id);
      const inningNo = number(ball.innings);
      const inningKey = `${matchId}:${inningNo}`;
      const phase = phaseName(number(ball.overid));
      const statsKey = `${matchId}:${inningNo}`;
      const matchContext = matchById.get(matchId) || match;
      const firstRuns = runsByInnings.get(`${matchId}:1`);
      const target = number(matchContext.revised_target) || (firstRuns ? firstRuns + 1 : 0);

      let isPressure = false;
      if (inningNo === 2 && target && validFormats.has(match.match_format)) {
        const maxBalls = oversToBalls(matchContext.second_inn_revised_overs || 20);
        const remaining = Math.max(1, maxBalls - entry.before.legalBalls);
        const rrr = Math.max(0, target - entry.before.score) * 6 / remaining;
        const score = 0.65 * clamp((rrr - 6) / 9)
          + 0.2 * clamp(entry.before.wickets / 6)
          + 0.15 * clamp((maxBalls - remaining) / Math.max(1, maxBalls * 0.75));
        isPressure = score >= Number(threshold);
      }

      const batterId = String(ball.striker_id || '');
      const involvedBatter = batterId === id || String(ball.non_striker_id || '') === id;
      const batterDismissed = entry.wicket && String(ball.dismissed_player_id) === id;

      if (involvedBatter) {
        inScopeMatches.add(matchId);
        batting.matches.add(matchId);

        if (!batting.innings.has(inningKey)) {
          batting.innings.set(inningKey, { runs: 0, balls: 0, dismissals: 0 });
        }

        const inningsRecord = batting.innings.get(inningKey);
        if (batterDismissed) {
          inningsRecord.dismissals += 1;
          batting.dismissals += 1;
        }

        if (inningNo === 2 && target) {
          if (isPressure) pressure.batting.matches.add(matchId);
          if (batterDismissed) {
            if (isPressure) pressure.batting.dismissals += 1;
            else pressure.batting.baselineDismissals += 1;
          }
        }

        const competitionName = (competitionById.get(String(match.comp_id)) || {}).comp_name || 'Competition not supplied';

        for (const [map, key] of [
          [seasonStats, String(match.season || 'Season not supplied')],
          [competitionStats, competitionName],
        ]) {
          const row = breakdown(map, key);
          row.matches.add(matchId);
          row.battingInnings.add(inningKey);
          if (batterDismissed) row.battingDismissals += 1;
        }

        if (batterDismissed) {
          const row = matchStats.get(statsKey) || {
            runs: 0, balls: 0, dismissals: 0, legalBalls: 0, conceded: 0, wickets: 0,
          };
          row.dismissals += 1;
          matchStats.set(statsKey, row);
        }
      }

      if (batterId === id && String(ball.extras_type).toLowerCase() !== 'wide') {
        const inn = batting.innings.get(inningKey);
        const runs = number(ball.runs);
        const faced = String(ball.extras_type).toLowerCase() !== 'wide';

        inn.runs += runs;
        inn.balls += faced ? 1 : 0;

        if (bool(ball.is_four)) batting.fours += 1;
        if (bool(ball.is_six)) batting.sixes += 1;
        if (faced && runs === 0) batting.dots += 1;

        batting.runs += runs;
        batting.balls += faced ? 1 : 0;

        const competitionName = (competitionById.get(String(match.comp_id)) || {}).comp_name || 'Competition not supplied';

        for (const [map, key] of [
          [seasonStats, String(match.season || 'Season not supplied')],
          [competitionStats, competitionName],
        ]) {
          const row = breakdown(map, key);
          row.matches.add(matchId);
          row.battingInnings.add(inningKey);
          row.battingRuns += runs;
          row.battingBalls += faced ? 1 : 0;
        }

        const bowlingCategory = ball.pace_or_spin || ball.bowling_type || 'Not classified';
        addMatchup(
          matchups.battingVsBowlingType,
          String(bowlingCategory),
          String(bowlingCategory),
          matchId,
          { runs, balls: 1, dismissals: entry.wicket && String(ball.dismissed_player_id) === id ? 1 : 0 },
        );

        if (ball.bowler_id) {
          addMatchup(
            matchups.battingVsBowlers,
            String(ball.bowler_id),
            ball.bowler_name || `Player ${ball.bowler_id}`,
            matchId,
            { runs, balls: 1, dismissals: entry.wicket && String(ball.dismissed_player_id) === id ? 1 : 0 },
          );
        }

        if (!phaseStats.batting[phase]) {
          phaseStats.batting[phase] = { runs: 0, balls: 0, fours: 0, sixes: 0, matches: new Set() };
        }

        const ps = phaseStats.batting[phase];
        ps.runs += runs;
        ps.balls += faced ? 1 : 0;
        ps.fours += bool(ball.is_four) ? 1 : 0;
        ps.sixes += bool(ball.is_six) ? 1 : 0;
        ps.matches.add(matchId);

        if (inningNo === 2 && target) {
          if (isPressure) {
            pressure.batting.runs += runs;
            pressure.batting.balls += 1;
            pressure.batting.matches.add(matchId);
          } else {
            pressure.batting.baselineRuns += runs;
            pressure.batting.baselineBalls += 1;
          }
        }

        const row = matchStats.get(statsKey) || {
          runs: 0, balls: 0, dismissals: 0, legalBalls: 0, conceded: 0, wickets: 0,
        };
        row.runs += runs;
        row.balls += faced ? 1 : 0;
        matchStats.set(statsKey, row);
      }

      if (String(ball.bowler_id || '') === id) {
        inScopeMatches.add(matchId);

        const extrasType = String(ball.extras_type).toLowerCase();
        const total = number(ball.runs) + number(ball.extras1_runs) + number(ball.extras_2_runs);
        const extras = number(ball.extras1_runs) + number(ball.extras_2_runs);
        const conceded = Math.max(0, total - (byes.has(extrasType) ? extras : 0));
        const countsWicket = entry.wicket && !nonBowlerDismissals.has(String(ball.dismissal_type || '').toLowerCase());
        const battingCategory = ball.batting_type || 'Not classified';

        addMatchup(
          matchups.bowlingVsBatters,
          String(battingCategory),
          String(battingCategory),
          matchId,
          { runs: conceded, balls: entry.legal ? 1 : 0, wickets: countsWicket ? 1 : 0 },
        );

        bowling.matches.add(matchId);
        bowling.runs += conceded;

        const competitionName = (competitionById.get(String(match.comp_id)) || {}).comp_name || 'Competition not supplied';

        for (const [map, key] of [
          [seasonStats, String(match.season || 'Season not supplied')],
          [competitionStats, competitionName],
        ]) {
          const row = breakdown(map, key);
          row.matches.add(matchId);
          row.bowlingInnings.add(inningKey);
          row.bowlingRuns += conceded;
          row.bowlingBalls += entry.legal ? 1 : 0;
          row.bowlingWickets += countsWicket ? 1 : 0;
        }

        if (entry.legal) bowling.legalBalls += 1;
        if (countsWicket) bowling.wickets += 1;
        if (entry.legal && total === 0) bowling.dots += 1;

        const row = matchStats.get(statsKey) || {
          runs: 0, balls: 0, dismissals: 0, legalBalls: 0, conceded: 0, wickets: 0,
        };
        row.legalBalls += entry.legal ? 1 : 0;
        row.conceded += conceded;
        row.wickets += countsWicket ? 1 : 0;
        matchStats.set(statsKey, row);

        if (!phaseStats.bowling[phase]) {
          phaseStats.bowling[phase] = { runs: 0, legalBalls: 0, wickets: 0, dots: 0, matches: new Set() };
        }

        const ps = phaseStats.bowling[phase];
        ps.runs += conceded;
        ps.legalBalls += entry.legal ? 1 : 0;
        ps.wickets += countsWicket ? 1 : 0;
        ps.dots += entry.legal && total === 0 ? 1 : 0;
        ps.matches.add(matchId);

        if (inningNo === 2 && target) {
          if (isPressure) {
            pressure.bowling.runs += conceded;
            pressure.bowling.legalBalls += entry.legal ? 1 : 0;
            pressure.bowling.wickets += countsWicket ? 1 : 0;
            pressure.bowling.matches.add(matchId);
          } else {
            pressure.bowling.baselineRuns += conceded;
            pressure.bowling.baselineLegalBalls += entry.legal ? 1 : 0;
            pressure.bowling.baselineWickets += countsWicket ? 1 : 0;
          }
        }
      }
    }
        const batterInnings = [...batting.innings.values()];
    const bowlingInnings = [...new Set([...matchStats.keys()])]
      .map((key) => matchStats.get(key))
      .filter((row) => row.legalBalls || row.conceded || row.wickets);

    const seasonBreakdown = [...new Set([...directory.seasons])].sort();
    const battingAverage = batting.dismissals ? batting.runs / batting.dismissals : null;
    const battingSR = batting.balls ? batting.runs / batting.balls * 100 : null;
    const bowlingEconomy = bowling.legalBalls ? bowling.runs / bowling.legalBalls * 6 : null;
    const bowlingAverage = bowling.wickets ? bowling.runs / bowling.wickets : null;
    const bowlingSR = bowling.wickets ? bowling.legalBalls / bowling.wickets : null;

    const variance = (values) => values.length > 1
      ? values.reduce((sum, value) => sum + (value - values.reduce((a, b) => a + b, 0) / values.length) ** 2, 0) / (values.length - 1)
      : null;

    const matchRuns = new Map();
    for (const [key, row] of matchStats) {
      const matchId = key.split(':')[0];
      if (row.balls) matchRuns.set(matchId, (matchRuns.get(matchId) || 0) + row.runs);
    }

    const matchRunValues = [...matchRuns.values()];

    const phaseOut = (stats, kind) => Object.fromEntries(
      Object.entries(stats).map(([phase, item]) => [phase, kind === 'batting' ? {
        runs: item.runs,
        balls: item.balls,
        strikeRate: item.balls ? item.runs / item.balls * 100 : null,
        boundaryCount: item.fours + item.sixes,
        matches: item.matches.size,
      } : {
        runsConceded: item.runs,
        legalBalls: item.legalBalls,
        wickets: item.wickets,
        economy: item.legalBalls ? item.runs / item.legalBalls * 6 : null,
        dotBallPercentage: item.legalBalls ? item.dots / item.legalBalls * 100 : null,
        matches: item.matches.size,
      }]),
    );

    const aggregateBowlingInnings = bowlingInnings.length;
    const seasonSet = new Set([...directory.seasons]);
    const appliedSeasons = season === 'All'
      ? [...seasonSet].sort()
      : [...seasonSet].filter((value) => value === String(season));

    const breakdownRows = (map) => [...map.entries()].map(([label, row]) => ({
      label,
      matches: row.matches.size,
      battingInnings: row.battingInnings.size,
      battingRuns: row.battingRuns,
      battingDismissals: row.battingDismissals,
      battingAverage: row.battingDismissals ? row.battingRuns / row.battingDismissals : null,
      battingStrikeRate: row.battingBalls ? row.battingRuns / row.battingBalls * 100 : null,
      battingBalls: row.battingBalls,
      bowlingInnings: row.bowlingInnings.size,
      bowlingWickets: row.bowlingWickets,
      bowlingRuns: row.bowlingRuns,
      bowlingLegalBalls: row.bowlingBalls,
      bowlingEconomy: row.bowlingBalls ? row.bowlingRuns / row.bowlingBalls * 6 : null,
    }));

    const matchupRows = (map, minimumBalls = 12) => [...map.values()]
      .filter((row) => row.balls >= minimumBalls && row.matches.size >= 3)
      .map((row) => ({
        name: row.name,
        matches: row.matches.size,
        runs: row.runs,
        balls: row.balls,
        dismissals: row.dismissals,
        wickets: row.wickets,
        strikeRate: row.balls ? row.runs / row.balls * 100 : null,
        average: row.dismissals ? row.runs / row.dismissals : null,
        economy: row.balls ? row.runs / row.balls * 6 : null,
      }))
      .sort((a, b) => b.balls - a.balls)
      .slice(0, 10);

    const imageRecord = imageManifest[String(playerId)] || {};
    const localImageExists = imageRecord.verification_status === 'verified'
      && imageRecord.local_image_path
      && fs.existsSync(path.join(__dirname, '..', imageRecord.local_image_path));

    const verifiedPhotoUrl = localImageExists ? imageRecord.app_image_url || null : null;

    return {
      id: directory.id,
      name: directory.name,
      aliases: [...directory.aliases],

      identity: {
        teams: [...directory.teams].sort(),
        competitions: [...directory.competitions].sort(),
        formats: [...directory.formats].sort(),
        seasons: [...directory.seasons].sort(),
        battingStyles: [...directory.battingStyles].sort(),
        bowlingStyles: [...directory.bowlingStyles].sort(),
        role: null,
        photoUrl: null,
      },

      scope: {
        format,
        season,
        threshold: Number(threshold),
        matches: inScopeMatches.size,
        availableSeasons: appliedSeasons,
      },

      coverage: 'Ball-by-ball deliveries from the supplied dataset only; metadata and image licensing are not supplied.',

      batting: {
        matches: batting.matches.size,
        innings: batterInnings.length,
        runs: batting.runs,
        highestScore: batterInnings.length ? Math.max(...batterInnings.map((row) => row.runs)) : null,
        dismissals: batting.dismissals,
        average: battingAverage,
        strikeRate: battingSR,
        ballsFaced: batting.balls,
        fours: batting.fours,
        sixes: batting.sixes,
        boundaryRunShare: batting.runs ? (batting.fours * 4 + batting.sixes * 6) / batting.runs * 100 : null,
        dotBallPercentage: batting.balls ? batting.dots / batting.balls * 100 : null,
      },

      bowling: {
        matches: bowling.matches.size,
        innings: aggregateBowlingInnings,
        legalBalls: bowling.legalBalls,
        overs: `${Math.floor(bowling.legalBalls / 6)}.${bowling.legalBalls % 6}`,
        wickets: bowling.wickets,
        runsConceded: bowling.runs,
        economy: bowlingEconomy,
        average: bowlingAverage,
        strikeRate: bowlingSR,
        dotBallPercentage: bowling.legalBalls ? bowling.dots / bowling.legalBalls * 100 : null,
      },

      pressure: {
        batting: {
          runs: pressure.batting.runs,
          balls: pressure.batting.balls,
          strikeRate: pressure.batting.balls ? pressure.batting.runs / pressure.batting.balls * 100 : null,
          dismissals: pressure.batting.dismissals,
          appearances: pressure.batting.matches.size,
          baselineRuns: pressure.batting.baselineRuns,
          baselineBalls: pressure.batting.baselineBalls,
          baselineStrikeRate: pressure.batting.baselineBalls ? pressure.batting.baselineRuns / pressure.batting.baselineBalls * 100 : null,
          reliability: pressure.batting.balls / (pressure.batting.balls + 45),
        },

        bowling: {
          runsConceded: pressure.bowling.runs,
          legalBalls: pressure.bowling.legalBalls,
          economy: pressure.bowling.legalBalls ? pressure.bowling.runs / pressure.bowling.legalBalls * 6 : null,
          wickets: pressure.bowling.wickets,
          appearances: pressure.bowling.matches.size,
          baselineRunsConceded: pressure.bowling.baselineRuns,
          baselineLegalBalls: pressure.bowling.baselineLegalBalls,
          baselineEconomy: pressure.bowling.baselineLegalBalls ? pressure.bowling.baselineRuns / pressure.bowling.baselineLegalBalls * 6 : null,
          reliability: pressure.bowling.legalBalls / (pressure.bowling.legalBalls + 45),
        },
      },

      phases: {
        batting: phaseOut(phaseStats.batting, 'batting'),
        bowling: phaseOut(phaseStats.bowling, 'bowling'),
      },

      seasonStats: breakdownRows(seasonStats).sort((a, b) => a.label.localeCompare(b.label)),
      competitionStats: breakdownRows(competitionStats).sort((a, b) => b.matches - a.matches || a.label.localeCompare(b.label)),

      matchups: {
        battingByBowlingType: matchupRows(matchups.battingVsBowlingType),
        battingVsBowlers: matchupRows(matchups.battingVsBowlers),
        bowlingByBattingType: matchupRows(matchups.bowlingVsBatters),
      },

      consistency: {
        matchesWithBattingData: matchRunValues.length,
        matchRunsVariance: variance(matchRunValues),
        matchRunsMean: matchRunValues.length
          ? matchRunValues.reduce((a, b) => a + b, 0) / matchRunValues.length
          : null,
      },

      assessments: [],
      archetype: null,

      photo: {
        verifiedUrl: verifiedPhotoUrl,
        initials: directory.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase(),
        attribution: verifiedPhotoUrl ? imageRecord.attribution || null : null,
        sourceName: verifiedPhotoUrl ? imageRecord.source_name || null : null,
        sourcePageUrl: verifiedPhotoUrl ? imageRecord.source_page_url || null : null,
        license: verifiedPhotoUrl ? imageRecord.license || null : null,
        licenseUrl: verifiedPhotoUrl ? imageRecord.license_url || null : null,
        verificationStatus: verifiedPhotoUrl ? 'verified' : 'missing',
      },

      prediction: {
        available: false,
        reason: 'No validated player prediction model is present in this MVP.',
      },

      limitations: [
        'Role, country, biography, and verified portrait are not supplied; team affiliations and observed delivery styles are shown instead.',
        'Averages use recorded dismissals; retired-hurt and incomplete-scorecard edge cases cannot be independently confirmed.',
        'Pressure metrics cover second-innings T20/T20I chases only and are descriptive, not predictive.',
      ],
    };
  }

  function calculate({
    format = 'All',
    season = 'All',
    threshold = 0.45,
    minimumBalls = 30,
    minimumMatches = 3,
  } = {}) {
    const bat = new Map();
    const bowl = new Map();

    const scopedMatches = matches.filter((match) => {
      const competition = competitionById.get(String(match.comp_id));
      const matchFormat = competition?.match_format || 'Unknown';
      const matchSeason = String(competition?.season || (match.match_date || '').slice(0, 4));

      return (format === 'All' || matchFormat === format)
        && (season === 'All' || matchSeason === String(season));
    }).length;

    let scopedChaseDeliveries = 0;
    let scopedPressureDeliveries = 0;

    for (const entry of validBalls) {
      const ball = entry;
      const { match } = entry;

      if (number(ball.innings) !== 2 || !validFormats.has(match.match_format)) continue;
      if (format !== 'All' && match.match_format !== format) continue;
      if (season !== 'All' && String(match.season) !== String(season)) continue;

      const firstRuns = runsByInnings.get(`${ball.match_id}:1`);
      const targetScore = number(match.revised_target) || (firstRuns ? firstRuns + 1 : 0);
      if (!targetScore) continue;

      const maxBalls = oversToBalls(match.second_inn_revised_overs || 20);
      const ballsRemaining = Math.max(1, maxBalls - entry.before.legalBalls);
      const needed = Math.max(0, targetScore - entry.before.score);
      const rrr = needed * 6 / ballsRemaining;

      const p = 0.65 * clamp((rrr - 6) / 9)
        + 0.2 * clamp(entry.before.wickets / 6)
        + 0.15 * clamp((maxBalls - ballsRemaining) / Math.max(1, maxBalls * 0.75));

      const pressured = p >= Number(threshold);
      scopedChaseDeliveries += 1;
      if (pressured) scopedPressureDeliveries += 1;

      const matchId = String(ball.match_id);
      const batterId = keyFor(ball.striker_id, ball.striker_name);

      if (String(ball.extras_type).toLowerCase() !== 'wide') {
        const name = playerName(batterId, ball.striker_name);

        pushStat(bat, batterId, { id: batterId, name }, matchId, 'batter', {
          pressure: pressured,
          pressureScore: p,
          balls: 1,
          output: number(ball.runs),
          wicket: entry.wicket && String(ball.dismissed_player_id) === String(ball.striker_id),
        });
      }

      const bowlerId = keyFor(ball.bowler_id, ball.bowler_name);
      const bowlerName = playerName(bowlerId, ball.bowler_name);
      const extras = number(ball.extras1_runs) + number(ball.extras_2_runs);
      const total = number(ball.runs) + extras;
      const extrasType = String(ball.extras_type).toLowerCase();
      const conceded = Math.max(0, total - (byes.has(extrasType) ? extras : 0));
      const dismissal = String(ball.dismissal_type || '').toLowerCase();

      pushStat(bowl, bowlerId, { id: bowlerId, name: bowlerName }, matchId, 'bowler', {
        pressure: pressured,
        pressureScore: p,
        balls: entry.legal ? 1 : 0,
        output: conceded,
        wicket: entry.wicket && !nonBowlerDismissals.has(dismissal),
      });
    }

    const finish = (map, role) => [...map.values()]
      .map((stat) => ({
        ...finalizeStat(stat, role, Number(minimumBalls), Number(minimumMatches)),
        photoUrl: verifiedImageUrl(imageManifest, stat.playerId),
      }))
      .sort((a, b) => (b.impact ?? -Infinity) - (a.impact ?? -Infinity));

    const batters = finish(bat, 'batter');
    const bowlers = finish(bowl, 'bowler');

    return {
      settings: {
        threshold: Number(threshold),
        minimumBalls: Number(minimumBalls),
        minimumMatches: Number(minimumMatches),
        formula: '0.65 × required-rate stress + 0.20 × wickets lost + 0.15 × innings progress',
      },
      scopedMatches,
      chaseDeliveries: scopedChaseDeliveries,
      pressureDeliveries: scopedPressureDeliveries,
      pressuredShare: scopedChaseDeliveries ? scopedPressureDeliveries / scopedChaseDeliveries : 0,
      batters: batters.filter((player) => player.eligible).slice(0, 50),
      bowlers: bowlers.filter((player) => player.eligible).slice(0, 50),
      batterCandidates: batters.length,
      bowlerCandidates: bowlers.length,
      batterEligible: batters.filter((player) => player.eligible).length,
      bowlerEligible: bowlers.filter((player) => player.eligible).length,
      totalBatters: batters.length,
      totalBowlers: bowlers.length,
    };
  }

  const totalMatches = matches.length;

  const competitionsByFormat = competitions.reduce((acc, competition) => {
    acc[competition.match_format] = (acc[competition.match_format] || 0) + 1;
    return acc;
  }, {});

  const quality = {
    status: duplicateDeliveries || missingMatchRows || invalidNumericRows || unmatchedCompetitionRecords ? 'review' : 'passed',
    duplicateDeliveries,
    missingMatchRows,
    invalidNumericRows,
    unmatchedCompetitionRecords,
    unmatchedMatchRecords: missingMatchRows,
    caveats: [
      'Only second-innings chases have a known target and are scored for pressure.',
      'Pressure is a transparent state index, not a supervised win-probability model.',
      'Match scorecard outcomes and player roles are not inferred beyond the supplied delivery fields.',
    ],
  };

  return {
    calculate,
    getMatches,
    getPressureField,
    searchPlayers,
    listPlayers,
    getImageReport,
    getPlayerProfile,

    meta: {
      matches: totalMatches,
      deliveries: balls.length,
      competitions: competitions.length,
      playersMapped: new Set(playerMappings.map((player) => player.player_id)).size,
      playingXIRows: readCsv(files.playingEleven).length,
      teamRows: readCsv(files.teams).length,
      seasons: availableSeasons,
      formats: availableFormats,
      competitionsByFormat,
      matchesBySeason,
      dateRange: {
        start: earliestDate === '9999' ? null : earliestDate,
        end: latestDate || null,
      },
      chaseDeliveries,
      pressuredDeliveries,
      pressuredShare: chaseDeliveries ? pressuredDeliveries / chaseDeliveries : 0,
      loadMs: Date.now() - started,
      quality,
    },
  };
}

module.exports = { loadDataset };