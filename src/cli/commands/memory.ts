import type { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { AppCore } from '../../app.js';
import type { Memory, MemoryType } from '../../types.js';
import { isMemoryType } from '../../memory/extractor.js';

interface MemoryCmdOptions {
  project?: string;
  projectId?: string;
  type?: string;
  session?: string;
  minImportance?: string;
  limit: string;
  hybrid?: boolean;
  out?: string;
  file?: string;
}

export function registerMemoryCommands(program: Command, getApp: () => AppCore): void {
  program
    .command('memory')
    .description('Memory inspection and management')
    .argument('<action>', 'list | search | delete | save | update | recall | export | import')
    .argument('[query]', 'search query, memory id, or file path depending on action')
    .option('-p, --project <path>', 'restrict to a project by path')
    .option('-i, --project-id <id>', 'restrict to a project by id')
    .option('-t, --type <type>', 'filter by memory type')
    .option('-s, --session <id>', 'filter by session id')
    .option('--min-importance <score>', 'minimum importance (0..1)')
    .option('-l, --limit <n>', 'max rows', '50')
    .option('--hybrid', 'use hybrid (token-overlap) ranking for search')
    .option('-o, --out <file>', 'output file for export (default stdout)')
    .option('-f, --file <file>', 'input file for import')
    .action((action: string, query: string | undefined, opts: MemoryCmdOptions) => {
      const app = getApp();
      const pid =
        opts.projectId ?? (opts.project ? app.service.getProjectByPath(opts.project)?.id : undefined);
      if (opts.project && !pid) {
        exitError(`No project found for path: ${opts.project}`);
        return;
      }
      const limit = Number(opts.limit);
      if (!Number.isInteger(limit) || limit < 1) {
        exitError(`--limit must be a positive integer, got: ${opts.limit}`);
        return;
      }
      const type: MemoryType | undefined = opts.type && isMemoryType(opts.type) ? opts.type : undefined;
      if (opts.type && !type) {
        exitError(`Unknown memory type: ${opts.type}`);
        return;
      }
      const minImportance = opts.minImportance != null ? Number(opts.minImportance) : undefined;
      if (minImportance != null && (!Number.isFinite(minImportance) || minImportance < 0 || minImportance > 1)) {
        exitError(`--min-importance must be between 0 and 1, got: ${opts.minImportance}`);
        return;
      }

      if (action === 'list') {
        printMemories(
          app.service.listMemories({ project_id: pid, session_id: opts.session, type, limit })
        );
        return;
      }

      if (action === 'search') {
        if (!query) {
          exitError('search requires a query: memosaver memory search "authentication"');
          return;
        }
        if (opts.hybrid) {
          const results = app.service.searchHybrid(query, {
            project_id: pid,
            session_id: opts.session,
            type,
            limit
          });
          if (results.length === 0) {
            console.log('No matches.');
            return;
          }
          for (const { memory, score, meta } of results) {
            console.log(formatMemory(memory, `score=${score.toFixed(4)} (overlap ${meta.overlap}, bm25 ${meta.bm25})`));
          }
          return;
        }
        const results = app.service.retriever.search(query, {
          project_id: pid,
          session_id: opts.session,
          type,
          limit
        });
        if (results.length === 0) {
          console.log('No matches.');
          return;
        }
        for (const { memory, score } of results) {
          console.log(formatMemory(memory, `score=${score.toFixed(4)}`));
        }
        return;
      }

      if (action === 'delete') {
        if (!query) {
          exitError('memory delete requires a memory id.');
          return;
        }
        const deleted = app.service.engine.delete(query);
        console.log(deleted ? `Deleted memory ${query}` : `Memory not found: ${query}`);
        return;
      }

      if (action === 'update') {
        if (!query) {
          exitError('memory update requires a memory id.');
          return;
        }
        const updated = app.service.updateMemory(query, {
          type,
          importance: minImportance
        });
        if (!updated) {
          exitError(`Memory not found: ${query}`);
          return;
        }
        console.log(`Updated ${updated.id} (${updated.type}) imp=${updated.importance.toFixed(2)}`);
        return;
      }

      if (action === 'save') {
        if (!query) {
          exitError('memory save requires content: memosaver memory save "content" --project <path>');
          return;
        }
        if (!pid) {
          exitError('memory save requires a project (--project <path> or --project-id)');
          return;
        }
        const saved = app.service.engine.save({
          projectId: pid,
          content: query,
          type,
          importance: minImportance
        });
        if (saved) console.log(`Saved ${saved.id} (${saved.type}) imp=${saved.importance.toFixed(2)}`);
        else console.log('Memory was not stored (empty, duplicate, or invalid input).');
        return;
      }

      if (action === 'recall') {
        if (!pid) {
          exitError('memory recall requires a project (--project <path> or --project-id)');
          return;
        }
        const memories = app.service.retriever.recall(pid, {
          session_id: opts.session,
          type,
          min_importance: minImportance,
          limit
        });
        for (const m of memories) console.log(formatMemory(m));
        return;
      }

      if (action === 'export') {
        const doc = app.service.exportMemories({ project_id: pid, session_id: opts.session, type });
        const json = JSON.stringify(doc, null, 2);
        if (opts.out) {
          writeFileSync(opts.out, json + '\n');
          console.log(`Exported ${doc.memories.length} memories to ${opts.out}`);
        } else {
          console.log(json);
        }
        return;
      }

      if (action === 'import') {
        const file = opts.file ?? query;
        if (!file || !existsSync(file)) {
          exitError('memory import requires an existing file: --file <path> or <path>');
          return;
        }
        let doc: ReturnType<AppCore['service']['exportMemories']>;
        try {
          doc = JSON.parse(readFileSync(file, 'utf8')) as ReturnType<AppCore['service']['exportMemories']>;
        } catch (err) {
          exitError(`cannot parse ${file}: ${(err as Error).message}`);
          return;
        }
        try {
          const result = app.service.importMemories(doc as Parameters<AppCore['service']['importMemories']>[0]);
          console.log(`Imported ${result.imported} memories (${result.skipped} skipped).`);
        } catch (err) {
          exitError(`import failed: ${(err as Error).message}`);
        }
        return;
      }

      exitError(`Unknown memory action: ${action}`);
    });
}

function printMemories(memories: Memory[]): void {
  if (memories.length === 0) {
    console.log('No memories found.');
    return;
  }
  for (const memory of memories) console.log(formatMemory(memory));
}

function formatMemory(memory: Memory, extra = ''): string {
  const lines = [
    `${memory.id}  ${memory.type}  imp=${memory.importance.toFixed(2)}${extra ? '  ' + extra : ''}`
  ];
  lines.push(`  ${memory.content}`);
  lines.push(`  created ${new Date(memory.created_at).toISOString()}  session=${memory.session_id ?? '-'}`);
  return lines.join('\n');
}

function exitError(message: string): void {
  console.error(message);
  process.exitCode = 1;
}