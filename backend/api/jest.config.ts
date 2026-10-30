// jest.config.ts

export default {
    moduleFileExtensions: ["js", "json", "ts"],
    preset: "ts-jest",
    reporters: ["default", ["jest-junit", { outputDirectory: "test_reports" }]],
    rootDir: "src",
    testEnvironment: "node",
    testRegex: ".*\\.spec\\.ts$",
    transform: {
        "^.+\\.(t|j)s$": "ts-jest"
    },
    collectCoverage: true,
    coverageReporters: ["text-summary", "cobertura"],
    coverageDirectory: "../test_reports",
    // collectCoverageFrom: ["./src/**"],
    // coverageThreshold: {
    //   global: {
    //     lines: 90,
    //   },
    // },
  };
  