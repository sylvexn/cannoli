-- CHANGELOG: per-user "last opened the What's New panel" timestamp. Drives the
-- pulsing bell in the sidebar footer — entries in changelog.json dated after
-- this value are "unread". Null = never opened (everything unread).
ALTER TABLE `user_preferences` ADD `changelog_seen_at` text;
