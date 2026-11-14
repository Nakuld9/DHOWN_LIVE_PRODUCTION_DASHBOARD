// The 4-point fabric grading system (ASTM D5430 style), as a pure function.
//
// Kept pure and DB-free so the grading maths can be unit-tested exactly and can
// never disagree between the live entry screen and a re-grade or report: there is
// one implementation of "what grade is this roll", here.
//
// How it works:
//   1. Each defect earns penalty POINTS by its size (the longer dimension):
//        up to 3 in → 1 · >3–6 in → 2 · >6–9 in → 3 · over 9 in → 4.
//      A hole is scored on its own scale: 1 in or under → 2, over 1 in → 4.
//      No single defect can ever exceed 4 points — the system's cardinal cap.
//   2. Total points are normalised to points per 100 square yards:
//        points/100 sq yd = total points × 3600 ÷ (length_yards × width_inches)
//      (3600 = 100 sq yd expressed for a width given in inches and length in yards).
//   3. The normalised score is compared to configurable thresholds to give a grade.
//      Default A-grade cut-off is 40 points/100 sq yd — the universal industry line.
//
// Inputs are metric (the mill measures in metres and millimetres); the conversion
// to the imperial 4-point basis happens here so the rest of the system stays metric.

const M_PER_YARD = 0.9144;
const MM_PER_INCH = 25.4;

// Penalty points for one defect. `sizeInches` is the defect's longer dimension.
function pointsForDefect({ sizeInches = 0, isHole = false } = {}) {
  const s = Number(sizeInches) || 0;
  if (isHole) return s <= 1 ? 2 : 4;
  if (s <= 3) return 1;
  if (s <= 6) return 2;
  if (s <= 9) return 3;
  return 4; // the cap — nothing scores more than 4
}

// Default thresholds (points per 100 sq yd). A ≤ aMax; B ≤ bMax; else REJECT.
const DEFAULT_THRESHOLDS = { aMax: 40, bMax: 80 };

// Grade a roll from its defect list and dimensions.
//   defects: [{ sizeInches, isHole, count? }]  — count defaults to 1
//   lengthMeters, widthMm: the inspected piece
//   thresholds: { aMax, bMax } in points per 100 sq yd
function gradeRoll({ defects = [], lengthMeters = 0, widthMm = 0, thresholds } = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...(thresholds || {}) };

  const perDefect = defects.map(d => {
    const pts = pointsForDefect(d);
    const count = Math.max(1, Number(d.count) || 1);
    return { ...d, points: pts, count, subtotal: pts * count };
  });
  const totalPoints = perDefect.reduce((s, d) => s + d.subtotal, 0);

  const lengthYd = Number(lengthMeters) / M_PER_YARD;
  const widthIn = Number(widthMm) / MM_PER_INCH;
  const area = lengthYd * widthIn;

  // Guard: without a measured area there is no score to compute. Return the raw
  // points and an UNGRADED verdict rather than dividing by zero or inventing a grade.
  let per100 = null;
  let grade = 'UNGRADED';
  if (area > 0) {
    per100 = (totalPoints * 3600) / area;
    per100 = Math.round(per100 * 100) / 100;
    grade = per100 <= t.aMax ? 'A' : per100 <= t.bMax ? 'B' : 'REJECT';
  }

  return {
    totalPoints,
    pointsPer100SqYd: per100,
    grade,
    lengthYards: Math.round(lengthYd * 1000) / 1000,
    widthInches: Math.round(widthIn * 1000) / 1000,
    areaSqYards: area > 0 ? Math.round(area * 100) / 100 : 0,
    thresholds: t,
    lines: perDefect,
  };
}

module.exports = { pointsForDefect, gradeRoll, DEFAULT_THRESHOLDS, M_PER_YARD, MM_PER_INCH };
