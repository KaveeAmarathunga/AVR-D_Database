const express = require('express');
const { InfluxDB } = require('@influxdata/influxdb-client');
const opcua = require("node-opcua");



const app = express();
const port = 8003;

const influx = new InfluxDB({
  url: 'http://localhost:8086',
  token: 'E3qedEsZGezLwDOZpj9LsheJekCDj9oxTy9cXbzjVuarZ3FlBTcr3Hv1HdSaKSh9NCDjRNCjXswpC4_S1zeNfA==',
});
const org = 'AV';
const bucket = 'Ranna';

const { dataPoints, nodeIds, combineWordsExample } = require('./dataPoints');
const dataPointMap = new Map(dataPoints.map(dp => [dp.nodeId, dp]));




app.use(express.json());

// Convert UTC to Sri Lanka local time with milliseconds
function formatSriLankaTimestamp(utcTimeStr) {
  const date = new Date(utcTimeStr);
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${local.replace(',', '')}.${ms}`;
}

function formatOutput(row, scale = true) {
  const nodeIdIndex = row.tableMeta.columns.findIndex(col => col.label === 'nodeId');
  const valueIndex = row.tableMeta.columns.findIndex(col => col.label === '_value');
  const timeIndex = row.tableMeta.columns.findIndex(col => col.label === '_time');

  if (nodeIdIndex === -1 || valueIndex === -1 || timeIndex === -1) {
    console.warn('⚠️ Missing required column in row:', row);
    return null;
  }

  const nodeId = row.values[nodeIdIndex];
  const rawValue = parseFloat(row.values[valueIndex]);
  const timestampUTC = row.values[timeIndex];

  const meta = dataPointMap.get(nodeId);
  if (!meta) {
    console.warn(`⚠️ Metadata not found for nodeId: ${nodeId}`);
    return null;
  }

  const factor = meta.factor !== undefined ? meta.factor : 1;
  const scaledValue = rawValue * factor;
  const srilankaTime = formatSriLankaTimestamp(timestampUTC);

  return {
    id: meta.id,
    name: meta.name,
    nodeId: meta.nodeId,
    dataType: meta.dataType,
    unit: meta.unit,
    description: meta.description,
    category: meta.category,
    phase: meta.phase,
    label: meta.label,
    notes: meta.notes,
    timestamp: srilankaTime,
    value: scale ? scaledValue : rawValue
  };
}


// ✅ API 1: Read one node
app.get('/read-one/:nodeId', async (req, res) => {
  const nodeId = req.params.nodeId;
  const scale = req.query.scale !== 'false';
  const queryApi = influx.getQueryApi(org);

  const fluxQuery = `
    from(bucket: "Ranna")
      |> range(start: -5m)
      |> filter(fn: (r) => r["_measurement"] == "solar_data" and r["nodeId"] == "${nodeId}" and r["_field"] == "value")
      |> last()
      |> keep(columns: ["_time", "_value", "nodeId"])
  `;

  try {
    let result = null;
    for await (const row of queryApi.iterateRows(fluxQuery)) {
      const formatted = formatOutput(row, scale);
      if (formatted) result = formatted;
    }

    if (!result) return res.status(404).json({ error: `No data found for nodeId ${nodeId}` });

    res.json(result);
  } catch (err) {
    console.error('Error in /read-one:', err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/read-one-raw/:nodeId', async (req, res) => {
  const nodeId = req.params.nodeId;
  const queryApi = influx.getQueryApi(org);

  const fluxQuery = `
    from(bucket: "Ranna")
      |> range(start: -5m)
      |> filter(fn: (r) => r["_measurement"] == "solar_data" and r["nodeId"] == "${nodeId}" and r["_field"] == "value")
      |> last()
      |> keep(columns: ["_time", "_value", "nodeId"])
  `;

  try {
    let result = null;
    for await (const row of queryApi.iterateRows(fluxQuery)) {
      const formatted = formatOutput(row, false); // <-- false = no scaling
      if (formatted) result = formatted;
    }

    if (!result) return res.status(404).json({ error: `No raw data found for nodeId ${nodeId}` });

    res.json(result);
  } catch (err) {
    console.error('Error in /read-one-raw:', err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Health-check API for InfluxDB
app.get("/db-status", async (req, res) => {
  const queryApi = influx.getQueryApi(org); // make sure queryApi exists
  try {
    const fluxQuery = `buckets() |> limit(n:1)`; // lightweight test query
    await queryApi.collectRows(fluxQuery);
    res.json({ status: "online" });
  } catch (err) {
    console.error("InfluxDB status check failed:", err.message);
    res.json({ status: "failed" });
  }
});



// ✅ API 2: Read all nodes with scaling
app.get('/read-all', async (req, res) => {
  const queryApi = influx.getQueryApi(org);

  const fluxQuery = `
    from(bucket: "Ranna")
      |> range(start: -5m)
      |> filter(fn: (r) => r["_measurement"] == "solar_data" and r["_field"] == "value")
      |> group(columns: ["nodeId"])
      |> last()
      |> keep(columns: ["_time", "_value", "nodeId"])
  `;

  const results = [];

  try {
    for await (const row of queryApi.iterateRows(fluxQuery)) {
      const formatted = formatOutput(row, true);
      if (formatted) results.push(formatted);
    }
    results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (results.length === 0) return res.status(404).json({ error: 'No data found' });
    

    res.json(results);
  } catch (err) {
    console.error('Error in /read-all:', err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ API 3: Read all nodes without scaling
app.get('/read-all-raw', async (req, res) => {
  const queryApi = influx.getQueryApi(org);

  const fluxQuery = `
    from(bucket: "Ranna")
      |> range(start: -5m)
      |> filter(fn: (r) => r["_measurement"] == "solar_data" and r["_field"] == "value")
      |> group(columns: ["nodeId"])
      |> last()
      |> keep(columns: ["_time", "_value", "nodeId"])
  `;

  const results = [];

  try {
    for await (const row of queryApi.iterateRows(fluxQuery)) {
      const formatted = formatOutput(row, false);
      if (formatted) results.push(formatted);
    }
    results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (results.length === 0) return res.status(404).json({ error: 'No raw data found' });

    res.json(results);
  } catch (err) {
    console.error('Error in /read-all-raw:', err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ API 4: Write mock value to node
app.post('/write', async (req, res) => {
  const { nodeId, value } = req.body;

  if (!nodeId || value === undefined) {
    return res.status(400).json({ error: 'Missing nodeId or value in request body' });
  }

  try {
    const session = await connectToOpcUa(); // your function to get OPC UA session
    const dataType = opcua.DataType.Int16;

    const variant = {
      dataType,
      value: parseInt(value)
    };

    const writeResult = await session.write({
      nodeId,
      attributeId: opcua.AttributeIds.Value,
      value: { value: variant }
    });

    console.log('Write result statusCode:', writeResult.toString());

    const readResult = await session.read({ nodeId, attributeId: opcua.AttributeIds.Value });
    const readBackValue = readResult.value.value;
    const confirmed = parseFloat(value) === readBackValue;

    res.json({
      status: 'success',
      nodeId,
      writtenValue: parseFloat(value),
      readBack: readBackValue,
      confirmed
    });

  } catch (err) {
    console.error('Error writing to OPC UA node:', err);
    res.status(500).json({ error: 'Failed to write to OPC UA node', details: err.message });
  }
});

// ✅ API 5: Read node values within a time range
// Helper: convert SL time string to UTC ISO string
function toUtcFromSriLanka(slTime) {
  const date = new Date(slTime);
  return new Date(date.getTime() - 5.5 * 60 * 60 * 1000).toISOString();
}

// Helper: format timestamp to Sri Lanka local time
function formatSriLankaTimestamp(utcTimeStr) {
  const date = new Date(utcTimeStr);
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${local.replace(',', '')}.${ms}`;
}

// ✅ API 5: Read node values within a time range (input: SL time, output: SL time)
app.get('/read-range/:nodeId', async (req, res) => {
  const nodeId = req.params.nodeId;
  const { start, end } = req.query;

  if (!start || !end) return res.status(400).json({ error: 'start and end are required' });

  const meta = dataPointMap.get(nodeId);
  if (!meta) return res.status(404).json({ error: 'Metadata not found for nodeId' });

  const queryApi = influx.getQueryApi(org);
  const startUTC = toUtcFromSriLanka(start);
  const endUTC = toUtcFromSriLanka(end);

  const flux = `
    from(bucket: "${bucket}")
      |> range(start: time(v: "${startUTC}"), stop: time(v: "${endUTC}"))
      |> filter(fn: (r) => r._measurement == "solar_data" and r.nodeId == "${nodeId}" and r._field == "value")
      |> keep(columns: ["_time", "_value", "nodeId"])
  `;

  const output = [{
    id: meta.id,
    name: meta.name,
    nodeId: meta.nodeId,
    unit: meta.unit,
    description: meta.description
  }];

  try {
    const rows = [];
    for await (const row of queryApi.iterateRows(flux)) {
      const rawValue = parseFloat(row.values[row.tableMeta.columns.findIndex(c => c.label === '_value')]);
      const timestamp = formatSriLankaTimestamp(row.values[row.tableMeta.columns.findIndex(c => c.label === '_time')]);
      rows.push({ timestamp, value: rawValue * (meta.factor || 1) });
    }

    if (rows.length === 0) return res.status(404).json({ error: 'No data found' });

    rows.sort((a,b)=> new Date(b.timestamp) - new Date(a.timestamp));
    output.push(...rows);
    res.json(output);

  } catch(err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/read-range-raw/:nodeId', async (req, res) => {
  const nodeId = req.params.nodeId;
  const { start, end } = req.query;

  if (!start || !end) return res.status(400).json({ error: 'start and end are required' });

  const meta = dataPointMap.get(nodeId);
  if (!meta) return res.status(404).json({ error: 'Metadata not found for nodeId' });

  const queryApi = influx.getQueryApi(org);
  const startUTC = toUtcFromSriLanka(start);
  const endUTC = toUtcFromSriLanka(end);

  const flux = `
    from(bucket: "${bucket}")
      |> range(start: time(v: "${startUTC}"), stop: time(v: "${endUTC}"))
      |> filter(fn: (r) => r._measurement == "solar_data" and r.nodeId == "${nodeId}" and r._field == "value")
      |> keep(columns: ["_time", "_value", "nodeId"])
  `;

  const output = [{
    id: meta.id,
    name: meta.name,
    nodeId: meta.nodeId,
    unit: meta.unit,
    description: meta.description
  }];

  try {
    const rows = [];
    for await (const row of queryApi.iterateRows(flux)) {
      const rawValue = parseFloat(row.values[row.tableMeta.columns.findIndex(c => c.label === '_value')]);
      const timestamp = formatSriLankaTimestamp(row.values[row.tableMeta.columns.findIndex(c => c.label === '_time')]);
      rows.push({ timestamp, value: rawValue });
    }

    if (rows.length === 0) return res.status(404).json({ error: 'No data found' });

    rows.sort((a,b)=> new Date(b.timestamp) - new Date(a.timestamp));
    output.push(...rows);
    res.json(output);

  } catch(err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});



app.listen(8003, () => {
  console.log(`🚀 API server running at http://localhost:${8003}`);
});
