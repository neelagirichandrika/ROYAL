# Supplied dataset

`raw/` contains CSV files extracted from the user-provided `6af458274c1e8_data_pack.zip`. The problem statement PDF is stored in `reference/SupeRR_Selector_problem_statement.pdf`.

## Files

| File | Purpose |
| --- | --- |
| `ball_by_ball.csv` | Delivery-level runs, wickets, players, and delivery context |
| `matches.csv` | Match dates, competition IDs, teams, target/overs revisions, and results |
| `competitions.csv` | Competition names, format, and season |
| `competition_team_player_mapping.csv` | Competition, team, and player linkage |
| `playing_eleven.csv` | Match selection and player-role flags |
| `teams.csv` | Team identifiers and names by competition |

The current analysis links deliveries to matches and competitions. Player names and identifiers on delivery records are used directly; the player mapping and playing XI files are included in the inventory for future role and selection work.
