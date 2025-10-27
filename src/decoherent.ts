export { Decoherable, InferFromMeasurments, CohereFromExamples, GreaterThanX, WithDescription } from "./decobase";

export function Decohere<T>(): T {
  throw new Error("Decohere<T>() should be stripped by the decohere build step.");
}
