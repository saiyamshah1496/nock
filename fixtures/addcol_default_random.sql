-- ADD COLUMN with volatile DEFAULT random()
ALTER TABLE public.sessions ADD COLUMN v_rand double precision DEFAULT random();

