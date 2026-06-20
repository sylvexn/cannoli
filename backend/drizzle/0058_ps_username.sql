-- User-chosen Showdown username. When set, it overrides `username` as the
-- PS userid shown in battles and chat (e.g. PPG, SSS, EGD). NULL falls back
-- to `username`. The stored value is the raw display form; it is normalized
-- via toUserid() (lowercase, strip non-alnum) before PS assertion signing.
-- Max 18 chars after normalization (PS userid length limit), enforced at
-- the API layer.
ALTER TABLE `users` ADD `ps_username` text;
