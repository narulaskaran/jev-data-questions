/**
 * Categorical slots in a fixed, validated order (adjacent-pair colour-vision
 * separation checked for the light and dark surfaces). A class keeps its slot
 * for the life of a run. Past eight there are no more distinguishable hues, so
 * later classes share a neutral and are told apart by their labels.
 */
export const CLASS_COLOR_SLOTS = 8

export const classColorVar = (classIndex: number): string => (
  classIndex >= 0 && classIndex < CLASS_COLOR_SLOTS ? `var(--series-${classIndex + 1})` : 'var(--series-other)'
)
