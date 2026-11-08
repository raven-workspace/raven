-- Which Payloads-drawer payload a command entry came from, and the LHOST/LPORT it was built with (JSON).
-- Additive: existing rows keep NULL in both.
ALTER TABLE log_entries ADD COLUMN payload_id TEXT;
ALTER TABLE log_entries ADD COLUMN payload_values TEXT;
