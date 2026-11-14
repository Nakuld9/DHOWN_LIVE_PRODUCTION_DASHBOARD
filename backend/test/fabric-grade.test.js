// The 4-point grading maths — the core Phase-1 logic. If this is wrong, every
// roll is mis-graded and the mill sells B-grade as A (or scraps good fabric), so
// it is tested against hand-computed values.

const { pointsForDefect, gradeRoll } = require('../src/lib/fabric-grade');

describe('pointsForDefect — size bands and the 4-point cap', () => {
  test('length bands: ≤3=1, ≤6=2, ≤9=3, >9=4', () => {
    expect(pointsForDefect({ sizeInches: 2 })).toBe(1);
    expect(pointsForDefect({ sizeInches: 3 })).toBe(1);
    expect(pointsForDefect({ sizeInches: 4 })).toBe(2);
    expect(pointsForDefect({ sizeInches: 6 })).toBe(2);
    expect(pointsForDefect({ sizeInches: 7 })).toBe(3);
    expect(pointsForDefect({ sizeInches: 9 })).toBe(3);
    expect(pointsForDefect({ sizeInches: 12 })).toBe(4);
  });
  test('nothing ever scores more than 4 points', () => {
    expect(pointsForDefect({ sizeInches: 100 })).toBe(4);
  });
  test('holes: ≤1in=2, >1in=4 (their own scale)', () => {
    expect(pointsForDefect({ sizeInches: 0.5, isHole: true })).toBe(2);
    expect(pointsForDefect({ sizeInches: 2, isHole: true })).toBe(4);
  });
  test('a zero/blank defect scores the smallest band, not a crash', () => {
    expect(pointsForDefect({})).toBe(1);
  });
});

describe('gradeRoll — normalisation and grade', () => {
  // A 100-yard (91.44 m) roll, 60 inches (1524 mm) wide → 166.67 sq yd.
  const roll = { lengthMeters: 91.44, widthMm: 1524 };

  test('the points/100-sq-yd formula matches the hand calc', () => {
    // 20 total points on 100yd × 60in: 20×3600 / (100×60) = 12.0
    const r = gradeRoll({ ...roll, defects: [{ sizeInches: 12, count: 5 }] }); // 5×4 = 20 pts
    expect(r.totalPoints).toBe(20);
    expect(r.pointsPer100SqYd).toBeCloseTo(12, 1);
    expect(r.grade).toBe('A');
  });

  test('A-grade at the 40-point line, B just over it', () => {
    // Need >66.7 raw points to exceed 40/100sqyd on this roll.
    const a = gradeRoll({ ...roll, defects: [{ sizeInches: 12, count: 16 }] }); // 64 pts → 38.4
    expect(a.grade).toBe('A');
    const b = gradeRoll({ ...roll, defects: [{ sizeInches: 12, count: 18 }] }); // 72 pts → 43.2
    expect(b.grade).toBe('B');
  });

  test('REJECT above the B threshold', () => {
    const r = gradeRoll({ ...roll, defects: [{ sizeInches: 12, count: 40 }] }); // 160 pts → 96
    expect(r.grade).toBe('REJECT');
  });

  test('thresholds are configurable (a stricter mill)', () => {
    const r = gradeRoll({ ...roll, defects: [{ sizeInches: 12, count: 16 }], thresholds: { aMax: 20, bMax: 50 } });
    expect(r.pointsPer100SqYd).toBeCloseTo(38.4, 1);
    expect(r.grade).toBe('B'); // 38.4 > stricter aMax of 20
  });

  test('no measured area → UNGRADED, never a divide-by-zero or invented grade', () => {
    const r = gradeRoll({ lengthMeters: 0, widthMm: 1524, defects: [{ sizeInches: 4 }] });
    expect(r.grade).toBe('UNGRADED');
    expect(r.pointsPer100SqYd).toBeNull();
    expect(r.totalPoints).toBe(2); // points still counted
  });

  test('a clean roll is A-grade with zero points', () => {
    const r = gradeRoll({ ...roll, defects: [] });
    expect(r.totalPoints).toBe(0);
    expect(r.grade).toBe('A');
  });
});
