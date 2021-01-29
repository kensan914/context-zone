class ButtonGroupManager {
    show() {
        // ハンバーガーメニューに格納
    }
}
const landscapeLayer = layer("landscapeLayer");
landscapeLayer.refineClass(ButtonGroupManager, {
    show() {
        // ボタングループを全て表示
    }
});
const buttonGroupManager = new ButtonGroupManager();
withLayers([landscapeLayer], () => {
    buttonGroupManager.show(); // ボタングループを全て表示
});
buttonGroupManager.show(); // ハンバーガーメニューに格納

