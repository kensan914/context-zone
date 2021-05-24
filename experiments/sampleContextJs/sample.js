import { layer, proceed, withLayers } from "contextjs";

class Foo {
  bar() {
    return 3;
  }
}

const L1 = layer("L1");
L1.refineClass(Foo, {
  bar() {
    return proceed() + 4;
  },
});

let o = new Foo();
console.log(o.bar()); // 3
withLayers([L1], () => {
  console.log(o.bar()); // 7
});
