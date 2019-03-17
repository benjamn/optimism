describe("compiled by tsc", function () {
  require("./main");
});

describe("bundled by rollup", function () {
  require("./bundle");
});
