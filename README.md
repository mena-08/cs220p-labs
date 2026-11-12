# CS220P labs

Two Cloudflare Pages projects:

| Project | URL | Content |
|---|---|---|
| `cs220p-labs` | https://cs220p-labs.pages.dev | The labs (one shared version for TA and students), the live leaderboard, and the tournament API (`functions/`, D1 database `cs220p-tournament`). |
| `cs220p-ta` | https://cs220p-ta.pages.dev | The TA run sheet with teaching notes. Protected by Cloudflare Access. |

## Layout

- `cs220p_site/`: sources. `lab.js` and `lab.css` are the shared framework; `labN.html` hold each lab, including its teaching notes (`ask:`), which the build removes from the public pages; `index.html`, `leaderboard.html`.
- `server/official.json`: the hidden official tournament seeds. They are compiled into the server only and never reach a page.
- `server/schema.sql`: the D1 table for official runs.
- `functions/`: the tournament API (`/api/submit`, `/api/leaderboard`, `/api/admin`). `functions/_generated/` is written by the build.
- `runsheet_template.html`: the TA run sheet; the build fills in the lab data.
- `build.mjs`: builds `dist/`, `dist_ta/` and `functions/_generated/labs.js`.

## Build and deploy

```
node build.mjs
npx wrangler pages deploy                          # public site + API (reads wrangler.toml)
(cd dist_ta && npx wrangler pages deploy . --project-name cs220p-ta --branch main)
```

The build stops with an error if teaching notes or official seeds would end up in a public page, if a lab has no tournament spec, or if an official run is too slow for the server (60 ms; labs marked `precompute: true` get a score table instead).

## Tournament

- Students press **Official run** once. The server checks the settings, scores them on the hidden seeds, and stores the run. One run per device and one per name within a team.
- Project https://cs220p-labs.pages.dev/leaderboard.html; it refreshes every 4 seconds.
- To delete a run (the student can then submit again) or reset a whole lab, open **Admin (TA)** at the bottom of the leaderboard and enter the admin token. The token is in `.dev.vars` (keep it private). Change it with `npx wrangler pages secret put ADMIN_TOKEN --project-name cs220p-labs`.

## Class activities (timed checkpoints)

- A step can hold a timed activity (`Lab.checkpoint`, e.g. lab 2 step 5 "Hand-run challenge", 5 minutes). Students press **Start**, work, then **Submit my answers** with name and team; one submission per device (`/api/answers`, table `answers`).
- Live class results: https://cs220p-labs.pages.dev/activity.html#L2/byhand (`#<lab>/<activity id>`; the checkpoint bar links to it). Shows submissions, average, score distribution, how the class answered each question, and the names.
- **Admin (TA)** at the bottom of that page (same token) deletes one submission or resets the activity.
- Submitted quizzes (`Lab.quiz(items, { submit: {lab, id} })`, e.g. lab 1 step 2 `L1/properties`, lab 2 step 2 `L2/reportcard`): name and team on top, no feedback until Submit, then verdicts and score; once per device. The time taken (first answer to submit) is stored as `answers._seconds` and shown as "Time taken". Activities listed in `PRIVATE` (`functions/api/answers.js`) are only readable with the admin token: unlock **Admin (TA)** on the leaderboard to see them under **Class activities** (all activities are listed there, with delete buttons).

## Local testing

```
node build.mjs
npx wrangler d1 execute cs220p-tournament --local --file server/schema.sql
npx wrangler pages dev --port 8790
```
