# gta6-twitch-ccu-forecast-01

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/apexs15/gta6-twitch-ccu-forecast-01/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/apexs15/gta6-twitch-ccu-forecast-01/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Entry for the [gta6-twitch-ccu-forecast-01 bounty](https://make.fun/bounty/gta6-twitch-ccu-forecast-01): forecast GTA VI's launch-day Twitch viewers hour by hour (hours 2–24 UTC, 2026-11-19), as five quantiles per hour.

## Model

A launch-day **shape learned from the case's own comparables at run time** — not a
fixed curve, and not the house baseline's flat persistence.

1. For each usable comparable (a past big console launch) take its 24 release-day
   hours and form the log-ratio to its own hour 1: `r_h = ln(viewers_h / viewers_1)`.
2. The shape depends on how big hour 1 already is: a launch whose hour 1 is huge
   (already live in NZ/AU/JP for hours, Europe just unlocked) has most of its
   audience in hand, so its climb to the evening peak is flat; a launch whose
   hour 1 is small still has the whole US unlock ahead of it, so its ratio climbs
   several-fold. Across rolling-midnight launches, corr(log hour-1, log peak/hour-1)
   is about −0.67. So per hour we fit `r_h = a_h + b_h · (ln p1 − ln 120000)` by
   least squares, where `p1` is this case's hour-1 print. Slopes run from ~0 in
   the overnight hours to about −0.5 in the evening.
3. Spread is the per-hour residual standard deviation × 0.8; quantiles are the
   fitted median × exp(z_tau · spread).
4. Only **rolling midnight-local, tier-"comparable"** launches are used.
   Simultaneous-global launches are excluded: their hour 1 falls before the single
   unlock, so their ratios are meaningless. Early-access-contaminated and weak
   launches are excluded too, as is the GTA VI category's own pre-release history
   (not a launch curve).
5. If too few usable comparables survive, the program falls back to constants
   fitted offline on the same population (14 curves), baked into `main.ts`.

## Validation (local, practice cases p00–p03)

Mean pinball loss on the log scale (lower is better), measured against the real
hourly SullyGnome counts for hours 2–24:

| case | this model | house baseline |
| --- | --- | --- |
| p00 Wolverine | 0.198 | 0.744 |
| p01 Red Dead Redemption 2 | 0.109 | 0.287 |
| p02 God of War Ragnarök | 0.125 | 0.215 |
| p03 Spider-Man 2 | 0.231 | 0.303 |
| **mean** | **0.166** | **0.387** |

Leave-one-out over the 14 fit curves gives ~0.23 (worst single curve: Resident
Evil Requiem, 0.84 — a low hour-1 / very steep launch). The house baseline is
beaten on every practice case.

## Run

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Node 22, standard library only, no network. Reads every `*.in` in the input
directory, writes one `<id>.out` per case: `{"hours":[{"hour":h,"q":[q05,q25,q50,q75,q95]}]}`,
23 rows, hours 2–24. Deterministic: two runs on the same case write
byte-identical output. Runs in well under a second per case.

## License

MIT — see [LICENSE](LICENSE).
