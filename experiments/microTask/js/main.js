import { withLayersZone, withoutLayersZone } from "../../../context-zone/contextZone.js";
import { layer, withLayers, withoutLayers } from "../../../ContextJS/src/contextjs.js";
import { ACCESS_TOKEN } from "./tokens.js";


const authHeader = {
  Authorization: `Bearer ${ACCESS_TOKEN}`,
}

const BASE_URL = "https://qiita.com/api/v2/";
const POSTS_URL = "items";
const USERS_URL = "users";
const requestQiita = (url, isAuth, thenCallback) => {
  fetch(url, {
    method: "GET",
    mode: "cors",
    headers: {
      "Content-Type": "application/json",
      ...isAuth && authHeader,
    }
  })
    .then(response => response.json())
    .then(thenCallback);
}

class ListRenderer {
  constructor() {
    this.listElm = this.getListElm();
  }
  getListElm() {
    return document.getElementById("post-list");
  }
  renderCard(title, subTitle, id) {
    const cardElm = document.createElement("div");
    cardElm.classList.add("card", "mt-3", "shadow-sm");
    cardElm.id = id;
    const cardBody = `
    <div class="card-body">
      <h5 class="card-title">${title ? title : "-"}</h5>
      <h6 class="card-subtitle mb-2 text-muted">${subTitle ? subTitle : "-"}</h6>
    </div>
    `;
    cardElm.innerHTML = cardBody;
    return cardElm;
  }
  renderList(listDataSet) {
    listDataSet.forEach(listData => {
      const card = this.renderCard(listData.title, listData.subTitle, listData.id);
      this.listElm.appendChild(card);
    });
  }
}

class RequestClient {
  getUrl() {
    return BASE_URL + POSTS_URL;
  }
  getTitle(item) {
    return item.title;
  }
  getSubTitle(item) {
    const date = new Date(item.updated_at);
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  }
  getId(item) {
    return item.id;
  }
  parseItems(items) {
    return items.map(item => {
      return {
        title: this.getTitle(item),
        subTitle: this.getSubTitle(item),
        id: this.getId(item),
      }
    })
  }
  request(task) {
    requestQiita(this.getUrl(), true, task);
  }
}

const userListLayer = layer("userListLayer");
userListLayer.refineClass(ListRenderer, {
  getListElm() {
    return document.getElementById("user-list");
  }
});
userListLayer.refineClass(RequestClient, {
  getUrl() {
    return BASE_URL + USERS_URL;
  },
  getTitle(item) {
    return item.id;
  },
  getSubTitle(item) {
    return `フォロー数: ${item.followees_count}, フォロワー数: ${item.followers_count}`;
  },
  getId(item) {
    return item.id;
  },
});

const displayList = () => {
  const requestClient = new RequestClient();
  const listRenderer = new ListRenderer();

  requestClient.request((data) => {
    console.log(data);
    const items = Object.values(data);
    const listDataSet = requestClient.parseItems(items);
    listRenderer.renderList(listDataSet);

    defineClickEvent(listRenderer.listElm); // EventTask. cardが生成されてからevent定義
  });
}

/** MicroTask
 * 違い: 既存手法では、ユーザのtitle, subtitleが崩れる(titleやらupdated_atやら存在しないkeyを指定されるため).
 */
displayList();
withLayers([userListLayer], displayList);
// withLayersZone([userListLayer], displayList);


class ClickEventDefiner {
  geneDetailUrl(elm) {
    return `/post/${elm.id}`;
  }
  define(elm) {
    elm.addEventListener("click", () => {
      console.log(this.geneDetailUrl(elm)); // 疑似request
    });
  }
}

userListLayer.refineClass(ClickEventDefiner, {
  geneDetailUrl(elm) {
    return `/user/${elm.id}`;
  }
});

const defineClickEvent = (listElm) => {
  const clickEventDefiner = new ClickEventDefiner();
  Array.prototype.forEach.call(listElm.children, cardElm => {
    clickEventDefiner.define(cardElm);
  });
}

/** EventTask
 * 違い: 生成されたurlが既存手法ではどちらもpost/...となってしまう。
 */
// withLayersZone([userListLayer], defineClickEvent); // まだcardが生成されていない


/** MacroTask
 * 違い:
 */