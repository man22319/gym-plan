# Planet Fitness Tracker

*A simple workout tracker built for fast, distraction-free use in the gym.*

<p align="center">
  <img src="https://github.com/user-attachments/assets/d8985699-46d7-406e-9049-c7d0f789d78e" alt="Planet Fitness Tracker home screen" width="420">
</p>

<p align="center"><em>Home screen showing today’s workout, progress tracking, and quick access controls.</em></p>

---

## What It Does

Planet Fitness Tracker helps you track workouts, rest periods, and progress without needing an account, internet connection, or subscription. Everything is stored locally on your device.

<p align="center">
  <img src="https://github.com/user-attachments/assets/0a130e87-b738-4a73-bfc7-b88f4d59703a" alt="Workout dashboard" width="460">
</p>

<p align="center"><em>Main dashboard showing workout structure and current session progress.</em></p>

---

## Workout Tracking

Workouts are organized into structured sections instead of a flat list. Supersets are grouped so related movements stay connected.

You can:

* Track sets, reps, and weights
* View target ranges
* See exercise notes and coaching cues
* View alternatives when equipment is unavailable
* Switch workout days instantly

<p align="center">
  <img src="https://github.com/user-attachments/assets/713f8012-5105-4d31-ad38-55b7ad7ea8ce" alt="Workout day selector" width="380">
</p>

<p align="center"><em>Switch between workout days without leaving the session.</em></p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/131d24c5-67dc-44ec-87c5-a92b2e3a4351" alt="Workout persistence view" width="380">
</p>

<p align="center"><em>Workout state persists across sessions and days.</em></p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/56a06f5e-90e5-4795-9a0e-ec64a3914bc1" alt="Superset grouping" width="520">
</p>

<p align="center"><em>Exercises grouped into supersets for cleaner workout flow.</em></p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/4e11b5ff-a4b4-4d47-bc58-de6958ac39f0" alt="Exercise details" width="460">
</p>

<p align="center"><em>Exercise details include notes, targets, and alternatives.</em></p>

---

## Logging Sets

Sets are logged using a press-and-hold gesture to prevent accidental inputs during training.

The app tracks:

* Completed sets
* Reps performed
* Weight used
* Optional notes

You can also view past performance for any exercise.

<p align="center">
  <img src="https://github.com/user-attachments/assets/ded8b03f-85d1-4692-ae7b-1b141aacd3a5" alt="Exercise history modal" width="460">
</p>

<p align="center"><em>View past performance without leaving the current workout.</em></p>

---

## Rest Timer

A rest timer starts automatically after each set.

Features:

* Countdown bar
* +30s quick extension
* Skip option
* Clear visual pacing

<p align="center">
    <img width="320" alt="image" src="https://github.com/user-attachments/assets/f0e246cb-0bbd-4e93-83ef-a8cda6aeffeb" />
</p>

<p align="center"><em>Simple rest timer with quick controls.</em></p>

---

## Session Summary

The app tracks total workout duration automatically.

When finished, it shows:

* Total time
* Completed exercises
* Session progress

<p align="center">
  <img src="https://github.com/user-attachments/assets/3c8a5a7e-c5df-4724-9ae7-6b0d2682b901" alt="Workout summary" width="460">
</p>

<p align="center"><em>End-of-workout summary with full session breakdown.</em></p>

---

## Backup & Restore

All data is stored locally. Nothing is uploaded anywhere.

You can:

* Export workout data as JSON
* Import it on another device
* Preserve full history across devices

<p align="center">
  <img src="https://github.com/user-attachments/assets/c61170e0-0db2-4279-882d-9f1bc6681eeb" alt="Import export tools" width="420">
</p>

<p align="center"><em>Backup and restore tools for moving or saving data.</em></p>

---

## Extra Tools

* Copy full workout as text
* Reset all data (with confirmation)
* Safe updates without data loss

---

## Project Structure

```text
gym-plan/
├── index.html
└── src/
    ├── components/
    │   └── ui.js
    ├── core/
    │   └── engine.js
    ├── main.js
    └── store/
        ├── state.js
        └── workouts.json
```

### File Overview

| File            | Purpose                       |
| --------------- | ----------------------------- |
| `index.html`    | App layout and styles         |
| `main.js`       | App startup and wiring        |
| `engine.js`     | Core logic and state handling |
| `ui.js`         | Rendering and interactions    |
| `state.js`      | Data storage layer            |
| `workouts.json` | Workout definitions           |

---

## Technical Details

* Pure HTML, CSS, and JavaScript
* No frameworks or build tools
* Fully offline after load
* Deployable on GitHub Pages

<p align="center">
  <img src="https://github.com/user-attachments/assets/a447acf7-60d9-4dc7-999e-4334ec275579" alt="Mobile view" width="420">
</p>

<p align="center"><em>Mobile-first UI optimized for in-gym use.</em></p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/8cd35b20-ad2b-42c7-9a3d-96f44839fa6e" alt="Desktop view" width="650">
</p>

<p align="center"><em>Desktop view for managing and reviewing workouts.</em></p>

---
