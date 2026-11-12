-- Official tournament runs. One run per device and one per (lab, team, name).
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lab TEXT NOT NULL,
  name TEXT NOT NULL,
  team TEXT NOT NULL,
  device TEXT NOT NULL,
  params TEXT NOT NULL,
  points REAL NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_run_per_device ON submissions (lab, device);
CREATE UNIQUE INDEX IF NOT EXISTS one_run_per_name ON submissions (lab, team, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS by_lab_points ON submissions (lab, points DESC);

-- Timed class activities (checkpoints): one submission per device and exercise.
CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lab TEXT NOT NULL,
  exercise TEXT NOT NULL,
  name TEXT NOT NULL,
  team TEXT NOT NULL,
  device TEXT NOT NULL,
  score REAL NOT NULL,
  max REAL NOT NULL,
  answers TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_answer_per_device ON answers (lab, exercise, device);
CREATE INDEX IF NOT EXISTS answers_by_exercise ON answers (lab, exercise, score DESC);
