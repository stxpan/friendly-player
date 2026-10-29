import type { Modifier } from '@dnd-kit/core'

// Queue rows only move up and down. (Same as @dnd-kit/modifiers' restrictToVerticalAxis,
// without pulling in the whole package for one line.)
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 })
