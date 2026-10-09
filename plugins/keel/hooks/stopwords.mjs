/**
 * stopwords.mjs — the words that carry no topic, shared by both recall hooks.
 *
 * memory-recall.mjs drops them before scoring a prompt against local files.
 * hindsight-recall.mjs counts what is left to decide whether a prompt names a
 * topic at all. One list, so the two hooks cannot disagree about which words
 * mean nothing.
 */
export const STOPWORDS = new Set(
  ("the a an and or but if then than that this these those is are was were be been being do does did" +
    " done have has had having i me my we our you your it its of to in on for with at by from as not" +
    " no yes can could should would will just now how what when where which who why please help" +
    " let make made get got go going use used using need needs want wants like about into out up down" +
    " over under again more most some any all each other same so very own too also here there").split(/\s+/),
);
