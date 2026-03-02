-- Index for cursor pagination: ORDER BY COALESCE(last_activity_at, updated_at) DESC, request_id DESC
CREATE INDEX IF NOT EXISTS requests_index_last_activity_sort_idx
ON requests_index ((COALESCE(last_activity_at, updated_at)) DESC, request_id DESC);
