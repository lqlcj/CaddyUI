export default async function teardown() {
  // Stop the directly owned fixture processes before Playwright tears down its shell.
  try {
    await fetch('http://127.0.0.1:12029/test/shutdown', {
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // The server may already have exited after a startup failure.
  }
}
