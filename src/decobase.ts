export type Decoherable<T> = T & { readonly __decoherable?: unique symbol };

export type InferFromMeasurments<T> = Decoherable<T>;
export type CohereFromExamples<T> = Decoherable<T>;

export type GreaterThanX<T extends number> = Decoherable<number> & {
  readonly __minimum: T;
};

export type WithDescription<T> = Decoherable<T> & {
  readonly __description: string;
};
