# Changelog

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
