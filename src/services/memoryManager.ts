import { FileNode } from '@/store/workbenchStore';
import { RepoMap, Conventions, ProjectMemory, FileSummary, useProjectMemoryStore } from '@/store/projectMemoryStore';
import { buildProjectSkeleton, buildBudgetedSkeleton, type ProjectSkeleton } from '@/services/fileSkeletonParser';

// ─── Deterministic parsers (language-agnostic) ─────────────────────────────

function detectFramework(files: FileNode[]): string {
  const allPaths = flattenPaths(files);
  const flat = flattenFiles(files);

  // Helper: check package.json dependencies for a package name
  const hasDependency = (pkg: string): boolean => {
    const pkgFile = flat.find(f => f.name === 'package.json' && f.content);
    if (!pkgFile?.content) return false;
    try {
      const data = JSON.parse(pkgFile.content);
      return !!(data.dependencies?.[pkg] || data.devDependencies?.[pkg]);
    } catch { return false; }
  };

  // JS/TS frameworks — check specific frameworks first
  if (allPaths.some(p => p.includes('next.config'))) return 'Next.js';
  if (allPaths.some(p => p.includes('nuxt.config'))) return 'Nuxt';
  if (allPaths.some(p => p.includes('svelte.config'))) return 'SvelteKit';
  if (allPaths.some(p => p.includes('angular.json'))) return 'Angular';

  // Vite — distinguish React vs Vue vs Svelte vs vanilla
  if (allPaths.some(p => p.includes('vite.config'))) {
    if (hasDependency('react') || hasDependency('react-dom') || allPaths.some(p => p.endsWith('.jsx') || p.endsWith('.tsx'))) return 'React + Vite';
    if (hasDependency('vue') || allPaths.some(p => p.endsWith('.vue'))) return 'Vue + Vite';
    if (hasDependency('svelte')) return 'Svelte + Vite';
    if (hasDependency('solid-js')) return 'SolidJS + Vite';
    if (hasDependency('preact')) return 'Preact + Vite';
    return 'Vite';
  }

  if (allPaths.some(p => p.endsWith('App.tsx') || p.endsWith('App.jsx'))) return 'React (CRA/Vite)';
  // Python frameworks
  if (allPaths.some(p => p.includes('manage.py') || p.includes('django'))) return 'Django';
  if (allPaths.some(p => p.includes('flask') || (p.endsWith('app.py') && allPaths.some(q => q === 'requirements.txt')))) return 'Flask';
  if (allPaths.some(p => p.includes('fastapi') || p.includes('main.py') && allPaths.some(q => q === 'requirements.txt'))) return 'FastAPI (possible)';
  // Rust
  if (allPaths.some(p => p === 'Cargo.toml')) return 'Rust (Cargo)';
  // Go
  if (allPaths.some(p => p === 'go.mod')) return 'Go';
  // Java
  if (allPaths.some(p => p === 'pom.xml')) return 'Java (Maven)';
  if (allPaths.some(p => p === 'build.gradle' || p === 'build.gradle.kts')) return 'Java (Gradle)';
  // Ruby
  if (allPaths.some(p => p === 'Gemfile')) {
    if (allPaths.some(p => p.includes('config/routes.rb'))) return 'Ruby on Rails';
    return 'Ruby (Bundler)';
  }
  // PHP
  if (allPaths.some(p => p === 'composer.json')) {
    if (allPaths.some(p => p.includes('artisan'))) return 'Laravel';
    return 'PHP (Composer)';
  }
  // .NET
  if (allPaths.some(p => p.endsWith('.csproj') || p.endsWith('.sln'))) return '.NET';
  // Elixir
  if (allPaths.some(p => p === 'mix.exs')) return 'Elixir (Mix)';
  // CMake / C/C++
  if (allPaths.some(p => p === 'CMakeLists.txt')) return 'C/C++ (CMake)';
  if (allPaths.some(p => p === 'Makefile' || p === 'makefile')) {
    if (allPaths.some(p => p.endsWith('.c') || p.endsWith('.cpp') || p.endsWith('.h'))) return 'C/C++ (Make)';
  }
  return 'Unknown';
}

function detectPackageManager(files: FileNode[]): string {
  const allPaths = flattenPaths(files);
  // JS/TS — check lockfiles first (most reliable signal)
  if (allPaths.some(p => p === 'pnpm-lock.yaml')) return 'pnpm';
  if (allPaths.some(p => p === 'yarn.lock')) return 'yarn';
  // bun.lockb = bun <1.0 binary format; bun.lock = bun ≥1.0 text format
  // Only prefer bun if there is NO npm lockfile present (npm wins a tie since it's universal)
  if (allPaths.some(p => p === 'bun.lockb' || p === 'bun.lock') &&
      !allPaths.some(p => p === 'package-lock.json')) return 'bun';
  if (allPaths.some(p => p === 'package-lock.json')) return 'npm';
  if (allPaths.some(p => p === 'package.json')) return 'npm';
  // Python
  if (allPaths.some(p => p === 'poetry.lock' || p === 'pyproject.toml')) return 'poetry';
  if (allPaths.some(p => p === 'Pipfile' || p === 'Pipfile.lock')) return 'pipenv';
  if (allPaths.some(p => p === 'requirements.txt' || p === 'setup.py' || p === 'setup.cfg')) return 'pip';
  if (allPaths.some(p => p === 'uv.lock')) return 'uv';
  // Rust
  if (allPaths.some(p => p === 'Cargo.toml')) return 'cargo';
  // Go
  if (allPaths.some(p => p === 'go.mod')) return 'go modules';
  // Java
  if (allPaths.some(p => p === 'pom.xml')) return 'maven';
  if (allPaths.some(p => p === 'build.gradle' || p === 'build.gradle.kts')) return 'gradle';
  // Ruby
  if (allPaths.some(p => p === 'Gemfile')) return 'bundler';
  // PHP
  if (allPaths.some(p => p === 'composer.json')) return 'composer';
  // .NET
  if (allPaths.some(p => p.endsWith('.csproj') || p.endsWith('.sln'))) return 'dotnet';
  // Elixir
  if (allPaths.some(p => p === 'mix.exs')) return 'mix';
  // C/C++
  if (allPaths.some(p => p === 'CMakeLists.txt')) return 'cmake';
  if (allPaths.some(p => p === 'Makefile' || p === 'makefile')) return 'make';
  return 'none detected';
}

function detectLanguage(files: FileNode[]): string {
  const allPaths = flattenPaths(files);
  // Count file extensions to determine primary language
  const extCounts: Record<string, number> = {};
  for (const p of allPaths) {
    const ext = p.split('.').pop()?.toLowerCase();
    if (!ext || ext === p) continue;
    extCounts[ext] = (extCounts[ext] || 0) + 1;
  }

  const langMap: Record<string, string> = {
    tsx: 'TypeScript', ts: 'TypeScript',
    jsx: 'JavaScript', js: 'JavaScript',
    py: 'Python',
    rs: 'Rust',
    go: 'Go',
    java: 'Java', kt: 'Kotlin',
    rb: 'Ruby',
    php: 'PHP',
    cs: 'C#',
    cpp: 'C++', cc: 'C++', cxx: 'C++',
    c: 'C', h: 'C/C++',
    swift: 'Swift',
    ex: 'Elixir', exs: 'Elixir',
    zig: 'Zig',
    lua: 'Lua',
    dart: 'Dart',
    scala: 'Scala',
    clj: 'Clojure',
    hs: 'Haskell',
    ml: 'OCaml',
    r: 'R',
    jl: 'Julia',
  };

  // Explicit checks for config files that override counts
  if (allPaths.some(p => p === 'tsconfig.json')) return 'TypeScript';
  if (allPaths.some(p => p === 'Cargo.toml')) return 'Rust';
  if (allPaths.some(p => p === 'go.mod')) return 'Go';

  // Pick the language with the most source files
  let bestLang = 'Unknown';
  let bestCount = 0;
  for (const [ext, count] of Object.entries(extCounts)) {
    const lang = langMap[ext];
    if (lang && count > bestCount) {
      bestCount = count;
      bestLang = lang;
    }
  }
  return bestLang;
}

function detectStyling(files: FileNode[]): string {
  const allPaths = flattenPaths(files);
  if (allPaths.some(p => p.includes('tailwind.config'))) return 'TailwindCSS';
  if (allPaths.some(p => p.endsWith('.module.css'))) return 'CSS Modules';
  if (allPaths.some(p => p.endsWith('.scss'))) return 'SCSS';
  if (allPaths.some(p => p.endsWith('.css'))) return 'CSS';
  return 'N/A';
}

function detectEntryPoints(files: FileNode[]): string[] {
  const allPaths = flattenPaths(files);
  const candidates = [
    // JS/TS
    'src/main.tsx', 'src/main.ts', 'src/main.jsx', 'src/main.js',
    'src/index.tsx', 'src/index.ts', 'src/index.jsx', 'src/index.js',
    'src/App.tsx', 'src/App.jsx', 'src/App.js',
    'pages/_app.tsx', 'pages/_app.jsx', 'pages/_app.js',
    'app/layout.tsx', 'app/layout.jsx', 'app/layout.js',
    'index.html',
    // Python
    'main.py', 'app.py', 'manage.py', 'wsgi.py', 'asgi.py',
    'src/main.py', 'src/app.py',
    // Rust
    'src/main.rs', 'src/lib.rs',
    // Go
    'main.go', 'cmd/main.go',
    // Java
    'src/main/java/Main.java', 'src/main/java/App.java',
    // Ruby
    'config.ru', 'app.rb',
    // PHP
    'index.php', 'public/index.php', 'artisan',
    // C/C++
    'main.c', 'main.cpp', 'src/main.c', 'src/main.cpp',
    // .NET
    'Program.cs',
    // Elixir
    'lib/application.ex',
  ];
  // Match directly or with a single subfolder prefix (e.g. "website/src/App.jsx")
  return candidates.filter(c =>
    allPaths.includes(c) || allPaths.some(p => p.endsWith(`/${c}`))
  );
}

function detectImportantFiles(files: FileNode[]): string[] {
  const allPaths = flattenPaths(files);
  const important = [
    // Universal
    'README.md', 'README.rst', 'LICENSE', 'Makefile', 'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
    '.env', '.env.local', '.env.example', '.gitignore',
    // JS/TS
    'package.json', 'tsconfig.json', 'jsconfig.json',
    'vite.config.ts', 'vite.config.js', 'vite.config.mjs',
    'next.config.js', 'next.config.mjs', 'next.config.ts',
    'tailwind.config.ts', 'tailwind.config.js', 'postcss.config.js',
    'eslint.config.js', '.eslintrc.js', '.eslintrc.json',
    // Python
    'pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt',
    'Pipfile', 'tox.ini', 'pytest.ini', 'conftest.py',
    // Rust
    'Cargo.toml', 'Cargo.lock', 'build.rs',
    // Go
    'go.mod', 'go.sum',
    // Java
    'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts',
    // Ruby
    'Gemfile', 'Rakefile',
    // PHP
    'composer.json',
    // .NET
    'Program.cs',
    // C/C++
    'CMakeLists.txt',
    // Elixir
    'mix.exs',
  ];
  // Match directly or with a single subfolder prefix
  return important.filter(f =>
    allPaths.includes(f) || allPaths.some(p => p.endsWith(`/${f}`))
  );
}

function extractRunCommands(files: FileNode[]): Record<string, string> {
  const allPaths = flattenPaths(files);

  // JS/TS: package.json scripts
  const packageJson = findFileContent(files, 'package.json');
  if (packageJson) {
    try {
      const parsed = JSON.parse(packageJson);
      const scripts = parsed.scripts || {};
      const relevant: Record<string, string> = {};
      const keys = ['dev', 'build', 'start', 'test', 'lint', 'typecheck', 'check'];
      for (const key of keys) {
        if (scripts[key]) relevant[key] = scripts[key];
      }
      if (Object.keys(relevant).length > 0) return relevant;
    } catch {
      // ignore parse error
    }
  }

  // Python
  if (allPaths.includes('pyproject.toml') || allPaths.includes('setup.py') || allPaths.includes('requirements.txt')) {
    const cmds: Record<string, string> = {};
    if (allPaths.includes('manage.py')) {
      cmds.dev = 'python manage.py runserver';
      cmds.test = 'python manage.py test';
    } else {
      cmds.run = 'python main.py';
    }
    if (allPaths.includes('pytest.ini') || allPaths.includes('conftest.py') || allPaths.includes('pyproject.toml')) {
      cmds.test = 'pytest';
    }
    return cmds;
  }

  // Rust
  if (allPaths.includes('Cargo.toml')) {
    return { build: 'cargo build', test: 'cargo test', run: 'cargo run', check: 'cargo check' };
  }

  // Go
  if (allPaths.includes('go.mod')) {
    return { build: 'go build ./...', test: 'go test ./...', run: 'go run .' };
  }

  // Java Maven
  if (allPaths.includes('pom.xml')) {
    return { build: 'mvn compile', test: 'mvn test', package: 'mvn package' };
  }

  // Java Gradle
  if (allPaths.includes('build.gradle') || allPaths.includes('build.gradle.kts')) {
    return { build: './gradlew build', test: './gradlew test' };
  }

  // Ruby
  if (allPaths.includes('Gemfile')) {
    const cmds: Record<string, string> = { install: 'bundle install' };
    if (allPaths.some(p => p.includes('config/routes.rb'))) {
      cmds.dev = 'rails server';
      cmds.test = 'rails test';
    }
    return cmds;
  }

  // PHP
  if (allPaths.includes('composer.json')) {
    const cmds: Record<string, string> = { install: 'composer install' };
    if (allPaths.includes('artisan')) {
      cmds.dev = 'php artisan serve';
      cmds.test = 'php artisan test';
    }
    return cmds;
  }

  // .NET
  if (allPaths.some(p => p.endsWith('.csproj') || p.endsWith('.sln'))) {
    return { build: 'dotnet build', test: 'dotnet test', run: 'dotnet run' };
  }

  // C/C++
  if (allPaths.includes('CMakeLists.txt')) {
    return { build: 'cmake --build build', configure: 'cmake -B build' };
  }
  if (allPaths.includes('Makefile') || allPaths.includes('makefile')) {
    return { build: 'make', clean: 'make clean' };
  }

  // Elixir
  if (allPaths.includes('mix.exs')) {
    return { build: 'mix compile', test: 'mix test', run: 'mix run' };
  }

  return {};
}

function detectTopLevelFolders(files: FileNode[]): string[] {
  return files.filter(f => f.type === 'folder').map(f => f.name);
}

function detectRoutingStyle(files: FileNode[]): string {
  const allPaths = flattenPaths(files);
  if (allPaths.some(p => p.startsWith('app/') && p.includes('layout'))) return 'Next.js App Router';
  if (allPaths.some(p => p.startsWith('pages/'))) return 'Next.js Pages Router';
  // react-router-dom is declared in package.json, not in a file path — check the dep list
  const pkgNode = findFile(files, 'package.json');
  if (pkgNode?.content) {
    try {
      const pkg = JSON.parse(pkgNode.content);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
      if (allDeps['react-router-dom'] || allDeps['react-router'] || allDeps['@tanstack/react-router']) {
        return 'React Router';
      }
      if (allDeps['wouter']) return 'Wouter';
      if (allDeps['@reach/router']) return 'Reach Router';
    } catch { /* malformed package.json */ }
  }
  // Fallback: path-based heuristics for file-system routers
  if (allPaths.some(p => p.includes('router') || p.includes('routes'))) return 'React Router';
  if (allPaths.some(p => p.includes('config/routes.rb'))) return 'Rails Routes';
  if (allPaths.some(p => p.includes('urls.py'))) return 'Django URL conf';
  return 'N/A';
}

/** Find a file node by exact name anywhere in the tree. */
function findFile(nodes: FileNode[], name: string): FileNode | null {
  for (const n of nodes) {
    if (n.type === 'file' && n.name === name) return n;
    if (n.type === 'folder' && n.children) {
      const found = findFile(n.children, name);
      if (found) return found;
    }
  }
  return null;
}

function detectFileExtensions(files: FileNode[]): string {
  const allPaths = flattenPaths(files);
  // Count actual source file extensions
  const extCounts: Record<string, number> = {};
  const ignoredExts = new Set(['json', 'md', 'txt', 'yml', 'yaml', 'toml', 'lock', 'cfg', 'ini', 'env', 'gitignore', 'log', 'svg', 'png', 'jpg', 'ico', 'woff', 'woff2', 'ttf', 'eot']);
  for (const p of allPaths) {
    const ext = p.split('.').pop()?.toLowerCase();
    if (!ext || ext === p || ignoredExts.has(ext)) continue;
    extCounts[ext] = (extCounts[ext] || 0) + 1;
  }

  // Sort by count, return top extensions
  const sorted = Object.entries(extCounts).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return 'unknown';

  return sorted.slice(0, 4).map(([ext, count]) => `.${ext} (${count})`).join(', ');
}

function flattenPaths(nodes: FileNode[]): string[] {
  const result: string[] = [];
  for (const node of nodes) {
    result.push(node.path);
    if (node.children) result.push(...flattenPaths(node.children));
  }
  return result;
}

function flattenFiles(nodes: FileNode[]): FileNode[] {
  const result: FileNode[] = [];
  for (const node of nodes) {
    if (node.type === 'file') result.push(node);
    if (node.children) result.push(...flattenFiles(node.children));
  }
  return result;
}

function findFileContent(nodes: FileNode[], path: string): string | undefined {
  for (const node of nodes) {
    if (node.path === path && node.type === 'file') return node.content;
    if (node.children) {
      const found = findFileContent(node.children, path);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function simpleHash(content: string): string {
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) - h) + content.charCodeAt(i);
    h |= 0;
  }
  return h.toString(16);
}

function buildFileSummaries(files: FileNode[]): Record<string, FileSummary> {
  const summaries: Record<string, FileSummary> = {};
  const allFiles = flattenFiles(files);

  for (const file of allFiles) {
    if (!file.content) continue;
    const isImportant = file.path.includes('App.') || file.path.includes('main.') ||
      file.path === 'package.json' || file.path.includes('config') ||
      file.path.includes('router') || file.path.includes('store') ||
      file.path.includes('api') || file.path.includes('auth') ||
      file.path === 'Cargo.toml' || file.path === 'go.mod' ||
      file.path === 'pyproject.toml' || file.path === 'setup.py' ||
      file.path.includes('manage.py') || file.path.includes('urls.py') ||
      file.path.includes('models.py') || file.path.includes('views.py') ||
      file.path === 'pom.xml' || file.path === 'build.gradle' ||
      file.path === 'Gemfile' || file.path === 'composer.json' ||
      file.path === 'CMakeLists.txt' || file.path === 'mix.exs';

    if (!isImportant) continue;

    summaries[file.path] = {
      purpose: inferFilePurpose(file.path, file.content),
      exports: extractExports(file.content),
      dependsOn: extractImports(file.content),
      riskLevel: inferRiskLevel(file.path),
      hash: simpleHash(file.content),
    };
  }

  return summaries;
}

function inferFilePurpose(path: string, _content: string): string {
  if (path.includes('App.')) return 'Root application component';
  if (path.includes('main.') || path === 'main.go' || path === 'src/main.rs') return 'Application entry point';
  if (path === 'package.json') return 'JS/TS project config and dependencies';
  if (path === 'Cargo.toml') return 'Rust project config and dependencies';
  if (path === 'go.mod') return 'Go module definition';
  if (path === 'pyproject.toml' || path === 'setup.py') return 'Python project config';
  if (path === 'requirements.txt') return 'Python dependencies';
  if (path === 'pom.xml') return 'Maven project config';
  if (path === 'build.gradle' || path === 'build.gradle.kts') return 'Gradle build config';
  if (path === 'Gemfile') return 'Ruby dependencies';
  if (path === 'composer.json') return 'PHP project config';
  if (path === 'CMakeLists.txt') return 'CMake build config';
  if (path === 'mix.exs') return 'Elixir project config';
  if (path.includes('manage.py')) return 'Django management script';
  if (path.includes('urls.py')) return 'Django URL routing';
  if (path.includes('models.py')) return 'Data models';
  if (path.includes('views.py')) return 'View handlers';
  if (path.includes('router')) return 'Routing configuration';
  if (path.includes('store')) return 'State management';
  if (path.includes('api')) return 'API routes or client';
  if (path.includes('auth')) return 'Authentication logic';
  if (path.includes('config')) return 'Configuration file';
  return 'Application module';
}

function extractExports(content: string): string[] {
  // JS/TS exports
  const jsExports = content.match(/export\s+(?:default\s+)?(?:function|const|class|interface|type)\s+(\w+)/g) || [];
  // Python/Rust/Go: class/struct/func definitions at top level
  const pyClasses = content.match(/^class\s+(\w+)/gm) || [];
  const pyDefs = content.match(/^def\s+(\w+)/gm) || [];
  const rustPub = content.match(/pub\s+(?:fn|struct|enum|trait)\s+(\w+)/g) || [];
  const goFunc = content.match(/^func\s+(\w+)/gm) || [];

  const all = [...jsExports, ...pyClasses, ...pyDefs, ...rustPub, ...goFunc];
  return all.map(m => {
    const match = m.match(/(\w+)$/);
    return match ? match[1] : '';
  }).filter(Boolean).slice(0, 8);
}

function extractImports(content: string): string[] {
  // JS/TS
  const jsImports = content.match(/from\s+['"]([^'"]+)['"]/g) || [];
  // Python
  const pyImports = content.match(/^(?:from|import)\s+([\w.]+)/gm) || [];
  // Rust
  const rustUse = content.match(/^use\s+([\w:]+)/gm) || [];
  // Go
  const goImports = content.match(/^\s*"([^"]+)"/gm) || [];

  const all = [...jsImports, ...pyImports, ...rustUse, ...goImports];
  return all.map(m => {
    const match = m.match(/['"]([^'"]+)['"]/) || m.match(/([\w.:]+)$/);
    return match ? match[1] : '';
  }).filter(Boolean).slice(0, 10);
}

function inferRiskLevel(path: string): 'low' | 'medium' | 'high' {
  if (path.includes('auth') || path.includes('.env') || path.includes('config') || path.includes('secret')) return 'high';
  if (path.includes('App.') || path.includes('main.') || path.includes('router') || path.includes('urls.py')) return 'medium';
  return 'low';
}

/**
 * Detect if the project is nested inside a subdirectory (user opened parent).
 * Returns the subfolder prefix (e.g. "website/") or "" if project is at root.
 */
function detectProjectPrefix(files: FileNode[]): string {
  const topFiles = files.filter(f => f.type === 'file').map(f => f.name);
  if (PROJECT_MARKERS.some(m => topFiles.includes(m))) return '';
  const subdirs = files.filter(f => f.type === 'folder' && f.children);
  for (const dir of subdirs) {
    const childFiles = (dir.children ?? []).filter(f => f.type === 'file').map(f => f.name);
    if (PROJECT_MARKERS.some(m => childFiles.includes(m))) return `${dir.name}/`;
  }
  if (subdirs.length === 1) return `${subdirs[0].name}/`;
  return '';
}

function buildSkillMd(repoMap: RepoMap, conventions: Conventions, files: FileNode[]): string {
  const ext = detectFileExtensions(files);
  const isWebProject = ['N/A'].indexOf(conventions.styling) === -1 && conventions.styling !== 'N/A';
  const prefix = detectProjectPrefix(files);

  const sections = [`# ${repoMap.projectName}`];

  // Stack
  sections.push(`\n## Stack
- Language: ${repoMap.primaryLanguage}
- File extensions: ${ext}
- Framework: ${repoMap.framework}
- Package manager: ${repoMap.packageManager}`);

  if (isWebProject && conventions.styling !== 'N/A') {
    sections.push(`- Styling: ${conventions.styling}`);
  }

  // Structure — include prefix if nested
  const prefixedEntries = repoMap.entryPoints.map(e => `${prefix}${e}`);
  const prefixedImportant = repoMap.importantFiles.map(f => `${prefix}${f}`);
  sections.push(`\n## Structure
${prefix ? `Project root subdirectory: ${prefix}\n` : ''}Top-level: ${repoMap.topLevelFolders.join(', ')}
${prefixedEntries.length > 0 ? `Entry points: ${prefixedEntries.join(', ')}` : ''}
Important files: ${prefixedImportant.join(', ')}`);

  // Actual file tree (so the model sees real paths)
  const allPaths = flattenPaths(files).filter(p =>
    !p.includes('node_modules') && !p.includes('.git/') && !p.endsWith('.lock') && !p.endsWith('package-lock.json')
  );
  if (allPaths.length > 0 && allPaths.length <= 80) {
    sections.push(`\n## File tree (use EXACTLY these paths)\n${allPaths.join('\n')}`);
  } else if (allPaths.length > 80) {
    // Too many files — just show the first 60 + note
    sections.push(`\n## File tree (use EXACTLY these paths)\n${allPaths.slice(0, 60).join('\n')}\n... and ${allPaths.length - 60} more files`);
  }

  // Commands
  const cmdEntries = Object.entries(repoMap.runCommands);
  if (cmdEntries.length > 0) {
    sections.push(`\n## Commands
${cmdEntries.map(([k, v]) => `- ${k}: \`${v}\``).join('\n')}`);
  }

  // Architecture notes (auto-detected: framework, entry points, key patterns)
  if (repoMap.architectureNotes && repoMap.architectureNotes.length > 0) {
    sections.push(`\n## Architecture\n${repoMap.architectureNotes.map(n => `- ${n}`).join('\n')}`);
  }

  // Conventions (only include relevant ones)
  const convNotes: string[] = [];
  if (conventions.routingStyle !== 'N/A') convNotes.push(`Routing: ${conventions.routingStyle}`);
  if (conventions.componentPattern) convNotes.push(`Components: ${conventions.componentPattern}`);
  if (conventions.notes.length > 0) convNotes.push(...conventions.notes);
  if (convNotes.length > 0) {
    sections.push(`\n## Conventions
${convNotes.map(n => `- ${n}`).join('\n')}`);
  }

  // Important rules — emphasise correct paths
  sections.push(`\n## IMPORTANT
- ALL file paths MUST match the file tree above exactly. ${prefix ? `Files are inside "${prefix}" — always include this prefix.` : ''}
- ALWAYS use the correct file extensions. Check existing files before creating new ones.
- Check entry points and important files to understand what exists before modifying.
- Use the project's package manager and build tools (${repoMap.packageManager}).`);

  return sections.join('\n').trim();
}

// ─── Disk persistence (.codescout/project.json) ───────────────────────────

const CODESCOUT_DIR = '.codescout';
const PROJECT_FILE = 'project.json';
const AGENT_MEMORY_FILE = 'memory.json';
const SKILLS_FILE = 'skills.md';
const CONTEXT_FILE = 'context.md';

async function writeIndexToDisk(projectPath: string, memory: ProjectMemory): Promise<void> {
  if (!projectPath) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const sep = projectPath.includes('\\') ? '\\' : '/';
    const dirPath = `${projectPath}${sep}${CODESCOUT_DIR}`;
    const filePath = `${dirPath}${sep}${PROJECT_FILE}`;

    // Create .codescout directory
    try { await invoke('create_dir', { path: dirPath }); } catch { /* already exists */ }

    // Write the project index — include everything the agent needs
    const payload = {
      _comment: 'Auto-generated by Code Scout AI — do not edit manually',
      projectName: memory.repoMap.projectName,
      language: memory.repoMap.primaryLanguage,
      framework: memory.repoMap.framework,
      packageManager: memory.repoMap.packageManager,
      styling: memory.conventions.styling,
      routing: memory.conventions.routingStyle,
      entryPoints: memory.repoMap.entryPoints,
      importantFiles: memory.repoMap.importantFiles,
      topLevelFolders: memory.repoMap.topLevelFolders,
      runCommands: memory.repoMap.runCommands,
      conventions: {
        componentPattern: memory.conventions.componentPattern,
        apiPattern: memory.conventions.apiPattern,
        notes: memory.conventions.notes,
      },
      architectureNotes: memory.repoMap.architectureNotes,
      fileSummaries: Object.fromEntries(
        Object.entries(memory.fileSummaries).map(([k, v]) => [k, { purpose: v.purpose, exports: v.exports }])
      ),
      lastIndexed: new Date(memory.lastIndexed).toISOString(),
    };

    await invoke('write_file', { path: filePath, content: JSON.stringify(payload, null, 2) });
    console.log('[memoryManager] wrote .codescout/project.json');
  } catch (e) {
    console.warn('[memoryManager] failed to write .codescout/project.json:', e);
  }
}

/**
 * Write `.codescout/skills.md` — the human-readable project context document
 * that the LLM reads at the start of every session. Writing it to disk lets
 * developers inspect or hand-edit it, and lets the agent read it via file tools.
 *
 * `.codescout/context.md` holds the file-skeleton overview (structure without
 * function bodies) — useful for large codebases where the full tree is too big
 * to send in every prompt.
 */
async function writeSkillsToDisk(projectPath: string, memory: ProjectMemory): Promise<void> {
  if (!projectPath) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const sep = projectPath.includes('\\') ? '\\' : '/';
    const dirPath = `${projectPath}${sep}${CODESCOUT_DIR}`;
    try { await invoke('create_dir', { path: dirPath }); } catch { /* exists */ }

    // skills.md — the rich project context the LLM reads.
    // Preserve any "## User Notes" section the user or agent has added.
    const skillsPath = `${dirPath}${sep}${SKILLS_FILE}`;
    let userNotesSection = '';
    try {
      const existing = await invoke<string>('read_file_text', { path: skillsPath });
      const userNotesMatch = existing.match(/^##\s+User Notes[\s\S]*$/m);
      if (userNotesMatch) {
        userNotesSection = '\n\n' + userNotesMatch[0].trim();
      }
    } catch { /* file doesn't exist yet — that's fine */ }

    const skillsContent = [
      `# Code Scout — Project Skills`,
      `> Auto-generated on ${new Date().toISOString()} — edit the "User Notes" section below to add permanent tips`,
      '',
      memory.skillMd,
      userNotesSection || '\n## User Notes\n<!-- Add project-specific tips here. This section is preserved across re-indexes. -->\n<!-- Example: "Always use pnpm. tsx is available. Playwright is installed globally." -->',
    ].join('\n');
    await invoke('write_file', { path: skillsPath, content: skillsContent });

    // context.md — structural skeleton (file tree with exports, no bodies)
    if (memory.skeletonText) {
      const contextPath = `${dirPath}${sep}${CONTEXT_FILE}`;
      const contextContent = [
        `# Code Scout — Project Structure`,
        `> Auto-generated on ${new Date().toISOString()} — structural overview (~${memory.skeletonTokens} tokens)`,
        '',
        memory.skeletonText,
      ].join('\n');
      await invoke('write_file', { path: contextPath, content: contextContent });
    }

    console.log('[memoryManager] wrote .codescout/skills.md and context.md');
  } catch (e) {
    console.warn('[memoryManager] failed to write .codescout/skills.md:', e);
  }
}

async function readIndexFromDisk(projectPath: string): Promise<any | null> {
  if (!projectPath) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const sep = projectPath.includes('\\') ? '\\' : '/';
    const filePath = `${projectPath}${sep}${CODESCOUT_DIR}${sep}${PROJECT_FILE}`;
    const contents = await invoke<string>('read_file_text', { path: filePath });
    return JSON.parse(contents);
  } catch {
    return null;
  }
}

/** Persist agent memories for this project under `.codescout/memory.json` (desktop only). */
export async function writeAgentMemoryToDisk(projectRoot: string, memories: unknown[]): Promise<void> {
  if (!projectRoot) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const sep = projectRoot.includes('\\') ? '\\' : '/';
    const dirPath = `${projectRoot}${sep}${CODESCOUT_DIR}`;
    const filePath = `${dirPath}${sep}${AGENT_MEMORY_FILE}`;
    try {
      await invoke('create_dir', { path: dirPath });
    } catch {
      /* exists */
    }
    const payload = {
      _comment: 'Auto-generated by Code Scout AI — agent memory for this project',
      version: 1,
      updatedAt: new Date().toISOString(),
      memories,
    };
    await invoke('write_file', { path: filePath, content: JSON.stringify(payload, null, 2) });
    console.log('[memoryManager] wrote .codescout/memory.json');
  } catch (e) {
    console.warn('[memoryManager] failed to write .codescout/memory.json:', e);
  }
}

/** Load agent memories from disk; returns null if missing or invalid. */
export async function readAgentMemoryFromDisk(projectRoot: string): Promise<unknown[] | null> {
  if (!projectRoot) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const sep = projectRoot.includes('\\') ? '\\' : '/';
    const filePath = `${projectRoot}${sep}${CODESCOUT_DIR}${sep}${AGENT_MEMORY_FILE}`;
    const contents = await invoke<string>('read_file_text', { path: filePath });
    const data = JSON.parse(contents) as { memories?: unknown };
    if (!Array.isArray(data.memories)) return null;
    return data.memories;
  } catch {
    return null;
  }
}

// ─── Resolve actual project root (same logic as TerminalPanel / agentExecutor) ──

const PROJECT_MARKERS = ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'setup.py', 'Makefile', 'pom.xml', 'build.gradle'];

export function resolveEffectiveRoot(basePath: string, files: FileNode[]): string {
  const topFiles = files.filter(f => f.type === 'file').map(f => f.name);
  if (PROJECT_MARKERS.some(m => topFiles.includes(m))) return basePath;
  const sep = basePath.includes('\\') ? '\\' : '/';
  const subdirs = files.filter(f => f.type === 'folder' && f.children);
  for (const dir of subdirs) {
    const childFiles = (dir.children ?? []).filter(f => f.type === 'file').map(f => f.name);
    if (PROJECT_MARKERS.some(m => childFiles.includes(m))) return `${basePath}${sep}${dir.name}`;
  }
  if (subdirs.length === 1) return `${basePath}${sep}${subdirs[0].name}`;
  return basePath;
}

// ─── Main indexing function ────────────────────────────────────────────────

/**
 * When the user opens a parent dir, resolve to the actual project subdirectory's files.
 * E.g. if opened "WEBSITE/" and the project is "WEBSITE/website/", return website's children.
 */
/**
 * Re-root FileNodes by stripping a prefix from all paths.
 * E.g. "website/src/App.jsx" → "src/App.jsx" when prefix is "website/"
 */
function stripPathPrefix(nodes: FileNode[], prefix: string): FileNode[] {
  if (!prefix) return nodes;
  return nodes.map(n => ({
    ...n,
    path: n.path.startsWith(prefix) ? n.path.slice(prefix.length) : n.path,
    children: n.children ? stripPathPrefix(n.children, prefix) : undefined,
  }));
}

function resolveEffectiveFiles(files: FileNode[]): { effectiveFiles: FileNode[]; prefix: string } {
  const topFiles = files.filter(f => f.type === 'file').map(f => f.name);
  if (PROJECT_MARKERS.some(m => topFiles.includes(m))) {
    return { effectiveFiles: files, prefix: '' };
  }
  const subdirs = files.filter(f => f.type === 'folder' && f.children);
  for (const dir of subdirs) {
    const childFiles = (dir.children ?? []).filter(f => f.type === 'file').map(f => f.name);
    if (PROJECT_MARKERS.some(m => childFiles.includes(m))) {
      const prefix = `${dir.name}/`;
      return { effectiveFiles: stripPathPrefix(dir.children ?? [], prefix), prefix };
    }
  }
  if (subdirs.length === 1 && subdirs[0].children) {
    const prefix = `${subdirs[0].name}/`;
    return { effectiveFiles: stripPathPrefix(subdirs[0].children, prefix), prefix };
  }
  return { effectiveFiles: files, prefix: '' };
}

export function indexProject(files: FileNode[], projectName: string, projectPath?: string): ProjectMemory {
  // Resolve to the actual project root (handles parent-dir-opened case)
  const effectivePath = projectPath ? resolveEffectiveRoot(projectPath, files) : undefined;

  // Use the project subdirectory's files for detection (not the parent)
  const { effectiveFiles, prefix } = resolveEffectiveFiles(files);

  const framework = detectFramework(effectiveFiles);
  const packageManager = detectPackageManager(effectiveFiles);
  const primaryLanguage = detectLanguage(effectiveFiles);
  const styling = detectStyling(effectiveFiles);
  const entryPoints = detectEntryPoints(effectiveFiles);
  const importantFiles = detectImportantFiles(effectiveFiles);
  const runCommands = extractRunCommands(effectiveFiles);
  const topLevelFolders = detectTopLevelFolders(effectiveFiles);
  const routingStyle = detectRoutingStyle(effectiveFiles);

  const repoMap: RepoMap = {
    projectName,
    primaryLanguage,
    framework,
    packageManager,
    entryPoints,
    importantFiles,
    topLevelFolders,
    runCommands,
    architectureNotes: [
      framework !== 'Unknown' ? `${framework} detected` : '',
      entryPoints.length > 0 ? `Entry: ${entryPoints[0]}` : '',
    ].filter(Boolean),
  };

  // Build conventions — language-aware
  const isJsTs = ['TypeScript', 'JavaScript'].includes(primaryLanguage);
  const conventions: Conventions = {
    styling: isJsTs ? styling : 'N/A',
    routingStyle,
    componentPattern: isJsTs
      ? (primaryLanguage === 'TypeScript' ? 'Typed functional components' : 'Functional components')
      : primaryLanguage === 'Python' ? 'Classes and functions'
      : primaryLanguage === 'Rust' ? 'Structs + impl blocks'
      : primaryLanguage === 'Go' ? 'Structs + methods'
      : '',
    apiPattern: topLevelFolders.includes('api') ? 'Separate API folder' : 'Co-located',
    notes: [
      isJsTs && styling === 'TailwindCSS' ? 'Use Tailwind utility classes' : '',
      isJsTs ? 'Prefer functional components' : '',
    ].filter(Boolean),
  };

  const fileSummaries = buildFileSummaries(files);
  const skillMd = buildSkillMd(repoMap, conventions, files);

  // Build file skeletons (structural summaries without function bodies)
  const skeleton = buildProjectSkeleton(files);

  const memory: ProjectMemory = {
    repoMap,
    fileSummaries,
    conventions,
    skillMd,
    skeletonText: skeleton.fullText,
    skeletonTokens: skeleton.approxTokens,
    lastIndexed: Date.now(),
    isStale: false,
  };

  // Persist to store
  useProjectMemoryStore.getState().setMemory(projectName, memory);

  // Write all .codescout/ files to disk (fire-and-forget)
  if (effectivePath) {
    writeIndexToDisk(effectivePath, memory).catch(() => {});
    writeSkillsToDisk(effectivePath, memory).catch(() => {});
  }

  return memory;
}

export function isMemoryStale(memory: ProjectMemory): boolean {
  // Stale after 30 minutes
  return memory.isStale || (Date.now() - memory.lastIndexed > 30 * 60 * 1000);
}

export function getOrIndexProject(files: FileNode[], projectName: string, projectPath?: string): ProjectMemory {
  const existing = useProjectMemoryStore.getState().getMemory(projectName);
  if (existing && !isMemoryStale(existing)) return existing;
  return indexProject(files, projectName, projectPath);
}

export { readIndexFromDisk };

/**
 * Get a skeleton that fits within a token budget.
 * Uses cached full skeleton when possible, rebuilds budget-constrained version otherwise.
 */
export function getBudgetedSkeletonText(files: FileNode[], projectName: string, maxTokens: number): string {
  const memory = getOrIndexProject(files, projectName);
  if (memory.skeletonTokens <= maxTokens) return memory.skeletonText;
  return buildBudgetedSkeleton(files, maxTokens);
}
