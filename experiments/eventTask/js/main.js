import { layer, withLayers } from "../../../ContextJS/src/contextjs.js";
import { withLayersZone, withoutLayersZone } from "../../../context-zone/contextZone.js";
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
  }
});
const dropDownManager = new DropDownManager();
// withLayers([landscapeLayer], () => {
//   const dropDownButton = document.getElementById("dropDownButton");
//   dropDownButton.addEventListener("click", () => {
//     dropDownManager.show();
//   });
// });
withLayersZone([landscapeLayer], () => {
  const dropDownButton = document.getElementById("dropDownButton");
  dropDownButton.addEventListener("click", () => {
    dropDownManager.show();
  });
});
