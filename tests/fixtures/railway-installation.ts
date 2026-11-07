import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, request } from '@playwright/test';
import { Installation, openConnection } from '@storypane/db/installation';
import { publicWebhookReceiver } from './webhook-receiver';
import { assertDisposableRailway } from './recovery-data';

type Context = {
  createdBy: string;
  sshKeyPath: string;
  knownHostsPath: string;
  projectId: string;
  environmentId: string;
  serviceId: string;
  databaseServiceId: string;
  origin: string;
  admin: { email: string; password: string };
  proxy: { proxy: { id: string; domain: string; proxyPort: number } };
};
type Project = {
  id: string;
  name: string;
  environments: {
    edges: {
      node: {
        id: string;
        serviceInstances: {
          edges: {
            node: {
              serviceId: string;
              serviceName: string;
              numReplicas: number;
              latestDeployment: { id: string; status: string; meta: { commitHash?: string } };
              domains: { serviceDomains: { domain: string }[] };
            };
          }[];
        };
      };
    }[];
  };
};
export function railwayCommand(args: string[], input?: unknown) {
  try {
    return execFileSync(process.env.STORYPANE_RAILWAY_CLI ?? 'railway', args, {
      encoding: 'utf8',
      input: input === undefined ? undefined : JSON.stringify(input),
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
    });
  } catch {
    // CLI failures can include resolved credentials.
    throw new Error(
      `Railway ${args[0]} failed; inspect the selected disposable project in Railway`,
    );
  }
}
export function railwayApi<T>(query: string, variables: unknown = {}): T {
  const result = JSON.parse(
    railwayCommand(['api', query, '--variables', '@-', '--compact'], variables),
  );
  if (result.errors?.length) throw new Error('Railway API rejected the test operation');
  return result.data;
}
export async function railwayInstallation() {
  const path = process.env.STORYPANE_RAILWAY_TEST_CONTEXT;
  assert(path, 'Set STORYPANE_RAILWAY_TEST_CONTEXT to a private disposable-template context');
  const context: Context = JSON.parse(readFileSync(path, 'utf8'));
  const flags = ['-p', context.projectId, '-e', context.environmentId];
  const project = () => JSON.parse(railwayCommand(['status', ...flags, '--json'])) as Project;
  assertDisposableRailway(context, project());
  const environment: Record<string, string> = JSON.parse(
    railwayCommand(['variable', 'list', ...flags, '-s', context.serviceId, '--json']),
  );
  assert.equal(new URL(environment.STORYPANE_APP_URL).origin, context.origin);
  const webhook = await publicWebhookReceiver();
  let installation: Installation | undefined;
  const instance = () =>
    project()
      .environments.edges.find((e) => e.node.id === context.environmentId)!
      .node.serviceInstances.edges.find((e) => e.node.serviceId === context.serviceId)!.node;
  async function ready() {
    await expect
      .poll(
        async () => {
          try {
            return (
              await fetch(context.origin + '/api/ready', { signal: AbortSignal.timeout(10000) })
            ).status;
          } catch {
            return 0;
          }
        },
        { timeout: 180000, intervals: [2000] },
      )
      .toBe(200);
  }
  // The published image runs Node as PID 1; Node 24 names its main thread MainThread.
  const nodeSelection = `const fs=require('node:fs');const name=fs.readFileSync('/proc/1/comm','utf8').trim();if(!['node','MainThread'].includes(name))throw Error('Expected test Node as PID 1');const ids=['1'];`;
  function remote(script: string) {
    const quoted = "'" + script.replaceAll("'", "'\\''") + "'";
    try {
      return execFileSync(
        'ssh',
        [
          '-i',
          context.sshKeyPath,
          '-o',
          'IdentitiesOnly=yes',
          '-o',
          'BatchMode=yes',
          '-o',
          'StrictHostKeyChecking=yes',
          '-o',
          'UserKnownHostsFile=' + context.knownHostsPath,
          new URL(context.origin).hostname + '@ssh.railway.com',
          'node -e ' + quoted,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 },
      );
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'stdout' in error &&
        String(error.stdout).includes('CRASHING_TEST_NODE')
      )
        return 'CRASHING_TEST_NODE';
      throw new Error('Disposable Railway SSH operation failed', { cause: error });
    }
  }
  function boot() {
    return remote(
      nodeSelection +
        `console.log('BOOT:'+ids[0]+':'+fs.readFileSync('/proc/'+ids[0]+'/stat','utf8').split(' ')[21]);`,
    ).trim();
  }
  async function restart() {
    assertDisposableRailway(context, project());
    const previous = boot();
    railwayCommand(['restart', ...flags, '-s', context.serviceId, '--yes', '--json']);
    await expect
      .poll(
        () => {
          try {
            return boot() !== previous;
          } catch {
            return false;
          }
        },
        { timeout: 180000, intervals: [3000] },
      )
      .toBe(true);
    await ready();
  }
  async function deploy() {
    const previousDeployment = instance().latestDeployment.id;
    railwayApi(
      'mutation($environmentId:String!,$serviceId:String!){serviceInstanceRedeploy(environmentId:$environmentId,serviceId:$serviceId)}',
      { environmentId: context.environmentId, serviceId: context.serviceId },
    );
    await expect
      .poll(
        () => {
          const current = instance().latestDeployment;
          return current.id !== previousDeployment && current.status === 'SUCCESS';
        },
        { timeout: 600000, intervals: [10000] },
      )
      .toBe(true);
    await ready();
  }
  try {
    const host = new URL(webhook.destination).hostname;
    railwayApi(
      'mutation($input:VariableCollectionUpsertInput!){variableCollectionUpsert(input:$input)}',
      {
        input: {
          projectId: context.projectId,
          environmentId: context.environmentId,
          serviceId: context.serviceId,
          variables: { WEBHOOK_HOSTS: host },
          skipDeploys: true,
        },
      },
    );
    await deploy();
    assert.equal(instance().numReplicas, 1);
    environment.WEBHOOK_HOSTS = host;
    const operatorURL = new URL(environment.PROVISIONING_DATABASE_URL);
    operatorURL.hostname = context.proxy.proxy.domain;
    operatorURL.port = String(context.proxy.proxy.proxyPort);
    operatorURL.search = '';
    const installationURL = new URL(environment.INSTALLATION_DATABASE_URL);
    installationURL.hostname = operatorURL.hostname;
    installationURL.port = operatorURL.port;
    installationURL.search = '?sslmode=no-verify';
    installation = new Installation({
      connectionString: installationURL.href,
      encryptionKey: environment.INSTALLATION_ENCRYPTION_KEY,
      provider: 'local',
      provisioningURL: operatorURL.href,
      webhookEncryptionKey: environment.WEBHOOK_ENCRYPTION_KEY,
      webhookHosts: [host],
    });
    const client = await request.newContext({
      baseURL: context.origin,
      extraHTTPHeaders: { Origin: context.origin },
      timeout: 60000,
    });
    let spaceId: string;
    try {
      assert.equal(
        (
          await client.post('/api/auth/sign-in/email', {
            data: { email: context.admin.email, password: context.admin.password },
          })
        ).status(),
        200,
      );
      const spaces = await (await client.get('/api/spaces')).json();
      let space = spaces.find((s: { name: string }) => s.name === 'Operational regressions');
      if (!space) {
        const response = await client.post('/api/spaces', {
          data: { name: 'Operational regressions', mode: 'create', environment: 'dev' },
        });
        assert.equal(response.status(), 201);
        space = await response.json();
      }
      spaceId = space.id;
    } finally {
      await client.dispose();
    }
    // Seed only this generated fixture space, never the operator's current installation.
    const secret = (
      await installation.pool.query('SELECT connection_secret FROM space_connections WHERE id=$1', [
        spaceId,
      ])
    ).rows[0].connection_secret;
    const spaceURL = new URL(
      openConnection(secret, environment.INSTALLATION_ENCRYPTION_KEY, spaceId),
    );
    spaceURL.hostname = operatorURL.hostname;
    spaceURL.port = operatorURL.port;
    const { Pool } = await import('pg');
    const db = new Pool({ connectionString: spaceURL.href, ssl: { rejectUnauthorized: false } });
    try {
      const { StorypaneStore } = await import('@storypane/db');
      const user = (await installation.pool.query('SELECT id FROM "user" WHERE installation_admin'))
        .rows[0];
      await new StorypaneStore(db).seed({
        userId: user.id,
        sessionId: 'fixture',
        spaceId,
        role: 'admin',
      });
    } finally {
      await db.end();
    }
    return {
      origin: context.origin,
      spaceId,
      email: context.admin.email,
      password: context.admin.password,
      destination: webhook.destination,
      receiver: webhook.receiver,
      environment,
      operatorURL: operatorURL.href,
      databaseSSL: { rejectUnauthorized: false } as const,
      installation,
      async stop() {
        assertDisposableRailway(context, project());
        const id = instance().latestDeployment.id;
        railwayApi('mutation($id:String!){deploymentStop(id:$id)}', { id });
        await expect
          .poll(
            () =>
              railwayApi<{ deployment: { deploymentStopped: boolean } }>(
                'query($id:String!){deployment(id:$id){deploymentStopped}}',
                { id },
              ).deployment.deploymentStopped,
            { timeout: 120000, intervals: [2000] },
          )
          .toBe(true);
        await expect
          .poll(
            async () => {
              try {
                return (
                  await fetch(context.origin + '/api/ready', {
                    signal: AbortSignal.timeout(5000),
                  })
                ).status;
              } catch {
                return 0;
              }
            },
            { timeout: 120000, intervals: [2000] },
          )
          .not.toBe(200);
      },
      async start() {
        await deploy();
      },
      restart,
      async crash() {
        assertDisposableRailway(context, project());
        const previous = boot();
        const output = remote(
          nodeSelection +
            `
            // PID 1 ignores SIGKILL from its own namespace; exit without application shutdown.
            process.kill(Number(ids[0]),'SIGUSR1');
            (async()=>{
              let target;
              for(let i=0;i<50;i++){
                try{[target]=await(await fetch('http://127.0.0.1:9229/json/list',{signal:AbortSignal.timeout(1000)})).json();if(target)break}catch{}
                await new Promise(r=>setTimeout(r,100));
              }
              if(!target)throw Error('Test inspector did not open');
              const url=new URL(target.webSocketDebuggerUrl);
              if(url.protocol!=='ws:'||url.hostname!=='127.0.0.1'||url.port!=='9229')throw Error('Expected loopback inspector');
              const socket=new WebSocket(url);
              const timer=setTimeout(()=>process.exit(1),10000);
              socket.addEventListener('open',async()=>{
                await new Promise(r=>process.stdout.write('CRASHING_TEST_NODE\\n',r));
                socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'setTimeout(()=>process.exit(137),100);undefined'}}));
              });
              socket.addEventListener('message',event=>{if(JSON.parse(event.data).id===1)socket.close()});
              socket.addEventListener('close',()=>clearTimeout(timer));
              socket.addEventListener('error',()=>process.exit(1));
            })().catch(()=>process.exit(1));
          `,
        );
        assert(
          output.includes('CRASHING_TEST_NODE'),
          'Railway did not confirm the crash operation',
        );
        await expect
          .poll(
            () => {
              try {
                return boot() !== previous;
              } catch {
                return false;
              }
            },
            { timeout: 180000, intervals: [3000] },
          )
          .toBe(true);
        await ready();
      },
      async close() {
        await installation!.pool.end();
        await webhook.close();
      },
      contextPath: resolve(dirname(path), 'context.json'),
    };
  } catch (error) {
    await installation?.pool.end();
    await webhook.close();
    throw error;
  }
}
