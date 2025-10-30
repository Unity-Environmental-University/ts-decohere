import { Decohere, InferFromMeasurments, GreaterThanX, CohereFromExamples, InferFromUsage } from "./decoherent";
import { evaluatePredicates } from "../generated/predicates/index";

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

const special = (2 as unknown as Even & Prime);
const even = (2 as unknown as Even);
const prime = (3 as unknown as Prime);

console.log("Even", even);
console.log("Prime", prime);
console.log("Even & Prime", special);

type MysteryType = 1 | 2 | 3 | 5 | 8 | 13;

const result = (102 as unknown as MysteryType & GreaterThanX<100> & Even);
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

type Sandwich = {
  bread: "rye" | ("rye" | "pumpernickle")[];
  cheese: "cheddar";
  meat: "cold cuts";
};
type Hotdog = {
  bread: "hotdog bun" | "poppy seed bun";
  condiments?: ("mustard" | "relish" | "ketchup" | "mustard" | "relish")[];
  meat: "hotdog";
  veggies?: ("sauerkraut" | "onions" | "sport peppers")[];
};

const sandwich = ({"bread":"rye","meat":"cold cuts","cheese":"cheddar"} as unknown as Sandwich);
console.log("Classic Sandwich", sandwich);

const hotdog = ({"bread":"hotdog bun","meat":"hotdog"} as unknown as Hotdog);
console.log("Does hotdox fit classic sandwich?", evaluatePredicates(["05b8f83c9c889bcb5f166e70941c365539a036ce74ba8bc89c1b898affabc6fc", "ea08b20204e52cc483a0ee94dc4e095f65df72fcde33ae1582e79bae22a4302c", "5e87d1e0dfd8835f206e90059474b03bb78b915ec8baa72f5ee322b698df1fcf", "8097afe685eff861b8389b2aef82258a6e01485045cfeae944ef8e8935d9b6c6", "8f8690febf5fee733d0a7b0123950d99825aaf58363021e702f468d466691c63"], hotdog));
