import { createInterface } from 'node:readline/promises';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { getInstallation, migrateInstallation, migrateSpace } from '@storypane/db/installation';
import { linkExternalIdentity } from '@storypane/db/external-identity';
import {
  createLocalAccount,
  recoverLocalAccount,
  migrateLocalCredential,
} from '@storypane/db/local-auth';
import { splitLegacy } from '@storypane/db/split-legacy';

async function hiddenPrompt(label: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('A terminal is required for secret input');
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      process.stdin.off('data', data);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const data = (chunk: Buffer) => {
      for (const char of chunk.toString()) {
        if (char === '\u0003') {
          cleanup();
          reject(new Error('Cancelled'));
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    process.stdin.on('data', data);
  });
}
async function prompt(label: string) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await terminal.question(label);
  } finally {
    terminal.close();
  }
}
async function password() {
  const value = await hiddenPrompt('Password (12–128 characters): ');
  if (value !== (await hiddenPrompt('Confirm password: ')))
    throw new Error('Passwords do not match');
  return value;
}
const installation = getInstallation();
const [command, argument] = process.argv.slice(2);
try {
  await migrateInstallation(installation.pool, installation.options.provider);
  if (command === 'migrate') {
    const failed = await installation.forEachSpace(async (id) => {
      const selected = await installation.acquire(id);
      try {
        await migrateSpace(selected.db);
      } finally {
        await selected.close();
      }
    });
    if (failed.length) throw new Error(`Migrations failed for spaces: ${failed.join(', ')}`);
    console.log('Installation and space migrations applied.');
  } else if (command === 'bootstrap' || command === 'recover') {
    if (installation.options.provider !== 'local')
      throw new Error(
        'Bootstrap and password recovery require local authentication; use your provider controls otherwise',
      );
    const email = await prompt('Email: ');
    const name = command === 'bootstrap' ? await prompt('Name: ') : '';
    const secret = await password();
    const client = await installation.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(723198454)');
      if (command === 'bootstrap') {
        if ((await client.query('SELECT 1 FROM "user" WHERE installation_admin')).rowCount)
          throw new Error('An installation administrator already exists');
        await createLocalAccount(client, { email, name, password: secret }, true);
      } else await recoverLocalAccount(client, email, secret);
      await client.query('COMMIT');
      console.log(
        command === 'bootstrap'
          ? 'Installation administrator created.'
          : 'Password changed and existing sessions revoked.',
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } else if (command === 'create-space' || command === 'attach-space') {
    const owner = await prompt('Installation administrator user ID: ');
    const id = argument ?? randomUUID();
    console.log(`Provisioning operation: ${id}. Reuse this ID to retry.`);
    const name = await prompt('Space name: ');
    const connectionString =
      command === 'attach-space' ? await hiddenPrompt('Database connection URL: ') : undefined;
    console.log(
      await installation.provision(owner, {
        id,
        name,
        mode: command === 'create-space' ? 'create' : 'attach',
        connectionString,
      }),
    );
  } else if (command === 'split-legacy') {
    if (!argument)
      throw new Error(
        'Provide a private JSON manifest: { source, destinations: { spaceId: url }, installationAdminId }',
      );
    const manifest = JSON.parse(await readFile(argument, 'utf8'));
    const source = new Pool({ connectionString: manifest.source, max: 1 });
    try {
      console.log(
        await splitLegacy(
          installation,
          source,
          manifest.destinations,
          manifest.installationAdminId,
        ),
      );
    } finally {
      await source.end();
    }
  } else if (command === 'migrate-local-account') {
    if (!argument) throw new Error('Provide an exact installation user ID');
    const secret = await password();
    const client = await installation.pool.connect();
    try {
      await client.query('BEGIN');
      await migrateLocalCredential(client, argument, secret);
      await client.query('COMMIT');
      console.log(
        'Local credential created for this identity. Clerk mapping retained; sessions revoked.',
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } else if (command === 'link-clerk-account') {
    const clerkId = process.argv[4];
    if (!argument || !clerkId)
      throw new Error(
        'Provide an exact installation user ID and Clerk user ID; set the matching externalId in Clerk',
      );
    const result = await installation.pool.query(
      'UPDATE "user" SET clerk_user_id=$2 WHERE id=$1 AND (clerk_user_id IS NULL OR clerk_user_id=$2)',
      [argument, clerkId],
    );
    if (!result.rowCount)
      throw new Error('Identity not found or already mapped to another Clerk account');
    console.log('Explicit Clerk identity mapping saved.');
  } else if (command === 'link-provider-account') {
    const [provider, subject] = process.argv.slice(4);
    if (!argument || !provider || !subject)
      throw new Error('Provide an installation user ID, provider name and verified subject ID');
    await linkExternalIdentity(installation.pool, provider, subject, argument);
    console.log('Explicit provider identity mapping saved.');
  } else if (command === 'switch-provider') {
    if (!argument) throw new Error('Provide the target provider name during maintenance');
    await installation.switchProvider(argument);
    console.log(
      `Provider changed. Set AUTH_PROVIDER=${argument} before restarting the application.`,
    );
  } else if (command === 'grant-admin') {
    if (!argument) throw new Error('Provide an existing installation user ID');
    const result = await installation.pool.query(
      'UPDATE "user" SET installation_admin=true WHERE id=$1 AND NOT disabled',
      [argument],
    );
    if (!result.rowCount) throw new Error('Account not found');
    console.log('Installation administrator granted.');
  } else
    throw new Error(
      'Use bootstrap, recover, migrate-local-account <userId>, link-clerk-account <userId> <clerkId>, link-provider-account <userId> <provider> <subject>, switch-provider <provider>, grant-admin <userId>, create-space [operationId], attach-space [operationId], migrate, or split-legacy <manifest>',
    );
} catch (error) {
  // Driver errors can include connection secrets; expose only application/operator errors.
  console.error(
    error instanceof Error && !('code' in error)
      ? error.message
      : 'Operation failed. Check configuration and database availability; retained databases were not deleted.',
  );
  process.exitCode = 1;
} finally {
  await installation.pool.end();
}
