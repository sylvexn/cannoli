-- One-time auto-fill latch for league weekDates.
--
-- When an admin sets week 1 in the season-schedule editor and weeks 2..N are
-- still empty, the UI populates them as week1 + (n-1)*7 days. That auto-fill
-- only runs ONCE per league: as soon as it runs (or as soon as the admin
-- manually edits any week), this flag flips to 1 and subsequent edits to
-- week 1 leave the rest alone. Stops the editor from clobbering hand-tuned
-- schedules every time week 1 is re-saved.
--
-- Existing leagues that already have a weekDates blob are pre-marked auto-
-- filled so the legacy data isn't retroactively overwritten on first edit.
ALTER TABLE `leagues` ADD `week_dates_auto_filled` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `leagues` SET `week_dates_auto_filled` = 1
  WHERE `week_dates` IS NOT NULL
    AND TRIM(COALESCE(`week_dates`, '')) NOT IN ('', '{}', 'null');
