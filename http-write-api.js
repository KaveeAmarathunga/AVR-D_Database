const express = require('express');
const { OPCUAClient, AttributeIds, DataType, coerceNodeId } = require('node-opcua');
const bodyParser = require('body-parser');

const app = express();
const port = 7003;

app.use(bodyParser.json());

const dataTypeMap = {
  1: 'Boolean',
  2: 'SByte',
  3: 'Byte',
  4: 'Int16',
  5: 'UInt16',
  6: 'Int32',
  7: 'UInt32',
  8: 'Int64',
  9: 'UInt64',
  10: 'Float',
  11: 'Double',
  12: 'String',
};

const castValue = (value, typeStr) => {
  switch (typeStr) {
    case 'Boolean':
      return value === true || value === 'true';
    case 'Int16':
    case 'Int32':
    case 'Int64':
    case 'SByte':
      return parseInt(value);
    case 'UInt16':
    case 'UInt32':
    case 'UInt64':
    case 'Byte':
      return Math.max(0, parseInt(value));
    case 'Float':
    case 'Double':
      return parseFloat(value);
    case 'String':
      return String(value);
    default:
      throw new Error(`Unsupported dataType: ${typeStr}`);
  }
};

app.post('/write-node', async (req, res) => {
  const { nodeId, value, opcuaEndpoint, dataType } = req.body;

  if (!nodeId || value === undefined || !opcuaEndpoint) {
    return res.status(400).json({ status: 'failure', message: 'Missing required parameters' });
  }

  const client = OPCUAClient.create({ endpointMustExist: false });
  let session;

  try {
    await client.connect(opcuaEndpoint);
    session = await client.createSession();

    const dtResult = await session.read({
      nodeId,
      attributeId: AttributeIds.DataType,
    });

    const rawDataType = dtResult?.value?.value;
    if (rawDataType === null || rawDataType === undefined) {
      throw new Error('Failed to read data type from server (null or undefined).');
    }

    const dataTypeId = rawDataType.value || rawDataType;
    const expectedType = dataTypeMap[dataTypeId] || 'Unknown';

    console.log(`📊 OPC UA DataType nodeId: ${rawDataType.toString()}`);
    console.log(`📋 This node (${nodeId}) expects: ${expectedType}`);

    const finalType = dataType || expectedType;

    if (!DataType[finalType]) {
      throw new Error(`Unsupported OPC UA data type: ${finalType}`);
    }

    const typedValue = castValue(value, finalType);
    const variant = {
      dataType: DataType[finalType],
      value: typedValue,
    };

    const writeResult = await session.writeSingleNode(coerceNodeId(nodeId), variant);
    console.log(`📝 Write status for ${nodeId}: ${writeResult.toString()}`);

    res.json({
      status: writeResult.name === 'Good' ? 'success' : 'failure',
      message: writeResult.toString(),
      nodeId,
      written: value,
      confirmed: writeResult.name === 'Good',
      expectedType,
      usedType: finalType,
    });
  } catch (err) {
    console.error('❌ Error writing node:', err.message);
    res.status(500).json({
      status: 'failure',
      message: `OPC UA write failed: ${err.message}`,
      nodeId,
      written: value,
      confirmed: false,
    });
  } finally {
    if (session) await session.close();
    await client.disconnect();
  }
});

app.listen(7003, () => {
  console.log(`✅ Write API listening at http://localhost:${7003}`);
});
