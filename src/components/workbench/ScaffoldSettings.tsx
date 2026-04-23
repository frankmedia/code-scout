/**
 * ScaffoldSettings — UI for customizing project scaffold templates.
 * Lets users view and edit template files, toggle features, and add packages.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Package,
  RefreshCw,
  ChevronDown,
  Check,
  FileCode,
  RotateCcw,
  ChevronRight,
  Pencil,
} from 'lucide-react';
import {
  useScaffoldStore,
  SUGGESTED_PACKAGES,
  type ScaffoldPackage,
} from '@/store/scaffoldStore';
import { ARCHETYPES } from '@/services/scaffoldRegistry';

type ArchetypeId = (typeof ARCHETYPES)[number]['id'];
type Section = 'files' | 'features' | 'packages';

function languageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript (JSX)',
    js: 'JavaScript',
    jsx: 'JavaScript (JSX)',
    json: 'JSON',
    css: 'CSS',
    html: 'HTML',
    vue: 'Vue',
    mjs: 'JavaScript (ESM)',
    py: 'Python',
    rs: 'Rust',
    go: 'Go',
    php: 'PHP',
    toml: 'TOML',
    txt: 'Text',
    md: 'Markdown',
  };
  return map[ext] ?? ext.toUpperCase();
}

const ScaffoldSettings = () => {
  const [selectedArchetype, setSelectedArchetype] = useState<ArchetypeId>(
    ARCHETYPES[0]?.id ?? 'nextjs',
  );
  const [openSection, setOpenSection] = useState<Section>('files');
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState('');
  const [showPackageDropdown, setShowPackageDropdown] = useState(false);
  const [customPackage, setCustomPackage] = useState('');
  const [customPackageDev, setCustomPackageDev] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const {
    getCustomization,
    setCustomization,
    addExtraPackage,
    removeExtraPackage,
    setFileOverride,
    removeFileOverride,
    resetArchetype,
  } = useScaffoldStore();

  const archetype = useMemo(
    () => ARCHETYPES.find((a) => a.id === selectedArchetype) ?? ARCHETYPES[0],
    [selectedArchetype],
  );
  const customization = getCustomization(selectedArchetype);

  const openFile = useCallback(
    (filePath: string) => {
      const override = customization.fileOverrides[filePath];
      const defaultContent =
        archetype.files.find((f) => f.path === filePath)?.content ?? '';
      setEditingFile(filePath);
      setEditBuffer(override ?? defaultContent);
    },
    [archetype, customization.fileOverrides],
  );

  const closeFile = useCallback(() => {
    setEditingFile(null);
    setEditBuffer('');
  }, []);

  const saveFile = useCallback(() => {
    if (!editingFile) return;
    const defaultContent =
      archetype.files.find((f) => f.path === editingFile)?.content ?? '';
    if (editBuffer === defaultContent) {
      removeFileOverride(selectedArchetype, editingFile);
    } else {
      setFileOverride(selectedArchetype, editingFile, editBuffer);
    }
    closeFile();
  }, [
    editingFile,
    editBuffer,
    archetype,
    selectedArchetype,
    setFileOverride,
    removeFileOverride,
    closeFile,
  ]);

  const revertFile = useCallback(() => {
    if (!editingFile) return;
    removeFileOverride(selectedArchetype, editingFile);
    const defaultContent =
      archetype.files.find((f) => f.path === editingFile)?.content ?? '';
    setEditBuffer(defaultContent);
  }, [editingFile, archetype, selectedArchetype, removeFileOverride]);

  useEffect(() => {
    if (editingFile && editorRef.current) {
      editorRef.current.focus();
    }
  }, [editingFile]);

  const handleAddCustomPackage = () => {
    const name = customPackage.trim();
    if (!name) return;
    addExtraPackage(selectedArchetype, { name, dev: customPackageDev });
    setCustomPackage('');
    setCustomPackageDev(false);
  };

  const handleAddSuggestedPackage = (pkg: ScaffoldPackage) => {
    addExtraPackage(selectedArchetype, pkg);
    setShowPackageDropdown(false);
  };

  const toggleSection = (s: Section) =>
    setOpenSection((prev) => (prev === s ? s : s));

  const overrideCount = Object.keys(customization.fileOverrides).length;

  return (
    <div className="space-y-4">
      {/* ─── Archetype selector ─── */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-2">
          Framework Template
        </label>
        <div className="flex flex-wrap gap-2">
          {ARCHETYPES.map((arch) => (
            <button
              key={arch.id}
              onClick={() => {
                setSelectedArchetype(arch.id);
                closeFile();
              }}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                selectedArchetype === arch.id
                  ? 'bg-primary/10 border-primary text-primary'
                  : 'bg-surface-panel border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground'
              }`}
            >
              {arch.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Template Files ─── */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('files')}
          className="w-full flex items-center justify-between px-3 py-2.5 bg-surface-panel hover:bg-surface-hover transition-colors"
        >
          <div className="flex items-center gap-2">
            <ChevronRight
              className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                openSection === 'files' ? 'rotate-90' : ''
              }`}
            />
            <FileCode className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">
              Template Files
            </span>
            <span className="text-[10px] text-muted-foreground">
              ({archetype.files.length} files)
            </span>
          </div>
          {overrideCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/10 text-amber-500 rounded">
              {overrideCount} modified
            </span>
          )}
        </button>

        {openSection === 'files' && (
          <div className="border-t border-border">
            {editingFile ? (
              /* ─── File editor ─── */
              <div className="flex flex-col">
                <div className="flex items-center justify-between px-3 py-2 bg-surface-panel border-b border-border">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileCode className="h-3 w-3 text-primary shrink-0" />
                    <span className="text-xs font-mono text-foreground truncate">
                      {editingFile}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {languageFromPath(editingFile)}
                    </span>
                    {customization.fileOverrides[editingFile] !== undefined && (
                      <span className="text-[10px] px-1 py-0.5 bg-amber-500/10 text-amber-500 rounded shrink-0">
                        modified
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {customization.fileOverrides[editingFile] !== undefined && (
                      <button
                        onClick={revertFile}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground rounded hover:bg-surface-hover transition-colors"
                        title="Revert to default"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Revert
                      </button>
                    )}
                    <button
                      onClick={closeFile}
                      className="px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground rounded hover:bg-surface-hover transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveFile}
                      className="px-2 py-1 text-[10px] bg-primary text-white rounded hover:bg-primary/90 transition-colors"
                    >
                      Save
                    </button>
                  </div>
                </div>
                <textarea
                  ref={editorRef}
                  value={editBuffer}
                  onChange={(e) => setEditBuffer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      const start = e.currentTarget.selectionStart;
                      const end = e.currentTarget.selectionEnd;
                      const val = e.currentTarget.value;
                      setEditBuffer(
                        val.substring(0, start) + '  ' + val.substring(end),
                      );
                      requestAnimationFrame(() => {
                        if (editorRef.current) {
                          editorRef.current.selectionStart =
                            editorRef.current.selectionEnd = start + 2;
                        }
                      });
                    }
                    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                      e.preventDefault();
                      saveFile();
                    }
                  }}
                  spellCheck={false}
                  className="w-full min-h-[280px] max-h-[420px] px-3 py-2 text-xs font-mono leading-relaxed bg-[#1a1a2e] text-[#e0e0e0] border-0 resize-y focus:outline-none focus:ring-0"
                  style={{ tabSize: 2 }}
                />
              </div>
            ) : (
              /* ─── File list ─── */
              <div className="divide-y divide-border">
                {archetype.files.map((file) => {
                  const isOverridden =
                    customization.fileOverrides[file.path] !== undefined;
                  return (
                    <button
                      key={file.path}
                      onClick={() => openFile(file.path)}
                      className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-surface-hover transition-colors group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileCode className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-xs font-mono text-foreground truncate">
                          {file.path}
                        </span>
                        {isOverridden && (
                          <span className="text-[10px] px-1 py-0.5 bg-amber-500/10 text-amber-500 rounded shrink-0">
                            modified
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-muted-foreground">
                          {languageFromPath(file.path)}
                        </span>
                        <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Features ─── */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('features')}
          className="w-full flex items-center gap-2 px-3 py-2.5 bg-surface-panel hover:bg-surface-hover transition-colors"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
              openSection === 'features' ? 'rotate-90' : ''
            }`}
          />
          <span className="text-xs font-semibold text-foreground">
            Features
          </span>
        </button>
        {openSection === 'features' && (
          <div className="px-3 py-3 border-t border-border space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={customization.includeTailwind}
                onChange={(e) =>
                  setCustomization(selectedArchetype, {
                    includeTailwind: e.target.checked,
                  })
                }
                className="rounded border-border text-primary focus:ring-primary"
              />
              <span className="text-xs text-foreground">
                Include Tailwind CSS
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={customization.strictTypeScript}
                onChange={(e) =>
                  setCustomization(selectedArchetype, {
                    strictTypeScript: e.target.checked,
                  })
                }
                className="rounded border-border text-primary focus:ring-primary"
              />
              <span className="text-xs text-foreground">
                TypeScript strict mode
              </span>
            </label>
          </div>
        )}
      </div>

      {/* ─── Extra Packages ─── */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => toggleSection('packages')}
          className="w-full flex items-center gap-2 px-3 py-2.5 bg-surface-panel hover:bg-surface-hover transition-colors"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
              openSection === 'packages' ? 'rotate-90' : ''
            }`}
          />
          <span className="text-xs font-semibold text-foreground">
            Extra Packages
          </span>
          {customization.extraPackages.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              ({customization.extraPackages.length})
            </span>
          )}
        </button>
        {openSection === 'packages' && (
          <div className="px-3 py-3 border-t border-border space-y-3">
            <div className="flex items-center justify-end">
              <div className="relative">
                <button
                  onClick={() => setShowPackageDropdown(!showPackageDropdown)}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  Add suggested
                  <ChevronDown className="h-3 w-3" />
                </button>
                {showPackageDropdown && (
                  <div className="absolute right-0 top-full mt-1 w-64 bg-card border border-border rounded-lg shadow-lg z-10 max-h-64 overflow-y-auto">
                    {SUGGESTED_PACKAGES.map((category) => (
                      <div key={category.category}>
                        <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground bg-surface-panel border-b border-border">
                          {category.category}
                        </div>
                        {category.packages.map((pkg) => {
                          const isAdded = customization.extraPackages.some(
                            (p) => p.name === pkg.name,
                          );
                          return (
                            <button
                              key={pkg.name}
                              onClick={() =>
                                !isAdded && handleAddSuggestedPackage(pkg)
                              }
                              disabled={isAdded}
                              className={`w-full px-3 py-1.5 text-left text-xs flex items-center justify-between ${
                                isAdded
                                  ? 'text-muted-foreground bg-surface-panel'
                                  : 'text-foreground hover:bg-surface-hover'
                              }`}
                            >
                              <span className="font-mono">{pkg.name}</span>
                              {isAdded && (
                                <Check className="h-3 w-3 text-green-500" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {customization.extraPackages.length > 0 ? (
              <div className="space-y-1">
                {customization.extraPackages.map((pkg) => (
                  <div
                    key={pkg.name}
                    className="flex items-center justify-between px-3 py-1.5 bg-surface-panel border border-border rounded"
                  >
                    <div className="flex items-center gap-2">
                      <Package className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs font-mono text-foreground">
                        {pkg.name}
                      </span>
                      {pkg.dev && (
                        <span className="text-[10px] px-1 py-0.5 bg-amber-500/10 text-amber-600 rounded">
                          dev
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() =>
                        removeExtraPackage(selectedArchetype, pkg.name)
                      }
                      className="p-1 text-muted-foreground hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No extra packages. Add from suggestions above or enter a custom
                package below.
              </p>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                value={customPackage}
                onChange={(e) => setCustomPackage(e.target.value)}
                onKeyDown={(e) =>
                  e.key === 'Enter' && handleAddCustomPackage()
                }
                placeholder="package-name"
                className="flex-1 px-2 py-1.5 text-xs font-mono bg-surface-panel border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={customPackageDev}
                  onChange={(e) => setCustomPackageDev(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary"
                />
                dev
              </label>
              <button
                onClick={handleAddCustomPackage}
                disabled={!customPackage.trim()}
                className="px-2 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Reset + info ─── */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={() => {
            resetArchetype(selectedArchetype);
            closeFile();
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded hover:bg-surface-hover transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Reset to defaults
        </button>
      </div>

      <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
        <p className="text-[11px] text-blue-600 dark:text-blue-400">
          These settings apply when Code Scout creates new projects. Click any
          file above to view and edit its template content. Modified files are
          highlighted in amber.
        </p>
      </div>
    </div>
  );
};

export default ScaffoldSettings;
