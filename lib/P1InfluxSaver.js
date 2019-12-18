'use strict'

const Influx = require('influx')

const Schema = [
  {
    measurement: 'consumed_electricity',
    tags: [
      'tariff'
    ],
    fields: {
      total_power: Influx.FieldType.FLOAT,
      total: Influx.FieldType.FLOAT,
      total_normal: Influx.FieldType.FLOAT,
      total_low: Influx.FieldType.FLOAT
    }
  },
  {
    measurement: 'delivered_electricity',
    tags: [
      'tariff'
    ],
    fields: {
      total_power: Influx.FieldType.FLOAT,
      total: Influx.FieldType.FLOAT,
      total_normal: Influx.FieldType.FLOAT,
      total_low: Influx.FieldType.FLOAT
    }
  },
  {
    measurement: 'electricity_phase',
    tags: [
      'phase'
    ],
    fields: {
      power: Influx.FieldType.FLOAT,
      current: Influx.FieldType.FLOAT,
      voltage: Influx.FieldType.FLOAT
    },
 
  },
  {
    measurement: 'consumed_gas',
    tags: [],
    fields: {
      total: Influx.FieldType.FLOAT
    },
  }
]

module.exports = P1InfluxSaver

// ===== P1InfluxSaver ============================================================

function P1InfluxSaver (log, configJson, p1client) {
  this.log = log
  this.configJson = configJson
  this.p1 = p1client

  var influxConfig = configJson['influx']
  if (!influxConfig || !influxConfig['host'] || !influxConfig['database']) {
    this.log.error("Influx config is missing")
    return
  }
  var influxOptions = {
    host: influxConfig['host'],
    database: influxConfig['database']
  }
  if (influxConfig['username'] && influxConfig['password']) {
    influxOptions.username = influxConfig['username']
    influxOptions.password = influxConfig['password']
  }
  influxOptions.schema = Schema
  this.influx = new Influx.InfluxDB(influxOptions)
}

P1InfluxSaver.prototype.start = function() {
  this.p1.on('data', (data) => {
    var points = []
    if (data.electricity) {
      var source = data.electricity
      points.push(dataPointForElectricity(source, "consumed_electricity"))
      if (source.l1) {
        points.push(dataPointForPhase(source.l1, "l1"))
      }
      if (source.l2) {
        points.push(dataPointForPhase(source.l2, "l2"))
      }
      if (source.l3) {
        points.push(dataPointForPhase(source.l3, "l3"))
      }
    }
    if(data.electricityBack) {
      var source = data.electricityBack
      points.push(dataPointForElectricity(source, "delivered_electricity"))
    }
    if(data.gas) {
      points.push(dataPointForGas(data.gas, "consumed_gas"))
    }
    this.log.info("Writing points")
    this.log.info(points)
    this.influx.writePoints(points).then((point) => {
      this.log.info("Saved to influx DB")
      this.log.info(point)
    }).catch((error) => {
      this.log.error(error)
    })
  })
}

function dataPointForElectricity(electricity, measurement) {
  var total = electricity.consumption.normal + electricity.consumption.low
  return {
    measurement: measurement,
    fields: {
      total_power: electricity.power || 0,
      total: total || 0,
      total_low: electricity.consumption.low || 0,
      total_normal: electricity.consumption.normal || 0,
    },
    tags: {
      tariff: electricity.tariff || "normal"
    },
    timestamp: new Date(electricity.lastupdated)
  }
}

function dataPointForGas(gas, measurement) {
  return {
    measurement: measurement,
    fields: {
      total: gas.consumption || 0,
    },
    timestamp: new Date(gas.lastupdated)
  }
}

function dataPointForPhase(phase, name) {
  return {
    measurement: "electricity_phase",
    fields: {
      power: phase.power || 0,
      current: phase.current || 0,
      voltage: phase.voltage || 0,
    },
    tags: {
      phase: name
    }
  }
}