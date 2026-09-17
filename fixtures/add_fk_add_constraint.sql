-- ADD CONSTRAINT name FOREIGN KEY without NOT VALID
ALTER TABLE sessions
  ADD CONSTRAINT fk_sessions_accounts
  FOREIGN KEY (account_id)
  REFERENCES accounts(id);

