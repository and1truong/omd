-- Existing rows remain NULL and use the compatible block-only reminder fallback.
-- New and edited records store their type without parsing incomplete JSON parts.
ALTER TABLE records ADD COLUMN block_type TEXT;
CREATE INDEX records_block_type ON records(kind, block_type, page_id, id, part);
