import { Decohere, InferFromMeasurments, GreaterThanX, CohereFromExamples, InferFromUsage, testIsType } from "./decoherent";

const generateEvenNumbers = () => {
  const out = []
  for (var i = 0; i < 100; i++) {
    out.push(Math.floor((Math.random() * 100)) * 2)
  }
  return out;
}

type Even = InferFromUsage<ReturnType<typeof generateEvenNumbers>[number]>;

const generatePrimes = () => {
  const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47];
  return primes;
}

type Prime = InferFromUsage<ReturnType<typeof generatePrimes>[number]>;

const special = Decohere<Even & Prime>();
const even = Decohere<Even>();
const prime = Decohere<Prime>();

console.log("Even", even);
console.log("Prime", prime);
console.log("Even & Prime", special);

type MysteryType = InferFromMeasurments<[1, 2, 3, 5, 8, 13]>;

const result = Decohere<MysteryType & GreaterThanX<100> & Even>();
console.log("Mystery", result);

const sandwichExamples = [
  {
    bread: "rye",
    meat: "cold cuts",
    cheese: "cheddar",
  },
  {
    bread: ["rye", "pumpernickle"],
    meat: "cold cuts",
    cheese: "cheddar",
  },
] as const;

const hotdogExamples = [
  {
    bread: "hotdog bun",
    meat: "hotdog",
    condiments: ["mustard", "relish", "ketchup"],
  },
  {
    bread: "hotdog bun",
    meat: "hotdog",
    veggies: ["sauerkraut", "onions"],
  },
  {
    bread: "poppy seed bun",
    meat: "hotdog",
    veggies: ["sport peppers"],
    condiments: ["mustard", "relish"],
  },
] as const;

type Sandwich = InferFromUsage<typeof sandwichExamples[number]>;
type Hotdog = InferFromUsage<typeof hotdogExamples[number]>;

const sandwich = Decohere<Sandwich>();
console.log("Classic Sandwich", sandwich);

const hotdog = Decohere<Hotdog>();
console.log("Does hotdox fit classic sandwich?", testIsType<Sandwich>(hotdog));
