-- Create "users" table
CREATE TABLE `users` (
  `id` text NOT NULL,
  `name` text NOT NULL,
  `email` text NOT NULL,
  `password_hash` text NOT NULL,
  `created_at` datetime NULL,
  `updated_at` datetime NULL,
  PRIMARY KEY (`id`)
);
-- Create index "uni_users_email" to table: "users"
CREATE UNIQUE INDEX `uni_users_email` ON `users` (`email`);
