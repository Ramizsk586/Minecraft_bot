const { Vec3 } = require('vec3');

/**
 * Calculate 2D Euclidean distance on the XZ plane.
 */
function distance2D(p1, p2) {
  if (!p1 || !p2) return 0;
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.z - p2.z, 2));
}

/**
 * Calculate 3D Euclidean distance.
 */
function distance3D(p1, p2) {
  if (!p1 || !p2) return 0;
  const v1 = new Vec3(p1.x, p1.y, p1.z);
  const v2 = new Vec3(p2.x, p2.y, p2.z);
  return v1.distanceTo(v2);
}

/**
 * Calculate yaw and pitch from source position to destination.
 */
function getYawPitch(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, distance);
  return { yaw, pitch };
}

module.exports = {
  distance2D,
  distance3D,
  getYawPitch
};
