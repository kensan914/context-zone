// node --experimental-modules zoneContextJS.js
import { withLayers, withoutLayers } from "../ContextJS/src/contextjs.js";
import { LayerStack } from "../ContextJS/src/Layers.js";
import { decrementExpectedAwaits, incrementExpectedAwaits, microTaskScope } from "./microTaskZone/helpers/psd.js";
import { generateOnInvokeTaskCallback, generateZoneSettings, generateZoneName } from "./utils.js";


const withFrame = (frame, activateCallback) => {
  const zoneName = generateZoneName();
  const activeTask = { microTask: false, macroTask: false, eventTask: false };

  const onInvokeTaskCallback = generateOnInvokeTaskCallback(zoneName, activeTask, frame);
  const zoneSettings = generateZoneSettings(zoneName, activeTask, { onInvokeTask: onInvokeTaskCallback });
  const zone = Zone.current.fork(zoneSettings);

  activateCallback(zone);
}

export const customWithLayersZoned = (layers, callback) => {
  console.error("start customWithLayersZoned");
  console.error(layers);
  const frame = { withLayers: layers };

  let returnValue;
  const rootZone = Zone.current;

  withFrame(frame, (zone) => {
    withLayers(layers, () => {
      zone.run(() => {
        // returnValue = callback.call();

        try {
          incrementExpectedAwaits();

          microTaskScope(() => {

            // withFrame(frame, (zone) => {
            //   zone.run(() => {
            returnValue = callback.call();
            // console.log(returnValue);
            //   });
            // });

          }, {
            afterEnter() {
              console.warn("はじまり");
              LayerStack.push({ ...frame });

              Object.defineProperty(Zone, "current", {
                value: zone,
                writable: true,
                configurable: true,
                enumerable: false,
              });
            },
            afterLeave() {
              console.warn("おわり");
              LayerStack.pop();

              console.error(rootZone);
              Object.defineProperty(Zone, "current", {
                value: rootZone,
                writable: true,
                configurable: true,
                enumerable: false,
              });
            },
          });
        } finally {
          if (returnValue && typeof returnValue.then === 'function') {
            returnValue.then(() => decrementExpectedAwaits());
          } else {
            decrementExpectedAwaits();
          }
        }

      });
    });
  });
}


export const asyncawaitWithLayers = (layers, callback) => {
  microTaskScope(() => {
    return callback.call();
  }, {
    afterEnter() {
      console.log("アフターエンター(switchToZone内)");
    },
    afterLeave() {
      console.log("アフターリーブ(switchToZone内)");
    }
  });
}