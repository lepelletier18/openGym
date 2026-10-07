# Importing and exporting data

Everything here lives in the app under **Settings → Data**, except plan sharing, which is on the
**Plan** screen.

| You want to | Use |
|---|---|
| Bring your workout history from another app | **Import from another app** (CSV) |
| Pull workouts, routines and weigh-ins from Hevy Pro | **Import from Hevy** (API key) |
| Bring body weight over from an iPhone | **Import from another app** with the Apple Health export |
| Give someone your routines | **Plan → Share your plan → Export plan file** |
| Bring in a plan written as text | **Plan → Share your plan → Import a plan file** with a [Markdown file](#a-plan-written-in-markdown) |
| Back up or move everything | **Export backup** / **Import backup** |

## Workout history from another app

Export a CSV from your old app, then pick it under **Settings → Data → Import from another app**.
openGym matches exercise names against its library; anything it doesn't recognise becomes one of
your own exercises, so nothing in the file is dropped. Days that already have a workout in openGym
are left alone, so importing the same file twice never duplicates anything.

These exports work without any editing:

| App | Where to export |
|---|---|
| FitNotes (Android) | Settings → Backup/Export → **Spreadsheet Export** |
| FitNotes 2 (iOS) | Export workouts as CSV |
| Strong | Settings → Export Data |
| Hevy | Profile → Settings → Export & Import Data |
| Gravl | Profile → Export Data |

Other files work too, as long as they have a date, an exercise name and something measured
(weight and reps, a time or a distance). See [your own CSV](#your-own-csv) below.

> [!NOTE]
> History is a log of what you did, so it's imported separately from your routines. Importing
> workouts doesn't create or change any plan.

## Hevy, directly

With **Hevy Pro** you can skip the CSV:

1. In Hevy, open [Settings → Developer](https://hevy.com/settings?developer) and create an API key.
2. In openGym, go to **Settings → Data → Import from Hevy** and paste the key. It's used for this
   import only and isn't saved.
3. Choose workouts, routines, weigh-ins or any mix, then confirm.

Routines always arrive as new plans; nothing you already have is overwritten.

## Body weight from Apple Health

In the Health app on your iPhone, tap your profile picture, then **Export All Health Data**. Unzip
the result and pick `export.xml` under **Import from another app**. The file is often hundreds of
megabytes; openGym reads only the body-weight records from it, in whatever unit each one was saved
in, and keeps one weigh-in per day. Days that already have a weigh-in are left alone.

A CSV with a date column and a weight column works the same way.

## Sharing a plan

On the **Plan** screen, tap the share icon:

- **Export plan file** writes your routines and weekly schedule to a small JSON file. It contains
  no workouts and no weigh-ins.
- **Import a plan file** adds someone else's plan to yours. It merges, so your own routines are
  never overwritten.
- **Print / Save as PDF** gives you a clean printout.

An export always contains every routine. To share only some of them, import the file into the
[demo](https://opengym.duarte-santos.ch/demo/), delete what you don't want, and export again. The
demo keeps everything in your browser; nothing is uploaded. The same trick works for building a plan
on a computer and then importing it into the phone app.

Writing the JSON plan file by hand is fiddly, because the exercise ids have to match the library.
Write the plan as a Markdown file instead, as described next.

### A plan written in Markdown

**Plan → share icon → Import a plan file** also takes a `.md` file, so a plan from a notes app, a
coach or an assistant can go straight in. See
[examples/beginner-kettlebell-plan.md](examples/beginner-kettlebell-plan.md) for a complete one.
It goes through the same checks and the same preview as a shared plan file, and is merged as new
routines, so nothing you already have is overwritten.

What it reads:

| In the file | Becomes |
|---|---|
| `# Title` | the plan's name |
| A heading (`##`, `###`) or a bold line (`**Day A**`) | the name of the routine that the next table or list belongs to |
| A table with an `Exercise` column and either `Sets x reps` or separate `Sets` and `Reps` columns | one exercise per row; optional `Weight`, `Rest` and `Notes` columns |
| A bullet list such as `- Goblet squat: 3 x 12` | the same, one exercise per bullet |
| A table with `Day` and `Session` columns | the weekly schedule (only the first one; later ones are ignored) |

Anything else (paragraphs, other tables, advice) is skipped, so a plan can carry its own notes.

How a cell is read:

- `3 x 12`, `3 × 8-10` and `3 x 8 to 10`: sets and reps. A range becomes a rep range.
- `3 x 30 sec` or `2 x 1 min`: a timed hold. In a schedule cell, `Run, 30 min easy` makes a cardio
  routine of that length.
- `3 x 8 per leg` (also `per arm`, `per side`, `each side`): per-side reps.
- `4 x 15 @ 16 kg` (or `lb`): a weight. A file in pounds is converted if your profile is in kilograms.
- `Halo + dead bug`: a superset.
- Words in brackets, and anything else it cannot turn into a number (`as many as you can`), become
  the exercise's note.

Exercise names are matched against the library. If the title says the plan is for one piece of
equipment ("... (one kettlebell)"), a name without equipment prefers that version, and never
settles for a barbell lift when there is no version for that equipment. A name that matches nothing
becomes one of your own exercises, and the import preview lists those, so you can swap them for a
library exercise afterwards.

## Backups

- **Export backup (JSON)** saves your whole profile as one file. **Export with photos & videos
  (.zip)** includes your media as well.
- **Import backup** restores such a file and *replaces* everything currently in the app.
- **Auto-backup on changes** (phone app only) saves a dated copy to `Documents/openGym` after each
  workout or routine edit and keeps the newest 14. Point a sync app at that folder to get them off
  the phone.

If you host openGym yourself, backing up the `./data` folder covers every profile at once; see
[backups](SELF_HOSTING.md#6-backups).

## Your own CSV

The smallest file that works:

```csv
workout name,exercise,date,weight kg,reps
Leg Day,Squat,2026-08-21,120,5
Leg Day,Squat,2026-08-21,125,4
Leg Day,Leg Press,2026-08-21,200,1
```

One row per set. Column names are matched ignoring case and punctuation; the first match wins.

| Field | Accepted headers |
|---|---|
| exercise | `exercise`, `exercise name`, `exercise title` |
| date | `date`, `workout date` |
| start time | `start time`, `start date` |
| end time | `end time` |
| workout name | `workout name`, `title`, `workout` |
| category | `category`, `body part`, `muscle group` |
| weight in kg | `weight kg` |
| weight in lb | `weight lbs`, `weight lb` |
| weight, unit in another column | `weight` |
| weight unit | `weight unit`, `unit` |
| reps | `reps`, `repetitions` |
| RPE | `rpe`, `rpe rating` |
| RIR | `rir`, `reps in reserve` |
| distance in km | `distance km` |
| distance, unit in another column | `distance` |
| distance unit | `distance unit` |
| duration in seconds | `seconds`, `duration seconds`, `set duration sec` |
| duration | `time`, `duration` |
| set type | `set type` |
| note | `comment`, `comments`, `notes`, `note`, `workout notes` |

## For developers

The CSV parser is `frontend/src/lib/import-csv.js`. The Hevy API import and a detected Hevy CSV
resolve exercises through the same generated lookup, `frontend/src/lib/hevy-id-map.js` (template id
for the API, English title for the CSV). To regenerate it, set `HEVY_API_KEY` in the environment or
`.env` and run `node scripts/build-hevy-id-map.mjs`. Localised (non-English) Hevy titles fall back
to name matching.
