const fs = require('fs')
const log = (msg) => { fs.appendFileSync('test-log.txt', msg + '\n') }
log('process.type: ' + process.type)
log('electron: ' + typeof require('electron'))
const e = require('electron')
if (typeof e === 'object' && e.app) {
  log('SUCCESS - app ready')
  e.app.whenReady().then(() => { log('APP READY'); e.app.quit() })
} else {
  log('FAIL: ' + String(e).slice(-30))
  process.exit(1)
}
