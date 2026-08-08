import type { Command } from 'commander';
import type { AppCore } from '../../app.js';
import { detectProject } from '../../project/project-detector.js';

export function registerProjectCommands(program: Command, getApp: () => AppCore): void {
  program
    .command('projects')
    .description('List all known projects')
    .action(() => {
      const app = getApp();
      const projects = app.service.listProjects();
      if (projects.length === 0) {
        console.log('No projects recorded yet.');
        return;
      }
      for (const project of projects) {
        console.log(`${project.id}  ${project.name}`);
        console.log(`    path:    ${project.path}`);
        console.log(`    updated: ${new Date(project.updated_at).toISOString()}`);
        console.log(`    last session: ${project.last_session_id ?? '-'}`);
      }
    });

  program
    .command('project')
    .description('Resolve and inspect a project by path')
    .argument('<path>', 'project directory path')
    .action((path: string) => {
      const app = getApp();
      const detected = detectProject(path);
      const stored = app.service.getProjectByPath(path);
      console.log(`Detected project`);
      console.log(`  id:   ${detected.id}`);
      console.log(`  name: ${detected.name}`);
      console.log(`  path: ${detected.path}`);
      if (!stored) {
        console.log('Not recorded yet (no session started). Use session_start / claude+memosaver to record it.');
      }
    });
}