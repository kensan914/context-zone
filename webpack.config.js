module.exports = {
  entry: {
    debug: "./experiments/debug/js/main.js",
    qiitaClient: "./experiments/qiitaClient/js/main.js",
    eventTask: "./experiments/eventTask/js/main.js",
  },
  output: {
    path: __dirname + "/experiments/dist",
    filename: "[name].index.js",
  }
};