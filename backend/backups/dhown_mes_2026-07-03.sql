--
-- PostgreSQL database dump
--

\restrict Ru5swJHp7sGCaM34lyeJ9u5DEXlpUVEMV8uKnXeJNTPdtuY5Ijy3KYBtpuWRgAU

-- Dumped from database version 18.4
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.app_settings (
    key character varying(100) NOT NULL,
    value text,
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.app_settings OWNER TO postgres;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_logs (
    id integer NOT NULL,
    user_id integer,
    username character varying(50),
    action character varying(100) NOT NULL,
    module character varying(50) NOT NULL,
    old_value text,
    new_value text,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.audit_logs OWNER TO postgres;

--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.audit_logs_id_seq OWNER TO postgres;

--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: batch_rolls; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.batch_rolls (
    id integer NOT NULL,
    batch_id integer NOT NULL,
    roll_id character varying(100) NOT NULL,
    added_at timestamp without time zone DEFAULT now(),
    added_by character varying(50)
);


ALTER TABLE public.batch_rolls OWNER TO postgres;

--
-- Name: batch_rolls_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.batch_rolls_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.batch_rolls_id_seq OWNER TO postgres;

--
-- Name: batch_rolls_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.batch_rolls_id_seq OWNED BY public.batch_rolls.id;


--
-- Name: batches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.batches (
    batch_id integer NOT NULL,
    batch_number character varying(30) NOT NULL,
    fabric_type character varying(50),
    color_code character varying(50),
    color_name character varying(100),
    total_weight_kg numeric(10,3) DEFAULT 0,
    roll_count integer DEFAULT 0,
    status character varying(20) DEFAULT 'OPEN'::character varying,
    notes text,
    created_by character varying(50),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.batches OWNER TO postgres;

--
-- Name: batches_batch_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.batches_batch_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.batches_batch_id_seq OWNER TO postgres;

--
-- Name: batches_batch_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.batches_batch_id_seq OWNED BY public.batches.batch_id;


--
-- Name: bins; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bins (
    bin_id integer NOT NULL,
    rack_id integer NOT NULL,
    code character varying(30) NOT NULL,
    is_active boolean DEFAULT true
);


ALTER TABLE public.bins OWNER TO postgres;

--
-- Name: bins_bin_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bins_bin_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bins_bin_id_seq OWNER TO postgres;

--
-- Name: bins_bin_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bins_bin_id_seq OWNED BY public.bins.bin_id;


--
-- Name: bom_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bom_lines (
    bom_line_id integer NOT NULL,
    fabric_item_id integer NOT NULL,
    yarn_item_id integer NOT NULL,
    percentage numeric(6,2) NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT bom_lines_percentage_check CHECK (((percentage > (0)::numeric) AND (percentage <= (100)::numeric)))
);


ALTER TABLE public.bom_lines OWNER TO postgres;

--
-- Name: bom_lines_bom_line_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bom_lines_bom_line_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bom_lines_bom_line_id_seq OWNER TO postgres;

--
-- Name: bom_lines_bom_line_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bom_lines_bom_line_id_seq OWNED BY public.bom_lines.bom_line_id;


--
-- Name: cost_centres; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cost_centres (
    cc_id integer NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    dept_id integer,
    is_active boolean DEFAULT true
);


ALTER TABLE public.cost_centres OWNER TO postgres;

--
-- Name: cost_centres_cc_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.cost_centres_cc_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.cost_centres_cc_id_seq OWNER TO postgres;

--
-- Name: cost_centres_cc_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.cost_centres_cc_id_seq OWNED BY public.cost_centres.cc_id;


--
-- Name: cost_entries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cost_entries (
    entry_id integer NOT NULL,
    reference_type character varying(30) NOT NULL,
    reference_id character varying(100) NOT NULL,
    cost_component character varying(40) NOT NULL,
    amount_rs numeric(12,2) DEFAULT 0 NOT NULL,
    quantity_kg numeric(10,3),
    rate_used numeric(10,2),
    fabric_type character varying(100),
    color_name character varying(100),
    notes text,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.cost_entries OWNER TO postgres;

--
-- Name: cost_entries_entry_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.cost_entries_entry_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.cost_entries_entry_id_seq OWNER TO postgres;

--
-- Name: cost_entries_entry_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.cost_entries_entry_id_seq OWNED BY public.cost_entries.entry_id;


--
-- Name: cost_rates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cost_rates (
    rate_id integer NOT NULL,
    yarn_type character varying(100) NOT NULL,
    price_per_kg numeric(10,2) DEFAULT 0 NOT NULL,
    labour_per_shift numeric(10,2) DEFAULT 0 NOT NULL,
    machine_depreciation_per_hour numeric(10,2) DEFAULT 0 NOT NULL,
    notes text,
    updated_by character varying(80),
    updated_at timestamp without time zone DEFAULT now(),
    item_id integer
);


ALTER TABLE public.cost_rates OWNER TO postgres;

--
-- Name: cost_rates_rate_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.cost_rates_rate_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.cost_rates_rate_id_seq OWNER TO postgres;

--
-- Name: cost_rates_rate_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.cost_rates_rate_id_seq OWNED BY public.cost_rates.rate_id;


--
-- Name: cost_snapshots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cost_snapshots (
    snapshot_id integer NOT NULL,
    snapshot_date date NOT NULL,
    fabric_type character varying(100),
    color_name character varying(100),
    total_cost_rs numeric(12,2) DEFAULT 0,
    total_kg numeric(10,3) DEFAULT 0,
    cost_per_kg numeric(10,2) DEFAULT 0,
    selling_price_kg numeric(10,2),
    margin_rs numeric(12,2),
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.cost_snapshots OWNER TO postgres;

--
-- Name: cost_snapshots_snapshot_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.cost_snapshots_snapshot_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.cost_snapshots_snapshot_id_seq OWNER TO postgres;

--
-- Name: cost_snapshots_snapshot_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.cost_snapshots_snapshot_id_seq OWNED BY public.cost_snapshots.snapshot_id;


--
-- Name: data_collectors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.data_collectors (
    dc_id character varying(50) NOT NULL,
    machine_id character varying(20),
    ip_address character varying(50),
    status character varying(20),
    last_seen timestamp without time zone
);


ALTER TABLE public.data_collectors OWNER TO postgres;

--
-- Name: departments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.departments (
    dept_id integer NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    head_user character varying(80),
    is_active boolean DEFAULT true
);


ALTER TABLE public.departments OWNER TO postgres;

--
-- Name: departments_dept_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.departments_dept_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.departments_dept_id_seq OWNER TO postgres;

--
-- Name: departments_dept_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.departments_dept_id_seq OWNED BY public.departments.dept_id;


--
-- Name: dispatch_challans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.dispatch_challans (
    dispatch_id integer NOT NULL,
    dispatch_number character varying(30) NOT NULL,
    customer_name character varying(100) NOT NULL,
    customer_contact character varying(50),
    dispatch_date date NOT NULL,
    total_weight_kg numeric(10,3) DEFAULT 0,
    status character varying(20) DEFAULT 'DISPATCHED'::character varying,
    notes text,
    created_by character varying(50),
    created_at timestamp without time zone DEFAULT now(),
    vehicle_number character varying(50),
    partner_id integer,
    dispatch_type character varying(20) DEFAULT 'FG'::character varying,
    total_taxable_value numeric(12,2),
    total_gst numeric(12,2),
    grand_total numeric(12,2)
);


ALTER TABLE public.dispatch_challans OWNER TO postgres;

--
-- Name: dispatch_challans_dispatch_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.dispatch_challans_dispatch_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.dispatch_challans_dispatch_id_seq OWNER TO postgres;

--
-- Name: dispatch_challans_dispatch_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.dispatch_challans_dispatch_id_seq OWNED BY public.dispatch_challans.dispatch_id;


--
-- Name: dispatch_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.dispatch_items (
    item_id integer NOT NULL,
    dispatch_id integer NOT NULL,
    fg_id integer,
    weight_kg numeric(10,3),
    fabric_type character varying(50),
    color_name character varying(100),
    item_type character varying(20) DEFAULT 'FG'::character varying,
    roll_id integer,
    lot_id integer,
    item_description character varying(300),
    lot_number character varying(100),
    yarn_type character varying(100),
    color character varying(100),
    rate_per_kg numeric(10,2),
    gst_rate numeric(5,2),
    taxable_value numeric(12,2),
    gst_amount numeric(12,2),
    line_total numeric(12,2)
);


ALTER TABLE public.dispatch_items OWNER TO postgres;

--
-- Name: dispatch_items_item_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.dispatch_items_item_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.dispatch_items_item_id_seq OWNER TO postgres;

--
-- Name: dispatch_items_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.dispatch_items_item_id_seq OWNED BY public.dispatch_items.item_id;


--
-- Name: doc_series; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.doc_series (
    series_id integer NOT NULL,
    series_code character varying(20) NOT NULL,
    prefix character varying(20) NOT NULL,
    suffix character varying(20) DEFAULT ''::character varying,
    include_year boolean DEFAULT true,
    include_month boolean DEFAULT false,
    zero_pad integer DEFAULT 4,
    current_seq integer DEFAULT 0,
    fin_year character varying(9),
    reset_yearly boolean DEFAULT true,
    last_reset date,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.doc_series OWNER TO postgres;

--
-- Name: doc_series_series_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.doc_series_series_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.doc_series_series_id_seq OWNER TO postgres;

--
-- Name: doc_series_series_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.doc_series_series_id_seq OWNED BY public.doc_series.series_id;


--
-- Name: fabric_types; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fabric_types (
    code character varying(10) NOT NULL,
    name character varying(100) NOT NULL,
    description character varying(255),
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.fabric_types OWNER TO postgres;

--
-- Name: financial_years; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.financial_years (
    fy_id integer NOT NULL,
    label character varying(9) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    is_active boolean DEFAULT false,
    is_closed boolean DEFAULT false
);


ALTER TABLE public.financial_years OWNER TO postgres;

--
-- Name: financial_years_fy_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.financial_years_fy_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.financial_years_fy_id_seq OWNER TO postgres;

--
-- Name: financial_years_fy_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.financial_years_fy_id_seq OWNED BY public.financial_years.fy_id;


--
-- Name: finished_goods; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.finished_goods (
    fg_id integer NOT NULL,
    receipt_id integer,
    batch_id integer,
    fabric_type character varying(50),
    color_code character varying(50),
    color_name character varying(100),
    weight_kg numeric(10,3),
    roll_count integer DEFAULT 0,
    status character varying(20) DEFAULT 'IN_STOCK'::character varying,
    location character varying(100),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    source character varying(20) DEFAULT 'REGULAR'::character varying,
    lot_no character varying(80)
);


ALTER TABLE public.finished_goods OWNER TO postgres;

--
-- Name: finished_goods_fg_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.finished_goods_fg_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.finished_goods_fg_id_seq OWNER TO postgres;

--
-- Name: finished_goods_fg_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.finished_goods_fg_id_seq OWNED BY public.finished_goods.fg_id;


--
-- Name: finishing_records; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.finishing_records (
    finishing_id integer NOT NULL,
    receipt_id integer,
    batch_id integer,
    shade character varying(80),
    gsm numeric(8,2),
    moisture_pct numeric(5,2),
    shrinkage_pct numeric(5,2),
    damage_kg numeric(10,3) DEFAULT 0,
    qa_passed boolean DEFAULT true,
    qa_notes text,
    finished_by character varying(80),
    finished_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.finishing_records OWNER TO postgres;

--
-- Name: finishing_records_finishing_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.finishing_records_finishing_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.finishing_records_finishing_id_seq OWNER TO postgres;

--
-- Name: finishing_records_finishing_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.finishing_records_finishing_id_seq OWNED BY public.finishing_records.finishing_id;


--
-- Name: grn; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.grn (
    grn_id integer NOT NULL,
    grn_number character varying(40) NOT NULL,
    supplier_name character varying(150) NOT NULL,
    supplier_invoice character varying(100),
    receipt_date date DEFAULT CURRENT_DATE NOT NULL,
    vehicle_number character varying(50),
    received_by character varying(80),
    status character varying(20) DEFAULT 'DRAFT'::character varying,
    notes text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    partner_id integer,
    warehouse_id integer
);


ALTER TABLE public.grn OWNER TO postgres;

--
-- Name: grn_grn_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.grn_grn_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.grn_grn_id_seq OWNER TO postgres;

--
-- Name: grn_grn_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.grn_grn_id_seq OWNED BY public.grn.grn_id;


--
-- Name: hsn_codes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.hsn_codes (
    hsn_id integer NOT NULL,
    hsn_code character varying(20) NOT NULL,
    description text,
    gst_rate numeric(5,2) DEFAULT 0
);


ALTER TABLE public.hsn_codes OWNER TO postgres;

--
-- Name: hsn_codes_hsn_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.hsn_codes_hsn_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.hsn_codes_hsn_id_seq OWNER TO postgres;

--
-- Name: hsn_codes_hsn_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.hsn_codes_hsn_id_seq OWNED BY public.hsn_codes.hsn_id;


--
-- Name: item_categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.item_categories (
    category_id integer NOT NULL,
    code character varying(30) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    parent_id integer,
    is_active boolean DEFAULT true
);


ALTER TABLE public.item_categories OWNER TO postgres;

--
-- Name: item_categories_category_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.item_categories_category_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.item_categories_category_id_seq OWNER TO postgres;

--
-- Name: item_categories_category_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.item_categories_category_id_seq OWNED BY public.item_categories.category_id;


--
-- Name: item_fabric_attrs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.item_fabric_attrs (
    item_id integer NOT NULL,
    fabric_code character varying(50),
    structure character varying(100),
    gsm numeric(8,2),
    finished_gsm numeric(8,2),
    width_cm numeric(6,2),
    finished_width_cm numeric(6,2),
    machine_type character varying(50),
    gauge character varying(20),
    dia_inches numeric(6,2),
    feeders integer,
    stitch_length_mm numeric(6,3),
    process_route_id integer
);


ALTER TABLE public.item_fabric_attrs OWNER TO postgres;

--
-- Name: item_spare_attrs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.item_spare_attrs (
    item_id integer NOT NULL,
    oem_part_number character varying(100),
    compatible_machine character varying(200),
    rack_bin character varying(50),
    warranty_months integer,
    default_partner_id integer
);


ALTER TABLE public.item_spare_attrs OWNER TO postgres;

--
-- Name: item_yarn_attrs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.item_yarn_attrs (
    item_id integer NOT NULL,
    count character varying(30),
    composition character varying(100),
    shade character varying(80),
    yarn_type character varying(80),
    default_partner_id integer,
    pref_warehouse_id integer,
    pref_rack_id integer
);


ALTER TABLE public.item_yarn_attrs OWNER TO postgres;

--
-- Name: items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.items (
    item_id integer NOT NULL,
    item_code character varying(50) NOT NULL,
    item_name character varying(200) NOT NULL,
    category_id integer NOT NULL,
    description text,
    uom_id integer,
    hsn_id integer,
    gst_rate numeric(5,2) DEFAULT 0,
    standard_cost numeric(15,2) DEFAULT 0,
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    is_active boolean DEFAULT true,
    created_by character varying(80),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    knitting_rate_per_kg numeric(10,2),
    standard_loss_pct numeric(5,2) DEFAULT 1.00
);


ALTER TABLE public.items OWNER TO postgres;

--
-- Name: items_item_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.items_item_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.items_item_id_seq OWNER TO postgres;

--
-- Name: items_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.items_item_id_seq OWNED BY public.items.item_id;


--
-- Name: machine_downtime; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.machine_downtime (
    id integer NOT NULL,
    machine_id character varying(20),
    reason character varying(200),
    start_time timestamp without time zone,
    end_time timestamp without time zone,
    duration_minutes numeric(10,2),
    status character varying(20) DEFAULT 'OPEN'::character varying,
    source character varying(20) DEFAULT 'MANUAL'::character varying,
    shift character varying(2)
);


ALTER TABLE public.machine_downtime OWNER TO postgres;

--
-- Name: machine_downtime_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.machine_downtime_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.machine_downtime_id_seq OWNER TO postgres;

--
-- Name: machine_downtime_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.machine_downtime_id_seq OWNED BY public.machine_downtime.id;


--
-- Name: machine_live_data; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.machine_live_data (
    id integer NOT NULL,
    machine_id character varying(20),
    rpm integer,
    status character varying(20),
    production_counter numeric(10,2),
    operator_name character varying(100),
    shift character(1),
    "timestamp" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    dc_status character varying(20),
    operator_id character varying(50),
    previous_counter numeric DEFAULT 0 NOT NULL,
    session_production_kg numeric DEFAULT 0 NOT NULL,
    last_status character varying(20)
);


ALTER TABLE public.machine_live_data OWNER TO postgres;

--
-- Name: machine_live_data_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.machine_live_data_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.machine_live_data_id_seq OWNER TO postgres;

--
-- Name: machine_live_data_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.machine_live_data_id_seq OWNED BY public.machine_live_data.id;


--
-- Name: machine_status_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.machine_status_log (
    id integer NOT NULL,
    machine_id character varying(20) NOT NULL,
    status character varying(20) NOT NULL,
    shift character varying(2) DEFAULT 'D'::character varying NOT NULL,
    start_time timestamp without time zone DEFAULT now() NOT NULL,
    end_time timestamp without time zone,
    duration_minutes numeric
);


ALTER TABLE public.machine_status_log OWNER TO postgres;

--
-- Name: machine_status_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.machine_status_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.machine_status_log_id_seq OWNER TO postgres;

--
-- Name: machine_status_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.machine_status_log_id_seq OWNED BY public.machine_status_log.id;


--
-- Name: machines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.machines (
    machine_id character varying(20) NOT NULL,
    machine_name character varying(100),
    machine_type character varying(20),
    diameter integer,
    gauge integer,
    feeders integer,
    active boolean DEFAULT true,
    fabric character varying(100),
    dc_id character varying(50),
    rpm_target integer,
    machine_status character varying(20),
    kg_per_counter numeric(12,8),
    dc_status character varying(20),
    fabric_code character varying(10),
    manufacturer character varying(100),
    model character varying(100),
    serial_number character varying(100),
    needles_count integer,
    cylinder_diameter numeric(6,2),
    purchase_date date,
    installation_date date
);


ALTER TABLE public.machines OWNER TO postgres;

--
-- Name: maintenance_records; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.maintenance_records (
    id integer NOT NULL,
    machine_id character varying(20),
    maintenance_type character varying(100),
    technician character varying(100),
    remarks text,
    maintenance_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    next_service_date timestamp without time zone,
    status character varying(50) DEFAULT 'DONE'::character varying
);


ALTER TABLE public.maintenance_records OWNER TO postgres;

--
-- Name: maintenance_records_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.maintenance_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.maintenance_records_id_seq OWNER TO postgres;

--
-- Name: maintenance_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.maintenance_records_id_seq OWNED BY public.maintenance_records.id;


--
-- Name: maintenance_schedule; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.maintenance_schedule (
    schedule_id integer NOT NULL,
    machine_id character varying(20) NOT NULL,
    task_name character varying(200) NOT NULL,
    task_type character varying(50) DEFAULT 'PERIODIC'::character varying NOT NULL,
    frequency_days integer,
    frequency_hours integer,
    last_done_date date,
    last_done_hours numeric(10,2),
    next_due_date date,
    next_due_hours numeric(10,2),
    assigned_to character varying(100),
    priority character varying(20) DEFAULT 'MEDIUM'::character varying,
    notes text,
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT maintenance_schedule_priority_check CHECK (((priority)::text = ANY ((ARRAY['LOW'::character varying, 'MEDIUM'::character varying, 'HIGH'::character varying, 'CRITICAL'::character varying])::text[]))),
    CONSTRAINT maintenance_schedule_status_check CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'PAUSED'::character varying, 'COMPLETED'::character varying])::text[])))
);


ALTER TABLE public.maintenance_schedule OWNER TO postgres;

--
-- Name: maintenance_schedule_schedule_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.maintenance_schedule_schedule_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.maintenance_schedule_schedule_id_seq OWNER TO postgres;

--
-- Name: maintenance_schedule_schedule_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.maintenance_schedule_schedule_id_seq OWNED BY public.maintenance_schedule.schedule_id;


--
-- Name: oee_records; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.oee_records (
    id integer NOT NULL,
    machine_id character varying(20) NOT NULL,
    record_date date NOT NULL,
    shift character varying(2) NOT NULL,
    planned_minutes numeric DEFAULT 480 NOT NULL,
    run_minutes numeric DEFAULT 0 NOT NULL,
    stopped_minutes numeric DEFAULT 0 NOT NULL,
    availability numeric DEFAULT 0 NOT NULL,
    performance numeric DEFAULT 0 NOT NULL,
    quality numeric DEFAULT 100 NOT NULL,
    oee numeric DEFAULT 0 NOT NULL,
    production_kg numeric DEFAULT 0 NOT NULL,
    rpm_avg numeric DEFAULT 0 NOT NULL,
    sample_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.oee_records OWNER TO postgres;

--
-- Name: oee_records_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.oee_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.oee_records_id_seq OWNER TO postgres;

--
-- Name: oee_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.oee_records_id_seq OWNED BY public.oee_records.id;


--
-- Name: operator_assignments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.operator_assignments (
    assignment_id integer NOT NULL,
    operator_id integer,
    machine_id character varying(20),
    assigned_at timestamp without time zone DEFAULT now(),
    released_at timestamp without time zone,
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    operator_name character varying(100)
);


ALTER TABLE public.operator_assignments OWNER TO postgres;

--
-- Name: operator_assignments_assignment_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.operator_assignments_assignment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.operator_assignments_assignment_id_seq OWNER TO postgres;

--
-- Name: operator_assignments_assignment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.operator_assignments_assignment_id_seq OWNED BY public.operator_assignments.assignment_id;


--
-- Name: operator_attendance; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.operator_attendance (
    attendance_id integer NOT NULL,
    operator_id character varying(50) NOT NULL,
    operator_name character varying(100),
    work_date date NOT NULL,
    shift character(1),
    clock_in timestamp without time zone,
    clock_out timestamp without time zone,
    last_seen timestamp without time zone,
    scan_count integer DEFAULT 1,
    status character varying(20) DEFAULT 'PRESENT'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.operator_attendance OWNER TO postgres;

--
-- Name: operator_attendance_attendance_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.operator_attendance_attendance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.operator_attendance_attendance_id_seq OWNER TO postgres;

--
-- Name: operator_attendance_attendance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.operator_attendance_attendance_id_seq OWNED BY public.operator_attendance.attendance_id;


--
-- Name: operators; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.operators (
    operator_id integer NOT NULL,
    operator_code character varying(20),
    operator_name character varying(100),
    rfid_tag character varying(50),
    mobile character varying(20),
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    department character varying(50),
    shift character varying(10),
    updated_at timestamp without time zone DEFAULT now(),
    employee_id character varying(50),
    join_date date,
    skill_level character varying(20) DEFAULT 'BASIC'::character varying,
    emergency_contact character varying(20),
    CONSTRAINT operators_skill_level_check CHECK (((skill_level)::text = ANY ((ARRAY['BASIC'::character varying, 'INTERMEDIATE'::character varying, 'EXPERT'::character varying])::text[])))
);


ALTER TABLE public.operators OWNER TO postgres;

--
-- Name: operators_operator_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.operators_operator_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.operators_operator_id_seq OWNER TO postgres;

--
-- Name: operators_operator_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.operators_operator_id_seq OWNED BY public.operators.operator_id;


--
-- Name: partner_addresses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.partner_addresses (
    address_id integer NOT NULL,
    partner_id integer NOT NULL,
    address_type character varying(30) DEFAULT 'PRIMARY'::character varying,
    line1 character varying(200),
    line2 character varying(200),
    city character varying(100),
    state character varying(100),
    pincode character varying(10),
    country character varying(50) DEFAULT 'India'::character varying,
    gstin character varying(20),
    is_default boolean DEFAULT false
);


ALTER TABLE public.partner_addresses OWNER TO postgres;

--
-- Name: partner_addresses_address_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.partner_addresses_address_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.partner_addresses_address_id_seq OWNER TO postgres;

--
-- Name: partner_addresses_address_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.partner_addresses_address_id_seq OWNED BY public.partner_addresses.address_id;


--
-- Name: partner_bank; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.partner_bank (
    bank_id integer NOT NULL,
    partner_id integer NOT NULL,
    bank_name character varying(100),
    branch character varying(100),
    account_no character varying(50),
    ifsc character varying(20),
    account_type character varying(30) DEFAULT 'CURRENT'::character varying,
    is_default boolean DEFAULT false
);


ALTER TABLE public.partner_bank OWNER TO postgres;

--
-- Name: partner_bank_bank_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.partner_bank_bank_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.partner_bank_bank_id_seq OWNER TO postgres;

--
-- Name: partner_bank_bank_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.partner_bank_bank_id_seq OWNED BY public.partner_bank.bank_id;


--
-- Name: partner_contacts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.partner_contacts (
    contact_id integer NOT NULL,
    partner_id integer NOT NULL,
    name character varying(100) NOT NULL,
    designation character varying(100),
    mobile character varying(20),
    email character varying(100),
    whatsapp character varying(20),
    is_primary boolean DEFAULT false
);


ALTER TABLE public.partner_contacts OWNER TO postgres;

--
-- Name: partner_contacts_contact_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.partner_contacts_contact_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.partner_contacts_contact_id_seq OWNER TO postgres;

--
-- Name: partner_contacts_contact_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.partner_contacts_contact_id_seq OWNED BY public.partner_contacts.contact_id;


--
-- Name: partner_roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.partner_roles (
    role_id integer NOT NULL,
    partner_id integer NOT NULL,
    role character varying(50) NOT NULL,
    is_primary boolean DEFAULT false
);


ALTER TABLE public.partner_roles OWNER TO postgres;

--
-- Name: partner_roles_role_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.partner_roles_role_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.partner_roles_role_id_seq OWNER TO postgres;

--
-- Name: partner_roles_role_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.partner_roles_role_id_seq OWNED BY public.partner_roles.role_id;


--
-- Name: partners; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.partners (
    partner_id integer NOT NULL,
    partner_code character varying(30) NOT NULL,
    company_name character varying(200) NOT NULL,
    short_name character varying(80),
    gstin character varying(20),
    pan character varying(20),
    tan character varying(20),
    iec character varying(20),
    cin character varying(30),
    msme_number character varying(50),
    msme_category character varying(10),
    payment_terms integer DEFAULT 30,
    credit_limit numeric(15,2),
    credit_days integer DEFAULT 0,
    rating integer,
    notes text,
    is_active boolean DEFAULT true,
    created_by character varying(80),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT partners_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


ALTER TABLE public.partners OWNER TO postgres;

--
-- Name: partners_partner_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.partners_partner_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.partners_partner_id_seq OWNER TO postgres;

--
-- Name: partners_partner_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.partners_partner_id_seq OWNED BY public.partners.partner_id;


--
-- Name: process_route_steps; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.process_route_steps (
    step_id integer NOT NULL,
    route_id integer NOT NULL,
    step_order integer NOT NULL,
    step_code character varying(30) NOT NULL,
    step_name character varying(100) NOT NULL,
    location_type character varying(30) DEFAULT 'INTERNAL'::character varying,
    dept_id integer,
    generates_document character varying(50),
    is_optional boolean DEFAULT false
);


ALTER TABLE public.process_route_steps OWNER TO postgres;

--
-- Name: process_route_steps_step_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.process_route_steps_step_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.process_route_steps_step_id_seq OWNER TO postgres;

--
-- Name: process_route_steps_step_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.process_route_steps_step_id_seq OWNED BY public.process_route_steps.step_id;


--
-- Name: process_routes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.process_routes (
    route_id integer NOT NULL,
    code character varying(30) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    item_category character varying(50),
    is_active boolean DEFAULT true,
    created_by character varying(80),
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.process_routes OWNER TO postgres;

--
-- Name: process_routes_route_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.process_routes_route_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.process_routes_route_id_seq OWNER TO postgres;

--
-- Name: process_routes_route_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.process_routes_route_id_seq OWNED BY public.process_routes.route_id;


--
-- Name: production_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.production_history (
    id bigint NOT NULL,
    machine_id character varying(20) NOT NULL,
    period_type character varying(10) NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    shift character varying(2) DEFAULT ''::character varying NOT NULL,
    record_date date NOT NULL,
    hour_bucket smallint DEFAULT '-1'::integer NOT NULL,
    counter_start numeric(12,0) DEFAULT 0 NOT NULL,
    counter_end numeric(12,0) DEFAULT 0 NOT NULL,
    production_kg numeric(10,4) DEFAULT 0 NOT NULL,
    rpm_avg numeric(6,2) DEFAULT 0 NOT NULL,
    sample_count integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT chk_period_type CHECK (((period_type)::text = ANY ((ARRAY['HOURLY'::character varying, 'SHIFT'::character varying, 'DAILY'::character varying])::text[])))
);


ALTER TABLE public.production_history OWNER TO postgres;

--
-- Name: production_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.production_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.production_history_id_seq OWNER TO postgres;

--
-- Name: production_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.production_history_id_seq OWNED BY public.production_history.id;


--
-- Name: production_records; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.production_records (
    id integer NOT NULL,
    machine_id character varying(20) NOT NULL,
    record_date date NOT NULL,
    shift character varying(2) NOT NULL,
    counter_start bigint DEFAULT 0 NOT NULL,
    counter_end bigint DEFAULT 0 NOT NULL,
    production_kg numeric DEFAULT 0 NOT NULL,
    rpm_sum numeric DEFAULT 0 NOT NULL,
    sample_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.production_records OWNER TO postgres;

--
-- Name: production_records_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.production_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.production_records_id_seq OWNER TO postgres;

--
-- Name: production_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.production_records_id_seq OWNED BY public.production_records.id;


--
-- Name: racks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.racks (
    rack_id integer NOT NULL,
    warehouse_id integer NOT NULL,
    code character varying(30) NOT NULL,
    name character varying(100),
    is_active boolean DEFAULT true
);


ALTER TABLE public.racks OWNER TO postgres;

--
-- Name: racks_rack_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.racks_rack_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.racks_rack_id_seq OWNER TO postgres;

--
-- Name: racks_rack_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.racks_rack_id_seq OWNED BY public.racks.rack_id;


--
-- Name: rfid_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rfid_events (
    event_id integer NOT NULL,
    rfid_tag character varying(50),
    operator_id integer,
    machine_id character varying(20),
    event_time timestamp without time zone DEFAULT now()
);


ALTER TABLE public.rfid_events OWNER TO postgres;

--
-- Name: rfid_events_event_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rfid_events_event_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rfid_events_event_id_seq OWNER TO postgres;

--
-- Name: rfid_events_event_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rfid_events_event_id_seq OWNED BY public.rfid_events.event_id;


--
-- Name: rolls; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rolls (
    roll_id character varying(50) NOT NULL,
    machine_id character varying(20),
    fabric_type character varying(100),
    weight_kg numeric(10,2),
    shift character(1),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    start_counter bigint,
    current_counter bigint,
    roll_weight_kg numeric(10,2),
    status character varying(20),
    operator_id character varying(50),
    supervisor_id character varying(50),
    actual_weight_kg numeric(10,2),
    verified_at timestamp without time zone,
    closed_at timestamp without time zone,
    supervisor_name character varying(100),
    approved_at timestamp without time zone,
    warehouse_status character varying(30) DEFAULT 'GREIGE'::character varying,
    lot_id integer,
    issue_id integer,
    qr_image text,
    fabric_item_id integer,
    source character varying(20) DEFAULT 'REGULAR'::character varying
);


ALTER TABLE public.rolls OWNER TO postgres;

--
-- Name: sc_challan_yarn_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sc_challan_yarn_items (
    item_id integer NOT NULL,
    challan_id integer NOT NULL,
    lot_id integer,
    lot_number character varying(50),
    yarn_type character varying(100),
    color character varying(100),
    sent_kg numeric(10,3) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.sc_challan_yarn_items OWNER TO postgres;

--
-- Name: sc_challan_yarn_items_item_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.sc_challan_yarn_items_item_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sc_challan_yarn_items_item_id_seq OWNER TO postgres;

--
-- Name: sc_challan_yarn_items_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.sc_challan_yarn_items_item_id_seq OWNED BY public.sc_challan_yarn_items.item_id;


--
-- Name: shift_handovers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.shift_handovers (
    handover_id integer NOT NULL,
    shift_date date NOT NULL,
    shift character varying(5) NOT NULL,
    supervisor_name character varying(100),
    production_kg numeric(10,2),
    machines_down integer DEFAULT 0,
    issues text,
    actions_taken text,
    pending_actions text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.shift_handovers OWNER TO postgres;

--
-- Name: shift_handovers_handover_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.shift_handovers_handover_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.shift_handovers_handover_id_seq OWNER TO postgres;

--
-- Name: shift_handovers_handover_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.shift_handovers_handover_id_seq OWNED BY public.shift_handovers.handover_id;


--
-- Name: stock_ledger; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stock_ledger (
    ledger_id bigint NOT NULL,
    txn_date date DEFAULT CURRENT_DATE NOT NULL,
    txn_time timestamp without time zone DEFAULT now(),
    doc_type character varying(30) NOT NULL,
    doc_id character varying(100) NOT NULL,
    item_id integer,
    item_desc character varying(200),
    warehouse_id integer,
    rack_id integer,
    bin_id integer,
    movement_type character varying(20) NOT NULL,
    quantity numeric(12,3) NOT NULL,
    uom_code character varying(20) DEFAULT 'KG'::character varying,
    unit_cost numeric(15,2),
    total_cost numeric(15,2),
    partner_id integer,
    notes text,
    created_by character varying(80),
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.stock_ledger OWNER TO postgres;

--
-- Name: stock_ledger_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.stock_ledger_ledger_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stock_ledger_ledger_id_seq OWNER TO postgres;

--
-- Name: stock_ledger_ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.stock_ledger_ledger_id_seq OWNED BY public.stock_ledger.ledger_id;


--
-- Name: subcontract_challans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subcontract_challans (
    challan_id integer NOT NULL,
    challan_number character varying(30) NOT NULL,
    batch_id integer,
    vendor_name character varying(100),
    vendor_contact character varying(50),
    job_type character varying(30) NOT NULL,
    sent_date date NOT NULL,
    expected_return_date date,
    sent_weight_kg numeric(10,3),
    roll_count integer DEFAULT 0,
    rate_per_kg numeric(10,2),
    status character varying(20) DEFAULT 'SENT'::character varying,
    notes text,
    created_by character varying(50),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    partner_id integer,
    challan_type character varying(20) DEFAULT 'ROLL_BASED'::character varying,
    is_job_work boolean DEFAULT false,
    customer_name character varying(200),
    source character varying(20) DEFAULT 'REGULAR'::character varying
);


ALTER TABLE public.subcontract_challans OWNER TO postgres;

--
-- Name: subcontract_challans_challan_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.subcontract_challans_challan_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.subcontract_challans_challan_id_seq OWNER TO postgres;

--
-- Name: subcontract_challans_challan_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.subcontract_challans_challan_id_seq OWNED BY public.subcontract_challans.challan_id;


--
-- Name: subcontract_receipts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subcontract_receipts (
    receipt_id integer NOT NULL,
    challan_id integer NOT NULL,
    received_date date NOT NULL,
    received_weight_kg numeric(10,3),
    quality_status character varying(20) DEFAULT 'PASS'::character varying,
    rejected_weight_kg numeric(10,3) DEFAULT 0,
    notes text,
    received_by character varying(50),
    created_at timestamp without time zone DEFAULT now(),
    shade character varying(80),
    gsm numeric(8,2),
    rolls_received_count integer DEFAULT 0,
    balance_yarn_kg numeric(10,3) DEFAULT 0,
    vendor_invoice_no character varying(100),
    vendor_bill_amount numeric(12,2),
    payment_status character varying(20) DEFAULT 'PENDING'::character varying
);


ALTER TABLE public.subcontract_receipts OWNER TO postgres;

--
-- Name: subcontract_receipts_receipt_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.subcontract_receipts_receipt_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.subcontract_receipts_receipt_id_seq OWNER TO postgres;

--
-- Name: subcontract_receipts_receipt_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.subcontract_receipts_receipt_id_seq OWNED BY public.subcontract_receipts.receipt_id;


--
-- Name: tax_rates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tax_rates (
    tax_id integer NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(50) NOT NULL,
    cgst numeric(5,2) DEFAULT 0,
    sgst numeric(5,2) DEFAULT 0,
    igst numeric(5,2) DEFAULT 0,
    is_active boolean DEFAULT true
);


ALTER TABLE public.tax_rates OWNER TO postgres;

--
-- Name: tax_rates_tax_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.tax_rates_tax_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tax_rates_tax_id_seq OWNER TO postgres;

--
-- Name: tax_rates_tax_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.tax_rates_tax_id_seq OWNED BY public.tax_rates.tax_id;


--
-- Name: uom; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.uom (
    uom_id integer NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(50) NOT NULL,
    is_active boolean DEFAULT true
);


ALTER TABLE public.uom OWNER TO postgres;

--
-- Name: uom_uom_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.uom_uom_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.uom_uom_id_seq OWNER TO postgres;

--
-- Name: uom_uom_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.uom_uom_id_seq OWNED BY public.uom.uom_id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(50) NOT NULL,
    full_name character varying(100) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role character varying(30) DEFAULT 'VIEWER'::character varying NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    mobile character varying(20),
    pin_hash character varying(100)
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: warehouses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.warehouses (
    warehouse_id integer NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    type character varying(30) DEFAULT 'INTERNAL'::character varying,
    address text,
    is_active boolean DEFAULT true
);


ALTER TABLE public.warehouses OWNER TO postgres;

--
-- Name: warehouses_warehouse_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.warehouses_warehouse_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.warehouses_warehouse_id_seq OWNER TO postgres;

--
-- Name: warehouses_warehouse_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.warehouses_warehouse_id_seq OWNED BY public.warehouses.warehouse_id;


--
-- Name: yarn_issue_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.yarn_issue_items (
    item_id integer NOT NULL,
    issue_id integer NOT NULL,
    lot_id integer NOT NULL,
    issued_kg numeric(10,3) NOT NULL,
    returned_kg numeric(10,3) DEFAULT 0,
    consumed_kg numeric(10,3) GENERATED ALWAYS AS ((issued_kg - returned_kg)) STORED
);


ALTER TABLE public.yarn_issue_items OWNER TO postgres;

--
-- Name: yarn_issue_items_item_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.yarn_issue_items_item_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.yarn_issue_items_item_id_seq OWNER TO postgres;

--
-- Name: yarn_issue_items_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.yarn_issue_items_item_id_seq OWNED BY public.yarn_issue_items.item_id;


--
-- Name: yarn_issues; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.yarn_issues (
    issue_id integer NOT NULL,
    issue_number character varying(40) NOT NULL,
    issue_date date DEFAULT CURRENT_DATE NOT NULL,
    machine_id integer,
    machine_name character varying(100),
    issued_by character varying(80),
    received_by character varying(80),
    status character varying(20) DEFAULT 'ISSUED'::character varying,
    notes text,
    created_at timestamp without time zone DEFAULT now(),
    cost_centre_id integer,
    source character varying(20) DEFAULT 'REGULAR'::character varying
);


ALTER TABLE public.yarn_issues OWNER TO postgres;

--
-- Name: yarn_issues_issue_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.yarn_issues_issue_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.yarn_issues_issue_id_seq OWNER TO postgres;

--
-- Name: yarn_issues_issue_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.yarn_issues_issue_id_seq OWNED BY public.yarn_issues.issue_id;


--
-- Name: yarn_lot_movements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.yarn_lot_movements (
    movement_id integer NOT NULL,
    lot_id integer NOT NULL,
    movement_type character varying(30) NOT NULL,
    quantity_kg numeric(10,3) NOT NULL,
    before_kg numeric(10,3),
    after_kg numeric(10,3),
    reference_id integer,
    reference_type character varying(30),
    notes text,
    created_by character varying(80),
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.yarn_lot_movements OWNER TO postgres;

--
-- Name: yarn_lot_movements_movement_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.yarn_lot_movements_movement_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.yarn_lot_movements_movement_id_seq OWNER TO postgres;

--
-- Name: yarn_lot_movements_movement_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.yarn_lot_movements_movement_id_seq OWNED BY public.yarn_lot_movements.movement_id;


--
-- Name: yarn_lots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.yarn_lots (
    lot_id integer NOT NULL,
    lot_number character varying(40) NOT NULL,
    grn_id integer,
    yarn_type character varying(100) NOT NULL,
    count character varying(30),
    color character varying(80) DEFAULT 'Grey'::character varying,
    supplier_lot_no character varying(80),
    net_weight_kg numeric(10,3) NOT NULL,
    cones integer DEFAULT 0,
    rate_per_kg numeric(10,2),
    current_stock_kg numeric(10,3) DEFAULT 0,
    status character varying(20) DEFAULT 'IN_STORE'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    item_id integer,
    low_stock_threshold_kg numeric(10,3),
    source character varying(20) DEFAULT 'REGULAR'::character varying,
    brand character varying(100),
    location character varying(50)
);


ALTER TABLE public.yarn_lots OWNER TO postgres;

--
-- Name: yarn_lots_lot_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.yarn_lots_lot_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.yarn_lots_lot_id_seq OWNER TO postgres;

--
-- Name: yarn_lots_lot_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.yarn_lots_lot_id_seq OWNED BY public.yarn_lots.lot_id;


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: batch_rolls id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.batch_rolls ALTER COLUMN id SET DEFAULT nextval('public.batch_rolls_id_seq'::regclass);


--
-- Name: batches batch_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.batches ALTER COLUMN batch_id SET DEFAULT nextval('public.batches_batch_id_seq'::regclass);


--
-- Name: bins bin_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bins ALTER COLUMN bin_id SET DEFAULT nextval('public.bins_bin_id_seq'::regclass);


--
-- Name: bom_lines bom_line_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bom_lines ALTER COLUMN bom_line_id SET DEFAULT nextval('public.bom_lines_bom_line_id_seq'::regclass);


--
-- Name: cost_centres cc_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cost_centres ALTER COLUMN cc_id SET DEFAULT nextval('public.cost_centres_cc_id_seq'::regclass);


--
-- Name: cost_entries entry_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cost_entries ALTER COLUMN entry_id SET DEFAULT nextval('public.cost_entries_entry_id_seq'::regclass);


--
-- Name: cost_rates rate_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cost_rates ALTER COLUMN rate_id SET DEFAULT nextval('public.cost_rates_rate_id_seq'::regclass);


--
-- Name: cost_snapshots snapshot_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cost_snapshots ALTER COLUMN snapshot_id SET DEFAULT nextval('public.cost_snapshots_snapshot_id_seq'::regclass);


--
-- Name: departments dept_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.departments ALTER COLUMN dept_id SET DEFAULT nextval('public.departments_dept_id_seq'::regclass);


--
-- Name: dispatch_challans dispatch_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dispatch_challans ALTER COLUMN dispatch_id SET DEFAULT nextval('public.dispatch_challans_dispatch_id_seq'::regclass);


--
-- Name: dispatch_items item_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dispatch_items ALTER COLUMN item_id SET DEFAULT nextval('public.dispatch_items_item_id_seq'::regclass);


--
-- Name: doc_series series_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doc_series ALTER COLUMN series_id SET DEFAULT nextval('public.doc_series_series_id_seq'::regclass);


--
-- Name: financial_years fy_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_years ALTER COLUMN fy_id SET DEFAULT nextval('public.financial_years_fy_id_seq'::regclass);


--
-- Name: finished_goods fg_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.finished_goods ALTER COLUMN fg_id SET DEFAULT nextval('public.finished_goods_fg_id_seq'::regclass);


--
-- Name: finishing_records finishing_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.finishing_records ALTER COLUMN finishing_id SET DEFAULT nextval('public.finishing_records_finishing_id_seq'::regclass);


--
-- Name: grn grn_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grn ALTER COLUMN grn_id SET DEFAULT nextval('public.grn_grn_id_seq'::regclass);


--
-- Name: hsn_codes hsn_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hsn_codes ALTER COLUMN hsn_id SET DEFAULT nextval('public.hsn_codes_hsn_id_seq'::regclass);


--
-- Name: item_categories category_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.item_categories ALTER COLUMN category_id SET DEFAULT nextval('public.item_categories_category_id_seq'::regclass);


--
-- Name: items item_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.items ALTER COLUMN item_id SET DEFAULT nextval('public.items_item_id_seq'::regclass);


--
-- Name: machine_downtime id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_downtime ALTER COLUMN id SET DEFAULT nextval('public.machine_downtime_id_seq'::regclass);


--
-- Name: machine_live_data id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_live_data ALTER COLUMN id SET DEFAULT nextval('public.machine_live_data_id_seq'::regclass);


--
-- Name: machine_status_log id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_status_log ALTER COLUMN id SET DEFAULT nextval('public.machine_status_log_id_seq'::regclass);


--
-- Name: maintenance_records id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.maintenance_records ALTER COLUMN id SET DEFAULT nextval('public.maintenance_records_id_seq'::regclass);


--
-- Name: maintenance_schedule schedule_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.maintenance_schedule ALTER COLUMN schedule_id SET DEFAULT nextval('public.maintenance_schedule_schedule_id_seq'::regclass);


--
-- Name: oee_records id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oee_records ALTER COLUMN id SET DEFAULT nextval('public.oee_records_id_seq'::regclass);


--
-- Name: operator_assignments assignment_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operator_assignments ALTER COLUMN assignment_id SET DEFAULT nextval('public.operator_assignments_assignment_id_seq'::regclass);


--
-- Name: operator_attendance attendance_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operator_attendance ALTER COLUMN attendance_id SET DEFAULT nextval('public.operator_attendance_attendance_id_seq'::regclass);


--
-- Name: operators operator_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operators ALTER COLUMN operator_id SET DEFAULT nextval('public.operators_operator_id_seq'::regclass);


--
-- Name: partner_addresses address_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_addresses ALTER COLUMN address_id SET DEFAULT nextval('public.partner_addresses_address_id_seq'::regclass);


--
-- Name: partner_bank bank_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_bank ALTER COLUMN bank_id SET DEFAULT nextval('public.partner_bank_bank_id_seq'::regclass);


--
-- Name: partner_contacts contact_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_contacts ALTER COLUMN contact_id SET DEFAULT nextval('public.partner_contacts_contact_id_seq'::regclass);


--
-- Name: partner_roles role_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_roles ALTER COLUMN role_id SET DEFAULT nextval('public.partner_roles_role_id_seq'::regclass);


--
-- Name: partners partner_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partners ALTER COLUMN partner_id SET DEFAULT nextval('public.partners_partner_id_seq'::regclass);


--
-- Name: process_route_steps step_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_route_steps ALTER COLUMN step_id SET DEFAULT nextval('public.process_route_steps_step_id_seq'::regclass);


--
-- Name: process_routes route_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_routes ALTER COLUMN route_id SET DEFAULT nextval('public.process_routes_route_id_seq'::regclass);


--
-- Name: production_history id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.production_history ALTER COLUMN id SET DEFAULT nextval('public.production_history_id_seq'::regclass);


--
-- Name: production_records id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.production_records ALTER COLUMN id SET DEFAULT nextval('public.production_records_id_seq'::regclass);


--
-- Name: racks rack_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.racks ALTER COLUMN rack_id SET DEFAULT nextval('public.racks_rack_id_seq'::regclass);


--
-- Name: rfid_events event_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rfid_events ALTER COLUMN event_id SET DEFAULT nextval('public.rfid_events_event_id_seq'::regclass);


--
-- Name: sc_challan_yarn_items item_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sc_challan_yarn_items ALTER COLUMN item_id SET DEFAULT nextval('public.sc_challan_yarn_items_item_id_seq'::regclass);


--
-- Name: shift_handovers handover_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shift_handovers ALTER COLUMN handover_id SET DEFAULT nextval('public.shift_handovers_handover_id_seq'::regclass);


--
-- Name: stock_ledger ledger_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_ledger ALTER COLUMN ledger_id SET DEFAULT nextval('public.stock_ledger_ledger_id_seq'::regclass);


--
-- Name: subcontract_challans challan_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subcontract_challans ALTER COLUMN challan_id SET DEFAULT nextval('public.subcontract_challans_challan_id_seq'::regclass);


--
-- Name: subcontract_receipts receipt_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subcontract_receipts ALTER COLUMN receipt_id SET DEFAULT nextval('public.subcontract_receipts_receipt_id_seq'::regclass);


--
-- Name: tax_rates tax_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tax_rates ALTER COLUMN tax_id SET DEFAULT nextval('public.tax_rates_tax_id_seq'::regclass);


--
-- Name: uom uom_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.uom ALTER COLUMN uom_id SET DEFAULT nextval('public.uom_uom_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: warehouses warehouse_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.warehouses ALTER COLUMN warehouse_id SET DEFAULT nextval('public.warehouses_warehouse_id_seq'::regclass);


--
-- Name: yarn_issue_items item_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.yarn_issue_items ALTER COLUMN item_id SET DEFAULT nextval('public.yarn_issue_items_item_id_seq'::regclass);


--
-- Name: yarn_issues issue_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.yarn_issues ALTER COLUMN issue_id SET DEFAULT nextval('public.yarn_issues_issue_id_seq'::regclass);


--
-- Name: yarn_lot_movements movement_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.yarn_lot_movements ALTER COLUMN movement_id SET DEFAULT nextval('public.yarn_lot_movements_movement_id_seq'::regclass);


--
-- Name: yarn_lots lot_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.yarn_lots ALTER COLUMN lot_id SET DEFAULT nextval('public.yarn_lots_lot_id_seq'::regclass);


--
-- Data for Name: app_settings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.app_settings (key, value, updated_at) FROM stdin;
company_name	DHOWN HOSIERY MILLS	2026-07-02 08:44:53.425199
factory_address	E-372 PHASE VI FOCAL POINT DHANDARI KALAN LUDHIANA	2026-07-02 08:44:53.45663
gst_number	03AAYFD5631Q1ZR	2026-07-02 08:44:53.458331
phone_number	+918360180643	2026-07-02 08:44:53.460282
email	dhownhosiery@gmail.com	2026-07-02 08:44:53.461537
website	www.dhownhosiery.com	2026-07-02 08:44:53.462635
report_footer	Generated By DHOWN MES	2026-07-02 08:44:53.463947
roll_id_format	[MACHINE]-[FABRIC]-[DATE]-[SHIFT]-[ROLL]	2026-07-02 08:44:53.464965
downtime_reasons	Yarn Break\nNeedle Break\nPower Failure\nMaintenance\nOperator Absent\nQuality Issue	2026-07-02 08:44:53.466165
downtime_alert_minutes	5	2026-07-02 08:44:53.467817
critical_alert_minutes	30	2026-07-02 08:44:53.469123
collector_offline_alert	10	2026-07-02 08:44:53.470904
default_label_format	QR	2026-07-02 08:44:53.472511
qr_prefix	DHM-QR-	2026-07-02 08:44:53.473945
roll_prefix	DHM-	2026-07-02 08:44:53.475169
auto_downtime_enabled	true	2026-07-02 08:44:53.476652
auto_downtime_threshold_minutes		2026-07-02 08:44:53.477955
day_shift	08:00 - 20:00	2026-07-02 08:44:53.479559
night_shift	20:00 - 08:00	2026-07-02 08:44:53.480817
planned_hours_per_shift	12	2026-07-02 08:44:53.482018
quality_target_pct	100	2026-07-02 08:44:53.48336
shift_a_end	20:00	2026-07-02 08:44:53.488057
shift_a_start	08:00	2026-07-02 08:44:53.490748
shift_b_end	08:00	2026-07-02 08:44:53.491872
shift_b_start	20:00	2026-07-02 08:44:53.492964
shift_c_end	06:00	2026-07-02 08:44:53.494199
shift_c_start	22:00	2026-07-02 08:44:53.495117
shift_mode	2-shift	2026-07-02 08:44:53.496175
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.audit_logs (id, user_id, username, action, module, old_value, new_value, "timestamp") FROM stdin;
1	\N	system	CREATE_USER	USER_MANAGEMENT	\N	Created user test.supervisor (SUPERVISOR)	2026-06-10 15:43:25.66943+05:30
2	\N	system	UPDATE_USER	USER_MANAGEMENT	role=SUPERVISOR active=true	role=OPERATOR active=true	2026-06-10 15:43:26.060301+05:30
3	\N	system	DELETE_USER	USER_MANAGEMENT	Deleted user test.supervisor	\N	2026-06-10 15:43:26.58711+05:30
4	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.00018000	fabric=Cotton 40/1 gauge=24 rpm_target=22 kg_per_counter=0.00019	2026-06-10 15:43:26.673134+05:30
5	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric=Cotton 40/1 gauge=24 rpm_target=22 kg_per_counter=0.00019000	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.00018	2026-06-10 15:43:35.33953+05:30
6	\N	system	UPDATE_USER	USER_MANAGEMENT	role=SUPER_ADMIN active=true	role=SUPER_ADMIN active=true	2026-06-10 15:46:35.319875+05:30
7	\N	system	CREATE_USER	USER_MANAGEMENT	\N	Created user rishu (SUPERVISOR)	2026-06-10 15:47:18.365584+05:30
8	\N	system	UPDATE_USER	USER_MANAGEMENT	role=SUPER_ADMIN active=true	role=SUPER_ADMIN active=true	2026-06-10 15:49:43.511192+05:30
9	\N	system	UPDATE_USER	USER_MANAGEMENT	role=SUPER_ADMIN active=true	role=SUPER_ADMIN active=true	2026-06-10 15:50:09.836222+05:30
10	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.00018000	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.1274	2026-06-10 16:09:12.320683+05:30
11	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.00018000	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.1274	2026-06-10 16:09:25.368253+05:30
12	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.12740000	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.10274	2026-06-10 16:39:17.82917+05:30
13	\N	system	CREATE_USER	USER_MANAGEMENT	\N	Created user testsuper (SUPERVISOR)	2026-06-11 17:27:15.927494+05:30
14	\N	system	DELETE_USER	USER_MANAGEMENT	Deleted user testsuper	\N	2026-06-11 17:29:58.691688+05:30
15	\N	system	UPDATE_USER	USER_MANAGEMENT	role=SUPERVISOR active=true	role=SUPERVISOR active=true	2026-06-12 12:50:58.941807+05:30
16	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.10274000	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.10274000	2026-06-12 16:16:08.099608+05:30
17	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric=2TF gauge=28 rpm_target=23 kg_per_counter=0.00018000	fabric=Fake Cotton Looper gauge=28 rpm_target=23 kg_per_counter=0.00018000	2026-06-12 16:16:25.771939+05:30
18	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric=2TF gauge=28 rpm_target=23 kg_per_counter=0.00018000	fabric=Fake Cotton Looper gauge=28 rpm_target=23 kg_per_counter=0.00018000	2026-06-12 16:16:38.262295+05:30
19	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric=2TF gauge=28 rpm_target=23 kg_per_counter=0.00018000	fabric=Fake Cotton Looper gauge=28 rpm_target=23 kg_per_counter=0.00018000	2026-06-12 16:16:49.84226+05:30
20	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric=2TF gauge=28 rpm_target=23 kg_per_counter=0.00018000	fabric=Fake Cotton Looper gauge=28 rpm_target=23 kg_per_counter=0.00018000	2026-06-12 16:17:02.964076+05:30
21	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric=ANTIPILLING gauge=24 rpm_target=15 kg_per_counter=null	fabric=75/150 gauge=24 rpm_target=15 kg_per_counter=0.01274	2026-06-12 16:17:33.769708+05:30
22	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric=ANTIPILLING gauge=24 rpm_target=15 kg_per_counter=null	fabric=75/150 gauge=24 rpm_target=15 kg_per_counter=0.01274	2026-06-12 16:17:51.246487+05:30
23	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.10274000	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.10274000	2026-06-12 18:17:55.35415+05:30
24	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.00018000	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.00018000	2026-06-12 18:18:53.384843+05:30
25	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.10274000	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.0144833	2026-06-12 18:23:52.602268+05:30
26	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.12740000	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.0144833000	2026-06-12 18:24:03.235682+05:30
27	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.00018000	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.0144833	2026-06-12 18:24:16.1651+05:30
28	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.00018000	fabric=Fake Cotton 3Thread gauge=20 rpm_target=20 kg_per_counter=0.01448333	2026-06-12 18:24:28.4724+05:30
29	\N	system	CREATE_USER	USER_MANAGEMENT	\N	Created user abhishekverma (SUPERVISOR)	2026-06-15 11:35:30.047874+05:30
30	\N	system	UPDATE_USER	USER_MANAGEMENT	role=SUPER_ADMIN active=true	role=SUPER_ADMIN active=true	2026-06-15 12:29:59.003138+05:30
31	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric_code=null gauge=20 rpm_target=20 kg_per_counter=0.01448330	fabric_code=F3F gauge=20 rpm_target=20 kg_per_counter=0.01448330	2026-06-15 15:12:24.978285+05:30
32	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric_code=null gauge=20 rpm_target=20 kg_per_counter=0.01448330	fabric_code=F3F gauge=20 rpm_target=20 kg_per_counter=0.01448330	2026-06-15 15:12:30.390607+05:30
33	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric_code=null gauge=20 rpm_target=20 kg_per_counter=0.01448330	fabric_code=F3F gauge=20 rpm_target=20 kg_per_counter=0.01448330	2026-06-15 15:13:04.251922+05:30
34	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric_code=null gauge=28 rpm_target=23 kg_per_counter=0.00018000	fabric_code=FCL gauge=28 rpm_target=23 kg_per_counter=0.00018000	2026-06-15 15:13:10.737087+05:30
35	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric_code=null gauge=28 rpm_target=23 kg_per_counter=0.00018000	fabric_code=FCL gauge=28 rpm_target=23 kg_per_counter=0.00018000	2026-06-15 15:13:14.272535+05:30
36	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric_code=null gauge=28 rpm_target=23 kg_per_counter=0.00018000	fabric_code=FTL gauge=28 rpm_target=23 kg_per_counter=0.00018000	2026-06-15 15:13:19.218062+05:30
37	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric_code=null gauge=20 rpm_target=20 kg_per_counter=0.01448333	fabric_code=F3F gauge=20 rpm_target=20 kg_per_counter=0.01448333	2026-06-15 15:13:39.752456+05:30
38	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric_code=null gauge=28 rpm_target=23 kg_per_counter=0.00018000	fabric_code=FTL gauge=28 rpm_target=23 kg_per_counter=0.00018000	2026-06-15 15:13:48.301224+05:30
39	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric_code=null gauge=28 rpm_target=26 kg_per_counter=0.00018000	fabric_code=FML gauge=28 rpm_target=26 kg_per_counter=0.00018000	2026-06-15 15:13:53.107311+05:30
40	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric_code=null gauge=28 rpm_target=26 kg_per_counter=0.00018000	fabric_code=FML gauge=28 rpm_target=26 kg_per_counter=0.00018000	2026-06-15 15:13:59.10452+05:30
41	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric_code=null gauge=18 rpm_target=18 kg_per_counter=0.00025000	fabric_code=FSB gauge=18 rpm_target=18 kg_per_counter=0.00025000	2026-06-15 15:14:04.750922+05:30
42	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric_code=null gauge=18 rpm_target=18 kg_per_counter=0.00025000	fabric_code=FRB gauge=18 rpm_target=18 kg_per_counter=0.00025000	2026-06-15 15:14:10.788767+05:30
43	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric_code=null gauge=24 rpm_target=26 kg_per_counter=0.12740000	fabric_code=FRF gauge=24 rpm_target=26 kg_per_counter=0.12740000	2026-06-15 15:14:16.944998+05:30
44	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric_code=null gauge=24 rpm_target=26 kg_per_counter=0.00021000	fabric_code=FRF gauge=24 rpm_target=26 kg_per_counter=0.00021000	2026-06-15 15:14:23.213359+05:30
45	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric_code=null gauge=24 rpm_target=26 kg_per_counter=0.00021000	fabric_code=FRF gauge=24 rpm_target=26 kg_per_counter=0.00021000	2026-06-15 15:14:30.031466+05:30
46	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric_code=null gauge=24 rpm_target=26 kg_per_counter=0.00021000	fabric_code=FRF gauge=24 rpm_target=26 kg_per_counter=0.00021000	2026-06-15 15:14:36.345358+05:30
47	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric_code=null gauge=24 rpm_target=15 kg_per_counter=0.01274000	fabric_code=ATP gauge=24 rpm_target=15 kg_per_counter=0.01274000	2026-06-15 15:15:28.748679+05:30
48	\N	system	UPDATE_MACHINE_SETTINGS	MACHINE_SETTINGS	fabric_code=null gauge=24 rpm_target=15 kg_per_counter=0.01274000	fabric_code=ATP gauge=24 rpm_target=15 kg_per_counter=0.01274000	2026-06-15 15:15:32.897244+05:30
49	\N	admin	UPDATE_USER	USER_MANAGEMENT	role=SUPERVISOR active=true	role=SUPERVISOR active=false	2026-06-22 19:11:11.748802+05:30
50	\N	admin	UPDATE_USER	USER_MANAGEMENT	role=SUPERVISOR active=true	role=SUPERVISOR active=false	2026-06-22 19:11:12.881574+05:30
51	\N	admin	CLOSE_DOWNTIME	DOWNTIME	\N	downtime_id=10	2026-06-27 14:04:42.974215+05:30
52	\N	admin	CLOSE_DOWNTIME	DOWNTIME	\N	downtime_id=11	2026-06-27 14:04:44.380238+05:30
53	\N	admin	DELETE_USER	USER_MANAGEMENT	Deleted user rishu	\N	2026-06-27 14:10:41.50268+05:30
54	\N	admin	DELETE_USER	USER_MANAGEMENT	Deleted user abhishekverma	\N	2026-06-27 14:10:43.58478+05:30
55	\N	admin	CREATE_USER	USER_MANAGEMENT	\N	Created user ROHIT KUMAR (SUPERVISOR)	2026-06-27 14:22:30.247085+05:30
56	\N	admin	UPDATE_USER	USER_MANAGEMENT	role=SUPERVISOR active=true	role=SUPERVISOR active=true	2026-07-02 15:34:21.019825+05:30
57	\N	admin	OPEN_DOWNTIME	DOWNTIME	\N	machine=TV15 reason=Quality Issue	2026-07-02 17:23:41.124834+05:30
58	\N	admin	OPEN_DOWNTIME	DOWNTIME	\N	machine=TV11 reason=Quality Issue	2026-07-02 17:23:48.205521+05:30
59	\N	admin	OPEN_DOWNTIME	DOWNTIME	\N	machine=SJ12 reason=Quality Issue	2026-07-02 17:23:57.465973+05:30
60	\N	admin	OPEN_DOWNTIME	DOWNTIME	\N	machine=SJ16 reason=Quality Issue	2026-07-02 17:24:03.223726+05:30
61	\N	admin	OPEN_DOWNTIME	DOWNTIME	\N	machine=IL09 reason=Maintenance	2026-07-02 17:24:25.879781+05:30
62	\N	admin	OPEN_DOWNTIME	DOWNTIME	\N	machine=IL14 reason=Maintenance	2026-07-02 17:24:33.039171+05:30
63	\N	admin	CREATE_USER	USER_MANAGEMENT	\N	Created user abhishek  (SUPERVISOR)	2026-07-02 18:47:25.323501+05:30
64	\N	admin	UPDATE_USER	USER_MANAGEMENT	role=SUPERVISOR active=true	role=SUPERVISOR active=true	2026-07-02 18:49:27.414835+05:30
65	\N	admin	UPDATE_USER	USER_MANAGEMENT	role=SUPERVISOR active=true	role=SUPERVISOR active=true	2026-07-02 18:50:04.816601+05:30
66	\N	admin	DELETE_USER	USER_MANAGEMENT	Deleted user abhishek 	\N	2026-07-02 18:50:28.481671+05:30
67	\N	admin	CREATE_USER	USER_MANAGEMENT	\N	Created user abhishekverma (SUPERVISOR)	2026-07-02 18:50:57.384929+05:30
68	\N	abhishekverma	APPROVE_ROLL	ROLLS	\N	roll_id=DHM-SJ01-F3F-G20-20260702-D-001 weight=25kg	2026-07-02 18:52:36.941946+05:30
69	\N	admin	CREATE_PARTNER	PARTNERS	\N	partner_id=5 code=PART-0001 name=SAWAN FABRICS	2026-07-02 19:47:12.921376+05:30
70	\N	admin	CREATE_ITEM	ITEMS	\N	item_id=15 code=	2026-07-02 19:49:11.504727+05:30
71	\N	admin	CREATE_ITEM	ITEMS	\N	item_id=16 code=	2026-07-02 19:49:35.407183+05:30
72	\N	admin	CREATE_ITEM	ITEMS	\N	item_id=17 code=	2026-07-02 19:49:50.064603+05:30
73	\N	admin	CREATE_ITEM	ITEMS	\N	item_id=18 code=	2026-07-02 19:50:06.980583+05:30
74	\N	admin	CREATE_ITEM	ITEMS	\N	item_id=19 code=	2026-07-02 19:50:33.188108+05:30
75	\N	admin	CREATE_ITEM	ITEMS	\N	item_id=20 code=	2026-07-02 19:50:44.197311+05:30
76	\N	admin	CREATE_ITEM	ITEMS	\N	item_id=21 code=	2026-07-02 19:51:08.827301+05:30
77	\N	admin	CREATE_ITEM	ITEMS	\N	item_id=22 code=	2026-07-02 19:51:18.819546+05:30
78	\N	admin	CREATE_ITEM	ITEMS	\N	item_id=23 code=	2026-07-02 19:51:35.880633+05:30
79	\N	admin	CREATE_ITEM	ITEMS	\N	item_id=24 code=	2026-07-02 22:08:07.397957+05:30
80	\N	admin	CREATE_LOT	WAREHOUSE	\N	lot=LOT260001 fabric=FAKE RUSSIAN FLEECE rolls=8	2026-07-03 01:22:03.026799+05:30
81	\N	admin	CLOSE_DOWNTIME	DOWNTIME	\N	downtime_id=12	2026-07-03 13:35:27.667692+05:30
82	\N	admin	CLOSE_DOWNTIME	DOWNTIME	\N	downtime_id=14	2026-07-03 13:35:28.595803+05:30
83	\N	admin	CLOSE_DOWNTIME	DOWNTIME	\N	downtime_id=16	2026-07-03 13:35:29.332301+05:30
84	\N	admin	CLOSE_DOWNTIME	DOWNTIME	\N	downtime_id=15	2026-07-03 13:35:30.270407+05:30
85	\N	admin	CLOSE_DOWNTIME	DOWNTIME	\N	downtime_id=13	2026-07-03 13:35:31.187205+05:30
86	\N	admin	CLOSE_DOWNTIME	DOWNTIME	\N	downtime_id=17	2026-07-03 13:35:33.229804+05:30
87	\N	admin	APPROVE_ROLL	ROLLS	\N	roll_id=DHM-SJ02-F3F-G20-20260703-D-001 weight=250kg	2026-07-03 18:07:57.4938+05:30
88	\N	admin	CREATE_PARTNER	PARTNERS	\N	partner_id=6 code=PART-0002 name=GOPIMAL KAUR SAIN INDS. (P) LTD	2026-07-03 20:27:28.819612+05:30
89	\N	admin	CREATE_PARTNER	PARTNERS	\N	partner_id=7 code=PART-0003 name=NAVDURGA ENTERPRISES	2026-07-03 20:30:17.658604+05:30
\.


--
-- Data for Name: batch_rolls; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.batch_rolls (id, batch_id, roll_id, added_at, added_by) FROM stdin;
\.


--
-- Data for Name: batches; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.batches (batch_id, batch_number, fabric_type, color_code, color_name, total_weight_kg, roll_count, status, notes, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: bins; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bins (bin_id, rack_id, code, is_active) FROM stdin;
1	1	B1	t
2	1	B2	t
3	1	B3	t
4	1	B4	t
5	2	B1	t
6	2	B2	t
7	2	B3	t
8	2	B4	t
9	3	B1	t
10	3	B2	t
11	3	B3	t
12	3	B4	t
13	4	B1	t
14	4	B2	t
15	4	B3	t
16	4	B4	t
17	5	B1	t
18	5	B2	t
19	5	B3	t
20	5	B4	t
21	6	B1	t
22	6	B2	t
23	6	B3	t
24	6	B4	t
25	7	B1	t
26	7	B2	t
27	7	B3	t
28	7	B4	t
29	8	B1	t
30	8	B2	t
31	8	B3	t
32	8	B4	t
33	9	B1	t
34	9	B2	t
35	9	B3	t
36	9	B4	t
\.


--
-- Data for Name: bom_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bom_lines (bom_line_id, fabric_item_id, yarn_item_id, percentage, sort_order, created_at, updated_at) FROM stdin;
1	2	15	40.00	0	2026-07-02 22:06:00.713351+05:30	2026-07-02 22:06:00.713351+05:30
2	2	17	11.54	1	2026-07-02 22:06:00.713351+05:30	2026-07-02 22:06:00.713351+05:30
3	2	18	48.46	2	2026-07-02 22:06:00.713351+05:30	2026-07-02 22:06:00.713351+05:30
5	5	15	100.00	0	2026-07-02 22:07:08.581731+05:30	2026-07-02 22:07:08.581731+05:30
6	8	24	4.00	0	2026-07-02 22:17:33.087672+05:30	2026-07-02 22:17:33.087672+05:30
7	8	21	96.00	1	2026-07-02 22:17:33.087672+05:30	2026-07-02 22:17:33.087672+05:30
8	6	24	4.00	0	2026-07-02 22:18:27.114172+05:30	2026-07-02 22:18:27.114172+05:30
9	6	15	96.00	1	2026-07-02 22:18:27.114172+05:30	2026-07-02 22:18:27.114172+05:30
12	1	23	65.00	0	2026-07-02 22:19:08.10722+05:30	2026-07-02 22:19:08.10722+05:30
13	1	17	35.00	1	2026-07-02 22:19:08.10722+05:30	2026-07-02 22:19:08.10722+05:30
14	7	15	42.11	0	2026-07-02 22:20:46.821756+05:30	2026-07-02 22:20:46.821756+05:30
15	7	17	14.57	1	2026-07-02 22:20:46.821756+05:30	2026-07-02 22:20:46.821756+05:30
16	7	16	43.32	2	2026-07-02 22:20:46.821756+05:30	2026-07-02 22:20:46.821756+05:30
17	10	15	42.11	0	2026-07-02 22:21:23.982153+05:30	2026-07-02 22:21:23.982153+05:30
18	10	17	14.57	1	2026-07-02 22:21:23.982153+05:30	2026-07-02 22:21:23.982153+05:30
19	10	16	43.32	2	2026-07-02 22:21:23.982153+05:30	2026-07-02 22:21:23.982153+05:30
20	9	15	100.00	0	2026-07-02 22:22:54.638164+05:30	2026-07-02 22:22:54.638164+05:30
21	3	15	100.00	0	2026-07-02 22:23:02.925324+05:30	2026-07-02 22:23:02.925324+05:30
22	4	15	100.00	0	2026-07-02 22:23:27.873816+05:30	2026-07-02 22:23:27.873816+05:30
\.


--
-- Data for Name: cost_centres; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.cost_centres (cc_id, code, name, dept_id, is_active) FROM stdin;
1	CC-KNIT	Knitting Cost Centre	1	t
2	CC-DYE	Dye House Cost Centre	2	t
3	CC-FIN	Finishing Cost Centre	3	t
4	CC-WH	Warehouse Cost Centre	5	t
5	CC-OVHD	Overheads	7	t
\.


--
-- Data for Name: cost_entries; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.cost_entries (entry_id, reference_type, reference_id, cost_component, amount_rs, quantity_kg, rate_used, fabric_type, color_name, notes, created_at) FROM stdin;
2	ROLL	DHM-SJ02-F3F-G20-20260703-D-001	KNITTING_COST	3750.00	250.000	15.00	Fake Cotton 3Thread	\N	In-house knitting: FAKE COTTON 3THREAD @ ₹15/kg	2026-07-03 18:07:57.557339
\.


--
-- Data for Name: cost_rates; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.cost_rates (rate_id, yarn_type, price_per_kg, labour_per_shift, machine_depreciation_per_hour, notes, updated_by, updated_at, item_id) FROM stdin;
1	Cotton 40s	180.00	800.00	25.00	\N	system	2026-07-01 21:23:50.521332	\N
2	Cotton 60s	220.00	800.00	25.00	\N	system	2026-07-01 21:23:50.53356	\N
3	Polyester 40s	120.00	800.00	20.00	\N	system	2026-07-01 21:23:50.534764	\N
4	Polyester 60s	150.00	800.00	20.00	\N	system	2026-07-01 21:23:50.535851	\N
5	Cotton/Poly Blend	160.00	800.00	22.00	\N	system	2026-07-01 21:23:50.536854	\N
6	Viscose	200.00	800.00	28.00	\N	system	2026-07-01 21:23:50.538024	\N
7	Default	170.00	800.00	25.00	\N	system	2026-07-01 21:23:50.538898	\N
\.


--
-- Data for Name: cost_snapshots; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.cost_snapshots (snapshot_id, snapshot_date, fabric_type, color_name, total_cost_rs, total_kg, cost_per_kg, selling_price_kg, margin_rs, created_at) FROM stdin;
\.


--
-- Data for Name: data_collectors; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.data_collectors (dc_id, machine_id, ip_address, status, last_seen) FROM stdin;
WD250429	SJ03	\N	OFFLINE	\N
\.


--
-- Data for Name: departments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.departments (dept_id, code, name, head_user, is_active) FROM stdin;
1	KNITTING	Knitting	\N	t
2	DYEHOUSE	Dye House	\N	t
3	FINISHING	Finishing	\N	t
4	QA	Quality Assurance	\N	t
5	WAREHOUSE	Warehouse	\N	t
6	ACCOUNTS	Accounts	\N	t
7	ADMIN	Administration	\N	t
\.


--
-- Data for Name: dispatch_challans; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.dispatch_challans (dispatch_id, dispatch_number, customer_name, customer_contact, dispatch_date, total_weight_kg, status, notes, created_by, created_at, vehicle_number, partner_id, dispatch_type, total_taxable_value, total_gst, grand_total) FROM stdin;
\.


--
-- Data for Name: dispatch_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.dispatch_items (item_id, dispatch_id, fg_id, weight_kg, fabric_type, color_name, item_type, roll_id, lot_id, item_description, lot_number, yarn_type, color, rate_per_kg, gst_rate, taxable_value, gst_amount, line_total) FROM stdin;
\.


--
-- Data for Name: doc_series; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.doc_series (series_id, series_code, prefix, suffix, include_year, include_month, zero_pad, current_seq, fin_year, reset_yearly, last_reset, created_at, updated_at) FROM stdin;
1	GRN	GRN		t	f	4	0	\N	t	\N	2026-07-02 00:03:09.939884	2026-07-02 00:03:09.939884
3	ISS	ISS		t	f	4	0	\N	t	\N	2026-07-02 00:03:09.939884	2026-07-02 00:03:09.939884
5	SC	SC		t	f	4	0	\N	t	\N	2026-07-02 00:03:09.939884	2026-07-02 00:03:09.939884
6	DC	DC		t	f	4	0	\N	t	\N	2026-07-02 00:03:09.939884	2026-07-02 00:03:09.939884
7	ITEM	ITM		f	f	5	0	\N	f	\N	2026-07-02 00:03:09.939884	2026-07-02 00:03:09.939884
8	PART	PART		f	f	5	0	\N	f	\N	2026-07-02 00:03:09.939884	2026-07-02 00:03:09.939884
9	PO	PO		t	f	4	0	\N	t	\N	2026-07-02 00:03:09.939884	2026-07-02 00:03:09.939884
2	LOT	LOT		t	f	4	1	2026-27	t	2026-07-03	2026-07-02 00:03:09.939884	2026-07-03 01:22:03.077434
\.


--
-- Data for Name: fabric_types; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.fabric_types (code, name, description, created_at) FROM stdin;
FRF	FAKE RUSSIAN FLEECE 	FAKE RUSSIAN FLEECE 350 GSM 	2026-06-15 15:09:49.551562
F3F	FAKE COTTON 3THREAD	FAKE COTTON 3 THREAD  350 GSM	2026-06-15 15:08:21.253978
FRB	FAKE RIB 2X1	FAKE RIB 2X1 LYCRA	2026-06-15 15:10:29.80085
FSB	FAKE SAP RIB 2X1	FAKE SAP RIB 2X1	2026-06-15 15:10:47.927744
FCL	FAKE COTTON LYCRA	FAKE COTTON LYCRA 32S 200 GSM	2026-06-15 15:11:17.253581
FML	FAKE COTTON MATTY LYCRA	 FAKE COTTON MATTY LYCRA 32S 190 GSM 	2026-06-15 15:11:40.25913
FCT	FAKE COTTON LYCRA COLLAR AND TAPE 	FAKE COTTON LYCRA COLLAR AN TAPE 18.25"	2026-06-15 15:12:11.757683
FTL	FAKE TERRY LYCRA 	FAKE COTTON TERRY LYCRA 32S 240 GSM	2026-06-15 15:12:54.631046
ATP	75/100 ANTIPILLING 	75/36* 100/144 DTY ANTIPILLING 180 GSM	2026-06-15 15:15:21.851288
SRF	SAP RUSSIAN FLEECE 	160/144 FD FLEECE * 150/216/2	2026-06-27 14:11:57.947304
\.


--
-- Data for Name: financial_years; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.financial_years (fy_id, label, start_date, end_date, is_active, is_closed) FROM stdin;
1	2025-26	2025-04-01	2026-03-31	f	t
2	2026-27	2026-04-01	2027-03-31	t	f
\.


--
-- Data for Name: finished_goods; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.finished_goods (fg_id, receipt_id, batch_id, fabric_type, color_code, color_name, weight_kg, roll_count, status, location, created_at, updated_at, source, lot_no) FROM stdin;
\.


--
-- Data for Name: finishing_records; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.finishing_records (finishing_id, receipt_id, batch_id, shade, gsm, moisture_pct, shrinkage_pct, damage_kg, qa_passed, qa_notes, finished_by, finished_at) FROM stdin;
\.


--
-- Data for Name: grn; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.grn (grn_id, grn_number, supplier_name, supplier_invoice, receipt_date, vehicle_number, received_by, status, notes, created_at, updated_at, partner_id, warehouse_id) FROM stdin;
\.


--
-- Data for Name: hsn_codes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.hsn_codes (hsn_id, hsn_code, description, gst_rate) FROM stdin;
7	60069000	Knitted or crocheted fabrics - other	5.00
8	60063200	Knitted or crocheted fabrics of cotton	5.00
9	52052000	Cotton yarn multiple/cabled not retail	5.00
10	55092100	Yarn of polyester staple fibres single	12.00
11	54023300	Textured yarn of polyester synthetic filament	12.00
12	998821	Job work services on textiles and fabrics	5.00
\.


--
-- Data for Name: item_categories; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.item_categories (category_id, code, name, description, parent_id, is_active) FROM stdin;
1	YARN	Yarn	Raw material — yarn	\N	t
5	SPARES	Spares & Accessories	Machine spare parts	\N	t
8	PACKING	Packing Material	Bags, cartons, labels	\N	t
9	SERVICES	Services	Job work and external services	\N	t
2	FABRIC	Fabric	Knitted fabric before processing	\N	t
\.


--
-- Data for Name: item_fabric_attrs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.item_fabric_attrs (item_id, fabric_code, structure, gsm, finished_gsm, width_cm, finished_width_cm, machine_type, gauge, dia_inches, feeders, stitch_length_mm, process_route_id) FROM stdin;
2	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
15	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
16	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
17	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
18	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
19	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
20	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
21	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
5	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
8	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
6	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
1	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
7	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
10	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
9	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
3	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
4	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
\.


--
-- Data for Name: item_spare_attrs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.item_spare_attrs (item_id, oem_part_number, compatible_machine, rack_bin, warranty_months, default_partner_id) FROM stdin;
2	\N	\N	\N	\N	\N
15	\N	\N	\N	\N	\N
16	\N	\N	\N	\N	\N
17	\N	\N	\N	\N	\N
18	\N	\N	\N	\N	\N
19	\N	\N	\N	\N	\N
20	\N	\N	\N	\N	\N
21	\N	\N	\N	\N	\N
5	\N	\N	\N	\N	\N
8	\N	\N	\N	\N	\N
6	\N	\N	\N	\N	\N
1	\N	\N	\N	\N	\N
7	\N	\N	\N	\N	\N
10	\N	\N	\N	\N	\N
9	\N	\N	\N	\N	\N
3	\N	\N	\N	\N	\N
4	\N	\N	\N	\N	\N
\.


--
-- Data for Name: item_yarn_attrs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.item_yarn_attrs (item_id, count, composition, shade, yarn_type, default_partner_id, pref_warehouse_id, pref_rack_id) FROM stdin;
2					\N	\N	\N
15					\N	\N	\N
16					\N	\N	\N
17					\N	\N	\N
18					\N	\N	\N
19					\N	\N	\N
20					\N	\N	\N
21					\N	\N	\N
5					\N	\N	\N
8					\N	\N	\N
6					\N	\N	\N
1					\N	\N	\N
7					\N	\N	\N
10					\N	\N	\N
9					\N	\N	\N
3					\N	\N	\N
4					\N	\N	\N
\.


--
-- Data for Name: items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.items (item_id, item_code, item_name, category_id, description, uom_id, hsn_id, gst_rate, standard_cost, status, is_active, created_by, created_at, updated_at, knitting_rate_per_kg, standard_loss_pct) FROM stdin;
7	FRF	FAKE RUSSIAN FLEECE 	2	FAKE RUSSIAN FLEECE 350 GSM 	1	7	5.00	0.00	ACTIVE	t	\N	2026-07-02 01:24:48.576636	2026-07-02 22:20:50.790713	20.00	1.00
10	SRF	SAP RUSSIAN FLEECE 	2	160/144 FD FLEECE * 150/216/2	1	7	5.00	0.00	ACTIVE	t	\N	2026-07-02 01:24:48.582703	2026-07-02 22:21:27.905703	20.00	1.00
9	FTL	FAKE TERRY LYCRA 	2	FAKE COTTON TERRY LYCRA 32S 240 GSM	1	7	5.00	0.00	ACTIVE	t	\N	2026-07-02 01:24:48.580921	2026-07-02 22:22:56.31747	12.00	1.00
3	FCL	FAKE COTTON LYCRA	2	FAKE COTTON LYCRA 32S 200 GSM	1	7	5.00	0.00	ACTIVE	t	\N	2026-07-02 01:24:48.562692	2026-07-02 22:23:04.747728	12.00	1.00
4	FCT	FAKE COTTON LYCRA COLLAR AND TAPE 	2	FAKE COTTON LYCRA COLLAR AN TAPE 18.25"	1	7	5.00	0.00	ACTIVE	t	\N	2026-07-02 01:24:48.565539	2026-07-02 22:23:31.018373	30.00	1.00
2	F3F	FAKE COTTON 3THREAD	2	FAKE COTTON 3 THREAD  350 GSM	1	7	5.00	0.00	ACTIVE	t	\N	2026-07-02 01:24:48.560532	2026-07-02 15:51:49.766435	15.00	1.00
15	YAR-0001	FAKE COTTON 32S	1		1	11	5.00	0.00	ACTIVE	t	admin	2026-07-02 19:49:11.504727	2026-07-02 19:49:11.504727	\N	1.00
16	YAR-0002	150/216 	1		1	11	5.00	0.00	ACTIVE	t	admin	2026-07-02 19:49:35.407183	2026-07-02 19:49:35.407183	\N	1.00
17	YAR-0003	75/36	1		1	11	5.00	0.00	ACTIVE	t	admin	2026-07-02 19:49:50.064603	2026-07-02 19:49:50.064603	\N	1.00
18	YAR-0004	10S SPUN	1		1	10	5.00	0.00	ACTIVE	t	admin	2026-07-02 19:50:06.980583	2026-07-02 19:50:06.980583	\N	1.00
19	YAR-0005	150/108	1		1	11	5.00	0.00	ACTIVE	t	admin	2026-07-02 19:50:33.188108	2026-07-02 19:50:33.188108	\N	1.00
20	YAR-0006	150/288	1		1	11	5.00	0.00	ACTIVE	t	admin	2026-07-02 19:50:44.197311	2026-07-02 19:50:44.197311	\N	1.00
21	YAR-0007	160/144 FD	1		1	11	5.00	0.00	ACTIVE	t	admin	2026-07-02 19:51:08.827301	2026-07-02 19:51:08.827301	\N	1.00
22	YAR-0008	150/144 FD	1		1	11	5.00	0.00	ACTIVE	t	admin	2026-07-02 19:51:18.819546	2026-07-02 19:51:18.819546	\N	1.00
23	YAR-0009	150/144	1		1	11	5.00	0.00	ACTIVE	t	admin	2026-07-02 19:51:35.880633	2026-07-02 19:51:35.880633	\N	1.00
5	FML	FAKE COTTON MATTY LYCRA	2	 FAKE COTTON MATTY LYCRA 32S 190 GSM 	1	7	5.00	0.00	ACTIVE	t	\N	2026-07-02 01:24:48.569143	2026-07-02 22:07:12.594236	12.00	1.00
24	YAR-0010	70D spandex	1		1	11	5.00	0.00	ACTIVE	t	admin	2026-07-02 22:08:07.397957	2026-07-02 22:08:07.397957	\N	1.00
8	FSB	SAP RIB 2X1	2	SAP RIB 2X1	1	7	5.00	0.00	ACTIVE	t	\N	2026-07-02 01:24:48.578632	2026-07-02 22:17:43.687796	20.00	1.00
6	FRB	FAKE RIB 2X1	2	FAKE RIB 2X1 LYCRA	1	7	5.00	0.00	ACTIVE	t	\N	2026-07-02 01:24:48.573516	2026-07-02 22:18:30.622283	20.00	1.00
1	ATP	75/100 ANTIPILLING 	2	75/36* 100/144 DTY ANTIPILLING 180 GSM	1	7	5.00	0.00	ACTIVE	t	\N	2026-07-02 01:24:48.530387	2026-07-02 22:18:57.106703	12.00	1.00
\.


--
-- Data for Name: machine_downtime; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.machine_downtime (id, machine_id, reason, start_time, end_time, duration_minutes, status, source, shift) FROM stdin;
3	SJ01	Yarn Break	2026-06-10 13:42:04.014324	2026-06-10 13:42:15.357694	0.00	CLOSED	MANUAL	\N
4	SJ01	Operator Absent	2026-06-12 17:43:09.981709	2026-06-12 18:57:25.098509	74.25	CLOSED	MANUAL	D
5	TV15	Quality Issue	2026-06-12 18:01:26.883416	2026-06-15 15:36:54.18006	4175.45	CLOSED	MANUAL	D
7	SJ16	Maintenance	2026-06-12 18:02:02.740788	2026-06-15 15:36:56.239439	4174.89	CLOSED	MANUAL	D
8	SJ12	Maintenance	2026-06-12 18:02:17.241656	2026-06-15 15:36:57.145893	4174.67	CLOSED	MANUAL	D
6	TV11	Quality Issue	2026-06-12 18:01:33.069276	2026-06-15 15:36:59.573817	4175.44	CLOSED	MANUAL	D
9	TV15	Operator Absent	2026-06-15 17:57:49.803945	2026-06-15 17:58:14.695165	0.41	CLOSED	MANUAL	A
10	TV15	Operator Absent	2026-06-15 17:58:06.539393	2026-06-27 14:04:42.963045	17046.61	CLOSED	MANUAL	A
11	TV11	Operator Absent	2026-06-15 17:58:26.898919	2026-06-27 14:04:44.378106	17046.29	CLOSED	MANUAL	A
12	TV15	Quality Issue	2026-07-02 17:23:41.092304	2026-07-03 13:35:27.619823	1211.78	CLOSED	MANUAL	D
14	SJ12	Quality Issue	2026-07-02 17:23:57.460054	2026-07-03 13:35:28.591531	1211.52	CLOSED	MANUAL	D
16	IL09	Maintenance	2026-07-02 17:24:25.874274	2026-07-03 13:35:29.329157	1211.06	CLOSED	MANUAL	D
15	SJ16	Quality Issue	2026-07-02 17:24:03.220188	2026-07-03 13:35:30.268745	1211.45	CLOSED	MANUAL	D
13	TV11	Quality Issue	2026-07-02 17:23:48.20243	2026-07-03 13:35:31.186071	1211.72	CLOSED	MANUAL	D
17	IL14	Maintenance	2026-07-02 17:24:33.035142	2026-07-03 13:35:33.228539	1211.00	CLOSED	MANUAL	D
\.


--
-- Data for Name: machine_live_data; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.machine_live_data (id, machine_id, rpm, status, production_counter, operator_name, shift, "timestamp", dc_status, operator_id, previous_counter, session_production_kg, last_status) FROM stdin;
2	SJ01	0	\N	0.00	\N	\N	2026-06-27 15:26:37.229388	OFFLINE	\N	0	0	OFFLINE
\.


--
-- Data for Name: machine_status_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.machine_status_log (id, machine_id, status, shift, start_time, end_time, duration_minutes) FROM stdin;
1	SJ01	RUNNING	D	2026-06-10 14:52:31.452221	\N	\N
\.


--
-- Data for Name: machines; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.machines (machine_id, machine_name, machine_type, diameter, gauge, feeders, active, fabric, dc_id, rpm_target, machine_status, kg_per_counter, dc_status, fabric_code, manufacturer, model, serial_number, needles_count, cylinder_diameter, purchase_date, installation_date) FROM stdin;
SJ06	SJ-06	SJ	34	28	136	t	Fake Cotton Looper	DC006	23	OFFLINE	0.00018000	online	FCL	\N	\N	\N	\N	\N	\N	\N
SJ07	SJ-07	SJ	34	28	136	t	Fake Cotton Looper	DC007	23	OFFLINE	0.00018000	\N	FCL	\N	\N	\N	\N	\N	\N	\N
SJ08	SJ-08	SJ	34	28	136	t	Fake Cotton Looper	DC008	23	OFFLINE	0.00018000	\N	FTL	\N	\N	\N	\N	\N	\N	\N
SJ13	SJ-13	SJ	34	20	102	t	Fake Cotton 3Thread	DC013	20	OFFLINE	0.01448333	\N	F3F	\N	\N	\N	\N	\N	\N	\N
SJ17	SJ-17	SJ	34	28	136	t	Fake Cotton Looper	DC017	23	OFFLINE	0.00018000	\N	FTL	\N	\N	\N	\N	\N	\N	\N
RB04	RB-04	RB	34	18	60	t	Fake Rib 2x1	DC004	18	OFFLINE	0.00025000	\N	FSB	\N	\N	\N	\N	\N	\N	\N
RB05	RB-05	RB	34	18	60	t	Fake S Rib 2x1	DC005	18	OFFLINE	0.00025000	\N	FRB	\N	\N	\N	\N	\N	\N	\N
IL10	IL-10	IL	34	24	72	t	Fake Russian Fkeece	DC010	26	OFFLINE	0.00021000	\N	FRF	\N	\N	\N	\N	\N	\N	\N
IL18	IL-18	IL	34	24	72	t	Fake Russian Fkeece	DC018	26	OFFLINE	0.00021000	\N	FRF	\N	\N	\N	\N	\N	\N	\N
SJ02	SJ-02	SJ	34	20	102	t	Fake Cotton 3Thread	\N	20	OFFLINE	0.01448330	offline	F3F	\N	\N	\N	\N	\N	\N	\N
SJ03	SJ-03	SJ	34	20	102	t	Fake Cotton 3Thread	WD250429	20	OFFLINE	0.01448330	\N	F3F	\N	\N	\N	\N	\N	\N	\N
SJ01	SJ-01	SJ	34	20	90	t	Fake Cotton 3Thread	\N	20	STOPPED	0.01448330	online	F3F	\N	\N	\N	\N	\N	\N	\N
TV15	TV-15	TV	30	24	48	t	75/150	DC015	15	STOPPED	0.01274000	\N	ATP	\N	\N	\N	\N	\N	\N	\N
TV11	TV-11	TV	30	24	48	t	75/150	DC011	15	STOPPED	0.01274000	\N	ATP	\N	\N	\N	\N	\N	\N	\N
SJ12	SJ-12	SJ	30	28	90	t	FAKE MATTY	DC012	26	STOPPED	0.00018000	\N	FML	\N	\N	\N	\N	\N	\N	\N
SJ16	SJ-16	SJ	30	28	90	t	FAKE MATTY	DC016	26	STOPPED	0.00018000	\N	FML	\N	\N	\N	\N	\N	\N	\N
IL09	IL-09	IL	34	24	72	t	Fake Russian Fkeece	DC009	26	STOPPED	0.12740000	online	FRF	\N	\N	\N	\N	\N	\N	\N
IL14	IL-14	IL	34	24	72	t	Fake Russian Fkeece	DC014	26	STOPPED	0.00021000	\N	FRF	\N	\N	\N	\N	\N	\N	\N
\.


--
-- Data for Name: maintenance_records; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.maintenance_records (id, machine_id, maintenance_type, technician, remarks, maintenance_date, next_service_date, status) FROM stdin;
\.


--
-- Data for Name: maintenance_schedule; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.maintenance_schedule (schedule_id, machine_id, task_name, task_type, frequency_days, frequency_hours, last_done_date, last_done_hours, next_due_date, next_due_hours, assigned_to, priority, notes, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: oee_records; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.oee_records (id, machine_id, record_date, shift, planned_minutes, run_minutes, stopped_minutes, availability, performance, quality, oee, production_kg, rpm_avg, sample_count, updated_at) FROM stdin;
1	SJ01	2026-06-10	D	480	0.00024085	0	0	100	100	0	0.0144	280	1	2026-06-10 14:52:31.511047
2	SJ01	2026-06-12	D	480	0	0	0	100	100	0	23.89745	319.00	2	2026-06-12 18:59:03.086839
\.


--
-- Data for Name: operator_assignments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.operator_assignments (assignment_id, operator_id, machine_id, assigned_at, released_at, status, operator_name) FROM stdin;
9	6	SJ01	2026-07-02 15:18:56.285539	2026-07-02 17:33:56.624744	RELEASED	BIRJAN YADAV
10	6	SJ06	2026-07-02 15:19:05.241309	2026-07-02 17:34:09.559273	RELEASED	BIRJAN YADAV
11	6	SJ01	2026-07-02 17:33:56.642502	2026-07-02 18:51:55.726386	RELEASED	BIRJAN YADAV
12	7	SJ06	2026-07-02 17:34:09.565995	2026-07-02 18:52:04.074585	RELEASED	PAPPU YADAV
14	9	SJ06	2026-07-02 18:52:04.078598	2026-07-03 00:49:35.14362	RELEASED	MAKUSUDAN YADAV
13	9	SJ01	2026-07-02 18:51:55.735361	2026-07-03 00:49:37.939479	RELEASED	MAKUSUDAN YADAV
\.


--
-- Data for Name: operator_attendance; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.operator_attendance (attendance_id, operator_id, operator_name, work_date, shift, clock_in, clock_out, last_seen, scan_count, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: operators; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.operators (operator_id, operator_code, operator_name, rfid_tag, mobile, status, created_at, department, shift, updated_at, employee_id, join_date, skill_level, emergency_contact) FROM stdin;
7	OP0002	PAPPU YADAV	RFID0002	8795783171	ACTIVE	2026-06-11 16:26:38.840905	Knitting	D	2026-06-12 12:52:02.722235	\N	\N	BASIC	\N
6	OP0001	BIRJAN YADAV	RFID0001	7814870155	ACTIVE	2026-06-10 17:12:27.718226	Knitting	D	2026-06-12 12:52:34.693554	\N	\N	BASIC	\N
8	OP003 	VIJAY 	RFID0003		ACTIVE	2026-07-02 17:46:53.401365	Knitting	D	2026-07-02 17:50:16.161868	EMP003	\N	INTERMEDIATE	\N
9	OP004	MAKUSUDAN YADAV	RFID0004	\N	ACTIVE	2026-07-02 17:50:51.306611	Knitting	D	2026-07-02 17:50:51.306611	EMP004	\N	BASIC	\N
11	OP006	ROSHAN GUPTA	RFID0006	\N	ACTIVE	2026-07-02 17:52:32.587828	Knitting	D	2026-07-02 17:52:32.587828	EMO006	\N	BASIC	\N
12	OP007	RAKSHAK	RFID0007	\N	ACTIVE	2026-07-02 17:53:04.838798	Knitting	D	2026-07-02 17:53:04.838798	EMP007	\N	BASIC	\N
13	HL008	AJEET	\N	\N	INACTIVE	2026-07-02 17:53:49.952397	General	D	2026-07-02 17:55:38.51872	EMP008	\N	BASIC	\N
14	HL009	DILIP	\N	\N	INACTIVE	2026-07-02 17:54:09.485574	General	D	2026-07-02 17:55:40.846199	EMP009	\N	BASIC	\N
15	HL010	GOLU	\N	\N	INACTIVE	2026-07-02 17:54:51.68868	General	D	2026-07-02 17:55:43.042949	EMP010	\N	BASIC	\N
16	HL011	PARDESI	\N	\N	INACTIVE	2026-07-02 17:55:18.110559	General	D	2026-07-02 17:55:49.53714	EMP011	\N	BASIC	\N
10	OP005	RADHEY SHYAM	RFID0005	\N	ACTIVE	2026-07-02 17:52:01.038338	Knitting	D	2026-07-02 17:56:06.628051	EMP005	\N	BASIC	\N
\.


--
-- Data for Name: partner_addresses; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.partner_addresses (address_id, partner_id, address_type, line1, line2, city, state, pincode, country, gstin, is_default) FROM stdin;
4	5	PRIMARY	B45 E PHASE VI FOCAL POINT 	\N	LUDHIANA	PUNJAB 	141010	India	\N	t
\.


--
-- Data for Name: partner_bank; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.partner_bank (bank_id, partner_id, bank_name, branch, account_no, ifsc, account_type, is_default) FROM stdin;
3	5	STATE BANK OF INDIA 	\N	36939506322	SBIN0006062	CURRENT	t
\.


--
-- Data for Name: partner_contacts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.partner_contacts (contact_id, partner_id, name, designation, mobile, email, whatsapp, is_primary) FROM stdin;
4	5	NAKUL DHAWAN	\N	735569999	sawanfabrics@gmail.com	\N	t
5	6	PANKAJ BHARDWAJ	\N	9914016840		\N	t
6	7	NAVEEN BANSAL	\N	9316920047		\N	t
\.


--
-- Data for Name: partner_roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.partner_roles (role_id, partner_id, role, is_primary) FROM stdin;
5	5	CUSTOMER	f
8	7	SUPPLIER	f
9	6	SUPPLIER	f
\.


--
-- Data for Name: partners; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.partners (partner_id, partner_code, company_name, short_name, gstin, pan, tan, iec, cin, msme_number, msme_category, payment_terms, credit_limit, credit_days, rating, notes, is_active, created_by, created_at, updated_at) FROM stdin;
5	PART-0001	SAWAN FABRICS	\N	03AMBPD4317N2ZC	AMBPD4317N	\N	\N	\N	\N	\N	30	\N	0	\N	\N	t	admin	2026-07-02 19:47:12.921376	2026-07-02 19:47:12.921376
7	PART-0003	NAVDURGA ENTERPRISES	\N	03ACJPK7703R1Z7	ACJPK7703R	\N	\N	\N	\N	\N	30	\N	0	\N	\N	t	admin	2026-07-03 20:30:17.658604	2026-07-03 20:30:17.658604
6	PART-0002	GOPIMAL KAUR SAIN INDS. (P) LTD	\N	03AAFCG1369Q1ZA	AAFCG1369Q	\N	\N	\N	\N	\N	30	\N	0	\N	\N	t	admin	2026-07-03 20:27:28.819612	2026-07-03 20:31:18.129071
\.


--
-- Data for Name: process_route_steps; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.process_route_steps (step_id, route_id, step_order, step_code, step_name, location_type, dept_id, generates_document, is_optional) FROM stdin;
1	1	1	YARN_RECEIPT	Yarn Receipt	INTERNAL	5	GRN	f
2	1	2	KNITTING	Knitting	INTERNAL	1	\N	f
3	1	3	ROLL_APPROVAL	Roll QC & Approval	INTERNAL	4	\N	f
4	1	4	BATCHING	Batching for Dye	INTERNAL	5	BATCH_SLIP	f
5	1	5	DYE_DISPATCH	Dispatch to Dye House	EXTERNAL	5	SC_CHALLAN	f
6	1	6	DYE_RECEIPT	Receipt from Dye	INTERNAL	5	GRN	f
7	1	7	FINISHING	Finishing & QA	INTERNAL	3	\N	t
8	1	8	FG_ENTRY	Finished Goods Entry	INTERNAL	5	\N	f
9	1	9	DISPATCH	Customer Dispatch	INTERNAL	5	DC	f
10	2	1	YARN-RECV	Receive Yarn from Customer	INTERNAL	\N	GRN	f
11	2	4	QA-GREIGE	Greige QA & Weighing	INTERNAL	\N	\N	f
12	2	2	YARN-ISSUE	Issue Yarn to Machine	INTERNAL	\N	YARN_ISSUE	f
13	2	5	ROLL-STORE	Store Greige Rolls	INTERNAL	\N	\N	f
14	2	3	KNITTING	Knitting (In House)	INTERNAL	\N	\N	f
15	2	6	CUST-RETURN	Return Rolls + Balance Yarn to Customer	INTERNAL	\N	SC_RECEIPT	f
16	3	1	YARN-ISSUE	Issue Yarn from Store	INTERNAL	\N	YARN_ISSUE	f
17	3	2	SC-DISPATCH	Dispatch Yarn to Knitter (SC Challan)	EXTERNAL	\N	SC_CHALLAN	f
18	3	3	KNITTING	Knitting at Vendor	EXTERNAL	\N	\N	f
19	3	4	SC-RECEIVE	Receive Greige Rolls + Balance Yarn	INTERNAL	\N	SC_RECEIPT	f
20	3	5	QA-GREIGE	Greige QA & Weighing	INTERNAL	\N	\N	f
21	3	6	GREIGE-STORE	Store in Greige Warehouse	INTERNAL	\N	\N	f
22	4	1	GREIGE-QA	Greige QA & Final Weighing	INTERNAL	\N	\N	t
23	4	2	INVOICE	Raise Sale Invoice	INTERNAL	\N	INVOICE	f
24	4	3	DISPATCH	Dispatch — Delivery Challan	INTERNAL	\N	DISPATCH	f
25	5	1	YARN-WEIGH	Weigh & Confirm Lot	INTERNAL	\N	\N	t
26	5	2	INVOICE	Raise Sale Invoice	INTERNAL	\N	INVOICE	f
27	5	3	DISPATCH	Dispatch — Delivery Challan	INTERNAL	\N	DISPATCH	f
\.


--
-- Data for Name: process_routes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.process_routes (route_id, code, name, description, item_category, is_active, created_by, created_at) FROM stdin;
1	KNIT-STD	Standard Knitting Route	Default route: Yarn → Knitting → Greige → Dye → Finish → Dispatch	FINISHED_FABRIC	t	system	2026-07-02 00:24:13.25655
2	JW-INHOUSE	In House Job Work	Customer sends yarn → we knit in-house → return greige rolls + balance yarn	JOB_WORK	t	admin	2026-07-02 10:52:39.227368
3	JW-OUTSIDE	Outside Job Work	Send yarn to external knitter → receive greige rolls + balance yarn back	KNITTING	t	admin	2026-07-02 10:52:39.258522
4	SALE-GREIGE	Greige Roll Sale	Direct sale of greige rolls to buyer — issue delivery challan	GREIGE	t	admin	2026-07-02 10:55:01.261806
5	SALE-YARN	Yarn Sale	Direct sale of yarn lots to buyer — issue delivery challan	YARN	t	admin	2026-07-02 10:55:01.310714
\.


--
-- Data for Name: production_history; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.production_history (id, machine_id, period_type, period_start, period_end, shift, record_date, hour_bucket, counter_start, counter_end, production_kg, rpm_avg, sample_count, created_at, updated_at) FROM stdin;
1	SJ01	HOURLY	2026-06-12 18:00:00+05:30	2026-06-12 19:00:00+05:30	D	2026-06-12	18	1500	1650	23.8975	319.00	2	2026-06-12 18:58:47.405977+05:30	2026-06-12 18:59:03.088234+05:30
\.


--
-- Data for Name: production_records; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.production_records (id, machine_id, record_date, shift, counter_start, counter_end, production_kg, rpm_sum, sample_count, updated_at) FROM stdin;
\.


--
-- Data for Name: racks; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.racks (rack_id, warehouse_id, code, name, is_active) FROM stdin;
1	1	R1	Rack 1	t
2	1	R2	Rack 2	t
3	1	R3	Rack 3	t
4	2	R1	Rack 1	t
5	2	R2	Rack 2	t
6	2	R3	Rack 3	t
7	3	R1	Rack 1	t
8	3	R2	Rack 2	t
9	3	R3	Rack 3	t
10	1	GODOWN	G1	t
11	1	FACTORY 	F1	t
\.


--
-- Data for Name: rfid_events; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.rfid_events (event_id, rfid_tag, operator_id, machine_id, event_time) FROM stdin;
\.


--
-- Data for Name: rolls; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.rolls (roll_id, machine_id, fabric_type, weight_kg, shift, created_at, start_counter, current_counter, roll_weight_kg, status, operator_id, supervisor_id, actual_weight_kg, verified_at, closed_at, supervisor_name, approved_at, warehouse_status, lot_id, issue_id, qr_image, fabric_item_id, source) FROM stdin;
\.


--
-- Data for Name: sc_challan_yarn_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sc_challan_yarn_items (item_id, challan_id, lot_id, lot_number, yarn_type, color, sent_kg, created_at) FROM stdin;
\.


--
-- Data for Name: shift_handovers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.shift_handovers (handover_id, shift_date, shift, supervisor_name, production_kg, machines_down, issues, actions_taken, pending_actions, created_at) FROM stdin;
\.


--
-- Data for Name: stock_ledger; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.stock_ledger (ledger_id, txn_date, txn_time, doc_type, doc_id, item_id, item_desc, warehouse_id, rack_id, bin_id, movement_type, quantity, uom_code, unit_cost, total_cost, partner_id, notes, created_by, created_at) FROM stdin;
1	2026-07-02	2026-07-02 18:52:37.007549	ROLL	DHM-SJ01-F3F-G20-20260702-D-001	\N	Fake Cotton 3Thread Roll DHM-SJ01-F3F-G20-20260702-D-001	2	\N	\N	IN	25.000	KG	\N	\N	\N	Roll approved by Abhishek Verma	abhishekverma	2026-07-02 18:52:37.007549
2	2026-07-03	2026-07-03 18:07:57.548982	ROLL	DHM-SJ02-F3F-G20-20260703-D-001	\N	Fake Cotton 3Thread Roll DHM-SJ02-F3F-G20-20260703-D-001	2	\N	\N	IN	250.000	KG	\N	\N	\N	Roll approved by NAKKUL DHAWAN	admin	2026-07-03 18:07:57.548982
\.


--
-- Data for Name: subcontract_challans; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.subcontract_challans (challan_id, challan_number, batch_id, vendor_name, vendor_contact, job_type, sent_date, expected_return_date, sent_weight_kg, roll_count, rate_per_kg, status, notes, created_by, created_at, updated_at, partner_id, challan_type, is_job_work, customer_name, source) FROM stdin;
\.


--
-- Data for Name: subcontract_receipts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.subcontract_receipts (receipt_id, challan_id, received_date, received_weight_kg, quality_status, rejected_weight_kg, notes, received_by, created_at, shade, gsm, rolls_received_count, balance_yarn_kg, vendor_invoice_no, vendor_bill_amount, payment_status) FROM stdin;
\.


--
-- Data for Name: tax_rates; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.tax_rates (tax_id, code, name, cgst, sgst, igst, is_active) FROM stdin;
1	GST0	Exempt / Nil Rated	0.00	0.00	0.00	t
2	GST5	GST 5%	2.50	2.50	5.00	t
4	GST18	GST 18%	9.00	9.00	18.00	t
\.


--
-- Data for Name: uom; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.uom (uom_id, code, name, is_active) FROM stdin;
1	KG	Kilogram	t
2	MTR	Metre	t
3	PCS	Pieces	t
4	CONE	Cone	t
5	ROLL	Roll	t
6	PKT	Packet	t
7	SET	Set	t
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, username, full_name, password_hash, role, active, created_at, updated_at, mobile, pin_hash) FROM stdin;
1	admin	NAKKUL DHAWAN	$2b$10$NtvPo6mVqMIXYY4N/K8NHOGAlEeP3Ju9uC6AL44u.i03qTwCYgNoi	SUPER_ADMIN	t	2026-06-10 15:34:14.824859+05:30	2026-06-22 19:10:53.775084+05:30	8360180643	$2b$06$zosmZh78Jq.W2BPNCKcrlOBGr4b87Bf/htC191B/kPiY5f902qiza
6	ROHIT KUMAR	RISHU	$2b$10$tQpkjgyb9uki0USffNkBBesGtmJxgpc0oReX5cBPOipvZZm/XM.bu	SUPERVISOR	t	2026-06-27 14:22:30.215926+05:30	2026-07-02 15:34:21.007435+05:30	8727048169	\N
8	abhishekverma	Abhishek Verma	$2b$10$reoSF7pxkvGsrWwdJsmUR.cLTVIvgltAGgpxQvRNfspOyd6pVD/QO	SUPERVISOR	t	2026-07-02 18:50:57.380872+05:30	2026-07-02 18:50:57.380872+05:30	8808635990	\N
\.


--
-- Data for Name: warehouses; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.warehouses (warehouse_id, code, name, type, address, is_active) FROM stdin;
1	YARN-STORE	Yarn Store	INTERNAL	\N	t
2	GREIGE-STORE	Greige Store	INTERNAL	\N	t
3	FG-STORE	Finished Goods Store	INTERNAL	\N	t
4	DYE-HOUSE	Dye House	EXTERNAL	\N	t
5	FINISHING	Finishing Unit	EXTERNAL	\N	t
6	TRANSIT	In Transit	TRANSIT	\N	t
\.


--
-- Data for Name: yarn_issue_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.yarn_issue_items (item_id, issue_id, lot_id, issued_kg, returned_kg) FROM stdin;
\.


--
-- Data for Name: yarn_issues; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.yarn_issues (issue_id, issue_number, issue_date, machine_id, machine_name, issued_by, received_by, status, notes, created_at, cost_centre_id, source) FROM stdin;
\.


--
-- Data for Name: yarn_lot_movements; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.yarn_lot_movements (movement_id, lot_id, movement_type, quantity_kg, before_kg, after_kg, reference_id, reference_type, notes, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: yarn_lots; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.yarn_lots (lot_id, lot_number, grn_id, yarn_type, count, color, supplier_lot_no, net_weight_kg, cones, rate_per_kg, current_stock_kg, status, created_at, updated_at, item_id, low_stock_threshold_kg, source, brand, location) FROM stdin;
\.


--
-- Name: audit_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.audit_logs_id_seq', 89, true);


--
-- Name: batch_rolls_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.batch_rolls_id_seq', 8, true);


--
-- Name: batches_batch_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.batches_batch_id_seq', 1, true);


--
-- Name: bins_bin_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bins_bin_id_seq', 36, true);


--
-- Name: bom_lines_bom_line_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bom_lines_bom_line_id_seq', 22, true);


--
-- Name: cost_centres_cc_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.cost_centres_cc_id_seq', 5, true);


--
-- Name: cost_entries_entry_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.cost_entries_entry_id_seq', 2, true);


--
-- Name: cost_rates_rate_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.cost_rates_rate_id_seq', 7, true);


--
-- Name: cost_snapshots_snapshot_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.cost_snapshots_snapshot_id_seq', 1, false);


--
-- Name: departments_dept_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.departments_dept_id_seq', 7, true);


--
-- Name: dispatch_challans_dispatch_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.dispatch_challans_dispatch_id_seq', 1, false);


--
-- Name: dispatch_items_item_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.dispatch_items_item_id_seq', 1, false);


--
-- Name: doc_series_series_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.doc_series_series_id_seq', 10, true);


--
-- Name: financial_years_fy_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.financial_years_fy_id_seq', 2, true);


--
-- Name: finished_goods_fg_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.finished_goods_fg_id_seq', 1, false);


--
-- Name: finishing_records_finishing_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.finishing_records_finishing_id_seq', 1, false);


--
-- Name: grn_grn_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.grn_grn_id_seq', 1, true);


--
-- Name: hsn_codes_hsn_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.hsn_codes_hsn_id_seq', 12, true);


--
-- Name: item_categories_category_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.item_categories_category_id_seq', 9, true);


--
-- Name: items_item_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.items_item_id_seq', 24, true);


--
-- Name: machine_downtime_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.machine_downtime_id_seq', 17, true);


--
-- Name: machine_live_data_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.machine_live_data_id_seq', 12, true);


--
-- Name: machine_status_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.machine_status_log_id_seq', 1, true);


--
-- Name: maintenance_records_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.maintenance_records_id_seq', 2, true);


--
-- Name: maintenance_schedule_schedule_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.maintenance_schedule_schedule_id_seq', 1, false);


--
-- Name: oee_records_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.oee_records_id_seq', 3, true);


--
-- Name: operator_assignments_assignment_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.operator_assignments_assignment_id_seq', 14, true);


--
-- Name: operator_attendance_attendance_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.operator_attendance_attendance_id_seq', 1, false);


--
-- Name: operators_operator_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.operators_operator_id_seq', 16, true);


--
-- Name: partner_addresses_address_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.partner_addresses_address_id_seq', 4, true);


--
-- Name: partner_bank_bank_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.partner_bank_bank_id_seq', 3, true);


--
-- Name: partner_contacts_contact_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.partner_contacts_contact_id_seq', 6, true);


--
-- Name: partner_roles_role_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.partner_roles_role_id_seq', 9, true);


--
-- Name: partners_partner_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.partners_partner_id_seq', 7, true);


--
-- Name: process_route_steps_step_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.process_route_steps_step_id_seq', 27, true);


--
-- Name: process_routes_route_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.process_routes_route_id_seq', 5, true);


--
-- Name: production_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.production_history_id_seq', 2, true);


--
-- Name: production_records_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.production_records_id_seq', 4, true);


--
-- Name: racks_rack_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.racks_rack_id_seq', 11, true);


--
-- Name: rfid_events_event_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.rfid_events_event_id_seq', 2, true);


--
-- Name: sc_challan_yarn_items_item_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.sc_challan_yarn_items_item_id_seq', 1, false);


--
-- Name: shift_handovers_handover_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.shift_handovers_handover_id_seq', 1, false);


--
-- Name: stock_ledger_ledger_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.stock_ledger_ledger_id_seq', 2, true);


--
-- Name: subcontract_challans_challan_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.subcontract_challans_challan_id_seq', 1, false);


--
-- Name: subcontract_receipts_receipt_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.subcontract_receipts_receipt_id_seq', 1, false);


--
-- Name: tax_rates_tax_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.tax_rates_tax_id_seq', 5, true);


--
-- Name: uom_uom_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.uom_uom_id_seq', 7, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_id_seq', 8, true);


--
-- Name: warehouses_warehouse_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.warehouses_warehouse_id_seq', 6, true);


--
-- Name: yarn_issue_items_item_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.yarn_issue_items_item_id_seq', 1, false);


--
-- Name: yarn_issues_issue_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.yarn_issues_issue_id_seq', 1, false);


--
-- Name: yarn_lot_movements_movement_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.yarn_lot_movements_movement_id_seq', 1, false);


--
-- Name: yarn_lots_lot_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.yarn_lots_lot_id_seq', 1, false);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: batch_rolls batch_rolls_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.batch_rolls
    ADD CONSTRAINT batch_rolls_pkey PRIMARY KEY (id);


--
-- Name: batch_rolls batch_rolls_roll_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.batch_rolls
    ADD CONSTRAINT batch_rolls_roll_id_key UNIQUE (roll_id);


--
-- Name: batches batches_batch_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.batches
    ADD CONSTRAINT batches_batch_number_key UNIQUE (batch_number);


--
-- Name: batches batches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.batches
    ADD CONSTRAINT batches_pkey PRIMARY KEY (batch_id);


--
-- Name: bins bins_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bins
    ADD CONSTRAINT bins_pkey PRIMARY KEY (bin_id);


--
-- Name: bins bins_rack_id_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bins
    ADD CONSTRAINT bins_rack_id_code_key UNIQUE (rack_id, code);


--
-- Name: bom_lines bom_lines_fabric_item_id_yarn_item_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bom_lines
    ADD CONSTRAINT bom_lines_fabric_item_id_yarn_item_id_key UNIQUE (fabric_item_id, yarn_item_id);


--
-- Name: bom_lines bom_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bom_lines
    ADD CONSTRAINT bom_lines_pkey PRIMARY KEY (bom_line_id);


--
-- Name: cost_centres cost_centres_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cost_centres
    ADD CONSTRAINT cost_centres_code_key UNIQUE (code);


--
-- Name: cost_centres cost_centres_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cost_centres
    ADD CONSTRAINT cost_centres_pkey PRIMARY KEY (cc_id);


--
-- Name: cost_entries cost_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cost_entries
    ADD CONSTRAINT cost_entries_pkey PRIMARY KEY (entry_id);


--
-- Name: cost_rates cost_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cost_rates
    ADD CONSTRAINT cost_rates_pkey PRIMARY KEY (rate_id);


--
-- Name: cost_rates cost_rates_yarn_type_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cost_rates
    ADD CONSTRAINT cost_rates_yarn_type_key UNIQUE (yarn_type);


--
-- Name: cost_snapshots cost_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cost_snapshots
    ADD CONSTRAINT cost_snapshots_pkey PRIMARY KEY (snapshot_id);


--
-- Name: cost_snapshots cost_snapshots_snapshot_date_fabric_type_color_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cost_snapshots
    ADD CONSTRAINT cost_snapshots_snapshot_date_fabric_type_color_name_key UNIQUE (snapshot_date, fabric_type, color_name);


--
-- Name: data_collectors data_collectors_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.data_collectors
    ADD CONSTRAINT data_collectors_pkey PRIMARY KEY (dc_id);


--
-- Name: departments departments_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_code_key UNIQUE (code);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (dept_id);


--
-- Name: dispatch_challans dispatch_challans_dispatch_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dispatch_challans
    ADD CONSTRAINT dispatch_challans_dispatch_number_key UNIQUE (dispatch_number);


--
-- Name: dispatch_challans dispatch_challans_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dispatch_challans
    ADD CONSTRAINT dispatch_challans_pkey PRIMARY KEY (dispatch_id);


--
-- Name: dispatch_items dispatch_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dispatch_items
    ADD CONSTRAINT dispatch_items_pkey PRIMARY KEY (item_id);


--
-- Name: doc_series doc_series_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doc_series
    ADD CONSTRAINT doc_series_pkey PRIMARY KEY (series_id);


--
-- Name: doc_series doc_series_series_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.doc_series
    ADD CONSTRAINT doc_series_series_code_key UNIQUE (series_code);


--
-- Name: fabric_types fabric_types_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fabric_types
    ADD CONSTRAINT fabric_types_pkey PRIMARY KEY (code);


--
-- Name: financial_years financial_years_label_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_years
    ADD CONSTRAINT financial_years_label_key UNIQUE (label);


--
-- Name: financial_years financial_years_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.financial_years
    ADD CONSTRAINT financial_years_pkey PRIMARY KEY (fy_id);


--
-- Name: finished_goods finished_goods_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.finished_goods
    ADD CONSTRAINT finished_goods_pkey PRIMARY KEY (fg_id);


--
-- Name: finishing_records finishing_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.finishing_records
    ADD CONSTRAINT finishing_records_pkey PRIMARY KEY (finishing_id);


--
-- Name: grn grn_grn_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grn
    ADD CONSTRAINT grn_grn_number_key UNIQUE (grn_number);


--
-- Name: grn grn_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grn
    ADD CONSTRAINT grn_pkey PRIMARY KEY (grn_id);


--
-- Name: hsn_codes hsn_codes_hsn_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hsn_codes
    ADD CONSTRAINT hsn_codes_hsn_code_key UNIQUE (hsn_code);


--
-- Name: hsn_codes hsn_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.hsn_codes
    ADD CONSTRAINT hsn_codes_pkey PRIMARY KEY (hsn_id);


--
-- Name: item_categories item_categories_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.item_categories
    ADD CONSTRAINT item_categories_code_key UNIQUE (code);


--
-- Name: item_categories item_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.item_categories
    ADD CONSTRAINT item_categories_pkey PRIMARY KEY (category_id);


--
-- Name: item_fabric_attrs item_fabric_attrs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.item_fabric_attrs
    ADD CONSTRAINT item_fabric_attrs_pkey PRIMARY KEY (item_id);


--
-- Name: item_spare_attrs item_spare_attrs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.item_spare_attrs
    ADD CONSTRAINT item_spare_attrs_pkey PRIMARY KEY (item_id);


--
-- Name: item_yarn_attrs item_yarn_attrs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.item_yarn_attrs
    ADD CONSTRAINT item_yarn_attrs_pkey PRIMARY KEY (item_id);


--
-- Name: items items_item_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_item_code_key UNIQUE (item_code);


--
-- Name: items items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (item_id);


--
-- Name: machine_downtime machine_downtime_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_downtime
    ADD CONSTRAINT machine_downtime_pkey PRIMARY KEY (id);


--
-- Name: machine_live_data machine_live_data_machine_id_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_live_data
    ADD CONSTRAINT machine_live_data_machine_id_unique UNIQUE (machine_id);


--
-- Name: machine_live_data machine_live_data_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_live_data
    ADD CONSTRAINT machine_live_data_pkey PRIMARY KEY (id);


--
-- Name: machine_status_log machine_status_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_status_log
    ADD CONSTRAINT machine_status_log_pkey PRIMARY KEY (id);


--
-- Name: machines machines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machines
    ADD CONSTRAINT machines_pkey PRIMARY KEY (machine_id);


--
-- Name: maintenance_records maintenance_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.maintenance_records
    ADD CONSTRAINT maintenance_records_pkey PRIMARY KEY (id);


--
-- Name: maintenance_schedule maintenance_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.maintenance_schedule
    ADD CONSTRAINT maintenance_schedule_pkey PRIMARY KEY (schedule_id);


--
-- Name: oee_records oee_records_machine_id_record_date_shift_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oee_records
    ADD CONSTRAINT oee_records_machine_id_record_date_shift_key UNIQUE (machine_id, record_date, shift);


--
-- Name: oee_records oee_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oee_records
    ADD CONSTRAINT oee_records_pkey PRIMARY KEY (id);


--
-- Name: operator_assignments operator_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operator_assignments
    ADD CONSTRAINT operator_assignments_pkey PRIMARY KEY (assignment_id);


--
-- Name: operator_attendance operator_attendance_operator_id_work_date_shift_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operator_attendance
    ADD CONSTRAINT operator_attendance_operator_id_work_date_shift_key UNIQUE (operator_id, work_date, shift);


--
-- Name: operator_attendance operator_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operator_attendance
    ADD CONSTRAINT operator_attendance_pkey PRIMARY KEY (attendance_id);


--
-- Name: operators operators_operator_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operators
    ADD CONSTRAINT operators_operator_code_key UNIQUE (operator_code);


--
-- Name: operators operators_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operators
    ADD CONSTRAINT operators_pkey PRIMARY KEY (operator_id);


--
-- Name: partner_addresses partner_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_addresses
    ADD CONSTRAINT partner_addresses_pkey PRIMARY KEY (address_id);


--
-- Name: partner_bank partner_bank_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_bank
    ADD CONSTRAINT partner_bank_pkey PRIMARY KEY (bank_id);


--
-- Name: partner_contacts partner_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_contacts
    ADD CONSTRAINT partner_contacts_pkey PRIMARY KEY (contact_id);


--
-- Name: partner_roles partner_roles_partner_id_role_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_roles
    ADD CONSTRAINT partner_roles_partner_id_role_key UNIQUE (partner_id, role);


--
-- Name: partner_roles partner_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_roles
    ADD CONSTRAINT partner_roles_pkey PRIMARY KEY (role_id);


--
-- Name: partners partners_partner_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_partner_code_key UNIQUE (partner_code);


--
-- Name: partners partners_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_pkey PRIMARY KEY (partner_id);


--
-- Name: process_route_steps process_route_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_route_steps
    ADD CONSTRAINT process_route_steps_pkey PRIMARY KEY (step_id);


--
-- Name: process_route_steps process_route_steps_route_id_step_order_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_route_steps
    ADD CONSTRAINT process_route_steps_route_id_step_order_key UNIQUE (route_id, step_order);


--
-- Name: process_routes process_routes_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_routes
    ADD CONSTRAINT process_routes_code_key UNIQUE (code);


--
-- Name: process_routes process_routes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_routes
    ADD CONSTRAINT process_routes_pkey PRIMARY KEY (route_id);


--
-- Name: production_history production_history_machine_id_period_type_record_date_hour__key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.production_history
    ADD CONSTRAINT production_history_machine_id_period_type_record_date_hour__key UNIQUE (machine_id, period_type, record_date, hour_bucket, shift);


--
-- Name: production_history production_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.production_history
    ADD CONSTRAINT production_history_pkey PRIMARY KEY (id);


--
-- Name: production_records production_records_machine_id_record_date_shift_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.production_records
    ADD CONSTRAINT production_records_machine_id_record_date_shift_key UNIQUE (machine_id, record_date, shift);


--
-- Name: production_records production_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.production_records
    ADD CONSTRAINT production_records_pkey PRIMARY KEY (id);


--
-- Name: racks racks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.racks
    ADD CONSTRAINT racks_pkey PRIMARY KEY (rack_id);


--
-- Name: racks racks_warehouse_id_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.racks
    ADD CONSTRAINT racks_warehouse_id_code_key UNIQUE (warehouse_id, code);


--
-- Name: rfid_events rfid_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rfid_events
    ADD CONSTRAINT rfid_events_pkey PRIMARY KEY (event_id);


--
-- Name: rolls rolls_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rolls
    ADD CONSTRAINT rolls_pkey PRIMARY KEY (roll_id);


--
-- Name: sc_challan_yarn_items sc_challan_yarn_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sc_challan_yarn_items
    ADD CONSTRAINT sc_challan_yarn_items_pkey PRIMARY KEY (item_id);


--
-- Name: shift_handovers shift_handovers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shift_handovers
    ADD CONSTRAINT shift_handovers_pkey PRIMARY KEY (handover_id);


--
-- Name: stock_ledger stock_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_ledger
    ADD CONSTRAINT stock_ledger_pkey PRIMARY KEY (ledger_id);


--
-- Name: subcontract_challans subcontract_challans_challan_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subcontract_challans
    ADD CONSTRAINT subcontract_challans_challan_number_key UNIQUE (challan_number);


--
-- Name: subcontract_challans subcontract_challans_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subcontract_challans
    ADD CONSTRAINT subcontract_challans_pkey PRIMARY KEY (challan_id);


--
-- Name: subcontract_receipts subcontract_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subcontract_receipts
    ADD CONSTRAINT subcontract_receipts_pkey PRIMARY KEY (receipt_id);


--
-- Name: tax_rates tax_rates_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tax_rates
    ADD CONSTRAINT tax_rates_code_key UNIQUE (code);


--
-- Name: tax_rates tax_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tax_rates
    ADD CONSTRAINT tax_rates_pkey PRIMARY KEY (tax_id);


--
-- Name: uom uom_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.uom
    ADD CONSTRAINT uom_code_key UNIQUE (code);


--
-- Name: uom uom_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.uom
    ADD CONSTRAINT uom_pkey PRIMARY KEY (uom_id);


--
-- Name: operators uq_operators_code; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operators
    ADD CONSTRAINT uq_operators_code UNIQUE (operator_code);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: warehouses warehouses_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_code_key UNIQUE (code);


--
-- Name: warehouses warehouses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_pkey PRIMARY KEY (warehouse_id);


--
-- Name: yarn_issue_items yarn_issue_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.yarn_issue_items
    ADD CONSTRAINT yarn_issue_items_pkey PRIMARY KEY (item_id);


--
-- Name: yarn_issues yarn_issues_issue_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.yarn_issues
    ADD CONSTRAINT yarn_issues_issue_number_key UNIQUE (issue_number);


--
-- Name: yarn_issues yarn_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.yarn_issues
    ADD CONSTRAINT yarn_issues_pkey PRIMARY KEY (issue_id);


--
-- Name: yarn_lot_movements yarn_lot_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.yarn_lot_movements
    ADD CONSTRAINT yarn_lot_movements_pkey PRIMARY KEY (movement_id);


--
-- Name: yarn_lots yarn_lots_lot_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.yarn_lots
    ADD CONSTRAINT yarn_lots_lot_number_key UNIQUE (lot_number);


--
-- Name: yarn_lots yarn_lots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.yarn_lots
    ADD CONSTRAINT yarn_lots_pkey PRIMARY KEY (lot_id);


--
-- Name: idx_attendance_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_attendance_date ON public.operator_attendance USING btree (work_date, shift);


--
-- Name: idx_attendance_operator; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_attendance_operator ON public.operator_attendance USING btree (operator_id, work_date);


--
-- Name: idx_batch_rolls_batch; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_batch_rolls_batch ON public.batch_rolls USING btree (batch_id);


--
-- Name: idx_bom_fabric; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bom_fabric ON public.bom_lines USING btree (fabric_item_id);


--
-- Name: idx_challans_batch; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_challans_batch ON public.subcontract_challans USING btree (batch_id);


--
-- Name: idx_challans_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_challans_status ON public.subcontract_challans USING btree (status);


--
-- Name: idx_cost_entries_component; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cost_entries_component ON public.cost_entries USING btree (cost_component);


--
-- Name: idx_cost_entries_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cost_entries_date ON public.cost_entries USING btree (created_at);


--
-- Name: idx_cost_entries_fabric; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cost_entries_fabric ON public.cost_entries USING btree (fabric_type);


--
-- Name: idx_cost_entries_ref; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cost_entries_ref ON public.cost_entries USING btree (reference_type, reference_id);


--
-- Name: idx_cost_snapshots_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cost_snapshots_date ON public.cost_snapshots USING btree (snapshot_date);


--
-- Name: idx_dispatch_items; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_dispatch_items ON public.dispatch_items USING btree (dispatch_id);


--
-- Name: idx_downtime_machine_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_downtime_machine_status ON public.machine_downtime USING btree (machine_id, status);


--
-- Name: idx_dt_machine_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_dt_machine_status ON public.machine_downtime USING btree (machine_id, status);


--
-- Name: idx_dt_start_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_dt_start_date ON public.machine_downtime USING btree (start_time DESC);


--
-- Name: idx_fg_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_status ON public.finished_goods USING btree (status);


--
-- Name: idx_grn_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_grn_date ON public.grn USING btree (receipt_date);


--
-- Name: idx_grn_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_grn_status ON public.grn USING btree (status);


--
-- Name: idx_issue_items_issue; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_issue_items_issue ON public.yarn_issue_items USING btree (issue_id);


--
-- Name: idx_issue_items_lot; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_issue_items_lot ON public.yarn_issue_items USING btree (lot_id);


--
-- Name: idx_issues_machine; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_issues_machine ON public.yarn_issues USING btree (machine_id);


--
-- Name: idx_maint_schedule_due; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_maint_schedule_due ON public.maintenance_schedule USING btree (next_due_date);


--
-- Name: idx_maint_schedule_machine; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_maint_schedule_machine ON public.maintenance_schedule USING btree (machine_id);


--
-- Name: idx_movements_lot; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_movements_lot ON public.yarn_lot_movements USING btree (lot_id);


--
-- Name: idx_msl_date_shift; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_msl_date_shift ON public.machine_status_log USING btree (machine_id, date(start_time), shift);


--
-- Name: idx_msl_machine_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_msl_machine_time ON public.machine_status_log USING btree (machine_id, start_time DESC);


--
-- Name: idx_partner_roles_pid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_partner_roles_pid ON public.partner_roles USING btree (partner_id);


--
-- Name: idx_partner_roles_role; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_partner_roles_role ON public.partner_roles USING btree (role);


--
-- Name: idx_partners_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_partners_code ON public.partners USING btree (partner_code);


--
-- Name: idx_prod_hist_machine_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_prod_hist_machine_date ON public.production_history USING btree (machine_id, record_date);


--
-- Name: idx_prod_hist_period_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_prod_hist_period_date ON public.production_history USING btree (period_type, record_date);


--
-- Name: idx_rfid_events_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_rfid_events_time ON public.rfid_events USING btree (event_time DESC);


--
-- Name: idx_rolls_lot; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_rolls_lot ON public.rolls USING btree (lot_id);


--
-- Name: idx_sl_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sl_date ON public.stock_ledger USING btree (txn_date);


--
-- Name: idx_sl_doc; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sl_doc ON public.stock_ledger USING btree (doc_type, doc_id);


--
-- Name: idx_sl_item; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sl_item ON public.stock_ledger USING btree (item_id, txn_date);


--
-- Name: idx_sl_wh; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sl_wh ON public.stock_ledger USING btree (warehouse_id, txn_date);


--
-- Name: idx_status_log_machine_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_status_log_machine_date ON public.machine_status_log USING btree (machine_id, date(start_time), shift);


--
-- Name: idx_yarn_lots_grn; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_yarn_lots_grn ON public.yarn_lots USING btree (grn_id);


--
-- Name: idx_yarn_lots_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_yarn_lots_status ON public.yarn_lots USING btree (status);


--
-- Name: operators trg_operators_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_operators_updated_at BEFORE UPDATE ON public.operators FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: batch_rolls batch_rolls_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.batch_rolls
    ADD CONSTRAINT batch_rolls_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.batches(batch_id) ON DELETE CASCADE;


--
-- Name: bins bins_rack_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bins
    ADD CONSTRAINT bins_rack_id_fkey FOREIGN KEY (rack_id) REFERENCES public.racks(rack_id);


--
-- Name: bom_lines bom_lines_fabric_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bom_lines
    ADD CONSTRAINT bom_lines_fabric_item_id_fkey FOREIGN KEY (fabric_item_id) REFERENCES public.items(item_id) ON DELETE CASCADE;


--
-- Name: bom_lines bom_lines_yarn_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bom_lines
    ADD CONSTRAINT bom_lines_yarn_item_id_fkey FOREIGN KEY (yarn_item_id) REFERENCES public.items(item_id) ON DELETE CASCADE;


--
-- Name: cost_centres cost_centres_dept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cost_centres
    ADD CONSTRAINT cost_centres_dept_id_fkey FOREIGN KEY (dept_id) REFERENCES public.departments(dept_id);


--
-- Name: cost_rates cost_rates_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cost_rates
    ADD CONSTRAINT cost_rates_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(item_id);


--
-- Name: data_collectors data_collectors_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.data_collectors
    ADD CONSTRAINT data_collectors_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(machine_id);


--
-- Name: dispatch_challans dispatch_challans_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dispatch_challans
    ADD CONSTRAINT dispatch_challans_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(partner_id);


--
-- Name: dispatch_items dispatch_items_dispatch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dispatch_items
    ADD CONSTRAINT dispatch_items_dispatch_id_fkey FOREIGN KEY (dispatch_id) REFERENCES public.dispatch_challans(dispatch_id) ON DELETE CASCADE;


--
-- Name: dispatch_items dispatch_items_fg_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dispatch_items
    ADD CONSTRAINT dispatch_items_fg_id_fkey FOREIGN KEY (fg_id) REFERENCES public.finished_goods(fg_id);


--
-- Name: finished_goods finished_goods_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.finished_goods
    ADD CONSTRAINT finished_goods_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.batches(batch_id);


--
-- Name: finished_goods finished_goods_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.finished_goods
    ADD CONSTRAINT finished_goods_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.subcontract_receipts(receipt_id);


--
-- Name: finishing_records finishing_records_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.finishing_records
    ADD CONSTRAINT finishing_records_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.batches(batch_id);


--
-- Name: finishing_records finishing_records_receipt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.finishing_records
    ADD CONSTRAINT finishing_records_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.subcontract_receipts(receipt_id);


--
-- Name: grn grn_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grn
    ADD CONSTRAINT grn_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(partner_id);


--
-- Name: grn grn_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grn
    ADD CONSTRAINT grn_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(warehouse_id);


--
-- Name: item_categories item_categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.item_categories
    ADD CONSTRAINT item_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.item_categories(category_id);


--
-- Name: item_fabric_attrs item_fabric_attrs_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.item_fabric_attrs
    ADD CONSTRAINT item_fabric_attrs_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(item_id) ON DELETE CASCADE;


--
-- Name: item_spare_attrs item_spare_attrs_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.item_spare_attrs
    ADD CONSTRAINT item_spare_attrs_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(item_id) ON DELETE CASCADE;


--
-- Name: item_yarn_attrs item_yarn_attrs_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.item_yarn_attrs
    ADD CONSTRAINT item_yarn_attrs_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(item_id) ON DELETE CASCADE;


--
-- Name: items items_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.item_categories(category_id);


--
-- Name: items items_hsn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_hsn_id_fkey FOREIGN KEY (hsn_id) REFERENCES public.hsn_codes(hsn_id);


--
-- Name: items items_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_uom_id_fkey FOREIGN KEY (uom_id) REFERENCES public.uom(uom_id);


--
-- Name: machine_downtime machine_downtime_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_downtime
    ADD CONSTRAINT machine_downtime_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(machine_id);


--
-- Name: machine_live_data machine_live_data_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_live_data
    ADD CONSTRAINT machine_live_data_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(machine_id);


--
-- Name: machine_status_log machine_status_log_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_status_log
    ADD CONSTRAINT machine_status_log_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(machine_id);


--
-- Name: machines machines_fabric_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machines
    ADD CONSTRAINT machines_fabric_code_fkey FOREIGN KEY (fabric_code) REFERENCES public.fabric_types(code) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: maintenance_records maintenance_records_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.maintenance_records
    ADD CONSTRAINT maintenance_records_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(machine_id);


--
-- Name: maintenance_schedule maintenance_schedule_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.maintenance_schedule
    ADD CONSTRAINT maintenance_schedule_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(machine_id);


--
-- Name: oee_records oee_records_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oee_records
    ADD CONSTRAINT oee_records_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(machine_id);


--
-- Name: partner_addresses partner_addresses_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_addresses
    ADD CONSTRAINT partner_addresses_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(partner_id) ON DELETE CASCADE;


--
-- Name: partner_bank partner_bank_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_bank
    ADD CONSTRAINT partner_bank_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(partner_id) ON DELETE CASCADE;


--
-- Name: partner_contacts partner_contacts_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_contacts
    ADD CONSTRAINT partner_contacts_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(partner_id) ON DELETE CASCADE;


--
-- Name: partner_roles partner_roles_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.partner_roles
    ADD CONSTRAINT partner_roles_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(partner_id) ON DELETE CASCADE;


--
-- Name: process_route_steps process_route_steps_dept_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_route_steps
    ADD CONSTRAINT process_route_steps_dept_id_fkey FOREIGN KEY (dept_id) REFERENCES public.departments(dept_id);


--
-- Name: process_route_steps process_route_steps_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_route_steps
    ADD CONSTRAINT process_route_steps_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.process_routes(route_id) ON DELETE CASCADE;


--
-- Name: production_records production_records_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.production_records
    ADD CONSTRAINT production_records_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(machine_id);


--
-- Name: racks racks_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.racks
    ADD CONSTRAINT racks_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(warehouse_id);


--
-- Name: rolls rolls_fabric_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rolls
    ADD CONSTRAINT rolls_fabric_item_id_fkey FOREIGN KEY (fabric_item_id) REFERENCES public.items(item_id);


--
-- Name: rolls rolls_issue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rolls
    ADD CONSTRAINT rolls_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.yarn_issues(issue_id);


--
-- Name: rolls rolls_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rolls
    ADD CONSTRAINT rolls_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.yarn_lots(lot_id);


--
-- Name: rolls rolls_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rolls
    ADD CONSTRAINT rolls_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(machine_id);


--
-- Name: sc_challan_yarn_items sc_challan_yarn_items_challan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sc_challan_yarn_items
    ADD CONSTRAINT sc_challan_yarn_items_challan_id_fkey FOREIGN KEY (challan_id) REFERENCES public.subcontract_challans(challan_id) ON DELETE CASCADE;


--
-- Name: sc_challan_yarn_items sc_challan_yarn_items_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sc_challan_yarn_items
    ADD CONSTRAINT sc_challan_yarn_items_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.yarn_lots(lot_id);


--
-- Name: stock_ledger stock_ledger_bin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_ledger
    ADD CONSTRAINT stock_ledger_bin_id_fkey FOREIGN KEY (bin_id) REFERENCES public.bins(bin_id);


--
-- Name: stock_ledger stock_ledger_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_ledger
    ADD CONSTRAINT stock_ledger_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(item_id);


--
-- Name: stock_ledger stock_ledger_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_ledger
    ADD CONSTRAINT stock_ledger_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(partner_id);


--
-- Name: stock_ledger stock_ledger_rack_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_ledger
    ADD CONSTRAINT stock_ledger_rack_id_fkey FOREIGN KEY (rack_id) REFERENCES public.racks(rack_id);


--
-- Name: stock_ledger stock_ledger_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_ledger
    ADD CONSTRAINT stock_ledger_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(warehouse_id);


--
-- Name: subcontract_challans subcontract_challans_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subcontract_challans
    ADD CONSTRAINT subcontract_challans_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.batches(batch_id);


--
-- Name: subcontract_challans subcontract_challans_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subcontract_challans
    ADD CONSTRAINT subcontract_challans_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(partner_id);


--
-- Name: subcontract_receipts subcontract_receipts_challan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subcontract_receipts
    ADD CONSTRAINT subcontract_receipts_challan_id_fkey FOREIGN KEY (challan_id) REFERENCES public.subcontract_challans(challan_id);


--
-- Name: yarn_issue_items yarn_issue_items_issue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.yarn_issue_items
    ADD CONSTRAINT yarn_issue_items_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.yarn_issues(issue_id) ON DELETE CASCADE;


--
-- Name: yarn_issue_items yarn_issue_items_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.yarn_issue_items
    ADD CONSTRAINT yarn_issue_items_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.yarn_lots(lot_id);


--
-- Name: yarn_issues yarn_issues_cost_centre_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.yarn_issues
    ADD CONSTRAINT yarn_issues_cost_centre_id_fkey FOREIGN KEY (cost_centre_id) REFERENCES public.cost_centres(cc_id);


--
-- Name: yarn_lot_movements yarn_lot_movements_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.yarn_lot_movements
    ADD CONSTRAINT yarn_lot_movements_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.yarn_lots(lot_id);


--
-- Name: yarn_lots yarn_lots_grn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.yarn_lots
    ADD CONSTRAINT yarn_lots_grn_id_fkey FOREIGN KEY (grn_id) REFERENCES public.grn(grn_id) ON DELETE CASCADE;


--
-- Name: yarn_lots yarn_lots_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.yarn_lots
    ADD CONSTRAINT yarn_lots_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(item_id);


--
-- PostgreSQL database dump complete
--

\unrestrict Ru5swJHp7sGCaM34lyeJ9u5DEXlpUVEMV8uKnXeJNTPdtuY5Ijy3KYBtpuWRgAU

