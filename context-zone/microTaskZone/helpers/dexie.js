import {
  tryCatch,
  props,
  setProp,
  _global,
  getPropertyDescriptor,
  getArrayOf,
} from "../functions/utils.js";
import { nop, callBoth, mirror } from "../functions/chaining-functions.js";
import { debug, prettyStack, getErrorWithStack } from "./debug.js";
import { exceptions } from "../errors/errors.js";
import {
  PSD,
  totalEchoes,
  decrementExpectedAwaits,
  nativeAwaitCompatibleWrap,
  onPossibleParallellAsync,
  newScope,
  usePSD
} from "./psd";


//
// Promise and Zone (PSD) for Dexie library
//
// I started out writing this Promise class by copying promise-light (https://github.com/taylorhakes/promise-light) by
// https://github.com/taylorhakes - an A+ and ECMASCRIPT 6 compliant Promise implementation.
//
// In previous versions this was fixed by not calling setTimeout when knowing that the resolve() or reject() came from another
// tick. In Dexie v1.4.0, I"ve rewritten the Promise class entirely. Just some fragments of promise-light is left. I use
// another strategy now that simplifies everything a lot: to always execute callbacks in a new micro-task, but have an own micro-task
// engine that is indexedDB compliant across all browsers.
// Promise class has also been optimized a lot with inspiration from bluebird - to avoid closures as much as possible.
// Also with inspiration from bluebird, asyncronic stacks in debug mode.
//
// Specific non-standard features of this Promise class:
// * Custom zone support (a.k.a. PSD) with ability to keep zones also when using native promises as well as
//   native async / await.
// * Promise.follow() method built upon the custom zone engine, that allows user to track all promises created from current stack frame
//   and below + all promises that those promises creates or awaits.
// * Detect any unhandled promise in a PSD-scope (PSD.onunhandled).
//
// David Fahlander, https://github.com/dfahlander
//
// Just a pointer that only this module knows about.
// Used in Promise constructor to emulate a private constructor.
var INTERNAL = {};
// Async stacks (long stacks) must not grow infinitely.
export const
  LONG_STACKS_CLIP_LIMIT = 100,
  // When calling error.stack or promise.stack, limit the number of asyncronic stacks to print out.
  MAX_LONG_STACKS = 20,
  ZONE_ECHO_LIMIT = 100,
  [resolvedNativePromise, nativePromiseProto, resolvedGlobalPromise] = typeof Promise === "undefined" ?
    [] :
    (() => {
      let globalP = Promise.resolve();
      // if (typeof crypto === "undefined" || !crypto.subtle)
      //    return [globalP, globalP.__proto__, globalP];
      // Generate a native promise (as window.Promise may have been patched)
      const nativeP = new Function(`const F = async () => {}, p = F();
            return p;`)(); // alternative to crypto.subtle.digest("SHA-512", new Uint8Array([0]));
      return [
        nativeP,
        nativeP.__proto__,
        globalP
      ];
    })();

export const nativePromiseThen = nativePromiseProto && nativePromiseProto.then;
const nt = nativePromiseProto && nativePromiseProto.then;
nativePromiseProto.then = function (onFulfilled, onRejected) {
  return nt.call(this, onFulfilled, onRejected);
};

export const NativePromise = resolvedNativePromise && resolvedNativePromise.constructor;
export const patchGlobalPromise = !!resolvedGlobalPromise;
var stack_being_generated = false;

/* The default function used only for the very first promise in a promise chain.
   As soon as then promise is resolved or rejected, all next tasks will be executed in micro ticks
   emulated in this module. For indexedDB compatibility, this means that every method needs to
   execute at least one promise before doing an indexedDB operation. Dexie will always call
   db.ready().then() for every operation to make sure the indexedDB event is started in an
   indexedDB-compatible emulated micro task loop.
*/
const schedulePhysicalTick = resolvedGlobalPromise ?
  () => { resolvedGlobalPromise.then(physicalTick); }
  :
  _global.setImmediate ?
    // setImmediate supported. Those modern platforms also supports Function.bind().
    setImmediate.bind(null, physicalTick) :
    _global.MutationObserver ?
      // MutationObserver supported
      () => {
        var hiddenDiv = document.createElement("div");
        (new MutationObserver(() => {
          physicalTick();
          hiddenDiv = null;
        })).observe(hiddenDiv, { attributes: true });
        hiddenDiv.setAttribute("i", "1");
      } :
      // No support for setImmediate or MutationObserver. No worry, setTimeout is only called
      // once time. Every tick that follows will be our emulated micro tick.
      // Could have uses setTimeout.bind(null, 0, physicalTick) if it wasnt for that FF13 and below has a bug 
      () => { setTimeout(physicalTick, 0); };

// Promise.schedulerで設定可能。
// 未知のものをexportすると危険なので、exportしないでください。
// コードは、コールバック内でキャッチを試みない限り、コールバックを呼び出します。
// This function can be retrieved through getter of Promise.scheduler though,
// この関数はPromise.schedulerのゲッターから取得できますが、ユーザはPromise.scheduler = myFuncThatThrowsExceptionをしてはいけません。
const asap = function (callback, args) {
  microtickQueue.push([callback, args]);
  if (needsNewPhysicalTick) {
    schedulePhysicalTick();
    needsNewPhysicalTick = false;
  }
};
let isOutsideMicroTick = true,
  needsNewPhysicalTick = true,
  unhandledErrors = [],
  rejectingErrors = [],
  currentFulfiller = null,
  rejectionMapper = mirror; // Remove in next major when removing error mapping of DOMErrors and DOMExceptions

export let microtickQueue = []; // このtickまたは次のphysicalTickを呼び出すためのコールバック。
export let numScheduledCalls = 0; // このphysicalTickに残されたリスナーコールの数。Number of listener-calls left to do in this physical tick.
export let tickFinalizers = []; // Finalizers to call when there are no more async calls scheduled within current physical tick.


export default function DexiePromise(fn) {
  // console.log("デキシープロミス");
  if (typeof this !== "object")
    throw new TypeError("Promises must be constructed via new");
  this._listeners = [];
  this.onuncatched = nop; // 次のメジャーでは非推奨。必要ありません。グローバルエラーハンドラを使った方が良い。

  // ライブラリは、resolve()やreject()を実行するためにプロミスを作成した後に `promise._lib = true;` を設定することができます。
  // A+に準拠するためには、ライブラリが resolve() や reject() を呼び出したときに、スタックにライブラリコードだけが含まれていることを保証できる場合に限り、 `_lib=true` を設定しなければなりません。
  // RULE OF THUMB: グローバルスコープ(イベントハンドラやタイマーなど)から直接resolve/rejectを明示的に行うプロミスに対してのみ、_lib = true を設定してください。
  this._lib = false;
  // Current async scope
  const psd = (this._PSD = PSD);

  // if (debug) {
  //   this._stackHolder = getErrorWithStack();
  //   this._prev = null;
  //   this._numPrev = 0; // Number of previous promises (for long stacks)
  // }
  if (typeof fn !== "function") { // fnが関数でないとき、エラーハンドル
    if (fn !== INTERNAL)
      throw new TypeError("Not a function");
    // Private constructor (INTERNAL, state, value).
    // Used internally by Promise.resolve() and Promise.reject().
    this._state = arguments[1];
    this._value = arguments[2];
    if (this._state === false)
      handleRejection(this, this._value); // Map error, set stack and addPossiblyUnhandledError().
    return;
  }

  this._state = null; // null (=pending), false (=rejected) or true (=resolved)
  this._value = null; // error or result
  ++psd.ref; // 現在のスコープのカウント
  executePromiseTask(this, fn);
}

/**
* 誤った動作をする可能性のあるresolver関数を使用して、onFulfilled と onRejected が一度だけ呼び出されるようにします。
* 非同期性を保証しません。
*/
function executePromiseTask(promise, fn) {
  // Promise Resolution Procedure:
  // https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
  try {
    const resolve = value => {
      if (promise._state !== null)
        return; // Already settled
      if (value === promise)
        throw new TypeError("A promise cannot be resolved with itself.");
      const shouldExecuteTick = promise._lib && beginMicroTickScope();
      if (value && typeof value.then === "function") { // resolve(Promise)
        executePromiseTask(promise, (resolve, reject) => {
          value instanceof DexiePromise ? // valueがDexiePromiseのインスタンスか
            value._then(resolve, reject) :
            value.then(resolve, reject);
        });
      } else {
        promise._state = true;
        promise._value = value;
        propagateAllListeners(promise);
      }
      if (shouldExecuteTick) { // don't called
        endMicroTickScope();
      }
    };
    const reject = handleRejection.bind(null, promise);

    fn(resolve, reject); // If Function.bind is not supported. Exception is handled in catch below
  } catch (ex) {
    handleRejection(promise, ex);
  }
}

function propagateAllListeners(promise) {
  // _listeners内全てのListenerを伝播
  const listeners = promise._listeners;
  promise._listeners = [];
  for (let i = 0, len = listeners.length; i < len; ++i) {
    propagateToListener(promise, listeners[i]);
  }

  const psd = promise._PSD;
  --psd.ref || psd.finalize(); // if psd.ref reaches zero, call psd.finalize();
  if (numScheduledCalls === 0) {
    // numScheduledCallsが0の場合、スタックにスケジューリングされたコールバックにないことを意味し、このrejection or successを聞いているdeferredsがないことを意味します。
    // 私たちのスタックには、このコードが終了した後に新しい呼び出しを生成するようなアプリケーションコードが含まれている可能性があるので、ここでファイナライザを呼び出すことはできません。
    ++numScheduledCalls;
    asap(() => {
      if (--numScheduledCalls === 0)
        finalizePhysicalTick(); // Will detect unhandled errors
    }, []);
  }
}

function propagateToListener(promise, listener) {
  if (promise._state === null) {
    promise._listeners.push(listener);
    return;
  }

  var callback = promise._state ? listener.onFulfilled : listener.onRejected;
  if (callback === null) {
    // This Listener doesnt have a listener for the event being triggered (onFulfilled or onReject) so lets forward the event to any eventual listeners on the Promise instance returned by then() or catch()
    return (promise._state ? listener.resolve : listener.reject)(promise._value);
  }
  ++listener.psd.ref;
  ++numScheduledCalls;
  asap(callListener, [callback, promise, listener]);
}

function callListener(cb, promise, listener) {
  try {
    // スタティック変数 currentFulfiller をフルフィルされているPromiseに設定し、Promiseのチェーンを接続するようにします (ロングスタックのサポートのため)
    currentFulfiller = promise;

    // Call callback and resolve our listener with it"s return value.
    let ret, value = promise._value;

    if (promise._state) {
      // cb is onResolved
      ret = cb(value);
    } else {
      // cb is onRejected
      if (rejectingErrors.length)
        rejectingErrors = [];
      ret = cb(value);
      if (rejectingErrors.indexOf(value) === -1)
        markErrorAsHandled(promise); // Callback didnt do Promise.reject(err) nor reject(err) onto another promise.
    }
    listener.resolve(ret);
  } catch (e) {
    // Exception thrown in callback. Reject our listener.
    listener.reject(e);
  } finally {
    // Restore env and currentFulfiller.
    currentFulfiller = null;
    if (--numScheduledCalls === 0)
      finalizePhysicalTick();
    --listener.psd.ref || listener.psd.finalize();
  }
}

// Promise.prototype.thenに載せるプロパティ記述子を用意します。
const thenProp = {
  // DexiePromise.thenの正体
  get: function () {
    const psd = PSD, microTaskId = totalEchoes;

    function then(onFulfilled, onRejected) {
      const possibleAwait = !psd.global && (psd !== PSD || microTaskId !== totalEchoes);
      if (possibleAwait) {
        // async/await使用時
        decrementExpectedAwaits();
      }
      const rv = new DexiePromise((resolve, reject) => {
        propagateToListener(this, new Listener( // このthisはthenが実行されたときのpromise
          nativeAwaitCompatibleWrap(onFulfilled, psd, possibleAwait),
          nativeAwaitCompatibleWrap(onRejected, psd, possibleAwait),
          resolve,
          reject,
          psd));
      });
      // debug && linkToPreviousPromise(rv, this);
      return rv;
    }

    then.prototype = INTERNAL; // For idempotense, see setter below.
    return then;
  },
  // Be idempotent and allow another framework (such as zone.js or another instance of a Dexie.Promise module) to replace Promise.prototype.then
  // and when that framework wants to restore the original property, we must identify that and restore the original property descriptor.
  set: function (value) {
    setProp(this, "then", value && value.prototype === INTERNAL ?
      thenProp : // Restore to original property descriptor.
      {
        get: function () {
          return value; // Getter returning provided value (behaves like value is just changed)
        },
        set: thenProp.set // Keep a setter that is prepared to restore original.
      }
    );
  }
};

props(DexiePromise.prototype, {
  then: thenProp,
  _then: function (onFulfilled, onRejected) {
    // 結果のプロミスを作成する必要のない then() の少し小さなバージョン。
    propagateToListener(this, new Listener(null, null, onFulfilled, onRejected, PSD));
  },

  catch: function (onRejected) {
    if (arguments.length === 1)
      return this.then(null, onRejected);
    // First argument is the Error type to catch
    var type = arguments[0],
      handler = arguments[1];
    return typeof type === "function" ? this.then(null, err =>
      // Catching errors by its constructor type (similar to java / c++ / c#)
      // Sample: promise.catch(TypeError, function (e) { ... });
      err instanceof type ? handler(err) : PromiseReject(err))
      : this.then(null, err =>
        // Catching errors by the error.name property. Makes sense for indexedDB where error type
        // is always DOMError but where e.name tells the actual error type.
        // Sample: promise.catch("ConstraintError", function (e) { ... });
        err && err.name === type ? handler(err) : PromiseReject(err));
  },

  finally: function (onFinally) {
    return this.then(value => {
      onFinally();
      return value;
    }, err => {
      onFinally();
      return PromiseReject(err);
    });
  },

  stack: {
    get: function () {
      if (this._stack)
        return this._stack;
      try {
        stack_being_generated = true;
        var stacks = getStack(this, [], MAX_LONG_STACKS);
        var stack = stacks.join("\nFrom previous: ");
        if (this._state !== null)
          this._stack = stack; // Stack may be updated on reject.
        return stack;
      } finally {
        stack_being_generated = false;
      }
    }
  },

  timeout: function (ms, msg) {
    return ms < Infinity ?
      new DexiePromise((resolve, reject) => {
        var handle = setTimeout(() => reject(new exceptions.Timeout(msg)), ms);
        this.then(resolve, reject).finally(clearTimeout.bind(null, handle));
      }) : this;
  }
});
if (typeof Symbol !== "undefined" && Symbol.toStringTag) {
  // called
  setProp(DexiePromise.prototype, Symbol.toStringTag, "Dexie.Promise");
}
// Now that Promise.prototype is defined, we have all it takes to set globalPSD.env.
// Environment globals snapshotted on leaving global zone
function Listener(onFulfilled, onRejected, resolve, reject, zone) {
  this.onFulfilled = typeof onFulfilled === "function" ? onFulfilled : null;
  this.onRejected = typeof onRejected === "function" ? onRejected : null;
  this.resolve = resolve;
  this.reject = reject;
  this.psd = zone;
}
// Promise Static Properties
props(DexiePromise, {
  all: function () {
    var values = getArrayOf.apply(null, arguments) // Supports iterables, implicit arguments and array-like.
      .map(onPossibleParallellAsync); // Handle parallell async/awaits
    return new DexiePromise(function (resolve, reject) {
      if (values.length === 0)
        resolve([]);
      var remaining = values.length;
      values.forEach((a, i) => DexiePromise.resolve(a).then(x => {
        values[i] = x;
        if (!--remaining)
          resolve(values);
      }, reject));
    });
  },

  resolve: value => {
    if (value instanceof DexiePromise)
      return value;
    if (value && typeof value.then === "function")
      return new DexiePromise((resolve, reject) => {
        value.then(resolve, reject);
      });
    var rv = new DexiePromise(INTERNAL, true, value);
    linkToPreviousPromise(rv, currentFulfiller);
    return rv;
  },

  reject: PromiseReject,

  race: function () {
    var values = getArrayOf.apply(null, arguments).map(onPossibleParallellAsync);
    return new DexiePromise((resolve, reject) => {
      values.map(value => DexiePromise.resolve(value).then(resolve, reject));
    });
  },

  allSettled() {
    const possiblePromises = getArrayOf.apply(null, arguments).map(onPossibleParallellAsync);
    return new DexiePromise(resolve => {
      if (possiblePromises.length === 0)
        resolve([]);
      let remaining = possiblePromises.length;
      const results = new Array(remaining);
      possiblePromises.forEach((p, i) => DexiePromise.resolve(p).then(
        value => results[i] = { status: "fulfilled", value },
        reason => results[i] = { status: "rejected", reason })
        .then(() => --remaining || resolve(results)));
    });
  },

  any() {
    const possiblePromises = getArrayOf.apply(null, arguments).map(onPossibleParallellAsync);
    return new DexiePromise((resolve, reject) => {
      if (possiblePromises.length === 0)
        reject(new AggregateError([]));
      let remaining = possiblePromises.length;
      const failures = new Array(remaining);
      possiblePromises.forEach((p, i) => DexiePromise.resolve(p).then(
        value => resolve(value),
        failure => {
          failures[i] = failure;
          if (!--remaining)
            reject(new AggregateError(failures));
        }));
    });
  },

  PSD: {
    get: () => PSD,
    set: value => PSD = value
  },

  //totalEchoes: {get: ()=>totalEchoes},
  //task: {get: ()=>task},
  newPSD: newScope,

  usePSD: usePSD,

  scheduler: {
    get: () => asap,
    set: value => { asap = value; }
  },

  rejectionMapper: {
    get: () => rejectionMapper,
    set: value => { rejectionMapper = value; } // Map reject failures
  },

  follow: (fn, zoneProps) => {
    return new DexiePromise((resolve, reject) => {
      return newScope((resolve, reject) => {
        var psd = PSD;
        psd.unhandleds = []; // For unhandled standard- or 3rd party Promises. Checked at psd.finalize()
        psd.onunhandled = reject; // Triggered directly on unhandled promises of this library.
        psd.finalize = callBoth(function () {
          // Unhandled standard or 3rd part promises are put in PSD.unhandleds and
          // examined upon scope completion while unhandled rejections in this Promise
          // will trigger directly through psd.onunhandled
          run_at_end_of_this_or_next_physical_tick(() => {
            this.unhandleds.length === 0 ? resolve() : reject(this.unhandleds[0]);
          });
        }, psd.finalize);
        fn();
      }, zoneProps, resolve, reject);
    });
  }
});

function handleRejection(promise, reason) {
  rejectingErrors.push(reason);
  if (promise._state !== null)
    return;
  var shouldExecuteTick = promise._lib && beginMicroTickScope();
  reason = rejectionMapper(reason);
  promise._state = false;
  promise._value = reason;
  debug && reason !== null && typeof reason === "object" && !reason._promise && tryCatch(() => {
    var origProp = getPropertyDescriptor(reason, "stack");
    reason._promise = promise;
    setProp(reason, "stack", {
      get: () => stack_being_generated ?
        origProp && (origProp.get ?
          origProp.get.apply(reason) :
          origProp.value) :
        promise.stack
    });
  });
  // Add the failure to a list of possibly uncaught errors
  addPossiblyUnhandledError(promise);
  propagateAllListeners(promise);
  if (shouldExecuteTick)
    endMicroTickScope();
}

function getStack(promise, stacks, limit) {
  if (stacks.length === limit)
    return stacks;
  var stack = "";
  if (promise._state === false) {
    var failure = promise._value,
      errorName,
      message;

    if (failure != null) {
      errorName = failure.name || "Error";
      message = failure.message || failure;
      stack = prettyStack(failure, 0);
    } else {
      errorName = failure; // If error is undefined or null, show that.
      message = "";
    }
    stacks.push(errorName + (message ? ": " + message : "") + stack);
  }
  if (debug) {
    stack = prettyStack(promise._stackHolder, 2);
    if (stack && stacks.indexOf(stack) === -1)
      stacks.push(stack);
    if (promise._prev)
      getStack(promise._prev, stacks, limit);
  }
  return stacks;
}

function linkToPreviousPromise(promise, prev) {
  // Support long stacks by linking to previous completed promise.
  var numPrev = prev ? prev._numPrev + 1 : 0;
  if (numPrev < LONG_STACKS_CLIP_LIMIT) { // Prohibit infinite Promise loops to get an infinite long memory consuming "tail".
    promise._prev = prev;
    promise._numPrev = numPrev;
  }
}

/* The callback to schedule with setImmediate() or setTimeout().
   It runs a virtual microtick and executes any callback registered in microtickQueue.
 */
function physicalTick() {
  beginMicroTickScope() && endMicroTickScope();
}

export function beginMicroTickScope() {
  const wasRootExec = isOutsideMicroTick;
  isOutsideMicroTick = false;
  needsNewPhysicalTick = false;
  return wasRootExec;
}
/* Executes micro-ticks without doing try..catch.
   This can be possible because we only use this internally and
   the registered functions are exception-safe (they do try..catch
   internally before calling any external method). If registering
   functions in the microtickQueue that are not exception-safe, this
   would destroy the framework and make it instable. So we don"t export
   our asap method.
*/
export function endMicroTickScope() {
  let callbacks, i, l;
  do {
    // microtickQueueに格納された全てのコールバックを実行。
    while (microtickQueue.length > 0) {
      callbacks = microtickQueue;
      microtickQueue = [];
      l = callbacks.length;
      for (i = 0; i < l; ++i) {
        var item = callbacks[i];
        item[0].apply(null, item[1]);
      }
    }
  } while (microtickQueue.length > 0);
  isOutsideMicroTick = true;
  needsNewPhysicalTick = true;
}

function finalizePhysicalTick() {
  var unhandledErrs = unhandledErrors;
  unhandledErrors = [];
  unhandledErrs.forEach(p => {
    p._PSD.onunhandled.call(null, p._value, p);
  });
  var finalizers = tickFinalizers.slice(0); // Clone first because finalizer may remove itself from list.
  var i = finalizers.length;
  while (i)
    finalizers[--i]();
}

function run_at_end_of_this_or_next_physical_tick(fn) {
  function finalizer() {
    fn();
    tickFinalizers.splice(tickFinalizers.indexOf(finalizer), 1);
  }
  tickFinalizers.push(finalizer);
  ++numScheduledCalls;
  asap(() => {
    if (--numScheduledCalls === 0)
      finalizePhysicalTick();
  }, []);
}

function addPossiblyUnhandledError(promise) {
  // Only add to unhandledErrors if not already there. The first one to add to this list
  // will be upon the first rejection so that the root cause (first promise in the
  // rejection chain) is the one listed.
  if (!unhandledErrors.some(p => p._value === promise._value))
    unhandledErrors.push(promise);
}

function markErrorAsHandled(promise) {
  // Called when a reject handled is actually being called.
  // Search in unhandledErrors for any promise whos _value is this promise_value (list
  // contains only rejected promises, and only one item per error)
  var i = unhandledErrors.length;
  while (i)
    if (unhandledErrors[--i]._value === promise._value) {
      // Found a promise that failed with this same error object pointer,
      // Remove that since there is a listener that actually takes care of it.
      unhandledErrors.splice(i, 1);
      return;
    }
}

function PromiseReject(reason) {
  return new DexiePromise(INTERNAL, false, reason);
}
