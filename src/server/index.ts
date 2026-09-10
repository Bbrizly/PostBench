import { startServer } from './app.js'
import { closeContext } from '../platforms/browser.js'

const port = Number(process.env.PORT || 4317)
const { port: bound } = await startServer(port)
console.log(`postbench api listening on http://127.0.0.1:${bound}`)

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, async () => {
    await closeContext()
    process.exit(0)
  })
