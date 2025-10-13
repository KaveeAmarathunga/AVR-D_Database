// backup-influx-opcua.js
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { InfluxDB } = require("@influxdata/influxdb-client");

// ==== CONFIG ====
const url = "http://localhost:8086";
const token = "E3qedEsZGezLwDOZpj9LsheJekCDj9oxTy9cXbzjVuarZ3FlBTcr3Hv1HdSaKSh9NCDjRNCjXswpC4_S1zeNfA==";
const org = "AV";
const bucket = "Ranna";
const year = 2025;
const startMonth = 7;
const endMonth = new Date().getMonth() + 1;
const backupDir = "C:\\backups\\Oct-09";

if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

const client = new InfluxDB({ url, token });
const queryApi = client.getQueryApi(org);
const nsRegex = /^ns=\d+;i=\d+$/i;

// ==== LOAD NODE DESCRIPTIONS ====
const discoveredVariables = JSON.parse(fs.readFileSync("discoveredVariables.json", "utf8"));
const descriptionMap = {};
discoveredVariables.forEach(d => {
  descriptionMap[d.nodeId] = d.name || "N/A";
});

// ==== TIME ====
function toColomboTime(utcTime) {
  if (!utcTime) return "";
  const date = new Date(utcTime);
  const offsetMs = 5.5 * 60 * 60 * 1000;
  const local = new Date(date.getTime() + offsetMs);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(local.getDate())}/${pad(local.getMonth()+1)}/${local.getFullYear()} ${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}.${String(local.getMilliseconds()).padStart(3,"0")}`;
}

// ==== CSV HELPERS ====
function centerText(text, width) {
  const s = String(text ?? "");
  if (s.length >= width) return s.slice(0, width-3) + "...";
  const left = Math.floor((width - s.length)/2);
  const right = width - s.length - left;
  return " ".repeat(left) + s + " ".repeat(right);
}

// ==== BACKUP DAY ====
async function backupDay(date) {
  const start = `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}T00:00:00Z`;
  const stop  = `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}T23:59:59Z`;
  const csvName = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}.csv`;
  const txtName = csvName.replace(".csv",".txt");
  const csvPath = path.join(backupDir, csvName);
  const txtPath = path.join(backupDir, txtName);

  const query = `
    from(bucket: "${bucket}")
      |> range(start: ${start}, stop: ${stop})
      |> sort(columns: ["_time"])
  `;

  const rows = [];

  try {
    await new Promise((resolve, reject) => {
      queryApi.queryRows(query, {
        next(row, tableMeta) {
          const o = tableMeta.toObject(row);
          const nodeId = o.nodeId || o._measurement || o._field || o.id || "";
          if (!nsRegex.test(nodeId)) return;

          const value = o.value ?? o._value ?? "";
          const description = descriptionMap[nodeId] || "N/A"; // <-- get description from JSON
          const timeRaw = o.timestamp ?? o._time ?? o.time;
          const localTime = toColomboTime(timeRaw);

          rows.push({ time: localTime, nodeId, value, description });
        },
        error(err) { reject(err); },
        complete() { resolve(); }
      });
    });

    const wTime = 25, wNode = 25, wVal = 15, wDesc = 60;
    const header = [
      centerText("time", wTime),
      centerText("nodeId", wNode),
      centerText("value", wVal),
      centerText("description", wDesc)
    ].join(",") + "\n";

    const csvBody = rows.map(r =>
      [
        centerText(r.time, wTime),
        centerText(r.nodeId, wNode),
        centerText(String(r.value), wVal),
        centerText(r.description, wDesc)
      ].join(",")
    ).join("\n");

    fs.writeFileSync(csvPath, header + csvBody, "utf8");

    const headerLine = centerText("time", wTime) + " | " + centerText("nodeId", wNode) + " | " +
      centerText("value", wVal) + " | " + centerText("description", wDesc) + "\n";
    const sepLine = "-".repeat(wTime) + "-+-" + "-".repeat(wNode) + "-+-" +
      "-".repeat(wVal) + "-+-" + "-".repeat(wDesc) + "\n";

    const prettyLines = rows.length
      ? rows.map(r => centerText(r.time, wTime) + " | " + centerText(r.nodeId, wNode) + " | " +
        centerText(String(r.value), wVal) + " | " + centerText(r.description, wDesc)).join("\n")
      : "   <no OPC-UA rows found for this day>\n";

    fs.writeFileSync(txtPath, headerLine + sepLine + prettyLines, "utf8");

    return { csvPath, txtPath, success: true, name: csvName };
  } catch (err) {
    return { csvPath, txtPath, success: false, name: csvName, error: err.message };
  }
}

// ==== BACKUP MONTH ====
async function backupMonth(year, month) {
  const monthName = new Date(year, month - 1).toLocaleString("en", { month: "long" });
  console.log(`\n📦 Starting backup for ${monthName} ${year}...`);
  const zip = new AdmZip();
  const dates = Array.from({length: new Date(year, month, 0).getDate()}, (_, i) => new Date(year, month-1, i+1));

  for (const date of dates) {
    const res = await backupDay(date);
    if (res.success) {
      zip.addLocalFile(res.csvPath);
      zip.addLocalFile(res.txtPath);
      console.log(`  ✅ Added CSV & TXT: ${res.name}`);
    } else {
      console.error(`  ❌ Error for ${res.name}: ${res.error}`);
    }
  }

  const zipPath = path.join(backupDir, `${year}-${monthName}.zip`);
  zip.writeZip(zipPath);
  console.log(`✅ Monthly ZIP backup saved: ${zipPath}`);
}

// ==== MAIN ====
(async () => {
  for (let m = startMonth; m <= endMonth; m++) {
    await backupMonth(year, m);
  }
  console.log("\n🏁 All backups completed successfully!");
})();
