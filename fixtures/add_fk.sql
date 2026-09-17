-- ADD FOREIGN KEY without NOT VALID
ALTER TABLE sessions
  ADD FOREIGN KEY (account_id)
  REFERENCES accounts(id);

