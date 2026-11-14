-- DHOWN MES — HA primary one-time setup.
-- Run ONCE on the PRIMARY:  psql -U postgres -f setup-primary.sql
--
-- Both firms (dhown_mes + vdknits_mes) live in ONE PostgreSQL 18 cluster, so a
-- single physical replication stream covers both. The primary is already
-- replication-ready (wal_level=replica, listen_addresses='*', max_wal_senders=10),
-- so all that is needed here is a replication role + a slot.

-- 1. Replication login the standby will connect as. CHANGE THE PASSWORD.
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'CHANGE_ME_TO_A_STRONG_PASSWORD';

-- 2. A physical replication slot so the primary keeps WAL the standby still needs
--    (prevents the standby falling irrecoverably behind if it disconnects).
SELECT pg_create_physical_replication_slot('standby1');

-- 3. THEN, by hand, add this line to  D:\PostgreSQL\Data\pg_hba.conf
--    (replace <STANDBY_IP> with the standby machine's LAN IP):
--
--       host    replication    replicator    <STANDBY_IP>/32    scram-sha-256
--
-- 4. Optional safety in  D:\PostgreSQL\Data\postgresql.conf  (reloadable):
--       wal_keep_size = '1GB'
--
-- 5. Reload so pg_hba + conf changes take effect (no restart needed):
--       SELECT pg_reload_conf();
--
-- Verify the slot after the standby connects:
--       SELECT slot_name, active, restart_lsn FROM pg_replication_slots;
