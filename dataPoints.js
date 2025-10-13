// Helper function for creating kebab-case IDs
const createId = (name) => {
  if (typeof name !== 'string' || !name) {
    return '';
  }
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]+/g, '')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
};

// Define your OPC UA data points
const dataPoints = [
  {
    label: "Voltage Phase A",
    id: createId("Voltage Phase A"),
    name: "Voltage Phase A",
    nodeId: "ns=4;i=1001",
    dataType: "Double",
    uiType: "display",
    unit: "V",
    min: 0,
    max: 500,
    description: "Phase A Voltage",
    category: "three-phase",
    factor: 1,
    precision: 2,
    isWritable: false,
    phase: "a"
  },
  {
    label: "Voltage Phase B",
    id: createId("Voltage Phase B"),
    name: "Voltage Phase B",
    nodeId: "ns=4;i=1002",
    dataType: "Double",
    uiType: "display",
    unit: "V",
    min: 0,
    max: 500,
    description: "Phase B Voltage",
    category: "three-phase",
    factor: 1,
    precision: 2,
    isWritable: false,
    phase: "b"
  },
  {
    label: "Voltage Phase C",
    id: createId("Voltage Phase C"),
    name: "Voltage Phase C",
    nodeId: "ns=4;i=1003",
    dataType: "Double",
    uiType: "display",
    unit: "V",
    min: 0,
    max: 500,
    description: "Phase C Voltage",
    category: "three-phase",
    factor: 1,
    precision: 2,
    isWritable: false,
    phase: "c"
  },
  {
    label: "Active Power",
    id: createId("Active Power"),
    name: "Active Power",
    nodeId: "ns=4;i=1010",
    dataType: "Double",
    uiType: "gauge",
    unit: "kW",
    min: 0,
    max: 2000,
    description: "Total Active Power",
    category: "energy",
    factor: 0.001,
    precision: 2,
    isWritable: false,
  },

  {
    "label": "L1 Phase Voltage",
    "id": "31-l1-phase-voltage-instantaneous",
    "name": "31_L1 Phase voltage (Insta+A1:A225ntaneous) - V x 10",
    "nodeId": "ns=2;i=1004",
    "dataType": "Int32",
    "uiType": "gauge",
    "icon": "Zap",
    "unit": "V",
    "description": "Meter 31: Instantaneous Phase Voltage for L1. Raw value is 10x the actual value.",
    "category": "meter-31-instantaneous",
    "factor": 0.1,
    "precision": 1,
    "isWritable": false,
    "phase": "a",
    "threePhaseGroup": "phase-voltage"
  },
  {
    "label": "L1 Current",
    "id": "31-l1-current-instantaneous",
    "name": "31_L1 Current (Instantaneous) -  mA",
    "nodeId": "ns=2;i=1005",
    "dataType": "Int32",
    "uiType": "gauge",
    "icon": "Activity",
    "unit": "A",
    "description": "Meter 31: Instantaneous Current for L1. Raw value is in milliamperes.",
    "category": "meter-31-instantaneous",
    "factor": 0.001,
    "precision": 3,
    "isWritable": false,
    "phase": "a",
    "threePhaseGroup": "current"
  }, ]
  module.exports = { dataPoints };
