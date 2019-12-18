// homebridge-p1/lib/P1Platform.js
// Copyright © 2018-2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for DSMR end-consumer (P1) interface.

'use strict'

const semver = require('semver')

const homebridgeLib = require('homebridge-lib')
const P1AccessoryModule = require('./P1Accessory')
const P1Accessory = P1AccessoryModule.P1Accessory
const P1Client = require('./P1Client')
const P1InfluxSaver = require('./P1InfluxSaver')
const packageJson = require('../package.json')

module.exports = P1Platform

function toIntBetween (value, minValue, maxValue, defaultValue) {
  const n = Number(value)
  if (isNaN(n) || n !== Math.floor(n) || n < minValue || n > maxValue) {
    return defaultValue
  }
  return n
}

function minVersion (range) {
  let s = range.split(' ')[0]
  while (s) {
    if (semver.valid(s)) {
      break
    }
    s = s.substring(1)
  }
  return s || undefined
}

// ===== P1Platform ============================================================

function P1Platform (log, configJson, homebridge) {
  this.log = log
  this.api = homebridge
  this.packageJson = packageJson
  this.configJson = configJson
  const my = new homebridgeLib.MyHomeKitTypes(homebridge)
  const eve = new homebridgeLib.EveHomeKitTypes(homebridge)
  P1AccessoryModule.setHomebridge(homebridge, my, eve)
  this.config = { timeout: 5 }
  for (const key in configJson) {
    const value = configJson[key]
    switch (key.toLowerCase()) {
      case 'dsmr22':
        this.config.dsmr22 = true
        break
      case 'name':
        this.config.name = value
        break
      case 'platform':
        break
      case 'serialport':
        this.config.comName = value
        break
      case 'timeout':
        this.config.timeout = toIntBetween(
          value, 5, 120, this.config.timeout
        )
        break
      default:
        this.log.warn('config.json: warning: %s: ignoring unknown key', key)
        break
    }
  }
  if (this.config.dsmr22 && this.config.timeout < 50) {
    this.config.timeout = 50
  }
  this.identify()
}

P1Platform.prototype.accessories = function (callback) {
  const accessoryList = []
  const npmRegistry = new homebridgeLib.RestClient({
    host: 'registry.npmjs.org',
    name: 'npm registry'
  })
  npmRegistry.get('/' + 'homebridge-p1').then((response) => {
    if (
      response && response['dist-tags'] &&
      response['dist-tags'].latest !== packageJson.version
    ) {
      this.log.warn(
        'warning: lastest version: %s v%s', packageJson.name,
        response['dist-tags'].latest
      )
    }
  }).catch((err) => {
    this.log.error('%s', err)
  }).then(() => {
    this.p1 = new P1Client()
    this.p1.on('error', (error) => { this.log.error('error:', error) })
    this.p1.on('unknownKey', (line) => { this.log.warn('warning: unknown key: %s', line) })
    this.p1.on('ports', (ports) => { this.log.debug('ports: %j', ports) })
    this.p1.once('telegram', (s) => { this.log.debug('telegram:\n/%s', s) })
    this.p1.once('rawdata', (obj) => { this.log.debug('raw data: %j', obj) })
    this.p1.on('data', (data) => {
      try {
        if (this.electricity == null) {
          this.log.debug('data: %j', data)
          this.log('%s v%s', data.type, data.version)
          this.electricity = new P1Accessory(this, 'Electricity', data.electricity)
          accessoryList.push(this.electricity)
          if (
            data.electricityBack != null &&
            data.electricityBack.consumption != null && (
              data.electricityBack.consumption.low > 0 ||
              data.electricityBack.consumption.normal > 0
            )
          ) {
            this.electricityBack = new P1Accessory(
              this, 'Electricity Delivered', data.electricityBack
            )
            accessoryList.push(this.electricityBack)
          }
          if (data.gas != null) {
            this.gas = new P1Accessory(this, 'Gas', data.gas)
            accessoryList.push(this.gas)
          }
          setInterval(() => {
            this.electricity.addEntry()
            if (this.electricityBack != null) {
              this.electricityBack.addEntry()
            }
            if (this.gas != null) {
              this.gas.addEntry()
            }
          }, 10 * 60 * 1000)
          this.connected = true
          if (this.timedout) {
            this.log.error('data received too late - see README')
          } else {
            callback(accessoryList)
          }
        } else {
          this.electricity.check(data.electricity)
          if (this.electricityBack != null) {
            this.electricityBack.check(data.electricityBack)
          }
          if (this.gas != null) {
            this.gas.check(data.gas)
          }
        }
      } catch (error) {
        this.log.error(error)
      }
    })
    if (this.configJson["influx"] && this.influxSaver == null) {
      this.influxSaver = new P1InfluxSaver(this.log, this.configJson, this.p1)
      this.influxSaver.start()
    }
    this.p1.connect(this.config.comName, this.config.dsmr22).then((port) => {
      this.log.debug('listening on %s', port)
      setTimeout(() => {
        if (!this.connected) {
          this.timedout = true
          this.log.error('%s: no valid data received', port)
          callback(accessoryList)
        }
      }, this.config.timeout * 1000)
    }).catch((error) => {
      this.log.error(error.message)
      callback(accessoryList)
    })
  }).catch((error) => {
    this.log.error(error)
    callback(accessoryList) // Not going to help if error was thrown by callback().
  })
}

P1Platform.prototype.identify = function () {
  this.log.info(
    '%s v%s, node %s, homebridge v%s', packageJson.name,
    packageJson.version, process.version, this.api.serverVersion
  )
  if (semver.clean(process.version) !== minVersion(packageJson.engines.node)) {
    this.log.warn(
      'warning: not using recommended node version v%s LTS',
      minVersion(packageJson.engines.node)
    )
  }
  if (this.api.serverVersion !== minVersion(packageJson.engines.homebridge)) {
    this.log.warn(
      'warning: not using recommended homebridge version v%s',
      minVersion(packageJson.engines.homebridge)
    )
  }
  this.log.debug('config.json: %j', this.configJson)
}
