// node --experimental-modules main.js
import { layer } from "../../../ContextJS/src/contextjs.js";
import { withLayersZone, withoutLayersZone } from "../../../context-zone/contextZone.js";
import { LayerStack, proceed } from "../../../ContextJS/src/Layers.js";
import { ACCESS_TOKEN } from "./tokens.js";


const authHeader = {
  headers: {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
  },
}

const ghFetch = async (...args) => {
  return new Promise(async (resolve, reject) => {
    await fetch(...args)
      .then(r => r.json())
      .then(resolve)
      .catch(reject);
  });
}

const BASE_URL = "https://qiita.com/api/v2/items/"
const newestUrl = ""