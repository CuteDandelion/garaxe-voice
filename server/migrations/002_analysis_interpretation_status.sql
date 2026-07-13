-- Allow analysis runs to remain non-curatable while default LLM interpretation settles.
ALTER TABLE public.analysis_runs
  DROP CONSTRAINT IF EXISTS analysis_runs_status_check;

ALTER TABLE public.analysis_runs
  ADD CONSTRAINT analysis_runs_status_check
  CHECK (status IN ('queued', 'assembling_dataset', 'preprocessing', 'interpreting_clusters', 'completed', 'failed'));
