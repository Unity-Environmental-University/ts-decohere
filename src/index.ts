/**
 * ts-decohere: Main entry point
 * Exports all type markers and the Decohere function
 */

export {
  Decoherable,
  InferFromMeasurments,
  CohereFromExamples,
  InferFromUsage,
  GreaterThanX,
  WithDescription,
} from "./decobase";

export { Decohere, testIsType } from "./decoherent";

export {
  FuzzGenerator,
  FuzzGeneratorOptions,
  HeuristicDefinition,
  decohereFuzzGenerator,
} from "./decohereFuzzGenerator";
