/** Scroll past this many pixels before the back-to-top control appears. */
export const BACK_TO_TOP_THRESHOLD_PX = 320;

export function shouldShowBackToTop(
  scrollY: number,
  thresholdPx = BACK_TO_TOP_THRESHOLD_PX
): boolean {
  return scrollY > thresholdPx;
}
