# Official Penmanshiel status exports

Genuine public data. **Do not edit these files** — the importer checksums them and the parser tests
assert their published CRLF line endings survive checkout.

| | |
| --- | --- |
| Dataset | Penmanshiel wind farm data, v3 |
| Publisher | Cubico Sustainable Investments Ltd (released by Charlie Plumley and Roberta Takeuchi) |
| Record | https://zenodo.org/records/16807304 |
| DOI | 10.5281/zenodo.16807304 |
| License | CC-BY-4.0 |
| Source archive | `Penmanshiel_SCADA_2023_02_WT_01-10_5981.zip` (61 MB, sha256 `8068087be360e624da3fbdb2dfd2f17112534b81adc3895d2498d550a3c83ee9`) |

These two `Status_*.csv` files were extracted from that archive and are committed unmodified. The
archive itself, and the 42 MB-per-turbine `Turbine_Data_*.csv` SCADA files inside it, are **not**
committed — see `docs/PENMANSHIEL_DATA.md` for how to obtain them.

Exported by Greenbyte; the comment header on each file declares the turbine, turbine type, time
zone (UTC) and exported interval.
