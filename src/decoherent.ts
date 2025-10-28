export {
  Decoherable,
  InferFromMeasurments,
  CohereFromExamples,
  InferFromUsage,
  GreaterThanX,
  WithDescription,
} from "./decobase";

export function Decohere<T>(): T {
  throw new Error("Decohere<T>() should be stripped by the decohere build step.");
}

export function testIsType<T>(_value: unknown): _value is T {
  throw new Error("testIsType<T>() should be stripped by the decohere build step.");
}
