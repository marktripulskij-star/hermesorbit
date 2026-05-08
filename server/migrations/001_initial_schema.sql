-- Ultemir initial schema — Phase 1
-- Apply via Supabase Dashboard → SQL Editor → New Query → paste this whole file → Run.

-- ──────────────────────────────────────────────────────────────────────────
-- Tables
-- ──────────────────────────────────────────────────────────────────────────

-- Profiles extend auth.users with app-specific fields.
-- Auto-created on signup via trigger below.
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',           -- 'free' | 'starter' | 'pro' | 'scale'
  credits_remaining INT NOT NULL DEFAULT 30,
  credits_reset_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- A user has many projects (brands).
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,                          -- URL-safe identifier per user
  brand_name TEXT,
  brand_brief JSONB,                           -- the structured brief
  website_content JSONB,                       -- scraped multi-page content + Shopify catalog
  manual_offers TEXT[] DEFAULT '{}',
  brand_colors JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, slug)
);

CREATE INDEX IF NOT EXISTS projects_user_idx ON public.projects(user_id);

-- Documents uploaded per project (PDFs, brand guides).
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  storage_path TEXT,                           -- Supabase Storage path
  extracted_text TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS documents_project_idx ON public.documents(project_id);

-- Brand images (logo, product, lifestyle).
CREATE TABLE IF NOT EXISTS public.brand_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('logo', 'product', 'lifestyle')),
  storage_path TEXT,                           -- Supabase Storage path
  data_url TEXT,                               -- inline data URL (kept for reference passing)
  higgsfield_url TEXT,                         -- public URL on Higgsfield (for image gen reference)
  colors JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS brand_images_project_idx ON public.brand_images(project_id);

-- 20 angles per project.
CREATE TABLE IF NOT EXISTS public.angles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  ordinal INT NOT NULL,                        -- 1..20 numbering
  avatar TEXT,
  desire TEXT,
  pain TEXT,
  hook_direction TEXT,
  insight_line TEXT,
  funnel_stage TEXT NOT NULL CHECK (funnel_stage IN ('tofu', 'mofu', 'bofu')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, ordinal)
);

CREATE INDEX IF NOT EXISTS angles_project_idx ON public.angles(project_id);

-- Generated ads.
CREATE TABLE IF NOT EXISTS public.ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  angle_id UUID NOT NULL REFERENCES public.angles(id) ON DELETE CASCADE,
  format_id TEXT NOT NULL,                     -- e.g. 'confession', 'deal_stack'
  headline TEXT,
  primary_text TEXT,
  description TEXT,
  cta_button TEXT,
  image_prompt TEXT,
  image_url TEXT,
  image_size TEXT DEFAULT '1024x1024',
  image_quality TEXT DEFAULT 'medium',
  image_error TEXT,
  scores JSONB,                                -- {hook:1-10, mechanism, voice, cta}
  critique TEXT,
  chosen_hook TEXT,
  starred BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ads_project_idx ON public.ads(project_id);
CREATE INDEX IF NOT EXISTS ads_angle_idx ON public.ads(angle_id);
CREATE INDEX IF NOT EXISTS ads_starred_idx ON public.ads(starred) WHERE starred = TRUE;

-- Append-only credit ledger.
CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  action TEXT NOT NULL,                        -- 'brand-brief', 'angles', 'copy', 'image-medium', etc.
  credits_used INT NOT NULL,
  real_cost_usd NUMERIC(10, 6),
  metadata JSONB,                              -- ad_id, model, tokens, etc.
  ts TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS credit_ledger_user_idx ON public.credit_ledger(user_id, ts DESC);

-- ──────────────────────────────────────────────────────────────────────────
-- Auto-create profile on signup (and grant 30 free credits)
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, plan, credits_remaining, credits_reset_at)
  VALUES (NEW.id, NEW.email, 'free', 30, NOW() + INTERVAL '30 days');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ──────────────────────────────────────────────────────────────────────────
-- Auto-update updated_at on row change
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS projects_updated_at ON public.projects;
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS ads_updated_at ON public.ads;
CREATE TRIGGER ads_updated_at BEFORE UPDATE ON public.ads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- Atomic credit-deduction function (no race conditions)
-- Returns the new balance, or raises an exception if insufficient.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deduct_credits(
  p_user_id UUID,
  p_project_id UUID,
  p_action TEXT,
  p_credits INT,
  p_real_cost NUMERIC DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
) RETURNS INT AS $$
DECLARE
  v_balance INT;
BEGIN
  -- Lock the profile row to prevent race conditions
  SELECT credits_remaining INTO v_balance
    FROM public.profiles WHERE id = p_user_id FOR UPDATE;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = 'P0001';
  END IF;

  IF v_balance < p_credits THEN
    RAISE EXCEPTION 'Insufficient credits: have %, need %', v_balance, p_credits
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.profiles
    SET credits_remaining = credits_remaining - p_credits
    WHERE id = p_user_id;

  INSERT INTO public.credit_ledger (user_id, project_id, action, credits_used, real_cost_usd, metadata)
    VALUES (p_user_id, p_project_id, p_action, p_credits, p_real_cost, p_metadata);

  RETURN v_balance - p_credits;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ──────────────────────────────────────────────────────────────────────────
-- Row Level Security policies
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.angles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "user reads own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "user updates own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Projects: full CRUD on own
CREATE POLICY "user lists own projects" ON public.projects
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user creates own projects" ON public.projects
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user updates own projects" ON public.projects
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "user deletes own projects" ON public.projects
  FOR DELETE USING (auth.uid() = user_id);

-- Child tables: ownership flows through projects
CREATE POLICY "user accesses docs in own projects" ON public.documents
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = documents.project_id AND p.user_id = auth.uid())
  );

CREATE POLICY "user accesses brand_images in own projects" ON public.brand_images
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = brand_images.project_id AND p.user_id = auth.uid())
  );

CREATE POLICY "user accesses angles in own projects" ON public.angles
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = angles.project_id AND p.user_id = auth.uid())
  );

CREATE POLICY "user accesses ads in own projects" ON public.ads
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = ads.project_id AND p.user_id = auth.uid())
  );

-- Credit ledger: read-only for own user
CREATE POLICY "user reads own credit ledger" ON public.credit_ledger
  FOR SELECT USING (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────────────────
-- Storage buckets (run separately if not using SQL — see instructions below)
-- ──────────────────────────────────────────────────────────────────────────
-- Create two buckets manually in Supabase Dashboard → Storage:
--   1. "brand-assets" (private) — for uploaded logos / products / lifestyle / docs
--   2. "generated-ads" (public)  — for AI-generated ad images served by URL
-- Then come back and run the policies below.

-- ──────────────────────────────────────────────────────────────────────────
-- Done. Inspect with:
--   SELECT * FROM public.profiles;
--   SELECT * FROM information_schema.tables WHERE table_schema = 'public';
-- ──────────────────────────────────────────────────────────────────────────
