// Pure payroll math — no DB, no side effects (unit-tested in test/payroll.calc.test.js).
// gross: MONTHLY -> flat wage_rate; else DAILY -> days_present × wage_rate.
// net  : gross + overtime + bonus − deductions − advance.
const num = (v) => Number(v) || 0;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function computePay({ wage_type, wage_rate, days_present, overtime, bonus, deductions, advance } = {}) {
  const rate = num(wage_rate);
  const days = num(days_present);
  const gross = wage_type === 'MONTHLY' ? rate : days * rate;
  const net = gross + num(overtime) + num(bonus) - num(deductions) - num(advance);
  return { gross: r2(gross), net: r2(net) };
}

module.exports = { computePay, r2 };
