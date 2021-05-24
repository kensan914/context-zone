// node --experimental-modules zoneContextJS.js
import { withLayers, withoutLayers } from "../ContextJS/src/contextjs.js";
import { decrementExpectedAwaits, incrementExpectedAwaits, microTaskScope } from "./microTaskZone/helpers/psd.js";
import { generateOnInvokeTaskCallback, generateZoneName, useReplayLayerStack, useReplayZoneCurrent } from "./utils.js";


const withFrame = (frame, activateCallback, wrapWithFrameZone) => {
  const zoneName = generateZoneName();

  const onInvokeTaskCallback = generateOnInvokeTaskCallback(frame, zoneName, wrapWithFrameZone);
  const zone = Zone.current.fork({
    name: zoneName,
    onInvokeTask: onInvokeTaskCallback,
  });

  activateCallback(zone);
}

const withFrameZone = (layers, callback, isActivation) => {
  const frame = { [isActivation ? "withLayers" : "withoutLayers"]: layers };
  const withDynamicExtent = isActivation ? withLayers : withoutLayers;
  const wrapWithFrameZone = (_callback) => () => withFrameZone(layers, _callback, isActivation);
  let returnValue;

  withFrame(frame, (zone) => {
    const [restoreLayerStack, unrestoreLayerStack] = useReplayLayerStack(frame, zone.name);
    const [replayZoneCurrentEnter, replayZoneCurrentLeave] = useReplayZoneCurrent(zone, Zone.current);

    withDynamicExtent(layers, () => {
      zone.run(() => {
        try {
          incrementExpectedAwaits();

          microTaskScope(() => {
            returnValue = callback.call();
          }, {
            afterEnter() {
              restoreLayerStack();
              replayZoneCurrentEnter();
            },
            afterLeave() {
              unrestoreLayerStack();
              replayZoneCurrentLeave();
            },
          });
        } finally {
          if (returnValue && typeof returnValue.then === "function") {
            returnValue.then(() => decrementExpectedAwaits());
          } else {
            decrementExpectedAwaits();
          }
        }
      });
    });
  }, wrapWithFrameZone);
}

export const withLayersZone = (layers, callback) => {
  withFrameZone(layers, callback, true);
}

export const withoutLayersZone = (layers, callback) => {
  withFrameZone(layers, callback, false);
}