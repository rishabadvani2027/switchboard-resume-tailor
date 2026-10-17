update storage.buckets
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[]
where id = 'private-documents';
