import { SIM_ACTION_LOW, SIM_ACTION_HIGH, GRIPPER_IDX, NUM_JOINTS } from '../constants';

/**
 * Convert normalized joint values to radians.
 * Joints: [-100, 100] -> [LOW, HIGH]
 * Gripper: [0, 100] -> [LOW, HIGH]
 */
export function normalizedToRadians(normalized: number[]): number[] {
  const radians = new Array(NUM_JOINTS);
  for (let i = 0; i < NUM_JOINTS; i++) {
    let t: number;
    if (i === GRIPPER_IDX) {
      // Gripper: [0, 100] -> [LOW, HIGH]
      t = normalized[i] / 100.0;
    } else {
      // Joints: [-100, 100] -> [LOW, HIGH]
      t = (normalized[i] + 100.0) / 200.0;
    }
    radians[i] = SIM_ACTION_LOW[i] + t * (SIM_ACTION_HIGH[i] - SIM_ACTION_LOW[i]);
  }
  return radians;
}

/**
 * Auto-detect the unit/encoding of joint values and convert to radians.
 * Heuristic based on data ranges:
 * - max(abs) > 360 -> servo ticks (not yet implemented, treat as normalized)
 * - max(abs) > 6.3 -> normalized [-100, 100] / [0, 100]
 * - otherwise -> already radians
 */
export function autoConvertToRadians(values: number[]): number[] {
  const maxAbs = Math.max(...values.map(Math.abs));

  if (maxAbs > 6.3) {
    // Normalized format
    return normalizedToRadians(values);
  }
  // Already radians - just clip to limits
  return clipToLimits(values);
}

/**
 * Clip joint values to valid range.
 */
export function clipToLimits(radians: number[]): number[] {
  return radians.map((v, i) =>
    Math.max(SIM_ACTION_LOW[i], Math.min(SIM_ACTION_HIGH[i], v))
  );
}

/**
 * Map joint names to qpos indices using model.jnt_qposadr.
 * Returns an array of qpos indices in motor order.
 */
export function getJointQposIndices(mujoco: any, model: any): number[] {
  const MOTOR_NAMES = [
    'shoulder_pan', 'shoulder_lift', 'elbow_flex',
    'wrist_flex', 'wrist_roll', 'gripper',
  ];

  const indices: number[] = [];
  for (const name of MOTOR_NAMES) {
    // Find joint by name
    const jntId = mujoco.mj_name2id(model, 3, name); // OBJ_JOINT = 3
    if (jntId >= 0) {
      indices.push(model.jnt_qposadr[jntId]);
    } else {
      console.warn(`Joint not found: ${name}`);
      indices.push(-1);
    }
  }
  return indices;
}

/**
 * Set qpos values for the robot joints.
 */
export function setJointPositions(
  data: any,
  qposIndices: number[],
  radians: number[],
): void {
  for (let i = 0; i < radians.length && i < qposIndices.length; i++) {
    const idx = qposIndices[i];
    if (idx >= 0) {
      data.qpos[idx] = radians[i];
    }
  }
}
