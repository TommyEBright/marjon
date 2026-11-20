# Changelog

## 0.2.2 (November 2026)

- Opens AVI files. MJPEG (with or without Huffman tables) and uncompressed colour, greyscale and paletted AVIs are read frame by frame straight from the file, including OpenDML files over 1 GB. The stored frame rate comes from the file header.
- Other AVI codecs (e.g. Xvid) are converted in the browser to all-intra MP4 with ffmpeg.wasm on first use (needs an internet connection).
- Validated by running the demo runner encoded as MJPEG, MJPEG without Huffman tables, 24-bit, greyscale, 8-bit palette (2.5 GB OpenDML for 24-bit) and Xvid AVIs through the full analysis: identical results to the true values.

## 0.2.1 (November 2026)

- Marjon colours and larger logo across the workspace and report.
- Reliability study: load paired session files to calculate bias, ICC(2,1) and SEM with bootstrap confidence intervals, and MDC95; fill the report MDC values from the study.

## 0.2.0 (November 2026)

- Rebuilt interface: project tree, single viewport with wheel zoom and pan, timeline with trajectory coverage and events, properties panels, status bar.
- Auto-labelling of markers on the current frame.
- "Process all views" runs auto-label, tracking, event detection and calculation for every loaded view.
- Camera stations: save a calibration once and reuse it for new videos of the same size.
- Session files (save and open), which also act as the previous session at a retest.
- Report rebuilt summary-first: headline tiles, up to three practitioner-chosen key findings with angle overlays, stance sequence, full results with change since the previous session, MDC flags.
- Contact and stride time now reported in milliseconds.
- Automated validation tests against the synthetic demo runner on every update.

## 0.1.0 (November 2026)

- First standalone version replacing the six-camera CSV tool: side and rear video, belt calibration, marker tracking, event detection, side and rear metrics, printable report, synthetic demo runner with known values.
