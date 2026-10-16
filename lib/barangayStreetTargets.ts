/**
 * Where each of the barangay's streets is on its own map.
 *
 * Kept apart from the component that draws it so the geometry can be checked
 * without a browser - see tests/streetTargets.test.ts. Coordinates are in the
 * artwork's own 760x400 space, the one BarangayBaseArt draws in.
 *
 * These are NOT geographic coordinates and can never be turned into any. The
 * drawing is a diagram: fitting a transform from it to latitude and longitude
 * was measured against held-out control points and missed by a mean of 172m,
 * at worst 384m, across a barangay about a kilometre wide. Real coordinates
 * live in lib/streetPoints.ts, and only for streets whose point was confirmed
 * by reading it back from a geocoder.
 */

import { BARANGAY_STREETS, type BarangayStreet } from './streets';

/** The drawing's own coordinate space. Every number below is in these units. */
export const MAP_W = 760;
export const MAP_H = 400;

export type Shape =
  | { t: 'rect'; x: number; y: number; w: number; h: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; w: number }
  | { t: 'path'; d: string; w: number };

export interface Target {
  street: BarangayStreet;
  /**
   * Where a tap counts. Generous on purpose - it takes in the road, the words
   * naming it, and a margin for a thumb, because a finger aiming at a six
   * pixel line misses it.
   */
  hit: Shape[];
  /**
   * The road itself, as BarangayBaseArt draws it, for the highlight. Lighting
   * up the hit area instead would show the resident a scatter of rectangles
   * and tell them nothing about which road they picked.
   */
  show: Shape[];
  /** Where the pin sits once this street is chosen. */
  pin: [number, number];
  /** What to look for on the ground, so the resident can confirm the choice. */
  near: string;
}

export const TARGETS: Target[] = [
  {
    street: 'MacArthur Highway', pin: [210, 130],
    show: [{ t: 'rect', x: 38, y: 122, w: 322, h: 16 }],
    near: 'the main highway past the Shell station',
    hit: [
      { t: 'rect', x: 38, y: 120, w: 322, h: 20 },
      { t: 'rect', x: 22, y: 100, w: 78, h: 14 },   // its name, drawn above the road
    ],
  },
  {
    street: 'Granville Subd.', pin: [650, 204],
    show: [
      { t: 'path', d: 'M 540,158 H 700 V 250 H 540 Z', w: 7 },
      { t: 'line', x1: 650, y1: 161, x2: 650, y2: 247, w: 6 },
    ],
    near: 'the block east of Ayukit, above the railway',
    hit: [
      { t: 'rect', x: 536, y: 154, w: 168, h: 100 },
      { t: 'rect', x: 640, y: 353, w: 56, h: 13 },  // its name, drawn below the railway
    ],
  },
  {
    street: 'Violeta Metroville Subd.', pin: [262, 208],
    show: [
      { t: 'rect', x: 257, y: 130, w: 10, h: 172 },
      { t: 'rect', x: 150, y: 208, w: 170, h: 6 },
      { t: 'rect', x: 150, y: 238, w: 170, h: 6 },
      { t: 'rect', x: 150, y: 274, w: 170, h: 6 },
    ],
    near: 'in from McArthur, past McDonald’s',
    hit: [
      { t: 'rect', x: 251, y: 130, w: 22, h: 174 },
      { t: 'rect', x: 150, y: 200, w: 170, h: 84 },
      { t: 'rect', x: 241, y: 147, w: 13, h: 72 },  // the name up the side of the road
      { t: 'rect', x: 204, y: 291, w: 58, h: 13 },  // "METROVILLE SUBD." under the grid
    ],
  },
  {
    street: 'Ortega Compound', pin: [44, 190],
    show: [{ t: 'rect', x: 39, y: 130, w: 11, h: 122 }],
    near: 'the west end of McArthur, running down to Sapa',
    hit: [{ t: 'rect', x: 24, y: 128, w: 34, h: 126 }],
  },
  {
    street: 'Eugenio Compound', pin: [132, 185],
    show: [{ t: 'rect', x: 127, y: 130, w: 10, h: 102 }],
    near: 'beside Sto. Niño Academy',
    hit: [{ t: 'rect', x: 120, y: 128, w: 24, h: 106 }],
  },
  {
    street: 'J.P. Rizal St.', pin: [240, 92],
    show: [{ t: 'line', x1: 178, y1: 133, x2: 305, y2: 49, w: 10 }],
    near: 'the road past the Brgy Hall',
    hit: [{ t: 'line', x1: 178, y1: 133, x2: 305, y2: 49, w: 17 }],
  },
  {
    street: 'Gov. F. Halili Ext.', pin: [304, 100],
    show: [
      { t: 'rect', x: 299, y: 46, w: 11, h: 90 },
      { t: 'path', d: 'M 304,48 H 400 Q 428,48 428,74 V 100 Q 428,126 400,131 L 358,133', w: 10 },
    ],
    near: 'north from the Fly-Over, toward the river',
    hit: [
      { t: 'rect', x: 293, y: 44, w: 20, h: 94 },
      { t: 'path', d: 'M 304,48 H 400 Q 428,48 428,74 V 100 Q 428,126 400,131 L 358,133', w: 15 },
    ],
  },
  {
    street: 'Gov. F. Halili Ave.', pin: [402, 224],
    show: [
      { t: 'line', x1: 352, y1: 132, x2: 452, y2: 316, w: 10 },
      { t: 'rect', x: 448, y: 316, w: 9, h: 68 },
    ],
    near: 'south from the Fly-Over past 7-Eleven, then on as Turo past the railway',
    hit: [
      { t: 'line', x1: 352, y1: 132, x2: 452, y2: 316, w: 17 },
      { t: 'rect', x: 444, y: 314, w: 18, h: 72 },  // the Turo stretch
      { t: 'rect', x: 430, y: 354, w: 14, h: 22 },  // and the word "TURO"
    ],
  },
  {
    street: 'P. Lazaro St.', pin: [500, 64],
    show: [{ t: 'path', d: 'M 428,64 H 520 Q 534,64 534,78 V 128', w: 9 }],
    near: 'toward Dr. Yanga Colleges',
    hit: [{ t: 'path', d: 'M 428,64 H 520 Q 534,64 534,78 V 128', w: 16 }],
  },
  {
    street: 'J. Benedicto St.', pin: [358, 69],
    show: [{ t: 'rect', x: 312, y: 66, w: 92, h: 6 }],
    near: 'the upper row of houses inside the loop',
    hit: [{ t: 'rect', x: 312, y: 61, w: 92, h: 15 }],
  },
  {
    street: 'A. Mendoza St.', pin: [358, 91],
    show: [{ t: 'rect', x: 312, y: 88, w: 92, h: 6 }],
    near: 'the lower row of houses inside the loop',
    hit: [{ t: 'rect', x: 312, y: 83, w: 92, h: 15 }],
  },
  {
    street: 'Ayukit', pin: [596, 283],
    show: [{ t: 'rect', x: 592, y: 158, w: 8, h: 226 }],
    near: 'down the side of Granville to the railway',
    hit: [{ t: 'rect', x: 576, y: 156, w: 30, h: 228 }],
  },
];

/**
 * Streets the Public Safety Office lists that have nowhere to be tapped.
 *
 * Adding a street to lib/streets.ts without putting it on the map would leave
 * one a resident is asked about but cannot point to. Should always be empty.
 */
export const STREETS_WITHOUT_A_PLACE: string[] =
  BARANGAY_STREETS.filter(s => !TARGETS.some(t => t.street === s));
