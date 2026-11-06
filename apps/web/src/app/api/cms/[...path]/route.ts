import { env, openCache } from '#platform';
import { StorypaneError, definitionSaveSchema, parseInput } from '@storypane/core';
import { emailInvitation } from '@storypane/db/local-auth';
import { handleAssets, copySchemaAsset } from '@storypane/assets';
import { schemaStatus, transferSchema } from '@storypane/db';
import { authenticate, createServices, requestedSpace } from '../../../../lib/context';
import { assertOrigin, errorResponse, jsonResponse, readJson } from '../../../../lib/http';

async function handle(request: Request, route: { params: Promise<{ path: string[] }> }) {
  const services = createServices();
  try {
    const { path } = await route.params;
    const authorization = request.headers.get('authorization');
    const managementToken = authorization?.match(/^Bearer (sm_[\w-]+)$/)?.[1];
    if (authorization && !managementToken && services.installation.options.provider !== 'clerk') {
      throw new StorypaneError('unauthenticated', 'A management bearer token is required');
    }
    if (managementToken) await services.selectSpace(requestedSpace(request));
    const authenticated = managementToken ? null : await authenticate(request, services);
    const actor =
      authenticated?.actor ??
      (await services.store.authenticateManagement(
        managementToken!,
        request.headers.get('x-storypane-space-id') ??
          new URL(request.url).searchParams.get('space') ??
          '',
        path[0],
      ));
    const method = request.method;
    const isWebSocket = request.headers.get('upgrade')?.toLowerCase() === 'websocket';
    if (!managementToken && (!['GET', 'HEAD'].includes(method) || isWebSocket))
      assertOrigin(request, env.APP_URL);
    const [resource, id, child, localeId, action, targetId] = path;
    const store = services.store;
    if (managementToken) {
      await store.assertActor(actor);
      if (path.includes('leases') || path.includes('preview') || path[0] === 'presence') {
        throw new StorypaneError(
          'forbidden',
          'Browser editing sessions are not available to management tokens',
        );
      }
    }
    if (resource === 'page-map' && method === 'GET' && path.length === 1)
      return jsonResponse(
        await store.pageMap(
          actor,
          Object.fromEntries(
            [...new URL(request.url).searchParams].filter(([key]) => key !== 'space'),
          ),
        ),
      );
    if (resource === 'webhooks') {
      if (!id && method === 'GET') return jsonResponse(await store.listWebhooks(actor));
      if (!id && method === 'POST')
        return jsonResponse(await store.saveWebhook(actor, await readJson(request)), 201);
      if (id && !child && method === 'PUT')
        return jsonResponse(await store.saveWebhook(actor, await readJson(request), id));
      if (id && !child && method === 'DELETE') {
        await store.deleteWebhook(actor, id, await readJson(request));
        return jsonResponse({ ok: true });
      }
      if (id && child === 'rotate-secret' && !localeId && method === 'POST')
        return jsonResponse(await store.rotateWebhookSecret(actor, id, await readJson(request)));
      if (id && child === 'test' && !localeId && method === 'POST')
        return jsonResponse(await store.testWebhook(actor, id), 202);
      if (id && child === 'deliveries' && !localeId && method === 'GET')
        return jsonResponse(
          await store.listWebhookDeliveries(
            actor,
            id,
            Number(new URL(request.url).searchParams.get('offset') ?? 0),
          ),
        );
      if (
        id &&
        child === 'deliveries' &&
        localeId &&
        action === 'retry' &&
        !targetId &&
        method === 'POST'
      ) {
        await store.retryWebhook(actor, id, localeId);
        return jsonResponse({ ok: true }, 202);
      }
    }
    if (
      resource === 'migrations' &&
      ['environment', 'transfer-review', 'transfer-apply'].includes(id)
    ) {
      if ((id === 'environment' && method !== 'GET') || (id !== 'environment' && method !== 'POST'))
        throw new StorypaneError('not_found', 'Unknown schema operation');
      const space = await store.getSpace(actor);
      if (!space.productionSpaceId) {
        if (id !== 'environment')
          throw new StorypaneError('invalid', 'This space is not linked to production');
        return jsonResponse(await schemaStatus(store, actor));
      }
      const production = await services.installation.acquire(
        space.productionSpaceId,
        services.clerkChecks,
      );
      try {
        const productionActor = managementToken
          ? await production.store.authenticateManagement(
              request.headers.get('x-storypane-production-token') ?? '',
              space.productionSpaceId,
              'migrations',
            )
          : { ...actor, spaceId: space.productionSpaceId, role: '' };
        if (!managementToken) await services.installation.syncProfile(production.db, actor.userId);
        if (id === 'environment')
          return jsonResponse(await schemaStatus(store, actor, production.store, productionActor));
        const input = (await readJson(request)) as Record<string, unknown>;
        if (id === 'transfer-review' && input.reviewToken)
          throw new StorypaneError('invalid', 'Use transfer-apply to apply a reviewed migration');
        if (id === 'transfer-apply' && !input.reviewToken)
          throw new StorypaneError('invalid', 'Review this transfer before applying');
        return jsonResponse(
          await transferSchema(
            store,
            actor,
            production.store,
            productionActor,
            input,
            (asset, key) => copySchemaAsset(env.MEDIA, asset, key),
          ),
        );
      } finally {
        await production.close();
      }
    }
    if (resource === 'migrations') {
      if (method === 'GET' && !id)
        return jsonResponse(
          await store.listMigrations(
            actor,
            new URL(request.url).searchParams.get('workspace') === 'true',
          ),
        );
      if (method === 'POST' && !id)
        return jsonResponse(await store.pushMigration(actor, await readJson(request)));
      if (method === 'GET' && id && child === 'review')
        return jsonResponse(
          await store.reviewMigration(
            actor,
            id,
            new URL(request.url).searchParams.get('destructive') === 'true',
          ),
        );
      if (method === 'POST' && id && child === 'deploy') {
        const input = (await readJson(request)) as {
          reviewToken?: unknown;
          destructive?: boolean;
          confirmation?: string;
        };
        if (!input || typeof input.reviewToken !== 'string')
          throw new StorypaneError('invalid', 'A reviewed migration token is required');
        return jsonResponse(
          await store.deployMigration(actor, id, input.reviewToken, {
            destructive: input.destructive,
            confirmation: input.confirmation,
          }),
        );
      }
    }
    if (resource === 'management-tokens' && !child) {
      if (method === 'GET' && !id) return jsonResponse(await store.listManagementTokens(actor));
      if (method === 'POST' && !id)
        return jsonResponse(await store.createManagementToken(actor, await readJson(request)), 201);
      if (method === 'DELETE' && id) {
        await store.revokeManagementToken(actor, id);
        return jsonResponse({ ok: true });
      }
    }
    if (resource === 'folders' && !child) {
      if (method === 'GET' && !id) return jsonResponse(await store.listFolders(actor));
      if (method === 'POST' && !id)
        return jsonResponse(await store.saveFolder(actor, await readJson(request)), 201);
      if (method === 'PUT' && id)
        return jsonResponse(await store.saveFolder(actor, await readJson(request), id));
      if (method === 'DELETE' && id) {
        await store.deleteFolder(actor, id);
        return jsonResponse({ ok: true });
      }
    }
    if (resource === 'presence' && !id && method === 'GET')
      return jsonResponse(await store.listPageEditors(actor));
    if (resource === 'roles' && !child) {
      if (method === 'GET' && !id) return jsonResponse(await store.listSpaceRoles(actor));
      if (method === 'POST' && !id) {
        await store.saveSpaceRole(actor, await readJson(request));
        return jsonResponse({ ok: true }, 201);
      }
      if (method === 'PUT' && id) {
        await store.saveSpaceRole(actor, await readJson(request), id);
        return jsonResponse({ ok: true });
      }
      if (method === 'DELETE' && id) {
        await store.deleteSpaceRole(actor, id);
        return jsonResponse({ ok: true });
      }
    }
    if (resource === 'members' && id && !child) {
      if (method === 'PUT') {
        await store.updateSpaceMember(actor, id, await readJson(request));
        return jsonResponse({ ok: true });
      }
      if (method === 'DELETE') {
        await store.removeSpaceMember(actor, id);
        return jsonResponse({ ok: true });
      }
    }
    if (resource === 'invitations' && !child) {
      if (method === 'GET' && !id) return jsonResponse(await store.listSpaceInvitations(actor));
      if (method === 'POST' && !id) {
        const input = await readJson(request);
        const { token } = await store.inviteSpaceMember(actor, input);
        const link = token ? `${env.APP_URL}/?invite=${token}&space=${actor.spaceId}` : env.APP_URL;
        return jsonResponse(
          {
            ok: true,
            link,
            emailSent: await emailInvitation((input as { email: string }).email, link),
          },
          201,
        );
      }
      if (method === 'DELETE' && id) {
        await store.revokeSpaceInvitation(actor, id);
        return jsonResponse({ ok: true });
      }
    }
    if (resource === 'locales') {
      if (method === 'GET' && id && child === 'deletion-review' && !localeId)
        return jsonResponse(await store.reviewSpaceLocaleDeletion(actor, id));
      if (method === 'GET' && !id) return jsonResponse(await store.listSpaceLocales(actor));
      if (method === 'POST' && !id)
        return jsonResponse(await store.createSpaceLocale(actor, await readJson(request)), 201);
      if (method === 'PUT' && id && child === 'default' && !localeId) {
        await store.setDefaultSpaceLocale(actor, id, await readJson(request));
        return jsonResponse({ ok: true });
      }
      if (method === 'PUT' && id && !child)
        return jsonResponse(await store.updateSpaceLocale(actor, id, await readJson(request)));
      if (method === 'DELETE' && id && !child) {
        await store.deleteSpaceLocale(actor, id, request.body ? await readJson(request) : {});
        return jsonResponse({ ok: true });
      }
    }
    if (resource === 'public-media' && !id) {
      if (method === 'GET') return jsonResponse(await store.getPublicMediaSettings(actor));
      if (method === 'PUT')
        return jsonResponse(await store.updatePublicMediaSettings(actor, await readJson(request)));
    }
    if (resource === 'assets' && id && child === 'usage' && !localeId && method === 'GET')
      return jsonResponse(
        await store.listAssetUsage(actor, id, {
          cursor: new URL(request.url).searchParams.get('cursor') ?? 0,
        }),
      );
    if (resource === 'delivery-settings' && !id) {
      if (method === 'GET') return jsonResponse(await store.getDeliverySettings(actor));
      if (method === 'PUT')
        return jsonResponse(await store.updateDeliverySettings(actor, await readJson(request)));
    }
    if (resource === 'delivery-tokens') {
      if (method === 'GET' && !id) return jsonResponse(await store.listDeliveryTokens(actor));
      if (method === 'POST' && !id)
        return jsonResponse(await store.createDeliveryToken(actor, await readJson(request)), 201);
      if (method === 'DELETE' && id) {
        await store.revokeDeliveryToken(actor, id);
        return jsonResponse({ ok: true });
      }
    }
    if (resource === 'space' && !id) {
      if (method === 'GET') return jsonResponse(await store.getSpace(actor));
      if (method === 'PUT')
        return jsonResponse(await store.updateSpace(actor, await readJson(request)));
    }
    if (resource === 'assets') {
      const writes = !['GET', 'HEAD'].includes(method);
      if (writes) {
        await store.assertActor(actor, 'assets:write');
      }
      return await handleAssets(request, path.slice(1), {
        db: services.db,
        actor,
        canWrite: writes,
        bucket: env.MEDIA,
        images: env.IMAGES,
        cache: await openCache('storypane-thumbnails-v1'),
      });
    }
    if (resource === 'definitions') {
      if (method === 'GET' && id === 'reference-counts' && !child)
        return jsonResponse(await store.listDefinitionReferenceCounts(actor));
      if (method === 'DELETE' && id && !child) {
        await store.deleteDefinition(actor, id, await readJson(request));
        return jsonResponse({ ok: true });
      }
      if (method === 'GET' && id && child === 'references' && !localeId)
        return jsonResponse(
          await store.listDefinitionReferences(actor, id, {
            cursor: new URL(request.url).searchParams.get('cursor') ?? 0,
          }),
        );
      if (method === 'GET' && !id)
        return jsonResponse(
          await store.listDefinitions(
            actor,
            new URL(request.url).searchParams.get('deployed') === 'true',
          ),
        );
      if (method === 'POST' && !id) {
        const input = parseInput(definitionSaveSchema, await readJson(request));
        return jsonResponse(
          await store.createDefinition(
            actor,
            input.schema,
            input.baseVersion,
            input.parentDefinitionId,
          ),
          201,
        );
      }
      if (method === 'PUT' && id && child === 'parent' && !localeId)
        return jsonResponse(await store.moveDefinition(actor, id, await readJson(request)));
      if (method === 'POST' && id && child === 'versions') {
        const input = parseInput(definitionSaveSchema, await readJson(request));
        if (input.parentDefinitionId !== undefined)
          throw new StorypaneError('invalid', 'Change the block parent separately from its schema');
        if (!input.expectedVersionId)
          throw new StorypaneError('invalid', 'The starting definition version is required');
        return jsonResponse(
          await store.updateDefinition(
            actor,
            id,
            input.schema,
            input.expectedVersionId,
            input.baseVersion,
          ),
        );
      }
    }
    if (resource === 'datasources') {
      if (method === 'GET' && !id) return jsonResponse(await store.listDatasources(actor));
      if ((method === 'POST' && !id) || (method === 'PUT' && id))
        return jsonResponse(await store.saveDatasource(actor, await readJson(request), id));
    }
    if (resource === 'options' && method === 'POST') {
      const input = await readJson(request);
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new StorypaneError('invalid', 'Invalid options request');
      const { search, ...rest } = input as Record<string, unknown>;
      return jsonResponse(
        await store.resolveOptions(actor, { ...rest, query: search ?? rest.query }),
      );
    }
    async function invalidate(storyId: string, localeIds: string[]) {
      await Promise.all(
        localeIds.map(async (localeId) => {
          try {
            await env.ROOMS.getByName(`${actor.spaceId}:${storyId}:${localeId}`).fetch(
              new Request('https://room/invalidate', {
                method: 'POST',
                headers: {
                  'x-storypane-space-id': actor.spaceId,
                  'x-storypane-story-id': storyId,
                  'x-storypane-locale-id': localeId,
                },
              }),
            );
          } catch {
            console.warn('Room invalidation unavailable; clients will resync');
          }
        }),
      );
    }
    if (resource === 'releases' && !child) {
      if (method === 'GET' && !id) return jsonResponse(await store.listReleases(actor));
      if ((method === 'POST' && !id) || (method === 'PUT' && id)) {
        const release = await store.saveRelease(actor, await readJson(request), id);
        await Promise.all(release.items.map((item) => invalidate(item.storyId, [item.localeId])));
        return jsonResponse(release, id ? 200 : 201);
      }
      if (method === 'DELETE' && id) {
        const release = await store.cancelRelease(actor, id, await readJson(request));
        await Promise.all(release.items.map((item) => invalidate(item.storyId, [item.localeId])));
        return jsonResponse(release);
      }
    }
    if (resource === 'stories') {
      if (id === 'bulk' && method === 'POST') {
        const result = await store.bulkStoryAction(actor, await readJson(request));
        await Promise.all(
          result
            .filter((item) => item.result)
            .map((item) => invalidate(item.result!.story.id, item.result!.localeIds)),
        );
        return jsonResponse(result);
      }
      if (id && child === 'review' && method === 'GET')
        return jsonResponse(await store.reviewStoryAction(actor, id));
      if (
        id &&
        ((child === 'duplicate' && method === 'POST') ||
          (child === 'restore' && method === 'POST') ||
          (!child && method === 'DELETE'))
      ) {
        const input = await readJson(request);
        if (!input || typeof input !== 'object' || Array.isArray(input))
          throw new StorypaneError('invalid', 'Invalid story action');
        const result = await store.storyAction(actor, id, {
          ...input,
          action: child === 'duplicate' ? 'duplicate' : child === 'restore' ? 'restore' : 'delete',
        });
        await invalidate(result.story.id, result.localeIds);
        return jsonResponse(result);
      }

      if (id && child === 'location' && !localeId && method === 'PUT')
        return jsonResponse(await store.updateStoryLocation(actor, id, await readJson(request)));
      if (id && child === 'pin' && !localeId && (method === 'PUT' || method === 'DELETE')) {
        const pinned = method === 'PUT';
        await store.setStoryPinned(actor, id, pinned);
        return jsonResponse({ pinned });
      }
      if (method === 'GET' && !id)
        return jsonResponse(
          await store.listStories(
            actor,
            new URL(request.url).searchParams.get('deleted') === 'true',
          ),
        );
      if (method === 'GET' && id && !child) return jsonResponse(await store.getStory(actor, id));
      if (method === 'POST' && !id)
        return jsonResponse((await store.createStory(actor, await readJson(request))).story, 201);
      if (id && child === 'locales') {
        if (!localeId && method === 'GET') return jsonResponse(await store.listLocales(actor, id));
        if (!localeId && method === 'POST')
          return jsonResponse(
            (await store.createLocale(actor, id, await readJson(request))).locale,
            201,
          );
        if (localeId) {
          if (action === 'schedules') {
            if (method === 'GET' && !targetId)
              return jsonResponse(await store.listSchedules(actor, id, localeId));
            if (method === 'POST' && !targetId) {
              const result = await store.schedulePublication(
                actor,
                id,
                localeId,
                await readJson(request),
              );
              await invalidate(id, [localeId]);
              return jsonResponse(result, 201);
            }
            if (method === 'DELETE' && targetId) {
              const result = await store.cancelSchedule(
                actor,
                id,
                localeId,
                targetId,
                await readJson(request),
              );
              await invalidate(id, [localeId]);
              return jsonResponse(result);
            }
          }

          if (action === 'preview' && method === 'POST')
            return jsonResponse(
              await store.createEditorPreview(actor, id, localeId, await readJson(request)),
              201,
            );
          if (!action && method === 'GET')
            return jsonResponse(await store.getSnapshot(actor, id, localeId));
          const room = env.ROOMS.getByName(`${actor.spaceId}:${id}:${localeId}`);
          const internalHeaders = new Headers({
            'x-storypane-actor': JSON.stringify(actor),
            'x-storypane-story-id': id,
            'x-storypane-locale-id': localeId,
          });
          async function notify(payload: unknown) {
            try {
              const headers = new Headers(internalHeaders);
              headers.set('content-type', 'application/json');
              const result = await room.fetch(
                new Request('https://room/notify', {
                  method: 'POST',
                  headers,
                  body: JSON.stringify(payload),
                }),
              );
              if (!result.ok) console.warn('Room notification failed', { status: result.status });
            } catch (error) {
              console.warn('Room notification unavailable; clients will resync', error);
            }
          }
          if (action === 'commands' && method === 'POST') {
            const result = await store.command(actor, id, localeId, await readJson(request));
            await notify(result);
            return jsonResponse(result);
          }
          if (action === 'leases') {
            const input = await readJson(request);
            if (!input || typeof input !== 'object' || Array.isArray(input))
              throw new StorypaneError('invalid', 'Invalid lease request');
            const { blockId, token } = input as { blockId?: unknown; token?: unknown };
            if (typeof blockId !== 'string' || (method !== 'POST' && typeof token !== 'string'))
              throw new StorypaneError('invalid', 'Missing lease details');
            if (method === 'POST') {
              const lease = await store.acquireLease(actor, id, localeId, blockId);
              await notify({ type: 'leases' });
              return jsonResponse(lease);
            }
            if (method === 'PATCH') {
              const lease = await store.renewLease(actor, id, localeId, blockId, token as string);
              await notify({ type: 'leases' });
              return jsonResponse(lease);
            }
            if (method === 'DELETE') {
              await store.releaseLease(actor, id, localeId, blockId, token as string);
              await notify({ type: 'leases' });
              return jsonResponse({ ok: true });
            }
          }
          if (action === 'checkpoints' && method === 'GET')
            return jsonResponse(
              targetId
                ? await store.getCheckpoint(actor, id, localeId, targetId)
                : await store.listCheckpoints(actor, id, localeId),
            );
          if (action === 'publication-review' && targetId && method === 'GET')
            return jsonResponse(await store.reviewPublication(actor, id, localeId, targetId));
          if (action === 'published' && method === 'GET') {
            const publication = await store.getPublication(actor, id, localeId);
            if (!publication)
              throw new StorypaneError('not_found', 'This locale has not been published.');
            return jsonResponse(publication);
          }
        }
      }
    }
    throw new StorypaneError('not_found', 'Endpoint not found');
  } catch (error) {
    return errorResponse(error);
  } finally {
    await services.close();
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
