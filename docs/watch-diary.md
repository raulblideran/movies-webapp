# Watch diary: one record per watch

Status: **built on 2026-11-01**, in a simpler form than the proposal below. Each watch (`Data/Watch.cs`) has a
date (or none), notes, "in the cinema" and "with Bogdan". There's no date precision and no per-watch rating.
The title's first/latest watch, count, Bogdan and cinema fields stay as a summary, worked out again whenever its
watches change (`WatchSummary.Apply`), so the cards, filters and the CSV export read them as before.

The `Watches` migration seeded every title's watches from its old summary (`WatchSummary.FromSummary`, run by
`Startup.MigrateAsync`). It follows the rules below, plus:

- A count of 1 with two different dates is one watch on the first date. Its notes keep the other date.
- A title with dates but a count of 0 still gets its dated watch.
- "In the cinema" goes on the first watch.
- A "with Bogdan" date with no room left in the count becomes a watch of its own.

Undated watches are dated by hand, from the title popup, the edit form or the Watches page (`/watches`).

The proposal as it was written follows.

## The idea

At the moment each title stores a summary of its viewings: `FirstWatch`, `LatestWatch` and `WatchCount`, plus
`WithBogdan` and `DateWithBogdan`. A watch diary would store **every viewing as its own entry**:

| Field | |
|---|---|
| `TitleId` | the title watched |
| `Date` | the day, or null when it isn't known |
| `DatePrecision` | `Day`, `Month` (the old sheet's month-only dates) or `Unknown` |
| `WithBogdan` | watched together |
| `Note` | optional ("cinema", "on the plane", "fell asleep"…) |
| `Rating` | optional: what it scored that time, so a rating can change over the years |

The title's current fields would then be worked out from its entries: first watch, latest watch, count, and
watched with Bogdan.

## The problem: past watches can't be dated

Most of the watch history happened before anything was tracked. For a title watched 5 times, all we know is:

- the **first** watch date (and for sheet imports, often only the month: the import picked a random day)
- the **latest** watch date
- the **count**

The 3 watches in between have no date, and for long-loved films there's no way to recover them. **We shouldn't
guess.** A made-up date would make every per-year number look precise when it isn't.

## How existing data would be seeded (no guessing)

For each title, one migration would create:

1. **One dated entry for the first watch**, at its precision: `Day` for titles added on the site, `Month` for the
   imported dates whose day was randomised.
2. **One dated entry for the latest watch**, if it's on a different day from the first.
3. **The rest as undated entries** (`Date = null`, `DatePrecision = Unknown`): `WatchCount − 2` of them, or
   `WatchCount − 1` when first and latest are the same day.
4. **With Bogdan**: if `DateWithBogdan` matches one of the dated entries, that entry gets `WithBogdan = true`.
   Otherwise it's one more dated entry, if the count allows; if not, it's flagged for review.

Example: Spirited Away, first watch 03/2015, latest 12/08/2025, 5 watches. That seeds:

- March 2015 (month only)
- 12 Aug 2025
- 3 watches with no date

No information is lost and nothing is invented. The popup's history would show the undated watches as
**"3 earlier watches, dates unknown"** between the two dated points.

## What changes for stats

- **Totals stay exact.** Watch counts, rewatches and "seen N times" count every entry, dated or not.
- **Per-year and per-month charts only use dated entries.** They're exact from the day the diary starts, and as
  approximate as today's first/latest dates before that. The page would say so ("1,203 watches, 389 of them
  dated").
- **Things that become possible:**
  - "On this day" (watched a year ago, five years ago…)
  - real rewatch gaps (how long between viewings)
  - rating changes over time
  - accurate "watched in 2027" totals
  - a proper Year in review for every year after the switch-over

## What changes in the UI

- **"Watched again"** adds an entry dated today (optionally changing the date, who with, a note), instead of
  bumping a counter.
- **The popup's watch history** lists the entries, with the undated ones grouped as above. An editor can date
  any undated entry later if they remember it (e.g. "it was the Christmas we went to Dublin").
- **Mark as watched** (watchlist → Watchlog) adds the first diary entry.
- **The edit form** loses the First watch, Latest watch and Watch count fields. They become read-only,
  worked out from the diary, with a "Diary" list to add, edit or remove entries.
- **The CSV export** keeps its sheet format by writing out the worked-out first/latest/count.

## Data model sketch

```csharp
public enum DatePrecision { Day, Month, Unknown }

public class Viewing : ITimestamped
{
    public int Id { get; set; }
    public int TitleId { get; set; }
    public Title Title { get; set; } = null!;
    public DateOnly? Date { get; set; }
    public DatePrecision DatePrecision { get; set; }
    public bool WithBogdan { get; set; }
    public decimal? Rating { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
```

`Title.FirstWatch`, `LatestWatch`, `WatchCount`, `WithBogdan` and `DateWithBogdan` would either be dropped
(and worked out in queries), or kept as a cache updated on every diary change. Keeping them as a cache is less
work, because Stats, the cards and the export keep reading the same fields.

## Rough effort

About one phase of work:

- migration and seeding
- `Viewing` endpoints
- the popup history
- the diary list on the edit form
- "Watched again" and "Mark as watched" adding entries
- stats reading dated entries
- tests

## Open questions

- Keep a per-viewing rating, or keep one rating per title (as now)?
- Should the imported month-only dates show as "March 2015", or keep their randomised day as today?
- Should undated watches be listed one by one, or always grouped?
