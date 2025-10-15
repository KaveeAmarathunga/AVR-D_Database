// backup-influx-opcua.js
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { InfluxDB } = require("@influxdata/influxdb-client");
const yargs = require("yargs");

// ==== CONFIG ====
// InfluxDB connection
const url = "http://localhost:8086";
const token = "E3qedEsZGezLwDOZpj9LsheJekCDj9oxTy9cXbzjVuarZ3FlBTcr3Hv1HdSaKSh9NCDjRNCjXswpC4_S1zeNfA==";
const org = "AV";
const bucket = "Ranna";
const nsRegex = /^ns=\d+;i=\d+$/i;

// ==== COMMAND-LINE ARGUMENTS ====
const argv = yargs
  .option("start", { type: "string", demandOption: true, describe: "Start date (YYYY-MM-DD)" })
  .option("end", { type: "string", demandOption: true, describe: "End date (YYYY-MM-DD)" })
  .option("folder", { type: "string", default: "C:\\backups", describe: "Backup folder" })
  .option("zip", { type: "boolean", default: true, describe: "Create monthly ZIP" })
  .argv;

const backupDir = argv.folder;
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

// ==== LOAD NODE METADATA ====
const discoveredVariables = JSON.parse(fs.readFileSync("discoveredVariables.json", "utf8"));
const metaMap = {};
discoveredVariables.forEach(d => {
  const deviceMatch = d.name ? d.name.split("-").pop().trim() : "N/A";
  metaMap[d.nodeId] = {
    description: d.name || "N/A",
    device: deviceMatch || "N/A"
  };
});

// ==== UTILS ====
function toColomboTime(utcTime) {
  if (!utcTime) return "";
  const date = new Date(utcTime);
  const offsetMs = 5.5 * 60 * 60 * 1000;
  const local = new Date(date.getTime() + offsetMs);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(local.getDate())}/${pad(local.getMonth()+1)}/${pad(local.getFullYear())} ${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}.${String(local.getMilliseconds()).padStart(3,"0")}`;
}

function centerText(text, width) {
  const s = String(text ?? "");
  if (s.length >= width) return s.slice(0, width-3) + "...";
  const left = Math.floor((width - s.length)/2);
  const right = width - s.length - left;
  return " ".repeat(left) + s + " ".repeat(right);
}

// ==== INFLUX CLIENT ====
const client = new InfluxDB({ url, token });
const queryApi = client.getQueryApi(org);

// ==== BACKUP ONE DAY ====
async function backupDay(date) {
  const start = `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}T00:00:00Z`;
  const stop  = `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}T23:59:59Z`;
  const csvName = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}.csv`;
  const txtName = csvName.replace(".csv", ".txt");
  const csvPath = path.join(backupDir, csvName);
  const txtPath = path.join(backupDir, txtName);

  const wTime = 25, wNode = 25, wVal = 15, wDesc = 60, wDev = 20;

  // Prepare CSV/TXT headers
  const headerCsv = [
    centerText("time", wTime),
    centerText("nodeId", wNode),
    centerText("value", wVal),
    centerText("description", wDesc),
    centerText("device", wDev)
  ].join(",") + "\n";

  const headerTxt = centerText("time", wTime) + " | " +
                    centerText("nodeId", wNode) + " | " +
                    centerText("value", wVal) + " | " +
                    centerText("description", wDesc) + " | " +
                    centerText("device", wDev) + "\n";
  const sepTxt = "-".repeat(wTime) + "-+-" + "-".repeat(wNode) + "-+-" +
                 "-".repeat(wVal) + "-+-" + "-".repeat(wDesc) + "-+-" +
                 "-".repeat(wDev) + "\n";

  const csvStream = fs.createWriteStream(csvPath, { flags: "w" });
  const txtStream = fs.createWriteStream(txtPath, { flags: "w" });
  csvStream.write(headerCsv);
  txtStream.write(headerTxt + sepTxt);

  const query = `
    from(bucket: "${bucket}")
      |> range(start: ${start}, stop: ${stop})
      |> sort(columns: ["_time"])
  `;

  let rowsFound = 0;

  await new Promise((resolve, reject) => {
    queryApi.queryRows(query, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        const nodeId = o.nodeId || o._measurement || o._field || o.id || "";
        if (!nsRegex.test(nodeId)) return;

        const value = o.value ?? o._value ?? "";
        const meta = metaMap[nodeId] || {};
        const description = meta.description || "N/A";
        const device = meta.device || "N/A";
        const timeRaw = o.timestamp ?? o._time ?? o.time;
        const localTime = toColomboTime(timeRaw);

        // Write row immediately
        const csvLine = [
          centerText(localTime, wTime),
          centerText(nodeId, wNode),
          centerText(String(value), wVal),
          centerText(description, wDesc),
          centerText(device, wDev)
        ].join(",") + "\n";

        const txtLine = [
          centerText(localTime, wTime),
          centerText(nodeId, wNode),
          centerText(String(value), wVal),
          centerText(description, wDesc),
          centerText(device, wDev)
        ].join(" | ") + "\n";

        csvStream.write(csvLine);
        txtStream.write(txtLine);
        rowsFound++;
      },
      error(err) { reject(err); },
      complete() { resolve(); }
    });
  });

  csvStream.end();
  txtStream.end();

  if (rowsFound === 0) {
    fs.appendFileSync(txtPath, "   <no OPC-UA rows found for this day>\n");
  }

  return { csvPath, txtPath, success: true, name: csvName };
}

// ==== BACKUP RANGE ====
async function backupRange(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const zipMap = {}; // month -> AdmZip

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const res = await backupDay(new Date(d));
    console.log(`  ✅ Backup done: ${res.name}`);

    if (argv.zip) {
      const monthKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      if (!zipMap[monthKey]) zipMap[monthKey] = new AdmZip();
      zipMap[monthKey].addLocalFile(res.csvPath);
      zipMap[monthKey].addLocalFile(res.txtPath);
    }
  }

  // Write ZIPs
  if (argv.zip) {
    for (const monthKey in zipMap) {
      const zipPath = path.join(backupDir, `${monthKey}.zip`);
      zipMap[monthKey].writeZip(zipPath);
      console.log(`✅ Monthly ZIP created: ${zipPath}`);
    }
  }

  console.log("\n🏁 All backups completed successfully!");
}

// ==== MAIN ====
(async () => {
  try {
    await backupRange(argv.start, argv.end);
  } catch (err) {
    console.error("❌ Backup failed:", err);
  }
})();
