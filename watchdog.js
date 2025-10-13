const nodemailer = require("nodemailer");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const rfs = require("rotating-file-stream");
const chalk = require("chalk");
require("dotenv").config(); // load .env

// === CONFIG ===
const batFile = path.join(__dirname, "server.bat");
const heartbeatFile = path.join(__dirname, "heartbeat.txt");
const checkInterval = 10000; // 10 seconds
const logDir = path.join(__dirname, "logs");
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

const colomboTime = () =>
  new Date().toLocaleString("en-GB", { timeZone: "Asia/Colombo" });

// === Rotating Log Setup ===
const logStream = rfs.createStream("watchdog.log", {
  size: "2M",
  interval: "1d",
  compress: "gzip",
  maxFiles: 5,
  path: logDir,
});

function log(msg, colorFn = (x) => x) {
  const line = `[${colomboTime()}] ${msg}\n`;
  process.stdout.write(colorFn(line));
  logStream.write(line);
}

// === Email Setup (Gmail SSL) ===
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465, // SSL
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Send email safely
function sendAlert(subject, text) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    log("⚠️ Email credentials missing in .env — skipping email alert.", chalk.yellow);
    return;
  }

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_TO || process.env.EMAIL_USER,
    subject,
    text,
  };

  transporter.sendMail(mailOptions, (err, info) => {
    if (err) log(`EMAIL ERROR: ${err.message}`, chalk.red);
    else log(`EMAIL SENT: ${info.response}`, chalk.green);
  });
}

// === Restart Main Service ===
function restartMain() {
  log("Restarting main service via server.bat...", chalk.yellow);
  sendAlert(
    "⚠️ OPC UA System Restarted",
    `Main service was unresponsive. Restarted at ${colomboTime()}.`
  );

  spawn("cmd.exe", ["/c", batFile], { detached: true, stdio: "ignore" }).unref();
  log("Main service restarted.", chalk.green);
}

// === Health Check ===
function checkHealth() {
  try {
    const stats = fs.statSync(heartbeatFile);
    const diff = Date.now() - stats.mtimeMs;

    if (diff > 15000) {
      log("❌ No heartbeat detected — restarting service...", chalk.red);
      restartMain();
    } else {
      log("✅ System healthy.", chalk.green);
    }
  } catch {
    log("⚠️ Heartbeat file missing — restarting service...", chalk.yellow);
    restartMain();
  }
}

// === Main Loop ===
log("🩺 Watchdog started — monitoring OPC UA service health...", chalk.cyan);
checkHealth();
setInterval(checkHealth, checkInterval);
