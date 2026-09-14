CREATE TABLE public.invoices (
  invoice_id TEXT PRIMARY KEY,
  retailer TEXT NOT NULL,
  product TEXT NOT NULL,
  units_shipped INTEGER NOT NULL,
  price_per_unit DECIMAL(10,2) NOT NULL,
  invoice_date DATE NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access on invoices" ON public.invoices FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public insert access on invoices" ON public.invoices FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Public update access on invoices" ON public.invoices FOR UPDATE TO anon, authenticated USING (true);
CREATE POLICY "Public delete access on invoices" ON public.invoices FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE public.deduction_claims (
  claim_id TEXT PRIMARY KEY,
  invoice_id TEXT REFERENCES public.invoices(invoice_id),
  retailer TEXT NOT NULL,
  reason TEXT NOT NULL,
  claimed_amount DECIMAL(10,2) NOT NULL,
  status TEXT DEFAULT 'open'
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deduction_claims TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deduction_claims TO authenticated;
GRANT ALL ON public.deduction_claims TO service_role;

ALTER TABLE public.deduction_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access on deduction_claims" ON public.deduction_claims FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public insert access on deduction_claims" ON public.deduction_claims FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Public update access on deduction_claims" ON public.deduction_claims FOR UPDATE TO anon, authenticated USING (true);
CREATE POLICY "Public delete access on deduction_claims" ON public.deduction_claims FOR DELETE TO anon, authenticated USING (true);