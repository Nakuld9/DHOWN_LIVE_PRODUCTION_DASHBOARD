// Command-center service — assembles the aggregate dashboard payload (verbatim).
module.exports = (repo, { getShiftSettings, detectCurrentShift }) => ({
  async get() {
    const today = new Date().toISOString().slice(0, 10);
    const shiftCfg = await getShiftSettings();
    const currentShift = detectCurrentShift(shiftCfg);

    const [
      machR, prodTodayR, prodShiftR, oeeR,
      grnTodayR, grnRecentR,
      dispTodayR, dispRecentR,
      scSentR, scRecvR, scRecentR,
      issueRecentR, issueTodayR,
      invR,
      rollRecentR,
      dtRecentR,
      topOperR,
      topFabricR,
      topYarnR,
      pendingSCR,
      pendingGRNR,
      pendingDispR,
    ] = await repo.snapshot({ today, currentShift });

    const machines = machR.rows;
    const total = machines.length;
    const running = machines.filter(m => m.live_status === 'RUNNING').length;
    const stopped = machines.filter(m => m.live_status === 'STOPPED').length;
    const maintenance = machines.filter(m => m.live_status === 'DOWNTIME').length;
    const offline = total - running - stopped - maintenance;

    return {
      timestamp: new Date().toISOString(),
      current_shift: currentShift,
      machines: { total, running, stopped, maintenance, offline, list: machines },
      production: {
        today_kg: Math.round(parseFloat(prodTodayR.rows[0].kg) * 1000) / 1000,
        shift_kg: Math.round(parseFloat(prodShiftR.rows[0].kg) * 1000) / 1000,
      },
      oee: parseFloat(oeeR.rows[0]?.oee || 0),
      grn: { today_count: parseInt(grnTodayR.rows[0].cnt), today_value: 0, recent: grnRecentR.rows },
      dispatch: { today_count: parseInt(dispTodayR.rows[0].cnt), today_kg: parseFloat(dispTodayR.rows[0].kg), recent: dispRecentR.rows },
      sc: { sent_today: parseInt(scSentR.rows[0].cnt), recv_today: parseInt(scRecvR.rows[0].cnt), recent: scRecentR.rows },
      yarn_issue: { today_count: parseInt(issueTodayR.rows[0].cnt), today_kg: parseFloat(issueTodayR.rows[0].kg), recent: issueRecentR.rows },
      inventory: { value: parseFloat(invR.rows[0].val), total_kg: parseFloat(invR.rows[0].kg) },
      recent_rolls: rollRecentR.rows,
      recent_downtime: dtRecentR.rows,
      top_operators: topOperR.rows,
      top_fabrics: topFabricR.rows,
      top_yarn: topYarnR.rows,
      pending: {
        sc_challans: parseInt(pendingSCR.rows[0].cnt),
        grn_draft: parseInt(pendingGRNR.rows[0].cnt),
        dispatch_draft: parseInt(pendingDispR.rows[0].cnt),
      },
    };
  },
});
