import { Decohere, InferFromMeasurments, GreaterThanX } from "./decoherent";

type Even = InferFromMeasurments<[2,4,6,8,10]>
type Prime = InferFromMeasurments<[2,3,5,7,11]>

const special = Decohere<Even & Prime>();
const even = Decohere<Even>();
const prime = Decohere<Prime>();

console.log("Even", even);
console.log("Prime", prime);
console.log("Even & Prime", special);

type MysteryType = InferFromMeasurments<1 | 2 | 3 | 5 | 8 | 13>;

const result = Decohere<MysteryType & GreaterThanX<100> & Even>();
console.log("Mystery", result);
