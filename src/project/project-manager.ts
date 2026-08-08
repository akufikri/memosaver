import type { Project } from '../types.js';
import { ProjectRepository } from '../storage/repositories/project-repository.js';
import { detectProject } from './project-detector.js';
import { now } from '../util/id.js';

export interface ProjectResult {
  project: Project;
  /** true when the project did not exist before this call */
  created: boolean;
}

export class ProjectManager {
  constructor(private readonly projects: ProjectRepository) {}

  /** Detect a project by path and ensure it exists in the database. */
  ensureProject(rawPath: string): ProjectResult {
    const detected = detectProject(rawPath);
    const existing = this.projects.findByHash(detected.path_hash);
    if (existing) {
      return { project: existing, created: false };
    }
    const project: Project = {
      id: detected.id,
      name: detected.name,
      path: detected.path,
      path_hash: detected.path_hash,
      created_at: now(),
      updated_at: now(),
      last_session_id: null
    };
    this.projects.create(project);
    return { project, created: true };
  }

  get(rawPath: string): Project | null {
    const detected = detectProject(rawPath);
    return this.projects.findByHash(detected.path_hash);
  }

  getById(id: string): Project | null {
    return this.projects.get(id);
  }

  list(): Project[] {
    return this.projects.list();
  }
}