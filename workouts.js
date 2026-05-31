// ==========================================
// ─── WORKOUT DEFINITIONS (static config) ───
// ==========================================

const workouts = [
  {
    id: 'session_thu',
    dayLabel: 'THU',
    sessionLabel: 'Session 1',
    warmup: 'Incline treadmill · 8 min · 3.0 mph · 2% incline',
    finisher: 'Incline treadmill · 8 min · 3.3 mph · 2.5% incline',
    blocks: [
      {
        label: 'Superset 1 — Pull / Push',
        exercises: [
          { id: 'thu_row', letter: 'A', name: 'Seated Row Machine', sets: 4, reps: '6-8', weight: '60 lbs' },
          { id: 'thu_bench', letter: 'B', name: 'Dumbbell Bench Press', sets: 4, reps: '8', weight: '22.5-25 lbs' }
        ]
      },
      {
        label: 'Superset 2 — Legs',
        exercises: [
          { id: 'thu_leg_curl', letter: 'A', name: 'Seated Leg Curl', sets: 4, reps: '10-15', weight: '60 lbs' },
          { id: 'thu_leg_ext', letter: 'B', name: 'Seated Leg Extension', sets: 4, reps: '10-15', weight: '60-70 lbs' }
        ]
      },
      {
        label: 'Superset 3 — Your Moves',
        exercises: [
          { id: 'thu_leg_press', letter: 'A', name: 'Modified Leg Press (Glute Biased)', sets: 4, reps: '10-12', weight: '140-160 lbs' },
          { id: 'thu_lat_pull', letter: 'B', name: 'Lat Pulldown', sets: 3, reps: '8-10', weight: '70 lbs' }
        ]
      },
      {
        label: 'Superset 4 — Shoulders / Arms',
        exercises: [
          { id: 'thu_lat_raise', letter: 'A', name: 'Lateral Raise', sets: 3, reps: '12-15', weight: '10-15 lbs' },
          { id: 'thu_tri_press', letter: 'B', name: 'Triceps Press Machine', sets: 3, reps: '8-10', weight: '70-80 lbs' }
        ]
      }
    ]
  },

  {
    id: 'session_sat',
    dayLabel: 'SAT',
    sessionLabel: 'Session 2',
    warmup: 'Incline treadmill · 8 min · 3.0 mph · 2% incline',
    finisher: 'Incline treadmill · 8 min · 3.3 mph · 2.5% incline',
    blocks: [
      {
        label: 'Superset 1 — Pull / Shoulders',
        exercises: [
          { id: 'sat_row', letter: 'A', name: 'Supported Single-Arm Row', sets: 3, reps: '8-10', weight: '30 lbs' },
          { id: 'sat_arnold_press', letter: 'B', name: 'Arnold Press', sets: 3, reps: '8-10', weight: '25-30 lbs' }
        ]
      },
      {
        label: 'Superset 2 — Legs',
        exercises: [
          { id: 'sat_leg_press', letter: 'A', name: 'Leg Press', sets: 4, reps: '10-12', weight: '140-160 lbs' },
          { id: 'sat_leg_curl', letter: 'B', name: 'Seated Leg Curl', sets: 3, reps: '10-12', weight: '60 lbs' }
        ]
      },
      {
        label: 'Superset 3 — Arms / Shoulders',
        exercises: [
          { id: 'sat_lat_raise', letter: 'A', name: 'Lateral Raise', sets: 3, reps: '12-15', weight: '10-15 lbs' },
          { id: 'sat_tri_press', letter: 'B', name: 'Triceps Press Machine', sets: 3, reps: '8-10', weight: '70-80 lbs' },
          { id: 'sat_hammer', letter: 'C', name: 'Hammer Curl', sets: 3, reps: '10-12', weight: '15 lbs' }
        ]
      }
    ]
  },

  {
    id: 'session_mon',
    dayLabel: 'MON',
    sessionLabel: 'Session 3',
    warmup: 'Incline treadmill · 8 min · 3.0 mph · 2% incline',
    finisher: 'Incline treadmill · 8 min · 3.3 mph · 2.5% incline',
    blocks: [
      {
        label: 'Superset 1 — Pull / Push',
        exercises: [
          { id: 'mon_row', letter: 'A', name: 'Supported Single-Arm Row', sets: 3, reps: '8-10', weight: '30 lbs' },
          { id: 'mon_idbp', letter: 'B', name: 'Incline Dumbbell Bench Press', sets: 3, reps: '8-12', weight: '22.5-25 lbs' }
        ]
      },
      {
        label: 'Superset 2 — Legs',
        exercises: [
          { id: 'mon_leg_press', letter: 'A', name: 'Leg Press', sets: 4, reps: '8-12', weight: '140-160 lbs' },
          { id: 'mon_leg_curl', letter: 'B', name: 'Seated Leg Curl', sets: 3, reps: '10-12', weight: '60 lbs' }
        ]
      },
      {
        label: 'Superset 3 — Arms',
        exercises: [
          { id: 'mon_skull', letter: 'A', name: 'Skull Crushers', sets: 3, reps: '10-12', weight: '15 lbs' },
          { id: 'mon_curl', letter: 'B', name: 'Barbell Curl', sets: 3, reps: '8-12', weight: '40-50 lbs' }
        ]
      },
      {
        label: 'Superset 4 — Shoulders',
        exercises: [
          { id: 'mon_ohp', letter: 'A', name: 'Overhead Press', sets: 3, reps: '6-8', weight: '20-25 lbs' },
          { id: 'mon_lat_raise', letter: 'B', name: 'Lateral Raise', sets: 3, reps: '12-15', weight: '10-15 lbs' }
        ]
      }
    ]
  }
];

// Flat exercise index for O(1) lookup: exId → exercise config
const EXERCISE_INDEX = Object.fromEntries(
  workouts.flatMap(s => s.blocks.flatMap(b => b.exercises)).map(ex => [ex.id, ex])
);

// Session index: exId → sessionId
const EX_SESSION_INDEX = Object.fromEntries(
  workouts.flatMap(s => s.blocks.flatMap(b => b.exercises.map(ex => [ex.id, s.id])))
);
