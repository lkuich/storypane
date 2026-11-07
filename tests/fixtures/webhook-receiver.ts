import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { devNull } from 'node:os';
import { getDefaultResultOrder, setDefaultResultOrder } from 'node:dns';
import { createServer } from 'node:http';

export async function publicWebhookReceiver() {
  const dnsOrder = getDefaultResultOrder();
  setDefaultResultOrder('ipv4first');
  const receiver = createServer();
  let tunnel: ChildProcess | undefined;
  async function close() {
    if (tunnel?.pid && tunnel.exitCode === null && tunnel.signalCode === null) {
      const exited = once(tunnel, 'exit');
      tunnel.kill('SIGKILL');
      await exited;
    }
    receiver.closeAllConnections();
    if (receiver.listening) await new Promise<void>((resolve) => receiver.close(() => resolve()));
    setDefaultResultOrder(dnsOrder);
  }
  try {
    receiver.listen(0, '127.0.0.1');
    await once(receiver, 'listening');
    const receiverAddress = receiver.address();
    assert(receiverAddress && typeof receiverAddress !== 'string');
    tunnel = spawn(
      'cloudflared',
      [
        'tunnel',
        '--config',
        devNull,
        '--no-autoupdate',
        '--protocol',
        'http2',
        '--url',
        `http://127.0.0.1:${receiverAddress.port}`,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const destination = await new Promise<string>((resolve, reject) => {
      let log = '',
        url = '';
      const timer = setTimeout(
        () => reject(new Error('Public HTTPS test tunnel did not start')),
        60_000,
      );
      tunnel!.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      tunnel!.stderr!.on('data', (chunk) => {
        log = (log + String(chunk)).slice(-8192);
        const match = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match) url = match[0];
        if (url && log.includes('Registered tunnel connection')) {
          clearTimeout(timer);
          resolve(url);
        }
      });
    });
    return { receiver, destination, close };
  } catch (error) {
    await close();
    throw error;
  }
}
