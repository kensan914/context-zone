import "zone.js";
import {
  currentLayers,
  LayerStack,
  resetLayerStack,
} from "../ContextJS/src/Layers.js";
import { withLayersZone } from "./contextZone.js";

/**
 * return [restoreLayerStack, unrestoreLayerStack]
 */
export const useReplayLayerStack = (frame, zoneName) => {
  const zonedLayerStack = getCurrentLayerStack();
  frame.zoneName = zoneName;
  zonedLayerStack.push(frame);

  // LayerStackから_zoneNameのframeを削除
  const deleteFromLayerStack = (_zoneName) => {
    const targetIndex = LayerStack.findIndex(
      (elm) => elm.zoneName === _zoneName
    );
    if (targetIndex !== -1) {
      LayerStack.splice(targetIndex, 1);
    }
  };

  const restoreLayerStack = () => {
    applyToLayerStack(zonedLayerStack);
  };
  const unrestoreLayerStack = () => {
    zonedLayerStack.forEach((_frame) => {
      if (_frame.zoneName) {
        deleteFromLayerStack(_frame.zoneName);
      } else {
      }
    });
    // console.error([...LayerStack]);
  };

  return [restoreLayerStack, unrestoreLayerStack];
};

/**
 * return [replayZoneCurrentEnter, replayZoneCurrentLeave]
 */
export const useReplayZoneCurrent = (zone, rootZone) => {
  const replayZoneCurrent = (_zone) => {
    Object.defineProperty(Zone, "current", {
      value: _zone,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  };

  const replayZoneCurrentEnter = () => replayZoneCurrent(zone);
  const replayZoneCurrentLeave = () => replayZoneCurrent(rootZone);

  return [replayZoneCurrentEnter, replayZoneCurrentLeave];
};

export const generateOnInvokeTaskCallback = (
  frame,
  zoneName,
  wrapWithFrameZone
) => {
  const [restoreLayerStack, unrestoreLayerStack] = useReplayLayerStack(
    frame,
    zoneName
  );

  return (delegate, curr, target, task, applyThis, applyArgs) => {
    let _task = task;
    if (task.type !== "microTask") {
      _task = wrapCallbackTask(
        task,
        restoreLayerStack,
        unrestoreLayerStack,
        wrapWithFrameZone
      );
    }

    return delegate.invokeTask(target, _task, applyThis, applyArgs);
  };
};

const wrapCallbackTask = (
  task,
  invokeTaskCallback,
  endTaskCallback,
  wrapWithFrameZone
) => {
  if (!task.isWrappedCallback) {
    // not wrapped yet
    const _callback = task.callback;

    task.callback = function () {
      wrapWithFrameZone(() => {
        _callback.apply(this, arguments);
      }).call();
      // invokeTaskCallback();
      // withLayersZone(layers, () => {
      //   _callback.apply(this, arguments);
      // });
      // endTaskCallback();
    };
    task.isWrappedCallback = true;
  } else {
    // already wrapped
    // console.log("already wrapped.");
  }

  return task;
};

/**
 * zone nameの生成
 */
export const generateZoneName = () => {
  const chars = [];
  for (const char of "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx") {
    switch (char) {
      case "x":
        chars.push(Math.floor(Math.random() * 16).toString(16));
        break;
      case "y":
        chars.push((Math.floor(Math.random() * 4) + 8).toString(16));
        break;
      default:
        chars.push(char);
        break;
    }
  }
  return chars.join("");
};

export function applyToLayerStack(from) {
  const fromLength = from.length;
  const LayerStackLength = LayerStack.length;
  const maxLengthCommonAncestry = Math.min(fromLength, LayerStackLength);
  let commonAncestryLength = 0;

  while (
    commonAncestryLength < maxLengthCommonAncestry &&
    from[commonAncestryLength]?.zoneName ===
      LayerStack[commonAncestryLength]?.zoneName
  ) {
    commonAncestryLength++;
  }

  while (LayerStack.length > commonAncestryLength) {
    popFrame();
  }
  while (LayerStack.length < fromLength) {
    pushFrame(from[LayerStack.length]);
  }
}

export function popFrame() {
  const beforePop = currentLayers();

  const frame = LayerStack.pop();
  const { withLayers, withoutLayers } = frame;

  const afterPop = currentLayers();

  // #TODO: we should probably .reverse() the list to deactivate the last activated layer first
  withLayers &&
    withLayers
      .filter((l) => beforePop.includes(l) && !afterPop.includes(l))
      .forEach((l) => l._emitDeactivateCallbacks());

  withoutLayers &&
    withoutLayers
      .filter((l) => !beforePop.includes(l) && afterPop.includes(l))
      .forEach((l) => l._emitActivateCallbacks());
}

export function pushFrame(frame) {
  const { withLayers, withoutLayers } = frame;

  const beforePush = currentLayers();

  LayerStack.push(frame);

  withLayers &&
    withLayers
      .filter((l) => !beforePush.includes(l))
      .forEach((l) => l._emitActivateCallbacks());

  withoutLayers &&
    withoutLayers
      .filter((l) => beforePush.includes(l))
      .forEach((l) => l._emitDeactivateCallbacks());
}

export function frameEquals(frame1, frame2) {
  const layerListProperties = ["withLayers", "withoutLayers"];

  // all props are StrictEqual, except withLayers and withoutLayers
  const shallowCompare = (obj1, obj2) =>
    Object.keys(obj1).length === Object.keys(obj2).length &&
    Object.keys(obj1).every((key) => {
      if (layerListProperties.includes(key)) {
        return true; // checked later
      }
      return obj2.hasOwnProperty(key) && obj1[key] === obj2[key];
    });

  if (!shallowCompare(frame1, frame2)) {
    return false;
  }

  // withLayers and withoutLayers should contain the same layers in order
  return layerListProperties.every((prop) => {
    const arr1 = frame1[prop];
    const arr2 = frame2[prop];
    if (arr1 && arr2) {
      // both have prop set
      if (
        !Array.isArray(arr1) ||
        !Array.isArray(arr2) ||
        arr1.length !== arr2.length
      ) {
        return false;
      }
      return arr1.every((layer, index) => layer === arr2[index]);
    }

    return !arr1 && !arr2; // both do not define the prop is fine, too
  });
}

export function getCurrentLayerStack() {
  if (LayerStack.length === 0) {
    resetLayerStack();
  }
  return LayerStack.map((frame) => {
    const resultFrame = {};

    // use copied arrays of layers
    if (frame.withLayers) {
      resultFrame.withLayers = Array.from(frame.withLayers);
    }
    if (frame.withoutLayers) {
      resultFrame.withoutLayers = Array.from(frame.withoutLayers);
    }

    return Object.assign(resultFrame, frame);
  });
}
