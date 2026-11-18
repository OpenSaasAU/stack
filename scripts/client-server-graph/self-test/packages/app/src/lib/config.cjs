const { readFileSync } = require('node:fs')

exports.readConfig = () => readFileSync('config.json', 'utf8')
