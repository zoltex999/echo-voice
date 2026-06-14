const { spawn } = require("child_process");
const path = require("path");

function start() {
  const proc = spawn("node", [path.join(__dirname, "index.js")], { stdio: "inherit" });
  console.log("✅ Bot launched");

  proc.on("exit", (code) => {
    if (code !== 0) {
      setTimeout(start, 3000);
    }
  });
}

start();
