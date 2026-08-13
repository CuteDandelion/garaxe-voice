-- Local migration draft for private Supabase Storage. Do not apply until the
-- Voice Lab project, policies, dedicated API role, and rollback are approved.
CREATE TABLE IF NOT EXISTS public.artifact_objects (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  import_job_id UUID REFERENCES public.import_jobs(id) ON DELETE SET NULL,
  report_id UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES public.auth_users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('csv', 'pdf')),
  bucket_id TEXT NOT NULL CHECK (bucket_id IN ('voice-lab-uploads', 'voice-lab-reports')),
  object_path TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.artifact_deletion_queue (
  id UUID PRIMARY KEY,
  artifact_object_id UUID NOT NULL UNIQUE REFERENCES public.artifact_objects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'deleted', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS artifact_objects_project_created_idx ON public.artifact_objects(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS artifact_deletion_queue_status_idx ON public.artifact_deletion_queue(status, scheduled_at);

ALTER TABLE public.artifact_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artifact_objects FORCE ROW LEVEL SECURITY;
ALTER TABLE public.artifact_deletion_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artifact_deletion_queue FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS artifact_objects_api_access ON public.artifact_objects;
CREATE POLICY artifact_objects_api_access ON public.artifact_objects TO voice_lab_api
  USING (public.app_can_access_org(organization_id))
  WITH CHECK (public.app_can_access_org(organization_id) AND created_by = public.app_current_user_id());

DROP POLICY IF EXISTS artifact_deletion_queue_api_access ON public.artifact_deletion_queue;
CREATE POLICY artifact_deletion_queue_api_access ON public.artifact_deletion_queue TO voice_lab_api
  USING (EXISTS (
    SELECT 1 FROM public.artifact_objects artifact
    WHERE artifact.id = artifact_object_id AND public.app_can_access_org(artifact.organization_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.artifact_objects artifact
    WHERE artifact.id = artifact_object_id AND public.app_can_access_org(artifact.organization_id)
  ));

REVOKE ALL ON public.artifact_objects, public.artifact_deletion_queue FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.artifact_objects, public.artifact_deletion_queue TO voice_lab_api;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('voice-lab-uploads', 'voice-lab-uploads', false, 20971520, ARRAY['text/csv','application/csv','application/vnd.ms-excel'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('voice-lab-reports', 'voice-lab-reports', false, 26214400, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.voice_lab_can_access_storage_object(target_bucket_id TEXT, object_name TEXT, require_write BOOLEAN)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships membership
    JOIN public.project_organizations project_scope
      ON project_scope.organization_id = membership.organization_id
    WHERE membership.user_id = (SELECT auth.uid())
      AND membership.organization_id::text = split_part(object_name, '/', 1)
      AND project_scope.project_id::text = split_part(object_name, '/', 2)
      AND (
        (target_bucket_id = 'voice-lab-uploads' AND split_part(object_name, '/', 3) = 'imports')
        OR (target_bucket_id = 'voice-lab-reports' AND split_part(object_name, '/', 3) = 'reports')
      )
      AND (NOT require_write OR membership.role IN ('owner', 'admin', 'analyst'))
  );
$$;

REVOKE ALL ON FUNCTION private.voice_lab_can_access_storage_object(TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.voice_lab_can_access_storage_object(TEXT, TEXT, BOOLEAN) TO authenticated;

DROP POLICY IF EXISTS voice_lab_storage_object_read ON storage.objects;
CREATE POLICY voice_lab_storage_object_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('voice-lab-uploads', 'voice-lab-reports')
    AND private.voice_lab_can_access_storage_object(bucket_id, name, false));

DROP POLICY IF EXISTS voice_lab_storage_object_insert ON storage.objects;
CREATE POLICY voice_lab_storage_object_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('voice-lab-uploads', 'voice-lab-reports')
    AND private.voice_lab_can_access_storage_object(bucket_id, name, true));

DROP POLICY IF EXISTS voice_lab_storage_object_update ON storage.objects;
CREATE POLICY voice_lab_storage_object_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('voice-lab-uploads', 'voice-lab-reports')
    AND private.voice_lab_can_access_storage_object(bucket_id, name, true))
  WITH CHECK (bucket_id IN ('voice-lab-uploads', 'voice-lab-reports')
    AND private.voice_lab_can_access_storage_object(bucket_id, name, true));

DROP POLICY IF EXISTS voice_lab_storage_object_delete ON storage.objects;
CREATE POLICY voice_lab_storage_object_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('voice-lab-uploads', 'voice-lab-reports')
    AND private.voice_lab_can_access_storage_object(bucket_id, name, true));
