import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { railwayApi, railwayCommand } from '../tests/fixtures/railway-installation';
import { assertDisposableRailway } from '../tests/fixtures/recovery-data';

type Context = {
  createdBy: string;
  projectId: string;
  environmentId: string;
  serviceId: string;
  databaseServiceId: string;
  origin: string;
  sshKeyPath: string;
  sshKeyId: string;
  knownHostsPath: string;
  admin: { name: string; email: string; password: string };
  proxy: unknown;
};
async function waitFor<T>(read: () => T | undefined, label: string): Promise<T> {
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 10000));
  }
  throw new Error('Timed out waiting for ' + label);
}
mkdirSync('artifacts/operational-runs', { recursive: true, mode: 0o700 });
const contextPath = process.env.STORYPANE_RAILWAY_TEST_CONTEXT;
const directory = contextPath
  ? resolve(contextPath, '..')
  : mkdtempSync(resolve('artifacts/operational-runs/railway-'));
const file = contextPath ?? directory + '/context.json';
let context: Context | undefined;
let projectId: string | undefined;
let sshKeyId: string | undefined;
let exitCode: number;
try {
  if (contextPath) {
    context = JSON.parse(readFileSync(contextPath, 'utf8'));
    assert(context);
    const project = JSON.parse(
      railwayCommand(['status', '-p', context.projectId, '-e', context.environmentId, '--json']),
    );
    assertDisposableRailway(context, project);
    projectId = context.projectId;
    sshKeyId = context.sshKeyId;
  } else {
    const workspaceId = process.env.STORYPANE_RAILWAY_TEST_WORKSPACE_ID;
    assert(workspaceId, 'Set STORYPANE_RAILWAY_TEST_WORKSPACE_ID explicitly');
    assert.match(workspaceId, /^[a-f0-9-]{36}$/);
    const { template } = railwayApi<{
      template: {
        id: string;
        serializedConfig:
          | string
          | {
              services: Record<
                string,
                {
                  name: string;
                  variables: Record<string, { defaultValue?: string }>;
                }
              >;
            };
      };
    }>('query{template(code:"storypane"){id serializedConfig}}');
    const config: Exclude<typeof template.serializedConfig, string> =
      typeof template.serializedConfig === 'string'
        ? JSON.parse(template.serializedConfig)
        : template.serializedConfig;
    const app = Object.values(config.services).find((s) => s.name === 'Storypane');
    assert(app, 'Published template must contain Storypane');
    const admin = {
      name: 'Regression administrator',
      email: 'admin@railway-regression.test',
      password: randomBytes(24).toString('hex'),
    };
    for (const [key, value] of Object.entries({
      STORYPANE_ADMIN_NAME: admin.name,
      STORYPANE_ADMIN_EMAIL: admin.email,
      STORYPANE_ADMIN_PASSWORD: admin.password,
    })) {
      assert(app.variables[key]);
      app.variables[key].defaultValue = value;
    }
    const { templateDeployV2: deployment } = railwayApi<{
      templateDeployV2: { projectId: string };
    }>('mutation($input:TemplateDeployV2Input!){templateDeployV2(input:$input){projectId}}', {
      input: { templateId: template.id, workspaceId, serializedConfig: config },
    });
    projectId = deployment.projectId;
    const name =
      'storypane-regression-' +
      new Date().toISOString().slice(0, 10) +
      '-' +
      randomUUID().slice(0, 8);
    railwayApi(
      'mutation($id:String!,$input:ProjectUpdateInput!){projectUpdate(id:$id,input:$input){id}}',
      { id: projectId, input: { name } },
    );
    writeFileSync(directory + '/project.json', JSON.stringify({ projectId, name, workspaceId }), {
      mode: 0o600,
    });
    console.log('Waiting for fresh Railway template:', projectId);
    const selected = await waitFor(() => {
      const project = JSON.parse(
        railwayCommand(['status', '-p', projectId!, '-e', 'production', '--json']),
      );
      const environment = project.environments.edges[0]?.node;
      const instances = environment?.serviceInstances.edges.map((e: { node: unknown }) => e.node);
      const service = instances?.find(
        (s: { serviceName: string }) => s.serviceName === 'Storypane',
      );
      const database = instances?.find(
        (s: { serviceName: string }) => s.serviceName === 'Postgres',
      );
      if (
        service?.latestDeployment?.status !== 'SUCCESS' ||
        !database ||
        !service.domains.serviceDomains[0]
      )
        return undefined;
      writeFileSync(directory + '/project.json', JSON.stringify(project), { mode: 0o600 });
      return { environment, service, database };
    }, 'template readiness');
    const flags = ['-p', projectId, '-e', selected.environment.id];
    const proxy = JSON.parse(
      railwayCommand([
        'tcp-proxy',
        'create',
        ...flags,
        '-s',
        selected.database.serviceId,
        '--port',
        '5432',
        '--json',
      ]),
    );
    const sshKeyPath = directory + '/ssh-key';
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', sshKeyPath], { stdio: 'ignore' });
    sshKeyId = railwayApi<{ sshPublicKeyCreate: { id: string } }>(
      'mutation($input:SshPublicKeyCreateInput!){sshPublicKeyCreate(input:$input){id}}',
      { input: { name, workspaceId, publicKey: readFileSync(sshKeyPath + '.pub', 'utf8').trim() } },
    ).sshPublicKeyCreate.id;
    const knownHostsPath = directory + '/known_hosts';
    // Pin the host once for this disposable run; later SSH calls require an exact match.
    writeFileSync(
      knownHostsPath,
      execFileSync('ssh-keyscan', ['-T', '10', '-t', 'ed25519', 'ssh.railway.com'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      { mode: 0o600 },
    );
    assert(readFileSync(knownHostsPath, 'utf8').includes('ssh-ed25519'));
    context = {
      createdBy: 'storypane-operational-tests',
      projectId,
      environmentId: selected.environment.id,
      serviceId: selected.service.serviceId,
      databaseServiceId: selected.database.serviceId,
      origin: 'https://' + selected.service.domains.serviceDomains[0].domain,
      admin,
      proxy,
      sshKeyPath,
      sshKeyId,
      knownHostsPath,
    };
    writeFileSync(file, JSON.stringify(context), { mode: 0o600 });
  }
  console.log('Running operational regressions against', context.origin);
  const child = spawn(
    'pnpm',
    ['exec', 'playwright', 'test', '--config', 'playwright.operational.config.ts'],
    {
      env: { ...process.env, STORYPANE_RAILWAY_TEST_CONTEXT: file },
      stdio: 'inherit',
    },
  );
  const [code] = await once(child, 'exit');
  exitCode = code ?? 1;
} finally {
  // Only resources created above or validated as our disposable fixture may be removed.
  try {
    if (sshKeyId)
      assert.equal(
        railwayApi<{ sshPublicKeyDelete: boolean }>(
          'mutation($id:String!){sshPublicKeyDelete(id:$id)}',
          { id: sshKeyId },
        ).sshPublicKeyDelete,
        true,
      );
  } finally {
    if (projectId)
      assert.equal(
        railwayApi<{ projectDelete: boolean }>('mutation($id:String!){projectDelete(id:$id)}', {
          id: projectId,
        }).projectDelete,
        true,
      );
    rmSync(context?.sshKeyPath ?? directory + '/ssh-key', { force: true });
  }
  console.log('Disposable Railway resources removed. Private evidence:', directory);
}
process.exitCode = exitCode;
