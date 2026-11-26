/**
 * Speech cleanup (Sprint 13, Module 04): cutting a clip by its words, its
 * pauses and its filler words. Every tool here produces stretches of the
 * video to remove, and `removeSourceRanges` turns them into a longer segment
 * list. No new structure in the document. Pure.
 */
export * from './cut-range';
export * from './fillers';
export * from './removed';
export * from './silences';
export * from './word-cuts';
