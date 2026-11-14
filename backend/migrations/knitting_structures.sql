\restrict DikkhM15tpiSjp5bOpPQ1JTLz5GTSv3TacPlkPC7e5PIuetLWgbj5oqWMnte938
CREATE TABLE public.knitting_structures (
    id text NOT NULL,
    structure_name text NOT NULL,
    machine_type text NOT NULL,
    fabric_code character varying(10),
    gsm numeric(7,1),
    cylinder_tracks integer,
    dial_tracks integer,
    feed_repeat integer,
    needle_repeat integer,
    category text,
    tags jsonb DEFAULT '[]'::jsonb,
    description text,
    yarn_repeat_count integer,
    yarns jsonb DEFAULT '[]'::jsonb,
    feeder_data jsonb DEFAULT '[]'::jsonb,
    cam_data jsonb DEFAULT '{}'::jsonb,
    needle_data jsonb DEFAULT '{}'::jsonb,
    images jsonb DEFAULT '[]'::jsonb,
    is_favourite boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT knitting_structures_machine_type_check CHECK ((machine_type = ANY (ARRAY['SJ'::text, 'DJ'::text])))
);
ALTER TABLE ONLY public.knitting_structures
    ADD CONSTRAINT knitting_structures_pkey PRIMARY KEY (id);
CREATE INDEX idx_kstruct_fabric ON public.knitting_structures USING btree (fabric_code);
CREATE INDEX idx_kstruct_machine ON public.knitting_structures USING btree (machine_type);
ALTER TABLE ONLY public.knitting_structures
    ADD CONSTRAINT knitting_structures_fabric_code_fkey FOREIGN KEY (fabric_code) REFERENCES public.fabric_types(code) ON UPDATE CASCADE ON DELETE SET NULL;
\unrestrict DikkhM15tpiSjp5bOpPQ1JTLz5GTSv3TacPlkPC7e5PIuetLWgbj5oqWMnte938
