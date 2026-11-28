import { resolve } from 'node:path';

import type { Logger, Plugin, ViteDevServer } from 'vite';

import { build, formatDiagnostics, unreported } from './build.ts';
import type { BuildOptions, BuildResult } from './build.ts';

export interface ParlaViteOptions extends Pick<BuildOptions, 'config'> {
  /** Folder holding the config. Defaults to Vite's root. */
  root?: string;
}

/** Runs `parla build` on start and on every catalog change. */
export function parla(options: ParlaViteOptions = {}): Plugin {
  let root = process.cwd();
  let watchFiles = new Set<string>();
  let isBuild = false;
  let logger: Logger | undefined;
  // One plugin serves every environment and rebuild: each would repeat the same warnings.
  const fresh = unreported();

  const run = async (): Promise<BuildResult> => {
    const result = await build({ cwd: root, config: options.config });
    watchFiles = new Set(result.config.watchFiles.map((f) => resolve(f)));
    for (const { level, line } of formatDiagnostics(
      fresh(result.diagnostics),
      result.config.root,
    )) {
      logger?.[level === 'error' ? 'error' : 'warn'](`[parla] ${line}`);
    }
    return result;
  };

  return {
    name: 'parla',
    enforce: 'pre',
    configResolved(config) {
      root = options.root ? resolve(config.root, options.root) : config.root;
      isBuild = config.command === 'build';
      ({ logger } = config);
    },
    async buildStart() {
      const result = await run();
      for (const f of watchFiles) {
        this.addWatchFile(f);
      }
      if (isBuild && result.diagnostics.some((d) => d.level === 'error')) {
        this.error('parla: catalog errors, see above');
      }
    },
    configureServer(server: ViteDevServer) {
      server.watcher.add([...watchFiles]);
      const onChange = async (file: string): Promise<void> => {
        if (!watchFiles.has(resolve(file))) {
          return;
        }
        try {
          const result = await run();
          server.watcher.add([...watchFiles]);
          if (result.written.length > 0) {
            server.ws.send({ type: 'full-reload' });
          }
        } catch (error) {
          server.config.logger.error(`parla: ${(error as Error).message}`);
        }
      };
      for (const event of ['change', 'add', 'unlink'] as const) {
        server.watcher.on(event, (file: string) => {
          void onChange(file);
        });
      }
    },
  };
}
