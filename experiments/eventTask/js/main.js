import { layer, withLayers } from "../../../ContextJS/src/contextjs.js";
import {
  withLayersZone,
  withoutLayersZone,
} from "../../../context-zone/contextZone.js";
import { LayerStack, proceed } from "../../../ContextJS/src/Layers.js";

class DropDownManager {
  constructor() {
    this.dropdownMenu = document.getElementById("dropDownMenu");
  }
  show() {
    this.dropdownMenu.classList.add("active");
  }
}
const landscapeLayer = layer("landscapeLayer");
landscapeLayer.refineClass(DropDownManager, {
  show() {
    proceed();
    this.dropdownMenu.classList.add("landscape");
  },
});
const dropDownManager = new DropDownManager();

// 既存手法 (画面横向きにもかかわらずドロップダウンが下に表示)
withLayers([landscapeLayer], () => {
  const dropDownButton = document.getElementById("dropDownButton");
  dropDownButton.addEventListener("click", () => {
    dropDownManager.show();
  });
});

// 提案手法 (画面横向きであるためドロップダウンが左に表示)
// withLayersZone([landscapeLayer], () => {
//   const dropDownButton = document.getElementById("dropDownButton");
//   dropDownButton.addEventListener("click", () => {
//     dropDownManager.show();
//   });
// });
