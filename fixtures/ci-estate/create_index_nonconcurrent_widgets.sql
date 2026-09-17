-- Should PASS on tiny table (below red_rows threshold)
CREATE INDEX idx_widgets_name_ci ON public.widgets (name);

