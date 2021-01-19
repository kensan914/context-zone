// node --experimental-modules main.js
// import "zone.js"
import { layer, withLayers, withoutLayers } from './ContextJS/src/contextjs.js';
import { asyncawaitWithLayers, customWithLayersZoned, customWithoutLayersZoned, zonezone } from "./context-zone/zoneContextJS.js";
import { currentLayers, invalidateLayerComposition, LayerStack, proceed, resetLayerStack } from "./ContextJS/src/Layers.js";
import { withLayersZoned } from "./PSD/dynamic-extent-zoned.js";


class AuthChecker {
  check() {
    return "認証情報が見つかりません";
  }
}
const authChecker = new AuthChecker();

const authLayer = layer("authLayer");
authLayer.refineClass(AuthChecker, {
  check() {
    // return `認証済みです`;
    return `認証済みです(${proceed()})`;
  }
});
// console.log({ ...authLayer['0'] });

const authLayer2 = layer("authLayer2");
// console.log(1);
// console.log({ ...authLayer2 });
authLayer2.refineObject(authChecker, {
  check() {
    return `認証済みです2`;
    // return `認証済みです2(${proceed()})`;
  },
});
// console.log(authChecker.check);

// 擬似的なリクエスト処理
const request = () => new Promise((resolve) => {
  setTimeout(() => {
    resolve("response");
  }, 1000);
});

const clickHandler = (e) => {
  console.log(e);
  console.error(authChecker.check());

  // customWithLayersZoned([authLayer2], () => {
  //   window.addEventListener("click", () => console.log(authChecker.check()), true);
  // });
}

// asyncawaitWithLayers([authLayer], async () => {
//   await request();
//   console.error("終了");

//   // await (() => { console.log("実行"); })();
// });


customWithLayersZoned([authLayer], async () => {
  // Promise

  request()
    .then((res) => {
      // console.dir(([...LayerStack]));
      console.log(authChecker.check());

      customWithLayersZoned([authLayer2], () => {
        request()
          .then((res) => {
            console.dir(([...LayerStack]));
            console.log(authChecker.check());
          })
          .finally(() => {
          });
      });

    })
    .catch((err) => {
      console.error("err");
    })
    .finally(() => {
    });

  // simple Promise
  // const promise = new Promise((resolve) => {
  //   resolve("resolve");
  // });
  // promise
  //   .then(() => {
  //     console.error(authChecker.check());
  //   });

  // const result = await request();
  // // const result = await promise;
  // console.error(result);
  // console.error(authChecker.check());

  // const result2 = await request();
  // // const result = await promise;
  // console.error(result2);
  // console.error(authChecker.check());

  // macrotask
  // setTimeout(() => {
  //   console.error(authChecker.check());

  //   customWithLayersZoned([authLayer], () => {
  //     setTimeout(() => {
  //       console.error(authChecker.check());


  //       // customWithLayersZoned([authLayer], () => {
  //       //   request().then(() => {
  //       //     console.log(authChecker.check());
  //       //   });
  //       // });
  //     }, 900);
  //   });
  // }, 1000);

  // setInterval
  // setInterval(() => {
  //   console.log(authChecker.check());
  // }, 1000);

  // await request();
  // console.warn(authChecker.check());



  // eventtask
  document.getElementById("btn").addEventListener("click", clickHandler);
});
