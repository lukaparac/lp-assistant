CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sdk_id text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_messages_created_at_idx ON public.chat_messages (created_at);

GRANT SELECT, INSERT, DELETE ON public.chat_messages TO anon;
GRANT ALL ON public.chat_messages TO service_role;

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Desk is readable" ON public.chat_messages
  FOR SELECT TO anon USING (true);

CREATE POLICY "Desk is writable" ON public.chat_messages
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Desk is clearable" ON public.chat_messages
  FOR DELETE TO anon USING (true);