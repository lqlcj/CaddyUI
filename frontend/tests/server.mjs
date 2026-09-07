import { createServer } from 'node:http'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const temporary = mkdtempSync(path.join(tmpdir(), 'caddyui-e2e-'))
const caddyData = path.join(temporary, 'caddy')
const binary = path.join(
  temporary,
  process.platform === 'win32' ? 'caddyui.exe' : 'caddyui',
)
execFileSync('go', ['build', '-o', binary, '.'], {
  cwd: root,
  stdio: 'inherit',
})
let reject = false
let stopServer = () => {}
const mock = createServer((request, response) => {
  request.resume()
  if (request.url === '/test/shutdown') {
    response.end('ok')
    stopServer()
    return
  }
  if (request.url === '/test/reject') reject = true
  if (request.url === '/test/accept') reject = false
  if (request.url === '/test/issue-certificate') {
    const directory = path.join(
      caddyData,
      'certificates',
      'test-issuer',
      'app.example.com',
    )
    mkdirSync(directory, { recursive: true })
    // Path discovery also works when certificate metadata cannot be parsed.
    writeFileSync(
      path.join(directory, 'app.example.com.crt'),
      'test certificate',
    )
    writeFileSync(
      path.join(directory, 'app.example.com.key'),
      'test private key',
    )
  }
  response.setHeader('Content-Type', 'application/json')
  if (request.url === '/load' && reject) {
    response.writeHead(400)
    response.end('{"error":"test: configuration rejected"}')
  } else response.end(request.url === '/config/' ? '{"apps":{}}' : '{}')
})
mock.listen(12029, '127.0.0.1', () => {
  const child = spawn(
    binary,
    [
      '-listen',
      '127.0.0.1:18082',
      '-data',
      path.join(temporary, 'data'),
      '-caddy',
      '127.0.0.1:12029',
      '-caddy-data',
      caddyData,
    ],
    { cwd: root, stdio: 'inherit', windowsHide: true },
  )
  function stop() {
    child.kill()
    mock.close()
  }
  stopServer = stop
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  child.on('exit', (code) => {
    mock.close()
    // Only remove the unique test directory allocated under the OS temp root.
    const relative = path.relative(tmpdir(), temporary)
    if (
      !relative.startsWith('..') &&
      !path.isAbsolute(relative) &&
      path.basename(temporary).startsWith('caddyui-e2e-')
    )
      rmSync(temporary, { recursive: true, force: true })
    process.exitCode = code || 0
  })
})
