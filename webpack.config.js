module.exports = {
  entry: {
    debug: "./experiments/debug/js/main.js",
    microTask: "./experiments/microTask/js/main.js",
    eventTask: "./experiments/eventTask/js/main.js",
  },
  output: {
    path: __dirname + "/experiments/dist",
    filename: "[name].index.js",
  }
};