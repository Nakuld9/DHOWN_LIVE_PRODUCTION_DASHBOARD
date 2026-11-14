// Live-data routes — DC ingest (POST, api-key guarded) + latest snapshot (GET).
// Handlers moved VERBATIM from server.js; app.<m>('/api/live-data...') -> router.<m>('/...').
// Mounted at /api/live-data. Auth/middleware preserved exactly.
const express = require('express');
const rolls = require('../lib/rolls');

module.exports = ({ pool, dcApiKeyGuard, verifyToken, getShiftSettings, detectCurrentShift, updateOEE, computeLiveStatus, io }) => {
  const router = express.Router();

  // Reading live machine state is business data and needs a session. The POST
  // below is the collector ingest and stays on its API key — collectors have no
  // JWT, so a router-level guard would silently stop production capture.
  router.get('/', verifyToken, async (req, res) => {
  
    try {
  
      const result = await pool.query(`
        SELECT *
        FROM machine_live_data
        ORDER BY id DESC
      `);
  
      res.json(result.rows);
  
    } catch (err) {
  
      console.error('LIVE DATA ERROR:', err);
  
      res.status(500).json({
        error: 'Live Data Error'
      });
  
    }
  
  });

  router.post("/", dcApiKeyGuard, async (req, res) => {
    try {
      const { machine_id, rpm, dc_status, production_counter, operator_id, operator_name, shift: shiftOverride, working_hours, total_minutes, work_time } = req.body;
      if (!machine_id) return res.status(400).json({ error: "machine_id is required" });

      // Collector-reported stoppage reason (ESP32 taps the fault terminals). Optional —
      // when absent (e.g. legacy poller) the auto-downtime stays 'Reason Pending' as before.
      const stoppageReason = (req.body.stoppage_reason || req.body.status_reason || '').toString().trim() || null;
  
      // â"€â"€ 1. Shift config from app_settings (no hardcodes) â"€â"€â"€â"€â"€â"€â"€â"€â"€
      const shiftSettings  = await getShiftSettings();
      const currentShift   = shiftOverride || detectCurrentShift(shiftSettings);
      const plannedMinutes = parseFloat(shiftSettings.planned_hours_per_shift || '8') * 60;
      const qualityTarget  = parseFloat(shiftSettings.quality_target_pct || '100');
  
      // â"€â"€ 2. Current row + machine config â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      const [liveRow, machRow] = await Promise.all([
        pool.query('SELECT * FROM machine_live_data WHERE machine_id=$1', [machine_id]),
        pool.query('SELECT kg_per_counter, rpm_target FROM machines WHERE machine_id=$1', [machine_id])
      ]);
      const current    = liveRow.rows[0] || null;
      const machine    = machRow.rows[0] || {};
      const kpc        = parseFloat(machine.kg_per_counter || 0);
      const rpmTarget  = parseFloat(machine.rpm_target || 0);
  
      // â"€â"€ 3. Production delta using kg_per_counter from machines â"€â"€â"€
      // Counter-reset / spike protection (P1-02): on a reset (new < old, e.g. DC
      // restart or physical counter reset) count only the new value; and clamp any
      // implausibly large jump so a garbage reading can't inject phantom production.
      const MAX_DELTA   = parseFloat(process.env.DC_MAX_COUNTER_DELTA || '100000');
      const newCounter  = parseFloat(production_counter || 0);
      const oldCounter  = current ? parseFloat(current.production_counter || 0) : 0;
      // new > old: normal increment. new < old: counter reset → count only new.
      // new == old: no movement → zero (previously mis-counted the full counter).
      let   delta       = newCounter > oldCounter ? newCounter - oldCounter
                        : newCounter < oldCounter ? newCounter
                        : 0;
      if (!(delta >= 0) || delta > MAX_DELTA) {
        console.warn(`[live-data] ${machine_id}: implausible counter delta ${delta} (old=${oldCounter} new=${newCounter}) — ignoring production for this tick`);
        delta = 0;
      }
      const prodDeltaKg = kpc > 0 ? Math.round(delta * kpc * 100000) / 100000 : 0;
      const sessionKg   = Math.round(((current ? parseFloat(current.session_production_kg || 0) : 0) + prodDeltaKg) * 100000) / 100000;
  
      // â"€â"€ 4. Live status â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      const newStatus  = computeLiveStatus(dc_status, rpm);
      const prevStatus = current ? current.last_status : null;
  
      // â"€â"€ 5. Status-change log â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      if (prevStatus !== newStatus) {
        await pool.query(
          // GREATEST(0, ...) because start_time came from a NOW() in a
          // different statement, and the two transaction timestamps can
          // interleave by microseconds — which produced a stored duration of
          // -0.0000153 minutes. A negative duration is never meaningful, and
          // it is summed into OEE and downtime totals.
          `UPDATE machine_status_log
           SET end_time=NOW(),
               duration_minutes=GREATEST(0, EXTRACT(EPOCH FROM(NOW()-start_time))/60)
           WHERE machine_id=$1 AND end_time IS NULL`,
          [machine_id]
        );
        await pool.query(
          `INSERT INTO machine_status_log (machine_id, status, shift, start_time) VALUES ($1,$2,$3,NOW())`,
          [machine_id, newStatus, currentShift]
        );
      }
  
      // â"€â"€ 5.5. Auto-downtime detection â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      // Reads auto_downtime_enabled + auto_downtime_threshold_minutes from shiftSettings.
      // Only creates/closes downtime records. Does NOT touch production_records, oee_records,
      // shift detection, RPM, counter, or any calculation logic.
      const autoEnabled   = shiftSettings.auto_downtime_enabled !== 'false';
      const autoThreshold = parseFloat(shiftSettings.auto_downtime_threshold_minutes || '2');
  
      if (autoEnabled) {
        if (newStatus === 'STOPPED') {
          // When machine is STOPPED, check how long it has been stopped.
          // The machine_status_log row for this STOPPED run was created in step 5.
          const stoppedRow = await pool.query(
            `SELECT start_time FROM machine_status_log
             WHERE machine_id=$1 AND status='STOPPED' AND end_time IS NULL
             ORDER BY start_time DESC LIMIT 1`,
            [machine_id]
          );
          if (stoppedRow.rows.length > 0) {
            const stoppedMinutes = (Date.now() - new Date(stoppedRow.rows[0].start_time)) / 60000;
            if (stoppedMinutes >= autoThreshold) {
              // Only create if no open downtime already exists for this machine
              const openDt = await pool.query(
                `SELECT id, reason FROM machine_downtime WHERE machine_id=$1 AND status='OPEN' LIMIT 1`,
                [machine_id]
              );
              if (openDt.rows.length === 0) {
                // Use the collector-reported reason when we have one; else stay pending.
                await pool.query(
                  `INSERT INTO machine_downtime (machine_id, reason, start_time, status, source, shift)
                   VALUES ($1, $2, $3, 'OPEN', 'AUTO', $4)`,
                  [machine_id, stoppageReason || 'Reason Pending', stoppedRow.rows[0].start_time, currentShift]
                );
              } else if (stoppageReason && openDt.rows[0].reason === 'Reason Pending') {
                // Downtime was opened before the fault signal appeared — backfill the reason now.
                await pool.query(
                  `UPDATE machine_downtime SET reason=$1 WHERE id=$2`,
                  [stoppageReason, openDt.rows[0].id]
                );
              }
            }
          }
        } else if (newStatus === 'RUNNING') {
          // Machine resumed â€" close all open downtime records for this machine
          await pool.query(
            `UPDATE machine_downtime
             SET end_time = NOW(),
                 duration_minutes = EXTRACT(EPOCH FROM(NOW()-start_time))/60,
                 status = 'CLOSED'
             WHERE machine_id=$1 AND status='OPEN'`,
            [machine_id]
          );
        }
      }
  
      // â"€â"€ 6. UPSERT machine_live_data â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      const result = await pool.query(
        `INSERT INTO machine_live_data
           (machine_id, rpm, dc_status, production_counter, operator_id, operator_name, shift, timestamp,
            previous_counter, session_production_kg, last_status, working_hours, work_time, total_minutes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8,$9,$10,$11,$12,$13)
         ON CONFLICT (machine_id) DO UPDATE SET
           rpm                  = EXCLUDED.rpm,
           dc_status            = EXCLUDED.dc_status,
           production_counter   = EXCLUDED.production_counter,
           operator_id          = EXCLUDED.operator_id,
           operator_name        = EXCLUDED.operator_name,
           shift                = EXCLUDED.shift,
           timestamp            = NOW(),
           previous_counter     = COALESCE(machine_live_data.production_counter, 0),
           session_production_kg= $9,
           last_status          = $10,
           working_hours        = COALESCE(EXCLUDED.working_hours, machine_live_data.working_hours),
           work_time            = COALESCE(EXCLUDED.work_time, machine_live_data.work_time),
           total_minutes        = COALESCE(EXCLUDED.total_minutes, machine_live_data.total_minutes)
         RETURNING *`,
        [machine_id, rpm||0, dc_status||'online', production_counter||0, operator_id||null, operator_name||null,
         currentShift, oldCounter, sessionKg, newStatus, working_hours||null, work_time||null, total_minutes||null]
      );
  
      // â"€â"€ 7. Sync machines.dc_status â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      await pool.query('UPDATE machines SET dc_status=$1 WHERE machine_id=$2', [dc_status||'online', machine_id]);
  
      // â"€â"€ 8. Data-collector heartbeat â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      await pool.query(
        `UPDATE data_collectors SET status='ONLINE', last_seen=NOW() WHERE machine_id=$1`,
        [machine_id]
      );
  
      // â"€â"€ 9. Upsert production_records â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      const today = new Date().toISOString().slice(0, 10);
      await pool.query(
        `INSERT INTO production_records
           (machine_id, record_date, shift, counter_start, counter_end, production_kg, rpm_sum, sample_count)
         VALUES ($1,$2,$3,$4,$4,$5,$6,1)
         ON CONFLICT (machine_id,record_date,shift) DO UPDATE SET
           counter_end   = $4,
           production_kg = production_records.production_kg + $5,
           rpm_sum       = production_records.rpm_sum + $6,
           sample_count  = production_records.sample_count + 1,
           updated_at    = NOW()`,
        [machine_id, today, currentShift, newCounter, prodDeltaKg, rpm||0]
      );
  
      // â"€â"€ 10. Compute and store OEE â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      await updateOEE(pool, machine_id, today, currentShift, rpm, rpmTarget, plannedMinutes, qualityTarget);
  
      // â"€â"€ 11. Upsert hourly production_history bucket â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
      const nowDt   = new Date();
      const hBucket = nowDt.getHours();
      const hStart  = new Date(nowDt.getFullYear(), nowDt.getMonth(), nowDt.getDate(), hBucket, 0, 0);
      const hEnd    = new Date(hStart.getTime() + 3600000);
      await pool.query(
        `INSERT INTO production_history
           (machine_id, period_type, period_start, period_end, shift, record_date, hour_bucket,
            counter_start, counter_end, production_kg, rpm_avg, sample_count)
         VALUES ($1,'HOURLY',$2,$3,$4,$5,$6,$7,$8,$9,$10,1)
         ON CONFLICT (machine_id,period_type,record_date,hour_bucket,shift) DO UPDATE SET
           counter_end   = $8,
           production_kg = production_history.production_kg + $9,
           rpm_avg       = ROUND(
             (production_history.rpm_avg * production_history.sample_count + $10)::NUMERIC
             / (production_history.sample_count + 1), 2),
           sample_count  = production_history.sample_count + 1,
           updated_at    = NOW()`,
        [machine_id, hStart.toISOString(), hEnd.toISOString(), currentShift, today, hBucket,
         newCounter, newCounter, prodDeltaKg, rpm || 0]
      );
  
      // ── 12. Auto roll lifecycle from the green (doff) pulse ──────────────
      // The ESP32 collector sends a cumulative `rolls` count. Each increment is a
      // roll-complete/doff: close the machine's OPEN roll at the current counter
      // (with an estimated weight) and open the next. Fully automatic — also opens
      // the first roll when a running machine has none. Gated to collectors that
      // report `rolls`, so legacy/other collectors are unaffected.
      if (req.body.rolls !== undefined) {
        try {
          const incomingRolls = Math.max(0, parseInt(req.body.rolls) || 0);
          const prevRolls     = current ? parseInt(current.rolls_counter || 0) : 0;
          const ROLL_MAX_JUMP = 20;                       // ignore garbage spikes
          const rollDelta     = incomingRolls - prevRolls;
          const doff          = rollDelta > 0 && rollDelta <= ROLL_MAX_JUMP; // negative = collector reboot → rebaseline, no cut

          const openRes  = await pool.query(
            `SELECT roll_id, start_counter FROM rolls WHERE machine_id=$1 AND status='OPEN' ORDER BY created_at DESC LIMIT 1`,
            [machine_id]
          );
          const openRoll = openRes.rows[0] || null;
          const operatorForRoll = (current && current.operator_id) || operator_id || null;

          if (doff && openRoll) {
            await rolls.closeOpenRoll(openRoll, newCounter, kpc);
            await rolls.openRoll(machine_id, currentShift, newCounter, operatorForRoll);
          } else if (doff && !openRoll) {
            await rolls.openRoll(machine_id, currentShift, newCounter, operatorForRoll);
          } else if (!openRoll && newStatus === 'RUNNING') {
            // bootstrap: running with no open roll → open one
            await rolls.openRoll(machine_id, currentShift, newCounter, operatorForRoll);
          }

          // persist last-seen roll count (also rebaselines on a collector reboot)
          await pool.query(`UPDATE machine_live_data SET rolls_counter=$1 WHERE machine_id=$2`, [incomingRolls, machine_id]);
        } catch (rollErr) {
          console.error(`[live-data] ${machine_id} auto-roll error:`, rollErr.message);
        }
      }

      // Emit real-time update so connected dashboards can refresh immediately
      io.emit('machine_update', { machine_id, status: result.rows[0]?.live_status });
  
      res.json({
        success: true,
        data: result.rows[0],
        shift: currentShift,
        production_delta_kg: prodDeltaKg
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
