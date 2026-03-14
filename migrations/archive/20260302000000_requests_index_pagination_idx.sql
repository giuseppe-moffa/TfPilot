-- Index for cursor pagination: ORDER BY updated_at DESC, request_id DESC and WHERE (updated_at, request_id) < (...)
CREATE INDEX IF NOT EXISTS requests_index_updated_at_request_id_idx
ON requests_index (updated_at DESC, request_id DESC);
