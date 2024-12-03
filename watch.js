const chokidar = require("chokidar");
const { exec } = require("child_process");

// 监听 dist 目录（或其他输出目录）
chokidar.watch("./dist").on("all", (event, path) => {
  console.log(`检测到变化: ${path}`);
  exec("yalc push", (error, stdout, stderr) => {
    if (error) {
      console.error(`执行错误: ${error}`);
      return;
    }
    console.log(`已推送更新: ${stdout}`);
  });
});
