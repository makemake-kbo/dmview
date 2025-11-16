import type { WarpConfig, WarpPoint } from '../types';
import { DEFAULT_WARP } from '../types';

export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const identityHomography = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const ensureWarp = (warp?: WarpConfig | null): WarpConfig => {
  if (warp && Array.isArray(warp.corners) && warp.corners.length === 4) {
    return warp;
  }
  return DEFAULT_WARP;
};

export const computeHomography = (corners: WarpPoint[]): Mat3 => {
  if (corners.length !== 4) {
    throw new Error('Homography requires 4 corners');
  }
  const [p0, p1, p2, p3] = corners;
  const dx1 = p1.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dx2 = p3.x - p2.x;
  const dy2 = p3.y - p2.y;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy3 = p0.y - p1.y + p2.y - p3.y;

  let a31 = 0;
  let a32 = 0;
  if (dx3 !== 0 || dy3 !== 0) {
    const det = dx1 * dy2 - dx2 * dy1;
    if (det !== 0) {
      a31 = (dx3 * dy2 - dx2 * dy3) / det;
      a32 = (dx1 * dy3 - dx3 * dy1) / det;
    }
  }

  const a11 = p1.x - p0.x + a31 * p1.x;
  const a12 = p3.x - p0.x + a32 * p3.x;
  const a13 = p0.x;
  const a21 = p1.y - p0.y + a31 * p1.y;
  const a22 = p3.y - p0.y + a32 * p3.y;
  const a23 = p0.y;

  return [a11, a12, a13, a21, a22, a23, a31, a32, 1];
};

export const invertHomography = (matrix: Mat3): Mat3 => {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const A = e * i - f * h;
  const B = c * h - b * i;
  const C = b * f - c * e;
  const D = f * g - d * i;
  const E = a * i - c * g;
  const F = c * d - a * f;
  const G = d * h - e * g;
  const H = b * g - a * h;
  const I = a * e - b * d;
  const det = a * A + b * D + c * G;
  if (Math.abs(det) < 1e-9) {
    return identityHomography();
  }
  const invDet = 1 / det;
  return [
    A * invDet,
    B * invDet,
    C * invDet,
    D * invDet,
    E * invDet,
    F * invDet,
    G * invDet,
    H * invDet,
    I * invDet,
  ];
};

export const applyHomography = (matrix: Mat3, point: WarpPoint): WarpPoint => {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const { x, y } = point;
  const denom = g * x + h * y + i;
  if (denom === 0) {
    return { x, y };
  }
  return {
    x: (a * x + b * y + c) / denom,
    y: (d * x + e * y + f) / denom,
  };
};
