// "/" opens the current project's dashboard (last used, else the first project).
import { boot, loadProjectContext, projectHome } from './shell.js';

async function main() {
  await boot();
  const { project } = await loadProjectContext({ required: false });
  location.replace(project ? projectHome(project.id) : '/projects');
}

main();
