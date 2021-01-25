// node --experimental-modules main.js
import { layer } from "../../../ContextJS/src/contextjs.js";
import { withLayersZone, withoutLayersZone } from "../../../context-zone/contextZone.js";
import { LayerStack, proceed } from "../../../ContextJS/src/Layers.js";


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

const authLayer2 = layer("authLayer2");
authLayer2.refineObject(authChecker, {
  check() {
    return `認証済みです2`;
    // return `認証済みです2(${proceed()})`;
  },
});

// 擬似的なリクエスト処理
const request = () => new Promise((resolve) => {
  setTimeout(() => {
    resolve("response");
  }, 1000);
});

const clickHandler = (e) => {
  console.log(e);
  console.error(authChecker.check());
}

withLayersZone([authLayer], async () => {
  // Promise
  request()
    .then(async (res) => {
      console.error(authChecker.check());

      withoutLayersZone([authLayer], () => {
        request()
          .then((res) => {
            console.error([...LayerStack]);
            console.error(authChecker.check());
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

  // await request();
  // console.error(authChecker.check());

  // // // event task
  // document.getElementById("btn").addEventListener("click", clickHandler);
});
