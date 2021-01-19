newScope(async () => {
    const data = await request();
    console.log(data);
}, {
    afterEnter() {
        // 非同期タスク開始時
    },
    afterLeave() {
        // 非同期タスク終了時
    }
});


newScope(() => {
    new Promise((resolve) => {
        // リクエスト処理
        resolve(data);
    }).then(val => {
        // 非同期タスク
    });
}, {
    afterEnter() {
        // 非同期タスク開始時
    },
    afterLeave() {
        // 非同期タスク終了時
    }
});



const customPSD = {
    id: 1, // psd作成のたびにインクリメント
    global: false,
    parent: globalPSD,
    env: {
        Promise: DexiePromise,
        // 以下略
    },
    afterEnter() { /* newScopeで渡したafterEnter */ },
    afterLeave() { /* newScopeで渡したafterLeave */ },
    // 以下略
};


newScope(() => {
    request() // Promiseを返す非同期関数
        .then(val => {
            // 非同期タスク
        });
}, {
    afterEnter() {
        // 非同期タスク開始時
    },
    afterLeave() {
        // 非同期タスク終了時
    }
});
