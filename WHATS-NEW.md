# What's new on the Watchlog

Changes to [movies.raulblideran.uk](https://movies.raulblideran.uk) from 27 October to 1 November 2026, newest first.

## Sunday 1 November: every watch counts

Commit `cf3c99b`

- **Every viewing is its own record.** Each watch has a date (or "date unknown"), notes, and whether it was at the cinema or with Bogdan. A rewatch no longer overwrites the earlier date.
- **The old data moved over without guessing.** The first and latest watches kept their dates, and the rest became "date unknown", to fill in later. That made 388 watches.
- **Watch history in the title popup**, with Bogdan's watches in purple. Signed in, you can click a watch to change or delete it, or add a new one.
- **"Watched again"** opens a dialog dated today (add Bogdan, the cinema or a note), with Undo afterwards.
- **The edit form** lists every watch, instead of the first/latest/count fields.
- **The Watches page** (`/watches`, for editors): every watch in one table, to filter by title, year, Bogdan, cinema or notes, fix dates, or delete.
- **A dot per watch on every card**: hollow when the date isn't known, purple with Bogdan.
- **Person pages** (`/people/…`): names in the credits are links. Each page shows the person's films in the collection with ratings and watches, what they have coming out, and their best-known work not seen yet.
- **You vs the crowd**: TMDB users' score sits next to your rating, plus a Stats section on the biggest disagreements. On average I rate 1.8 points above TMDB.
- **Coming soon** on the Watchlist: the next films in franchises already started, and new films from the directors watched most, e.g. Shrek 5, A Quiet Place Part III, Gremlins 3.
- **Language and country** for each title, as filters and a Stats section: 10 languages and 17 countries so far.
- **Your own tags** (e.g. #Christmas): a filter, and links in the popup.
- **A yearly goal** on Stats, with progress and pace.
- **Watches per year** chart (first watches vs rewatches). Year in review now counts real watches.
- **Filters:**
  - sort by release year
  - filter by decade, language, tags, and times watched (one option per count in the collection)
  - a "Clear filters" button
- **Bigger posters in the popup on a computer.** The popup is never taller than the poster, and long text scrolls inside its column.
- **Behind the scenes:**
  - a tool to fill in missing release years (and matching posters) from TMDB
  - the database change was rehearsed on a copy of the live data before going out

## Saturday 31 October: the Watchlist arrives

Commits `ffa8db1` `73968e2` `d841ad8` `09b4342` `dcdefa0` `e0ecc9e` `b67a4d5` `fc6791c` `7f21b6f`

- **Watchlist page** for things still to watch. "Mark as watched" moves a title to the Watchlog and keeps its discs and history.
- **TMDB details on every title**: runtime, synopsis, trailer, directors and cast, refreshed automatically.
- **People on Stats**: the most-watched directors and actors.
- **Franchise progress** in the popup (e.g. "3 of 3 watched"), with missing films one click from the watchlist.
- **Pick for me**: a strip of posters spins and lands on something to watch.
- **Year in review**: a Stats tab summing up any year (new titles, rewatches, screen time, average rating, favourites, watchlist), each against the year before.
- **Shareable views**: search, sort and filters stay in the link.
- **No lost edits**: closing a form with unsaved changes asks first.
- **Themed confirmation dialogs** instead of the browser's own pop-ups.
- **Filter by length**, and sort shortest or longest first.

## Tuesday 27 October: cinema nights

Commits `0751fe6` `b3312f1` `522c03b` `8e5eee8` `f0dc014`

- **"Watched in cinema"** flag, with its own tag, filter, table column and CSV column.
- **One TMDB search in the add form**: type a title or paste a TMDB link, pick a result, and the form fills itself in (genres are suggested).
- **Tidier data**: text is trimmed on save, however it came in.
- **Older spreadsheets still import**, with or without the cinema column.

## In numbers

- 15 commits over 3 releases
- 65 files changed: 11,382 lines added, 2,129 removed
- 91 automated tests, up from 76
- Built with .NET 10, SQLite and plain JavaScript. Every push to main deploys itself.
