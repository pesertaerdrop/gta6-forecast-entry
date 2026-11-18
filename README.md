# gta6-forecast-entry

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/pesertaerdrop/gta6-forecast-entry/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/pesertaerdrop/gta6-forecast-entry/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Forecasts Grand Theft Auto VI's Twitch concurrent viewers hour by hour on release day 2026-11-19 (UTC), from the first hour's print and the release-day curves of past big console launches. The median curve comes from console-only, rolling-midnight comparables (no PC): it dips to ~0.8x of hour 1 in the small hours, then climbs with the US unlocks (east coast 05:00Z, west coast 08:00Z) to ~2.4x at hours 19-20. Quantile spreads are the empirical residual quantiles around that median, widened x1.6. Practice backtest (pinball loss, log scale): 0.255 mean vs 0.387 house baseline and 0.603 flat — p00 0.437, p01 0.171, p02 0.198, p03 0.214. A log-log regression on hour-1 size looked better in-sample (0.204) but extrapolates to an evening collapse for a GTA-VI-scale hour-1 print and fails scenario stress tests, so it was left out.

## Run it

```sh
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref={referral_code}&utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
