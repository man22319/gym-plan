# Planet Fitness Tracker

*A simple workout tracker built for fast, distraction-free use in the gym.*

<img width="1320" height="2297" alt="Planet Fitness Tracker home screen" src="https://github.com/user-attachments/assets/d8985699-46d7-406e-9049-c7d0f789d78e" />

<p align="center"><em>Home screen showing today's workout, progress tracking, and quick access to workout controls.</em></p>

## What It Does

Planet Fitness Tracker helps you track workouts, rest periods, and progress without needing an account, internet connection, or subscription. Everything is stored locally on your device.

<img width="947" height="875" alt="Workout dashboard" src="https://github.com/user-attachments/assets/0a130e87-b738-4a73-bfc7-b88f4d59703a" />

<p align="center"><em>Main workout dashboard displaying exercise groups, set tracking, and workout progress.</em></p>

---

## Workout Tracking

Workouts are organized into clear sections rather than one long list of exercises. Supersets are grouped together so related exercises stay connected and easy to follow.

You can:

* Track sets, reps, and weights
* View target rep and weight ranges
* See exercise notes and coaching tips
* View alternative exercises when equipment is unavailable
* Switch between workout days with a single tap

<img width="947" height="424" alt="Workout day selector" src="https://github.com/user-attachments/assets/83251e9f-6f46-40f2-bba9-44556b4b0a11" />

<p align="center"><em>Quickly switch between workout days without leaving the current session.</em></p>

<img width="947" height="422" alt="Superset grouping" src="https://github.com/user-attachments/assets/399f0454-b8fd-4175-871a-17e9ef8bf414" />

<p align="center"><em>Exercises are grouped into supersets for easier workout flow and organization.</em></p>

<img width="947" height="646" alt="Exercise details" src="https://github.com/user-attachments/assets/4e11b5ff-a4b4-4d47-bc58-de6958ac39f0" />

<p align="center"><em>Exercise notes, target ranges, and alternative movements are available directly within the workout view.</em></p>

---

## Logging Sets

To prevent accidental taps while training, exercises are logged using a short press-and-hold action.

The app records:

* Completed sets
* Reps performed
* Weight used
* Optional notes

You can also tap an exercise to view your previous workout history and compare performance.

<img width="947" height="482" alt="Exercise history modal" src="https://github.com/user-attachments/assets/ded8b03f-85d1-4692-ae7b-1b141aacd3a5" />

<p align="center"><em>View previous workout performance for any exercise without leaving the current session.</em></p>

---

## Rest Timer

After completing a set, a rest timer starts automatically.

Features include:

* Visual countdown bar
* Add 30 seconds instantly
* Skip the timer when ready
* Clear indication of remaining rest time

<img width="489" height="75" alt="Rest timer" src="https://github.com/user-attachments/assets/aba62dc8-fd09-45a5-8f53-8a0d77ad910f" />

<p align="center"><em>Automatic rest timer with quick controls for extending or skipping rest periods.</em></p>

---

## Session Summary

The app tracks your workout duration automatically.

When you finish a workout, a summary screen shows:

* Total workout time
* Completed exercises
* Session progress

<img width="947" height="894" alt="Workout summary" src="https://github.com/user-attachments/assets/3c8a5a7e-c5df-4724-9ae7-6b0d2682b901" />

<p align="center"><em>Session summary showing workout duration and overall completion statistics.</em></p>

---

## Backup & Restore

All data is stored directly in your browser. Nothing is sent to a server.

You can:

* Export your data as a JSON backup file
* Import backups on another device
* Keep your workout history when moving devices

<img width="613" height="428" alt="Import export tools" src="https://github.com/user-attachments/assets/c61170e0-0db2-4279-882d-9f1bc6681eeb" />

<p align="center"><em>Built-in import and export tools for backing up or transferring workout data.</em></p>

---

## Extra Tools

Additional utilities include:

* Copy an entire workout as plain text
* Reset all stored data (with confirmation)
* Automatic handling of app updates without losing workout history

---

## Project Structure

The application is split into separate modules to keep the code organized and maintainable.

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

| File            | Purpose                                             |
| --------------- | --------------------------------------------------- |
| `index.html`    | Main application layout and styling                 |
| `main.js`       | Starts the application and connects all modules     |
| `engine.js`     | Handles workout logic, timers, and state updates    |
| `ui.js`         | Renders the interface and handles user interactions |
| `state.js`      | Manages saved data and application state            |
| `workouts.json` | Stores workout routines and exercise definitions    |

---

## Technical Details

* Built with plain HTML, CSS, and JavaScript
* No frameworks or external dependencies
* No build tools required
* Works offline after loading
* Easily deployable on GitHub Pages

<img width="1320" height="2297" alt="Mobile view" src="https://github.com/user-attachments/assets/a447acf7-60d9-4dc7-999e-4334ec275579" />

<p align="center"><em>Mobile-first interface optimized for use during workouts.</em></p>

<img width="1897" height="885" alt="Desktop view" src="https://github.com/user-attachments/assets/8cd35b20-ad2b-42c7-9a3d-96f44839fa6e" />

<p align="center"><em>Desktop layout for editing routines, reviewing history, and managing workout data.</em></p>
