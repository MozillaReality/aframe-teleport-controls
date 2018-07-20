/* global THREE */
// Parabolic motion equation, y = p0 + v0*t + 1/2at^2
function parabolicCurveScalar(p0, v0, halfA, t, tSquared) {
  return p0 + v0 * t + halfA * tSquared;
}

// Parabolic motion equation applied to 3 dimensions
function parabolicCurve(p0, v0, halfA, t, out) {
  const tSquared = t * t;
  out.x = parabolicCurveScalar(p0.x, v0.x, halfA.x, t, tSquared);
  out.y = parabolicCurveScalar(p0.y, v0.y, halfA.y, t, tSquared);
  out.z = parabolicCurveScalar(p0.z, v0.z, halfA.z, t, tSquared);
  return out;
}

module.exports = parabolicCurve;
