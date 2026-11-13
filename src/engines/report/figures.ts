/** A caption that says nothing: empty, or the bare "Screenshot" an uncaptioned paste is titled. */
export const isWeakCaption = (caption: string) => /^\s*(?:screenshot)?\s*$/i.test(caption);
