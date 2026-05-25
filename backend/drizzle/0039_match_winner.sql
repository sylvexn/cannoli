ALTER TABLE `matches` ADD `winner_team_id` text REFERENCES teams(id);
