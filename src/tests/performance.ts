import { wrap } from "../index";

describe("performance", function () {
  this.timeout(30000);

  it("should be able to tolerate lots of Entry objects", function () {
    let counter = 0;
    const child = wrap((a: any, b: any) => counter++);
    const parent = wrap((obj1: object, num: number, obj2: object) => {
      child(obj1, counter);
      child(counter, obj2);
      return counter++;
    });
    for (let i = 0; i < 100000; ++i) {
      parent({}, i, {});
    }
  });
});
