-- TZ-DEADLINE: store a canonical timezone per league as the deadline cutoff
-- anchor. The auto-forfeit job computes a match's effective deadline as
-- end-of-day IN THIS ZONE (rather than hard-coded UTC 'Z'), so a match's
-- displayed deadline and its enforced cutoff agree regardless of where the
-- coach or the server sits. Default 'America/New_York' (the league's home TZ).
-- Per-user display labeling is a frontend concern (the API exposes this field).
ALTER TABLE `leagues` ADD `timezone` text DEFAULT 'America/New_York' NOT NULL;
