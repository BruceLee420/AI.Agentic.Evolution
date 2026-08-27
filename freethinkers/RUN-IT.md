# Run It — your machine, your art, start to finish

Everything below has been tested end to end. Your files never leave your computer
except as finished uploads.

**Why local:** Drive is great for reading filenames — that's how the title/date
parser was built against your real names — but it can't move image bytes. A 6.5KB
signature came through 40% truncated; a 4MB master has no chance. So the pipeline
runs where your files already are.

---

## One-time setup (~5 minutes)

```bash
# 1. Get the code
git clone https://github.com/BruceLee420/AI.Agentic.Evolution.git
cd AI.Agentic.Evolution
git checkout claude/freethinkers-migration-art-protection-dkldow

# 2. Install the pipeline
cd freethinkers/scripts && npm install
```

## Point it at your art

If you have **Google Drive for Desktop**, `Art.Folder/1-Drop` is already a real
folder on your machine — use that path directly, no copying:

| OS | Typical path |
|---|---|
| macOS | `~/Library/CloudStorage/GoogleDrive-aagrimaldo@gmail.com/My Drive/Art.Folder/1-Drop` |
| Windows | `G:\My Drive\Art.Folder\1-Drop` |

No Drive Desktop? Just download the folder and point at wherever it landed.

---

## The run

```bash
cd freethinkers/scripts

# Set these two to your actual paths
DROP="/path/to/Art.Folder/1-Drop"
SIG="/path/to/Art.Folder/1-Drop/Signature.png"

# 1. Ingest — titles, dates, signature, fingerprint, masters, catalog
node ingest.mjs "$DROP" --signature "$SIG" --artist "Adrian A. Grimaldo" --limit 5

# 2. Score — visual-impact ranking as a starting order
node score.mjs

# 3. Share cards for every piece
node make-og-images.mjs --previews ./out/previews
```

That's it. Expect roughly:

```
180 processed · 180 in catalog · 180 live on the site
N exact duplicate(s) found by content hash — skipped, not deleted
N date(s) I could not read cleanly — check the date and day columns
```

### Then read the two lists it prints

**Duplicates** — marked, never deleted. `SPACESUIT.3` and `FEAR` and `LOVE` each
appear more than once in your folder. Clear the `dupe` column in `catalog.csv` to
force one through.

**Unreadable dates** — these four need your call, because a wrong date on a
"one piece per day" project is worse than a flagged one:

| File | Problem |
|---|---|
| `SAVE.US_2026-06-0` | day 0 |
| `SATELITE_2026-04-44` | day 44 |
| `WAR_2026-03-36` | day 36 |
| `arttest.jpg` | no date — looks like a test file |

Fix the `date` and `day` columns in `catalog.csv`, or move those files to
`3-Needs-Review` and re-drop them renamed. Then rerun `ingest.mjs` — your edits
are always preserved.

---

## Descriptions and running order

```bash
# Descriptions: open in Excel/Sheets, fill the `description` column, save
open catalog.csv

# Arrange by eye — drag tiles, hit Save, it writes the `order` column
node curate.mjs        # → http://localhost:4321

# Republish after any edit
node ingest.mjs "$DROP" --signature "$SIG"
```

`order` always beats `score`. The machine's ranking is a starting point; your
hand is the final word and nothing overwrites it.

## See it

```bash
cd ../site && npm install && npm run dev     # → http://localhost:4321
```

Your pieces, your signature, your day counter, your 365 grid.

---

## What the run produces

```
scripts/
├── catalog.csv          your editable source of truth
└── out/
    ├── previews/        1080p, signed + dated, fingerprinted → public bucket
    └── masters/         full resolution, untouched pixels   → private bucket
```

Previews are what the world sees. **Masters never touch the website** — they go to
the private bucket and reach a buyer only through an expiring signed link.

## Print files, when you get to Print

```bash
node upscale.mjs ./out/masters ./out/print --size 18x24
```

Lanczos to true print dimensions, and it reports real source DPI so you know which
pieces are being stretched too far to fix by resampling.

---

## If something looks wrong

The signature is the one thing worth checking on the first piece before you run all
180. Open `out/previews/FT-2026-001.png` and look at the bottom-right.

```bash
# Bigger / smaller (default 0.22 = 22% of image width)
node ingest.mjs "$DROP" --signature "$SIG" --signature-width 0.30 --force

# Hard to read on light artwork? Flip the ink to black
node ingest.mjs "$DROP" --signature "$SIG" --signature-color "#000000" --force

# Yours already has clean transparency, so skip the paper-keying entirely
node ingest.mjs "$DROP" --signature "$SIG" --signature-keep-bg --force

# Sitting too close to the edge
node ingest.mjs "$DROP" --signature "$SIG" --signature-margin 48 --force
```

`--force` reprocesses images already marked done. Without it, reruns skip finished
work — which is what makes running this repeatedly cheap.

## Start with 5

`--limit 5` processes the first five and stops. No copying, no scratch folder.
Look at `out/previews/`, tune the signature if you want, then rerun **without**
`--limit` — it picks up the remaining 175 and skips the five already done.

Your `Signature.png` lives in `1-Drop` alongside the art; ingest excludes it
automatically, so it never becomes a piece.
