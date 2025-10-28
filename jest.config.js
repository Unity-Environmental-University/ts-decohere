module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  collectCoverageFrom: [
    "tooling/lib/**/*.ts",
    "!tooling/lib/index.ts",
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/tooling/lib/$1",
  },
};
