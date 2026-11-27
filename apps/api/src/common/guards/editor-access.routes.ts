/**
 * Every HTTP route the API registers, read from Nest's own metadata
 * (Sprint 13, Module 14).
 *
 * Used by the route-matrix specs (`editor-access.spec.ts`,
 * `editor-access.guard.spec.ts`) and nothing else. It starts at the real
 * `AppModule` and follows `imports` the way Nest does, so a controller only
 * counts when the running app would mount it, and nothing is instantiated:
 * no database, Redis or Temporal is needed to list routes.
 *
 * Each route is read the way `RolesGuard` reads it: `@Roles()` and
 * `@Public()` on the handler win over the class.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Role } from '@postgear/db';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

/** One mounted route. */
export interface RouteInfo {
  /** "PUT /posts/:group/schedule": the key in `editor-access.json`. */
  key: string;
  controller: Type<unknown>;
  /** The handler function itself, for a guard's `getHandler()`. */
  handler: (...args: unknown[]) => unknown;
  handlerName: string;
  /** The effective `@Roles()` list, or null when the route has none. */
  roles: Role[] | null;
  isPublic: boolean;
}

type ModuleRef =
  | Type<unknown>
  | { module: Type<unknown>; imports?: ModuleRef[]; controllers?: Type<unknown>[] }
  | { forwardRef: () => ModuleRef }
  | Promise<unknown>
  | undefined;

/** The controllers of `root` and every module it imports, each once. */
export function collectControllers(root: Type<unknown>): Type<unknown>[] {
  const seenModules = new Set<unknown>();
  const controllers = new Set<Type<unknown>>();

  const visit = (ref: ModuleRef): void => {
    if (!ref || ref instanceof Promise) return; // an async dynamic module (ConfigModule) has no controllers
    if (typeof ref === 'object' && 'forwardRef' in ref) {
      visit(ref.forwardRef());
      return;
    }
    const moduleClass = typeof ref === 'function' ? ref : ref.module;
    const key = typeof ref === 'function' ? ref : ref;
    if (seenModules.has(key)) return;
    seenModules.add(key);

    const declared: Type<unknown>[] =
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, moduleClass) ?? [];
    const imports: ModuleRef[] = Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleClass) ?? [];
    for (const controller of declared) controllers.add(controller);

    if (typeof ref === 'object' && !('forwardRef' in ref) && !(ref instanceof Promise)) {
      for (const controller of ref.controllers ?? []) controllers.add(controller);
      for (const child of ref.imports ?? []) visit(child);
    }
    for (const child of imports) visit(child);
  };

  visit(root);
  return [...controllers];
}

function joinPath(...parts: string[]): string {
  const joined = parts
    .flatMap((part) => part.split('/'))
    .filter((segment) => segment.length > 0)
    .join('/');
  return `/${joined}`;
}

function pathsOf(value: unknown): string[] {
  if (value === undefined) return [''];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

/** Every route of the given controllers, sorted by key. */
export function collectRoutes(controllers: readonly Type<unknown>[]): RouteInfo[] {
  const reflector = new Reflector();
  const routes: RouteInfo[] = [];

  for (const controller of controllers) {
    const prefixes = pathsOf(Reflect.getMetadata(PATH_METADATA, controller));
    const proto = controller.prototype as Record<string, unknown>;

    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const handler = proto[name];
      if (typeof handler !== 'function') continue;
      const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
      const path: unknown = Reflect.getMetadata(PATH_METADATA, handler);
      if (method === undefined || path === undefined) continue;

      const roles =
        reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [handler, controller]) ?? null;
      const isPublic =
        reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [handler, controller]) ===
        true;

      for (const prefix of prefixes) {
        for (const sub of pathsOf(path)) {
          routes.push({
            key: `${RequestMethod[method]} ${joinPath(prefix, sub)}`,
            controller,
            handler: handler as RouteInfo['handler'],
            handlerName: `${controller.name}.${name}`,
            roles: roles && roles.length > 0 ? roles : null,
            isPublic,
          });
        }
      }
    }
  }

  return routes.sort((a, b) => a.key.localeCompare(b.key));
}

/** How a route treats an Editor, as `editor-access.json` records it. */
export type EditorAccess = 'allow' | 'deny' | 'draft-only' | 'open' | 'public';

/** What the decorators alone say about an Editor (`draft-only` reads as `allow` here). */
export function accessFromDecorators(route: RouteInfo): Exclude<EditorAccess, 'draft-only'> {
  if (route.isPublic) return 'public';
  if (route.roles === null) return 'open';
  return route.roles.includes('EDITOR' as Role) ? 'allow' : 'deny';
}

/** One row of `editor-access.json`. */
export interface MatrixEntry {
  access: EditorAccess;
  /** Required for `open` and `public`: why the route is safe without a role list. */
  reason?: string;
}

/** The checked-in table. */
export interface Matrix {
  routes: Record<string, MatrixEntry>;
}

export function loadMatrix(): Matrix {
  return JSON.parse(readFileSync(join(__dirname, 'editor-access.json'), 'utf8')) as Matrix;
}

/**
 * Every route of the real `AppModule`. Required, not imported, so a spec can
 * mock `config/env` first (`ConfigModule.forRoot()` validates the environment
 * the moment `AppModule` is loaded, and listing routes needs none).
 */
export function loadAppRoutes(): RouteInfo[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppModule } = require('../../app.module') as { AppModule: Type<unknown> };
  return collectRoutes(collectControllers(AppModule));
}
