import { Config } from '../src'

async function main() {
  console.log('default config:', JSON.stringify(Config({})))
  console.log('disabled greeting:', JSON.stringify(Config({ sendGreeting: false })))
}
main().catch(e => { console.error('FATAL', e); process.exit(1) })
