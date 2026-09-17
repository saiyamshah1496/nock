-- ADD FOREIGN KEY with NOT VALID then VALIDATE
ALTER TABLE sessions
  ADD CONSTRAINT sessions_account_fk
  FOREIGN KEY (account_id)
  REFERENCES accounts(id)
  NOT VALID;
ALTER TABLE sessions VALIDATE CONSTRAINT sessions_account_fk;

