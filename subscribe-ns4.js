const opcua = require("node-opcua");
const { InfluxDB, Point } = require("@influxdata/influxdb-client");
const fs = require("fs");
require('dotenv').config();

// 🔧 Concurrency config
const MAX_CONCURRENT = 50;
const BATCH_DELAY_MS = 500;

const client = opcua.OPCUAClient.create({
  endpointMustExist: false,
  connectionStrategy: { initialDelay: 1000, maxRetry: 3 },
  requestTimeout: 30000,
});

const endpointUrl = "opc.tcp://0.0.0.0:4841";
const influx = new InfluxDB({
  url: "http://localhost:8086",
  token: "E3qedEsZGezLwDOZpj9LsheJekCDj9oxTy9cXbzjVuarZ3FlBTcr3Hv1HdSaKSh9NCDjRNCjXswpC4_S1zeNfA==",
});
const writeApi = influx.getWriteApi("AV", "Ranna");
writeApi.useDefaultTags({ location: "Ranna" });

let session = null;
let subscription = null;

// --- Helper: Sri Lanka time ---
function formatSriLankaTime(date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "00";
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}.${milliseconds}`;
}

// --- Helper: get description directly from InfluxDB write ---
function getDescriptionFromInflux(nodeId, fallbackName) {
  // Minimal: Just use the fallbackName as description
  // The backup script will now read the actual description
  return fallbackName || nodeId || "N/A";
}

// --- Browse helper ---
async function browseAll(session, nodeId) {
  let allRefs = [];
  let result = await session.browse(nodeId);
  allRefs = allRefs.concat(result.references);
  while (result.continuationPoint) {
    result = await session.browseNext(result.continuationPoint, false);
    allRefs = allRefs.concat(result.references);
  }
  return allRefs;
}

async function findAllVariableNodes(session, startNodeId) {
  let allVariables = [];
  async function browseRecursively(nodeId) {
    const references = await browseAll(session, nodeId);
    for (const ref of references) {
      const childNodeId = ref.nodeId.toString();
      if (ref.nodeClass === opcua.NodeClass.Variable) {
        allVariables.push({ nodeId: childNodeId, name: ref.browseName.name });
      } else if (ref.nodeClass === opcua.NodeClass.Object || ref.nodeClass === opcua.NodeClass.ObjectType) {
        await browseRecursively(ref.nodeId);
      }
    }
  }
  await browseRecursively(startNodeId);
  return allVariables;
}

// --- Cleanup ---
async function cleanup() {
  console.log("\n🧹 Cleaning up...");
  try {
    await writeApi.flush();
    await writeApi.close();
    if (subscription) await subscription.terminate();
    if (session) await session.close();
    await client.disconnect();
    console.log("✅ All connections closed successfully");
  } catch (err) {
    console.error("⚠️ Error during cleanup:", err);
  }
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("uncaughtException", (err) => {
  console.error("💥 Uncaught Exception:", err);
  cleanup();
});

// --- Main ---
async function main() {
  try {
    console.log("🔌 Connecting to OPC UA server at:", endpointUrl);
    await client.connect(endpointUrl);
    console.log("✅ Connected to OPC UA server");

    session = await client.createSession();
    console.log("✅ Session created");

    subscription = opcua.ClientSubscription.create(session, {
      requestedPublishingInterval: 1000,
      requestedLifetimeCount: 100,
      requestedMaxKeepAliveCount: 10,
      maxNotificationsPerPublish: 50,
      publishingEnabled: true,
      priority: 10,
    });

    console.log("🔍 Searching for all variable nodes...");
    let allVariables = await findAllVariableNodes(session, "RootFolder");

    allVariables = allVariables.filter(v => {
      const match = v.nodeId.match(/ns=(\d+);i=(\d+)/);
      if (!match) return false;
      const ns = parseInt(match[1], 10);
      const idNum = parseInt(match[2], 10);
      return ns === 2 && idNum >= 1000 && idNum <= 8000;
    });

    console.log(`📦 Found ${allVariables.length} variable nodes in ns=2 and i=1000–8000`);

    fs.writeFileSync("discoveredVariables.json", JSON.stringify(allVariables, null, 2));

    setInterval(() => console.log("⏳ Still receiving data..."), 10000);

    const pLimit = require("p-limit").default || require("p-limit");
    const limit = pLimit(MAX_CONCURRENT);

    for (let i = 0; i < allVariables.length; i += MAX_CONCURRENT) {
      const batch = allVariables.slice(i, i + MAX_CONCURRENT);
      console.log(`🚀 Subscribing batch ${i / MAX_CONCURRENT + 1} (${batch.length} items)...`);

      await Promise.all(batch.map((variable, index) => 
        limit(async () => {
          const nodeId = variable.nodeId;
          await new Promise(resolve => setTimeout(resolve, index * 20));
          console.log(`📡 Subscribing to: ${nodeId}`);

          // Initial read
          try {
            const dataValue = await session.read({ nodeId, attributeId: opcua.AttributeIds.Value });
            const rawValue = dataValue.value?.value;
            const systemTime = new Date();
            const slSystemTime = formatSriLankaTime(systemTime);

            if (typeof rawValue === "number" || typeof rawValue === "boolean") {
              const desc = getDescriptionFromInflux(nodeId, variable.name);
              console.log(`📦 Initial Value → ${rawValue} at ${slSystemTime}`);
              console.log(`📄 Description : ${desc}`);

              const point = new Point("solar_data")
                .tag("nodeId", nodeId)
                .tag("description", desc)
                .floatField("value", Number(rawValue))
                .timestamp(systemTime);
              writeApi.writePoint(point);
            }
          } catch (e) {
            console.error(`⚠️ Failed initial read for ${nodeId}:`, e.message);
          }

          // Subscribe to changes
          const monitoredItem = opcua.ClientMonitoredItem.create(
            subscription,
            { nodeId: opcua.resolveNodeId(nodeId), attributeId: opcua.AttributeIds.Value },
            { samplingInterval: 1000, discardOldest: true, queueSize: 10 },
            opcua.TimestampsToReturn.Server
          );

          monitoredItem.on("changed", (dataValue) => {
            const rawValue = dataValue.value?.value;
            const systemTime = new Date();
            const slSystemTime = formatSriLankaTime(systemTime);

            if (!(typeof rawValue === "number" || typeof rawValue === "boolean")) return;
            const desc = getDescriptionFromInflux(nodeId, variable.name);

            console.log(`\n📥 Data Received ---------------------------`);
            console.log(`📛 Node        : ${nodeId}`);
            console.log(`📄 Description : ${desc}`);
            console.log(`📈 Value       : ${rawValue}`);
            console.log(`🖥️  System Time : ${slSystemTime}`);
            console.log(`📤 Writing to InfluxDB...`);

            try {
              const point = new Point("solar_data")
                .tag("nodeId", nodeId)
                .tag("description", desc)
                .floatField("value", Number(rawValue))
                .timestamp(systemTime);
              writeApi.writePoint(point);
            } catch (err) {
              console.error("❌ InfluxDB write error:", err);
            }
          });
        })
      ));

      console.log(`✅ Finished batch ${i / MAX_CONCURRENT + 1}`);
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }

    console.log("🎉 All subscriptions set up!");
  } catch (err) {
    console.error("❌ Fatal error:", err);
    await cleanup();
  }
}

main();
