# Drop art here

Name the file what you want the piece called:

    JESUS GOT GAME.png
    THE ANCIENT.png

Drop your **high-resolution originals** here — not 1080p versions. The pipeline
makes the 1080p signed preview from the original, and keeps the original as the
master your buyers get at checkout.

Then run, from `../scripts`:

    node ingest.mjs ../art-drop --signature ../signature.png

Descriptions go in `catalog.csv` (open it in Excel or Google Sheets). Fill them
in, save, rerun the same command — your edits are always kept.
