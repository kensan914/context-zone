import { _global, extend } from "../functions/utils.js";
import { debug } from "./debug.js";
import DexiePromise, {
  patchGlobalPromise,
  ZONE_ECHO_LIMIT,
  NativePromise,
  nativePromiseProto,
  nativePromiseThen,
  resolvedNativePromise
} from "./dexie.js";


export const microTaskScope = (callback, props) => {
  let returnValue;
  try {
    incrementExpectedAwaits();

    newScope(() => {
      returnValue = callback.call();
    }, props);
  } finally {
    if (returnValue && typeof returnValue.then === "function") {
      returnValue.then(() => decrementExpectedAwaits());
    } else {
      decrementExpectedAwaits();
    }
  }
}

export let globalPSD = {
  id: "global",
  global: true,
  ref: 0,
  unhandleds: [],
  onunhandled: globalError,
  pgp: false,
  env: {},
  finalize: function () {
    this.unhandleds.forEach(uh => {
      try {
        globalError(uh[0], uh[1]);
      } catch (e) { }
    });
  }
};

export let PSD = globalPSD;
globalPSD.env = snapShot();


// native awaitのサポートに使用される変数。variables used for native await support
const task = { awaits: 0, echoes: 0, id: 0 }; // ゾーンエコー使用時の進行中のmacro task。
// echoes !== 0: we are in zone-echoing mode!
let taskCounter = 0; // macro taskのIDカウンタ
let zoneStack = []; // 非同期に復元する左ゾーンのスタック。
let zoneEchoes = 0; // zoneEchoesは、native await式間のゾーンを持続させるためには必須です。
export let totalEchoes = 0; // マイクロタスクのIDカウンタ。Promise.prototype.thenでネイティブが待機している可能性を検出するために使用されます。

let zone_id_counter = 0;
export function newScope(fn, props, a1, a2) {
  let parent = PSD;
  let psd = Object.create(parent);

  psd.parent = parent;
  psd.ref = 0;
  psd.global = false;
  psd.id = ++zone_id_counter;

  // Promiseパッチの準備（usePSDで行います）。
  let globalEnv = globalPSD.env;
  psd.env = patchGlobalPromise ? { // patchGlobalPromise = true
    Promise: DexiePromise, // IDB+Promiseが活躍するChromeやEdgeでは、window.Promiseの変更は省略できるかもしれません。
    PromiseProp: { value: DexiePromise, configurable: true, writable: true }, // definePropertyによるPromiseの定義に用いる。
    all: DexiePromise.all,
    race: DexiePromise.race,
    allSettled: DexiePromise.allSettled,
    any: DexiePromise.any,
    resolve: DexiePromise.resolve,
    reject: DexiePromise.reject,
    nthen: getPatchedPromiseThen(globalEnv.nthen, psd), // native then
    gthen: getPatchedPromiseThen(globalEnv.gthen, psd) // global then
  } : {};

  if (props) extend(psd, props); // afterEnter, afterLeave Propsを設定。

  // unhandledsとonunhandledは、ここでは特に設定する必要なし。
  ++parent.ref;
  psd.finalize = function () {
    --this.parent.ref || this.parent.finalize();
  }
  const returnValue = usePSD(psd, fn, a1, a2);

  if (psd.ref === 0) {
    psd.finalize();
  }
  return returnValue;
}

export function usePSD(psd, fn, a1, a2, a3) {
  const outerScope = PSD;
  try {
    switchToZone(psd, true);

    const rtn = fn(a1, a2, a3);
    return rtn;
  } finally {
    switchToZone(outerScope, false);
  }
}

function switchToZone(targetZone, isEnteringZone) {
  let currentZone = PSD;
  if (
    // isEnteringZone ? zoneEchoesを1に : zoneEchoesを0に(既にzoneEchoes===0のとき、終了)
    // isEnteringZone ===> decrementExpectedAwaits()が実行されtask.echoesが0になり終了
    // !isEnteringZone ===> isEnteringZoneのときにzoneEchoesがインクリメントされず0となり終了
    isEnteringZone ?
      task.echoes && (!zoneEchoes++ || targetZone !== PSD) :
      zoneEchoes && (!--zoneEchoes || targetZone !== PSD)
  ) {
    // ゾーンへの入退出も同様に非同期的に行い、現在のティックの間に開始されたタスクが呼び出されたときにゾーンに囲まれるようにします。
    enqueueNativeMicroTask(isEnteringZone ? zoneEnterEcho.bind(null, targetZone) : zoneLeaveEcho);
  } else {
    console.log("zoneSwitch停止");
  }
  if (targetZone === PSD) return;

  function lifeCycleCallback(fn) {
    if (typeof fn !== "function") { return; }
    fn(currentZone, targetZone);
  }
  if (isEnteringZone) {
    lifeCycleCallback(targetZone.beforeEnter);
  } else {
    lifeCycleCallback(currentZone.beforeLeave);
  }

  // console.error({ ...targetZone });
  // if (Object.keys(targetZone).length) return;
  PSD = targetZone; // 実際のゾーン切り替えはこの行で発生します。

  // globalゾーンから離れる際に毎回スナップショットします。
  if (currentZone === globalPSD) globalPSD.env = snapShot();

  if (patchGlobalPromise) {
    // グローバルとネイティブのPromiseにパッチを当ててみましょう(同じかもしれませんし、違うかもしれません)。Let"s patch the global and native Promises (may be same or may be different)
    let GlobalPromise = globalPSD.env.Promise;
    // envを切り替えます（PSDゾーンまたはグローバルゾーンのいずれかである可能性があります)。Switch environments (may be PSD-zone or the global zone. Both apply.)
    let targetEnv = targetZone.env;

    // ネイティブとグローバルのPromise用にPromise.prototype.thenを変更します(ポリフィル環境では異なりますが、両方にアクセスできます。)。
    // パッチ適用されたメソッドのクロージャにtargetZoneが含まれているため、ゾーンの変更ごとに行う必要があります。
    nativePromiseProto.then = targetEnv.nthen;
    GlobalPromise.prototype.then = targetEnv.gthen;

    if (currentZone.global || targetZone.global) {
      // グローバルゾーンからの離脱、またはグローバルゾーンへの進入。グローバルプロミスのパッチ/復元の時間です。

      // このPromiseをwindow.Promiseに設定することで、遷移した非同期関数がFirefox、Safari、IE、そしてZonejsやangularでも動作するようにします。
      Object.defineProperty(_global, "Promise", targetEnv.PromiseProp);

      // Promise.all()などをサポートし、es6-promise をモジュールとして含めている場合にも indexedDB-safe で動作するようにした (global.Promise にアクセスしているのではなく、ローカルで参照している可能性があります)。
      GlobalPromise.all = targetEnv.all;
      GlobalPromise.race = targetEnv.race;
      GlobalPromise.resolve = targetEnv.resolve;
      GlobalPromise.reject = targetEnv.reject;
      GlobalPromise.allSettled = targetEnv.allSettled;
      GlobalPromise.any = targetEnv.any;
    }
  }

  if (isEnteringZone) {
    lifeCycleCallback(targetZone.afterEnter);
  } else {
    lifeCycleCallback(currentZone.afterLeave);
  }
}

function enqueueNativeMicroTask(job) {
  // 前提条件： nativePromiseThen !== undefined
  // thenを実行することでresolvedNativePromiseが解決されたときに実行されるタスク(job)をスケジュールしている。
  nativePromiseThen.call(resolvedNativePromise, job);
}

function zoneEnterEcho(targetZone) {
  console.log("zoneエンター");
  ++totalEchoes;

  if (!task.echoes || --task.echoes === 0) { // task.echoesが0, または1のとき(task.echoesが>0ときtask.echoesをデクリメント)
    task.echoes = task.id = 0; // Cancel zone echoing.
  }

  zoneStack.push(PSD); // zoneを復元するため現在のPSDをzoneStackに格納
  switchToZone(targetZone, true);
}

function zoneLeaveEcho() {
  console.log("zoneリーブ");
  var preZone = zoneStack[zoneStack.length - 1]; // zoneEnterEcho()で格納しておいたzoneを取り出し復元
  zoneStack.pop();

  switchToZone(preZone, false);
}


/**
 * scopeFuncがNativePromiseを返した場合に呼び出す関数。Promise.all() の引数に含まれる各 NativePromise についても同様です。
 */
export function incrementExpectedAwaits() {
  if (!task.id) task.id = ++taskCounter;
  ++task.awaits;
  task.echoes += ZONE_ECHO_LIMIT;
  return task.id;
}

// Function to call when "then" calls back on a native promise where onAwaitExpected() had been called.
// Also call this when a native await calls then method on a promise. In that case, don"t supply
// sourceTaskId because we already know it refers to current task.
export function decrementExpectedAwaits(sourceTaskId) {
  if (!task.awaits || (sourceTaskId && sourceTaskId !== task.id)) return;
  if (--task.awaits === 0) task.id = 0;
  task.echoes = task.awaits * ZONE_ECHO_LIMIT; // Will reset echoes to 0 if awaits is 0.
}


// Call from Promise.all() and Promise.race()
export function onPossibleParallellAsync(possiblePromise) {
  if (task.echoes && possiblePromise && possiblePromise.constructor === NativePromise) {
    incrementExpectedAwaits();
    return possiblePromise.then(x => {
      decrementExpectedAwaits();
      return x;
    }, e => {
      decrementExpectedAwaits();
      return rejection(e);
    });
  }
  return possiblePromise;
}


/**
 * 現在設定されているPromiseのenvを生成しreturn.
 */
export function snapShot() {
  var GlobalPromise = _global.Promise;
  return patchGlobalPromise ? {
    Promise: GlobalPromise,
    PromiseProp: Object.getOwnPropertyDescriptor(_global, "Promise"),
    all: GlobalPromise.all,
    race: GlobalPromise.race,
    allSettled: GlobalPromise.allSettled,
    any: GlobalPromise.any,
    resolve: GlobalPromise.resolve,
    reject: GlobalPromise.reject,
    nthen: nativePromiseProto.then,
    gthen: GlobalPromise.prototype.then,
  } : {};
}

export function nativeAwaitCompatibleWrap(fn, zone, possibleAwait) {
  console.log("nativeAwaitCompatibleWrap");
  return typeof fn !== "function" ? fn : function () {
    var outerZone = PSD;
    console.group("nativeAwaitCompatibleWrapped");
    if (possibleAwait) incrementExpectedAwaits();
    switchToZone(zone, true);
    try {
      return fn.apply(this, arguments);
    } finally {
      switchToZone(outerZone, false);
      console.groupEnd();
    }
  };
}


/**
 * onFulfilled, onRejectedをラップしたthenを作成し, return。
 * onFulfilled, onRejectedを実行している間、zoneが切り替わる。
 * @param {*} origThen
 * @param {*} zone
 */
function getPatchedPromiseThen(origThen, zone) {
  return function (onFulfilled, onRejected) {
    return origThen.call(this,
      nativeAwaitCompatibleWrap(onFulfilled, zone, false),
      nativeAwaitCompatibleWrap(onRejected, zone, false));
  };
}

const UNHANDLEDREJECTION = "unhandledrejection";

function globalError(err, promise) {
  var rv;
  try {
    rv = promise.onuncatched(err);
  } catch (e) { }
  if (rv !== false) try {
    var event, eventData = { promise: promise, reason: err };
    if (_global.document && document.createEvent) {
      event = document.createEvent("Event");
      event.initEvent(UNHANDLEDREJECTION, true, true);
      extend(event, eventData);
    } else if (_global.CustomEvent) {
      event = new CustomEvent(UNHANDLEDREJECTION, { detail: eventData });
      extend(event, eventData);
    }
    if (event && _global.dispatchEvent) {
      dispatchEvent(event);
      if (!_global.PromiseRejectionEvent && _global.onunhandledrejection)
        // No native support for PromiseRejectionEvent but user has set window.onunhandledrejection. Manually call it.
        try { _global.onunhandledrejection(event); } catch (_) { }
    }
    if (debug && event && !event.defaultPrevented) {
      console.warn(`Unhandled rejection: ${err.stack || err}`);
    }
  } catch (e) { }
}

export var rejection = DexiePromise.reject;

// export class Zone {
//   static get current() {
//     return DexiePromise.PSD;
//   }
// }


// export function wrap(fn, errorCatcher) {
//     var psd = PSD;
//     return function () {
//         var wasRootExec = beginMicroTickScope(),
//             outerScope = PSD;

//         try {
//             switchToZone(psd, true);
//             return fn.apply(this, arguments);
//         } catch (e) {
//             errorCatcher && errorCatcher(e);
//         } finally {
//             switchToZone(outerScope, false);
//             if (wasRootExec) endMicroTickScope();
//         }
//     };
// }


// if (("" + nativePromiseThen).indexOf("[native code]") === -1) {
//     // If the native promise" prototype is patched, we cannot rely on zone echoing.
//     // Disable that here:
//     incrementExpectedAwaits = decrementExpectedAwaits = nop;
// }


// let __zone_id__ = 1;
// export function lZone(zone) {
//     if (!zone) {
//         return "!NO ZONE!"
//     }

//     if (!zone.hasOwnProperty("__id__")) {
//         zone.__id__ = __zone_id__++;
//     }
//     return zone.__id__ + (zone.global ? "g" : "");
// }
// export function getFrame() {
//     var o = {}
//     Error.captureStackTrace(o, getFrame)

//     const frames = o.stack.split("\n");
//     const topMostFrame = frames[1]
//         .replace(/^\s*at\s/, "")
//         .replace(/\s\(.*\)/, "");
//     const callerFrame = frames[2] && frames[2].replace(/^\s*at\s/, "").replace(/\(.+\)/, "");
//     const frame = topMostFrame + " at " + callerFrame;

//     return `(${task.id} ${task.awaits} ${task.echoes} ${taskCounter} (${zoneStack.map(lZone).join(",")}) ${zoneEchoes} ${totalEchoes}) ${frame}`;

// }