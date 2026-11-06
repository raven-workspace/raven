-- The last Field-Manual import: one row, replaced whole on each import. `snapshot` is JSON
-- ({ cards, commands, playbook, toolkit, report }); the imported layer of the command library.
CREATE TABLE field_manual (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  imported_at INTEGER NOT NULL,
  snapshot TEXT NOT NULL
);
