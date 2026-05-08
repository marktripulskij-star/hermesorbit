-- Persist full session state on the project row.
-- Session state is the working memory for a project: documents, brand images,
-- brand brief, angles, ads, scraped website content, manual offers, etc.
-- Previously this lived in a local sessions.json file on the server, which
-- was wiped on every Railway redeploy. Storing it here makes it durable.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS session_state JSONB DEFAULT '{}'::jsonb;
