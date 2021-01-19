import { LayerStack } from "../ContextJS/src/Layers.js";
import "zone.js";


export const generateZoneSettings = (zoneName, activeTask, overwriteSettings = {}) => {
  const zoneSettings = {
    ... {
      name: zoneName,
      onInvokeTask: (delegate, curr, target, task, applyThis, applyArgs) => { },

      // onHasTask: (delegate, curr, target, hasTaskState) => {
      //   console.log("1");

      //   // 非同期タスクの実行待ち状態が変化した時にトリガーされます
      //   if (!hasTaskState.microTask && hasTaskState.change === "microTask") {
      //     console.error("microTask(Promise.then)を終了しました");
      //     // deactivateWithLayerZoned(activeTask, hasTaskState.change, zoneName);
      //   } else if (!hasTaskState.macroTask && hasTaskState.change === "macroTask") {
      //     console.error("macroTask(setTimeout.callback)を終了しました。");
      //     deactivateWithLayerZoned(activeTask, hasTaskState.change, zoneName);
      //   } else if (!hasTaskState.eventTask && hasTaskState.change === "eventTask") {
      //     console.error("eventTaskを終了しました。");
      //     deactivateWithLayerZoned(activeTask, hasTaskState.change, zoneName);
      //   }
      //   return delegate.hasTask(target, hasTaskState);
      // },

      // onScheduleTask: (delegate, curr, target, task) => {
      //   console.log("2");
      //   if (Zone.current.name === zoneName) {
      //     // console.log("new task is scheduled:", task.type, task.source);
      //   }
      //   return delegate.scheduleTask(target, task);
      // },

      // onInvoke: (delegate, curr, target, callback, applyThis, applyArgs) => {
      //   console.log("3");
      //   // console.log({ ...target });
      //   if (Zone.current.name === zoneName) {
      //     // console.log("the callback will be invoked:", callback);
      //   }

      //   //// 仮 ////
      //   const _callback = function () {
      //     console.log("非同期タスク開始");
      //     console.log([...LayerStack]);
      //     const frame = { test: "test" };
      //     frame.zoneName = zoneName;
      //     frame.taskType = "test";
      //     // LayerStack.push(frame);
      //     callback.apply(this, arguments);
      //     console.log("非同期タスク終了");
      //     console.log([...LayerStack]);
      //   }
      //   //// 仮 ////
      //   console.log(_callback);

      //   return delegate.invoke(target, _callback, applyThis, applyArgs);
      // },
    },
    ...overwriteSettings,
  };

  return zoneSettings;
}


export const generateOnInvokeTaskCallback = (zoneName, activeTask, frame) => {
  return (delegate, curr, target, task, applyThis, applyArgs) => {
    // console.log("4");
    // console.log({ ...task });

    wrapCallbackTask(task, () => {
      activateWithLayerZoned(frame, activeTask, task.type, zoneName);
    }, () => {
      deactivateWithLayerZoned(activeTask, task.type, zoneName);
    });

    // 非同期タスクが実行されるときにトリガーされます
    if (Zone.current.name === zoneName) {
      switch (task.type) {
        // case "microTask":
        //   // activateWithLayerZoned(frame, activeTask, task.type, zoneName);
        //   console.warn("microTask(Promise.then)を開始します");
        //   break;
        case "macroTask":
          activateWithLayerZoned(frame, activeTask, task.type, zoneName);
          console.warn("macroTask(setTimeout.callback)を開始します");
          break;
        case "eventTask":
          activateWithLayerZoned(frame, activeTask, task.type, zoneName);
          console.warn("eventTaskを開始します");
          break;
      }
    }

    return delegate.invokeTask(target, task, applyThis, applyArgs);
  }
}


const wrapCallbackTask = (task, invokeTaskCallback, endTaskCallback) => {
  if (!task.isWrappedCallback) {
    // not wrapped yet
    const _callback = task.callback;

    task.callback = function () {
      invokeTaskCallback();
      _callback.apply(this, arguments);
      endTaskCallback();
    }
    task.isWrappedCallback = true;
  } else {
    // alredy wrapped
    console.log("すでに包まれている");
  }
}


const activateWithLayerZoned = (frame, activeTask, taskType, zoneName) => {
  if (!activeTask[taskType]) {
    frame.zoneName = zoneName;
    frame.taskType = taskType;
    LayerStack.push(frame);
    activeTask[taskType] = true;
    console.log("アクティベート");
    // console.log(zoneName);
    // console.log({ ...activeTask });
    console.log([...LayerStack]);
  }
}

const deactivateWithLayerZoned = (activeTask, taskType, zoneName) => {
  if (activeTask[taskType]) {
    const targetIndex = LayerStack.findIndex(elm => {
      return (elm.zoneName === zoneName && elm.taskType === taskType);
    });
    if (targetIndex !== -1) {
      LayerStack.splice(targetIndex, 1);
      activeTask[taskType] = false;
    }
    console.log("ディアクティベート");
    // console.log(zoneName);
    // console.log({ ...activeTask });
    console.log([...LayerStack]);
  }
}

/**
 * task keyの生成
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


export const copyLayerStack = () => {
  return LayerStack.map(frame => ({ ...frame }));
}


export function replayLayerStack(from) {
  const fromLength = from.length;
  const LayerStackLength = LayerStack.length;
  const maxLengthCommonAncestry = Math.min(fromLength, LayerStackLength);
  let commonAncestryLength = 0;

  while (commonAncestryLength < maxLengthCommonAncestry && frameEquals(from[commonAncestryLength], LayerStack[commonAncestryLength])) {
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
  withLayers && withLayers
    .filter(l => beforePop.includes(l) && !afterPop.includes(l))
    .forEach(l => l._emitDeactivateCallbacks());

  withoutLayers && withoutLayers
    .filter(l => !beforePop.includes(l) && afterPop.includes(l))
    .forEach(l => l._emitActivateCallbacks());
}

export function pushFrame(frame) {
  const { withLayers, withoutLayers } = frame;

  const beforePush = currentLayers();

  LayerStack.push(frame);

  withLayers && withLayers
    .filter(l => !beforePush.includes(l))
    .forEach(l => l._emitActivateCallbacks());

  withoutLayers && withoutLayers
    .filter(l => beforePush.includes(l))
    .forEach(l => l._emitDeactivateCallbacks());
}

export function frameEquals(frame1, frame2) {
  const layerListProperties = ["withLayers", "withoutLayers"];

  // all props are StrictEqual, except withLayers and withoutLayers
  const shallowCompare = (obj1, obj2) =>
    Object.keys(obj1).length === Object.keys(obj2).length &&
    Object.keys(obj1).every(key => {
      if (layerListProperties.includes(key)) {
        return true; // checked later
      }
      return obj2.hasOwnProperty(key) && obj1[key] === obj2[key]
    });

  if (!shallowCompare(frame1, frame2)) { return false; }

  // withLayers and withoutLayers should contain the same layers in order
  return layerListProperties.every(prop => {
    const arr1 = frame1[prop];
    const arr2 = frame2[prop];
    if (arr1 && arr2) { // both have prop set
      if (!Array.isArray(arr1) || !Array.isArray(arr2) || arr1.length !== arr2.length) {
        return false;
      }
      return arr1.every((layer, index) => layer === arr2[index]);
    }

    return !arr1 && !arr2; // both do not define the prop is fine, too
  });
}
