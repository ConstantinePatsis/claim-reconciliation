CREATE TABLE public.extraction_reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  file_name TEXT NOT NULL,
  field TEXT NOT NULL,
  extracted_value TEXT,
  final_value TEXT,
  was_corrected BOOLEAN NOT NULL
);

GRANT SELECT, INSERT ON public.extraction_reviews TO anon;
GRANT SELECT, INSERT ON public.extraction_reviews TO authenticated;
GRANT ALL ON public.extraction_reviews TO service_role;

ALTER TABLE public.extraction_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access on extraction_reviews" ON public.extraction_reviews FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public insert access on extraction_reviews" ON public.extraction_reviews FOR INSERT TO anon, authenticated WITH CHECK (true);
