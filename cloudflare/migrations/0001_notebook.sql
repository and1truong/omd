CREATE TABLE notebook (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  metadata TEXT NOT NULL,
  revision INTEGER NOT NULL,
  token TEXT NOT NULL
);
CREATE TABLE records (
  page_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
  part INTEGER NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(page_id, kind, id, part)
);
CREATE TABLE history (
  session TEXT NOT NULL, id TEXT NOT NULL, owner TEXT NOT NULL,
  part INTEGER NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(session, id, part)
);
CREATE TABLE delivery (
  notebook_id TEXT NOT NULL, page_id TEXT NOT NULL, block_id TEXT NOT NULL,
  due_at TEXT NOT NULL, fired_at TEXT NOT NULL,
  PRIMARY KEY(notebook_id, page_id, block_id, due_at)
);
CREATE TABLE bridge_receipts (
  notebook_id TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(notebook_id, key)
);
CREATE TABLE commit_receipts (
  id TEXT NOT NULL, part INTEGER NOT NULL, digest TEXT NOT NULL,
  payload TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(id, part)
);
CREATE INDEX history_age ON history(created_at);
CREATE INDEX commit_receipts_age ON commit_receipts(created_at);
