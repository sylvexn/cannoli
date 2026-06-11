-- Per-user IANA timezone for display formatting. NULL means "use the
-- browser-detected zone"; setting a value pins the zone across devices.
-- Display-only; storage everywhere else stays ISO/UTC.
--
-- Numbered 0027 to leave room for 0026_roster_nickname being added in a
-- parallel branch (avoids a collision when both merge into master).
ALTER TABLE `user_preferences` ADD `timezone` text;
