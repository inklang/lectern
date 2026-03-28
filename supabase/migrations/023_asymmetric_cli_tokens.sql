-- Migrate cli_tokens from symmetric hash to asymmetric public keys.
-- Drop old token_hash column; add key_id + public_key.
-- key_id: first 32 hex chars of SHA-256(public_key DER)
-- public_key: Ed25519 SPKI DER base64

alter table cli_tokens
  drop column if exists token_hash,
  add column if not exists key_id    text unique not null default '',
  add column if not exists public_key text not null default '';

-- Remove the bootstrap defaults now that the columns exist
alter table cli_tokens
  alter column key_id    drop default,
  alter column public_key drop default;

create index if not exists cli_tokens_key_id_idx on cli_tokens (key_id);

-- Allow anon reads of public keys (public keys are not secret)
create policy "anon read cli_tokens public_key"
  on cli_tokens for select
  using (true);
