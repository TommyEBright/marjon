# Marjon Gait

2D treadmill running gait assessment from side and rear video, developed in Sport and Exercise Science at Plymouth Marjon University.

**Live app:** https://tommyebright.github.io/marjon-gait/

Everything runs in the browser. Videos are opened from the user's own computer and are never uploaded anywhere, so the hosted app holds no client data.

## What it does

- Loads a left side, right side and rear video of treadmill running.
- Calibrates each camera on the belt (saved as a camera station for reuse).
- Finds and labels the reflective markers, then tracks them through the clip.
- Suggests initial contact and toe-off for the practitioner to confirm frame by frame.
- Calculates timing, side-view and rear-view measures for every stride.
- Builds a printable, Marjon-branded client report, including change since a previous session.

### Measures

| View | Measures |
|---|---|
| Side (each leg) | Contact time, stride time, cadence, duty factor, stride length, foot angle and strike pattern, shank angle, ankle ahead of hip, knee flexion at contact and peak, knee flexion excursion, thigh extension at toe-off, trunk lean, vertical oscillation |
| Rear | Contralateral pelvic drop, hip adduction, step width |

All values are 2D image-plane measures at the tested speed. They describe how someone ran on the day and do not diagnose or predict injury.

## Using it

1. Open the live link in Chrome or Edge.
2. Click **Demo in all views**, then **Process all views** to see the full workflow on a synthetic runner with known values.
3. For a client: **Session** for details, open each video, check the calibration, **Process all views**, check every event, then **Report**.
4. **Save** the session at the end. Load it as the *previous session* at the next visit to show change.

Press **Help** in the app for the capture protocol and keyboard shortcuts.

## Accuracy checks

Every update is run on the synthetic demo runner and compared against the true values before it can go live (`tests/validate.mjs`). If any measure misses its target the update is blocked. Results are shown in the **Actions** tab under each run.

| Check | Target |
|---|---|
| Marker labelling | within 2 px |
| Initial contact timing | within 5 ms (1 frame at 200 fps) |
| Toe-off timing, contact time | within 15 ms |
| Side-view angles | within 2° |
| Distances | within 1 cm |
| Rear-view angles | within 1° |

These checks confirm the processing is correct. Real-world accuracy against force platform and 3D motion capture, and between-session reliability (SEM, MDC), still need to be established on real runners.

## Project layout

```
src/
  index.html     page layout
  styles.css     app and report styles
  core.js        signal processing, synthetic runner, event detection, measures
  ui.js          workspace, tracking, auto-labelling, sessions
  report.js      report builder
  assets/        logo
scripts/build.mjs  bundles src/ into a single dist/index.html
tests/validate.mjs automated accuracy checks
```

## Developing

```
npm install
npx playwright install chromium
npm run build      # creates dist/index.html
npm test           # runs the accuracy checks
```

`dist/index.html` is a single self-contained file. It can be opened directly from disk, which is the recommended way to use the app with real client video.

## Releases

Publishing a GitHub Release (e.g. tag `v0.2.0`) runs the tests and attaches a single-file offline copy, `Marjon_Gait_v0.2.0.html`, to the release.

## Licence

Copyright © 2026 Plymouth Marjon University. All rights reserved. The code is visible for transparency; it is not licensed for reuse.
