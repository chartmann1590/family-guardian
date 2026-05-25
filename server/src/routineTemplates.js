export const ROUTINE_TEMPLATES = [
  {
    id: 'school-day',
    title: 'School day',
    description: 'Weekday school arrival + pickup',
    needsPlace: 'school',
    items: [
      { kind: 'arrival',   daysOfWeek: [1,2,3,4,5], expectedMinute: 8 * 60 + 15, toleranceMinutes: 15 },
      { kind: 'departure', daysOfWeek: [1,2,3,4,5], expectedMinute: 15 * 60,     toleranceMinutes: 20 },
    ],
  },
  {
    id: 'work-commute',
    title: 'Work commute (weekday)',
    description: 'Weekday work arrival + departure',
    needsPlace: 'work',
    items: [
      { kind: 'arrival',   daysOfWeek: [1,2,3,4,5], expectedMinute: 9 * 60,      toleranceMinutes: 20 },
      { kind: 'departure', daysOfWeek: [1,2,3,4,5], expectedMinute: 17 * 60 + 30, toleranceMinutes: 30 },
    ],
  },
  {
    id: 'after-school-home',
    title: 'After-school return',
    description: 'Weekday home arrival after school',
    needsPlace: 'home',
    items: [
      { kind: 'arrival', daysOfWeek: [1,2,3,4,5], expectedMinute: 15 * 60 + 30, toleranceMinutes: 30 },
    ],
  },
  {
    id: 'weekend-church',
    title: 'Weekend service',
    description: 'Sunday morning arrival at a place of worship',
    needsPlace: null,
    items: [
      { kind: 'arrival', daysOfWeek: [0],         expectedMinute: 10 * 60,      toleranceMinutes: 20 },
    ],
  },
  {
    id: 'night-curfew-home',
    title: 'Nightly home-by',
    description: 'Be home by curfew (weeknights)',
    needsPlace: 'home',
    items: [
      { kind: 'arrival', daysOfWeek: [0,1,2,3,4], expectedMinute: 21 * 60,      toleranceMinutes: 30 },
    ],
  },
];
