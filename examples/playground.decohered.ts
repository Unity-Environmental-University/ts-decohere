import { Decohere, InferFromMeasurments, GreaterThanX } from "./decoherent";

type Even = InferFromMeasurments<[2,4,6,8,10]>
type Prime = InferFromMeasurments<[2,3,5,7,11]>

const special = (2 as unknown as Even & Prime);
const even = (2 as unknown as Even);
const prime = (7 as unknown as Prime);

console.log("Even", even);
console.log("Prime", prime);
console.log("Even & Prime", special);

type MysteryType = InferFromMeasurments<1 | 2 | 3 | 5 | 8 | 13>;

const result = (102 as unknown as MysteryType & GreaterThanX<100> & Even);
console.log("Mystery", result);
