const rfs = require("rotating-file-stream");
const path = require("path");
const fs = require("fs");

// --- Helper: Colombo time ---
function colomboTime() {
  return new Date().toLocaleString("en-GB", { timeZone: "Asia/Colombo" });
}

// --- Ensure logs folder exists ---
const logDir = path.join(__dirname, "logs");
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

// --- Create rotating log stream (max 2MB per file, keep last 5 files) ---
const logStream = rfs.createStream("service.log", {
  size: "2M",          // rotate after 2MB
  maxFiles: 5,         // keep last 5 rotated files
  path: logDir,
  compress: "gzip",    // compress old files
});

// --- Save original console.log ---
const originalConsoleLog = console.log;

// --- Logging function ---
function log(message) {
  const timestamp = colomboTime();
  const fullMessage = `[${timestamp}] ${message}\n`;

  // Write to rotating log stream
  logStream.write(fullMessage);

  // Also print to console without recursion
  originalConsoleLog(fullMessage.trim());
}

// --- Override console.log and console.error safely ---
console.log = log;
console.error = log;

// --- Example usage ---
log("Service started...");

// Example: simulate service running
setInterval(() => {
  log("Service is running...");
}, 5000);



const { spawn, execSync } = require("child_process");


const combinedLogPath = path.join(__dirname, "combined.log");
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB
const TRIM_SIZE = 2 * 1024 * 1024;   // keep last 2 MB

// Write to combined log with real-time size check
function writeLog(text) {
    fs.appendFileSync(combinedLogPath, text);

    try {
        const stats = fs.statSync(combinedLogPath);
        if (stats.size > MAX_LOG_SIZE) {
            const buffer = Buffer.alloc(TRIM_SIZE);
            const fd = fs.openSync(combinedLogPath, "r");
            fs.readSync(fd, buffer, 0, TRIM_SIZE, stats.size - TRIM_SIZE);
            fs.closeSync(fd);
            fs.writeFileSync(combinedLogPath, buffer);
            fs.appendFileSync(combinedLogPath, `\n[LOG] combined.log truncated at ${colomboTime()}\n`);
        }
    } catch {
        // ignore if file doesn't exist
    }
}

// Utility function to start a process and track its output
function run(name, command, args = [], successCheck = null) {
    writeLog(`\n===== Starting ${name} at ${colomboTime()} =====\n`);

    const proc = spawn(command, args, { shell: false });

    proc.stdout.on("data", (data) => {
        const output = data.toString();
        process.stdout.write(`[${name}]  ${output}`);
        writeLog(`[${name}] ${output}`);
        if (successCheck && output.includes(successCheck)) {
            console.log(`[✅ ${name}] is running correctly.`);
            writeLog(`[✅ ${name}] is running correctly.\n`);
        }
    });

    proc.stderr.on("data", (data) => {
        const errorOutput = data.toString();
        process.stderr.write(`[${name} ERROR] ${errorOutput}`);
        writeLog(`[${name} ERROR] ${errorOutput}`);
    });

    proc.on("exit", (code) => {
        console.log(`[${name}] exited with code ${code}`);
        writeLog(`[${name}] exited with code ${code}\n`);
    });

    proc.on("error", (err) => {
        console.error(`[${name} ERROR] Failed to start: ${err.message}`);
        writeLog(`[${name} ERROR] Failed to start: ${err.message}\n`);
    });
}

// Check if InfluxDB is already running
function isInfluxRunning() {
    try {
        const output = execSync('tasklist | findstr influxd.exe').toString();
        return output.includes('influxd.exe');
    } catch {
        return false;
    }
}

// Path to influxd.exe
const influxPath = path.join("C:", "Program Files", "InfluxData", "influxd", "influxd.exe");

// Start InfluxDB if not running
if (!isInfluxRunning()) {
    run("influxDB", influxPath, [], "Welcome to InfluxDB");
} else {
    console.log("[✅ influxDB] Already running. Skipping startup.");
    writeLog(`[✅ influxDB] Already running. Skipping startup.\n`);
}

// Start other services
run("http-api", "node", ["http-api.js"], "Server running on port 8003");
run("http-write-api", "node", ["http-write-api.js"], "Server running on port 7003");
run("subscribe-ns4", "node", ["subscribe-ns4.js"], "✅ Connected to OPC UA server");



// Final status message
setTimeout(() => {
    console.log("\n🚀 All services have been started. Look for ✅ above to confirm each one is running.\n");
    writeLog("\n🚀 All services have been started. Look for ✅ above to confirm each one is running.\n");
}, 5000);
