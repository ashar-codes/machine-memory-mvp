

## Real public wind turbine data

Alongside the synthetic demonstration farm, Machine Memory holds **genuine public operational
data**: 1,172 real event records from two Penmanshiel turbines, February 2023.

Source: Cubico Sustainable Investments Ltd, "Penmanshiel wind farm data" v3, Zenodo record
16807304, CC-BY-4.0.

```bash
npm run data:penmanshiel                       # 14 real turbine identities
npm run data:penmanshiel -- --events           # real event history for PEN-T01 and PEN-T02
```

Both are idempotent. The site appears as **Penmanshiel Wind Farm · PUBLIC DATA**, kept entirely
separate from the fictional Demonstration Wind Farm, and every imported row carries
`record_origin = public_data`.

The dataset has operational events and **no** work orders, root causes or repair records. That gap
is preserved: ask how a real event was solved and Machine Memory says a verified resolution is not
present, rather than inventing one. Severity is mapped conservatively and `critical` is
unreachable, because the published data has no such class.

Nothing is trained on this data. Structured rows are queried in SQL; only reviewed public reference
*text* is embedded. See `docs/PENMANSHIEL_DATA.md`.
