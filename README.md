# Project RR

Project RR is a local-first cricket decision observatory for the supplied SupeRR Selector Season 2 pressure-performance challenge. The RR Royal Intelligence workspace measures batter and bowler output in high-pressure T20 chases against each player's own non-pressure chase baseline.

## Run locally on Windows

Requirements: Node.js 20 or newer. The app uses Node's built-in HTTP and filesystem modules; there are no npm packages to install.

```powershell
cd C:\Users\Administrator\Desktop\rr
node --version
node server.js
```

Open <http://127.0.0.1:4173>. Keep the terminal open while using the app. Press `Ctrl+C` to stop it.

## GitHub Pages production frontend

The Pages site URL is <https://neelagirichandrika.github.io/rr/>. This project uses plain HTML, CSS, and JavaScript; it does not use Vite and has no frontend dependency-install step. The production build command is `node scripts/build-frontend.js`, and its output directory is `dist/`. The build uses relative CSS/JavaScript paths for the `/rr/` project path, excludes CSVs and all competition records, and includes only portraits marked verified in the image manifest.

GitHub Pages cannot run this project's analytics API. The backend is a separate Node.js service requiring Node.js 20+, `server.js`, the six CSV files under `data/raw/`, and the image manifest. The server uses built-in Node modules and has no npm dependencies. On a host, set `HOST=0.0.0.0`, use its `PORT`, and set `ALLOWED_ORIGIN=https://neelagirichandrika.github.io`. After hosting the API, set the public API origin as the repository Actions variable `RR_API_BASE_URL`; the Pages workflow injects only that URL into the frontend build, never an API secret.

Do not connect restricted competition data to a public unauthenticated API. The backend currently has no user authentication; CORS is not an access-control system. If `RR_API_BASE_URL` is unset, Pages shows an API-not-configured message and does not publish analytics data. Build locally with `node scripts/build-frontend.js`; do not commit the generated `dist/` folder.

The server reads these local files at startup:

- `data/raw/ball_by_ball.csv`
- `data/raw/matches.csv`
- `data/raw/competitions.csv`
- `data/raw/competition_team_player_mapping.csv`
- `data/raw/playing_eleven.csv`
- `data/raw/teams.csv`

The supplied dataset is already extracted into `data/raw/`. If you replace it, keep the source column names and restart the app. The application reads cricket records locally. The optional photo utility sends public player names to Wikidata and retrieves eligible image files from Wikimedia Commons; the UI itself works offline.

## Included analysis

- Delivery-level reconstruction of second-innings chase state.
- The Pressure Field: an over-by-over timeline for an actual supplied chase, showing score, wickets, required rate, and average pressure index.
- Filterable batter and bowler rankings by format, season, pressure threshold, and sample minimums.
- Player-specific pressure versus non-pressure chase baselines.
- Shrinkage toward zero for lower pressure-ball samples.
- Delivery-level confidence intervals, pressure volume, and match counts alongside the rankings.
- Searchable player dossiers with historical batting, bowling, pressure, phase, season, competition, matchup, consistency, and side-by-side comparison records.
- A portrait acquisition utility that accepts only verified Wikidata portrait associations with reuse-permitted Wikimedia Commons license metadata; missing or ambiguous portraits remain initials placeholders.
- Data inventory, structural checks, model notes, and explicit limitations.

### Pressure definition

For each second-innings delivery, the score state is calculated before the delivery. Target and shortened-innings fields are taken from the supplied match file when available. The pressure index is:

`0.65 × clamp((required run rate − 6) / 9) + 0.20 × clamp(wickets lost / 6) + 0.15 × clamp(balls used / (0.75 × innings balls))`

Each `clamp` is bounded from 0 to 1. A delivery is classed as pressure when the index meets the selected threshold (default 0.45).

- **Batting impact:** pressure runs per 100 balls faced minus non-pressure chase runs per 100 balls faced.
- **Bowling impact:** non-pressure runs conceded per 100 legal balls minus pressure runs conceded per 100 legal balls. Byes and leg byes are excluded from bowler-conceded runs.
- **Reliability adjustment:** raw impact is multiplied by `pressure balls / (pressure balls + 45)`.
- **Eligibility:** at least 30 pressure balls and 30 baseline balls, and at least 3 separate matches in each group by default. The user can adjust the pressure ball and match minimums in the app; the baseline minimum follows the same settings.
- **Uncertainty:** intervals use delivery-level sample variance. They do not account for all within-match dependence, so they are descriptive uncertainty bands rather than fully clustered inference.

This is an explainable descriptive model fit to the supplied historical outcomes to estimate player-specific baselines. It is not a supervised classifier, does not estimate win probability, and does not claim that pressure caused the observed change. First-innings pressure is outside this MVP because the target is not known for that innings.

## Dataset audit snapshot

The attached pack contains 200,999 ball-by-ball rows, 883 match records, and competitions tagged as T20 or T20I from 2022 through 2026. The app checks match linkage, duplicate delivery keys, and numeric score fields at startup. The Data Quality view reports the current checks and the analysis limitations.

The problem statement PDF supplied in the data pack is kept in `data/reference/` for traceability.

## Player profiles and portraits

Use the player search in the top bar to resolve a player ID. Suggestions include supplied team affiliations so similarly named players remain distinct. Profile filters follow the selected format, season, and pressure threshold. Missing playing roles, biographies, or country metadata are labeled unavailable rather than inferred.

Portraits are looked up from Wikidata's exact English player label and `P18` portrait property, then checked against Wikimedia Commons image metadata. Only reuse-permitted licenses with their required attribution are accepted. Local images are written under `public/assets/players/<player_id>/`; `.gitignore` keeps downloaded binaries out of Git. Each entry in `data/player_images/manifest.json` records the player ID, source page, attribution, license, verification basis, dimensions, file size, hash, and status. Images are never substituted between players.

```powershell
node scripts\acquire-player-images.js
node scripts\acquire-player-images.js --report
node scripts\acquire-player-images.js --report --check-links
node scripts\acquire-player-images.js --retry-unresolved
node scripts\acquire-player-images.js --review
```

The full acquisition command checks the supported player database and caches verified files; reruns skip verified files that still exist. `--review` writes ambiguous/unverified identities and candidate QIDs to `data/player_images/review.json`. To disambiguate a player, set their `player_id` to the reviewed `wikidata_qid` in `data/player_images/overrides.json` and rerun. The script uses no API keys. Restart `node server.js` after an acquisition so its in-memory image manifest refreshes. The `images:acquire`, `images:report`, and `images:review` npm scripts are shortcuts.

Profiles use an RR initials placeholder when no sufficiently verified, licensed portrait is available. Check the per-image source and license before redistributing images.

## Project structure

```text
server.js                 Local HTTP server and JSON API
src/analysis.js           CSV loading, state reconstruction, metrics, and rankings
public/index.html         App views and page structure
public/style.css          Centralized responsive RR brand system
public/app.js             Filters, tables, and client-side rendering
data/raw/                 Supplied CSV dataset
data/reference/           Supplied problem statement
```

## Checks

```powershell
node --check server.js
node --check src\analysis.js
node --check public\app.js
node --check scripts\acquire-player-images.js
```

The analysis engine can also be smoke-checked from the project directory:

```powershell
node -e "const {loadDataset}=require('./src/analysis'); const {meta,calculate}=loadDataset(); const result=calculate(); console.log({matches:meta.matches,deliveries:meta.deliveries,quality:meta.quality.status,eligibleBatters:result.batterEligible,eligibleBowlers:result.bowlerEligible});"
```

## Scope note

The supplied data does not include a validated player prediction model, auction prices, budgets, squad rules, or official player-role metadata. Player profiles distinguish observed statistics from these unavailable decision inputs; the Predictive Decision Lab, auction optimization, and squad planning remain outside the implemented MVP.
