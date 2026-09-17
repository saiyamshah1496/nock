ALTER TABLE public.sessions ADD COLUMN tmp1 int;
ALTER TABLE public.sessions ALTER COLUMN tmp1 SET NOT NULL;

