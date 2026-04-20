/**
 * ScaffoldSettings — UI for customizing project scaffold templates.
 */

import { useState } from 'react';
import { Plus, Trash2, Package, RefreshCw, ChevronDown, Check } from 'lucide-react';
import {
  useScaffoldStore,
  SUGGESTED_PACKAGES,
  type ScaffoldPackage,
} from '@/store/scaffoldStore';

const ARCHETYPES = [
  { id: 'nextjs', label: 'Next.js + TypeScript + Tailwind' },
  { id: 'react-vite-ts', label: 'React + Vite + TypeScript + Tailwind' },
  { id: 'vue-vite-ts', label: 'Vue + Vite + TypeScript + Tailwind' },
] as const;

type ArchetypeId = typeof ARCHETYPES[number]['id'];

const ScaffoldSettings = () => {
  const [selectedArchetype, setSelectedArchetype] = useState<ArchetypeId>('nextjs');
  const [showPackageDropdown, setShowPackageDropdown] = useState(false);
  const [customPackage, setCustomPackage] = useState('');
  const [customPackageDev, setCustomPackageDev] = useState(false);

  const {
    getCustomization,
    setCustomization,
    addExtraPackage,
    removeExtraPackage,
    resetArchetype,
  } = useScaffoldStore();

  const customization = getCustomization(selectedArchetype);

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

  return (
    <div className="space-y-5">
      {/* Archetype selector */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-2">
          Framework Template
        </label>
        <div className="flex flex-wrap gap-2">
          {ARCHETYPES.map(arch => (
            <button
              key={arch.id}
              onClick={() => setSelectedArchetype(arch.id)}
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

      {/* Feature toggles */}
      <div>
        <h3 className="text-xs font-semibold text-foreground mb-3">Features</h3>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={customization.includeTailwind}
              onChange={e => setCustomization(selectedArchetype, { includeTailwind: e.target.checked })}
              className="rounded border-border text-primary focus:ring-primary"
            />
            <span className="text-xs text-foreground">Include Tailwind CSS</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={customization.strictTypeScript}
              onChange={e => setCustomization(selectedArchetype, { strictTypeScript: e.target.checked })}
              className="rounded border-border text-primary focus:ring-primary"
            />
            <span className="text-xs text-foreground">TypeScript strict mode</span>
          </label>
        </div>
      </div>

      {/* Extra packages */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-foreground">Extra Packages</h3>
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
                {SUGGESTED_PACKAGES.map(category => (
                  <div key={category.category}>
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground bg-surface-panel border-b border-border">
                      {category.category}
                    </div>
                    {category.packages.map(pkg => {
                      const isAdded = customization.extraPackages.some(p => p.name === pkg.name);
                      return (
                        <button
                          key={pkg.name}
                          onClick={() => !isAdded && handleAddSuggestedPackage(pkg)}
                          disabled={isAdded}
                          className={`w-full px-3 py-1.5 text-left text-xs flex items-center justify-between ${
                            isAdded
                              ? 'text-muted-foreground bg-surface-panel'
                              : 'text-foreground hover:bg-surface-hover'
                          }`}
                        >
                          <span className="font-mono">{pkg.name}</span>
                          {isAdded && <Check className="h-3 w-3 text-green-500" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Current extra packages */}
        {customization.extraPackages.length > 0 ? (
          <div className="space-y-1 mb-3">
            {customization.extraPackages.map(pkg => (
              <div
                key={pkg.name}
                className="flex items-center justify-between px-3 py-1.5 bg-surface-panel border border-border rounded"
              >
                <div className="flex items-center gap-2">
                  <Package className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs font-mono text-foreground">{pkg.name}</span>
                  {pkg.dev && (
                    <span className="text-[10px] px-1 py-0.5 bg-amber-500/10 text-amber-600 rounded">
                      dev
                    </span>
                  )}
                </div>
                <button
                  onClick={() => removeExtraPackage(selectedArchetype, pkg.name)}
                  className="p-1 text-muted-foreground hover:text-red-500 transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mb-3">
            No extra packages. Add from suggestions above or enter a custom package below.
          </p>
        )}

        {/* Custom package input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={customPackage}
            onChange={e => setCustomPackage(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddCustomPackage()}
            placeholder="package-name"
            className="flex-1 px-2 py-1.5 text-xs font-mono bg-surface-panel border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={customPackageDev}
              onChange={e => setCustomPackageDev(e.target.checked)}
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

      {/* Reset */}
      <div className="pt-3 border-t border-border">
        <button
          onClick={() => resetArchetype(selectedArchetype)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded hover:bg-surface-hover transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Reset {ARCHETYPES.find(a => a.id === selectedArchetype)?.label} to defaults
        </button>
      </div>

      {/* Info */}
      <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
        <p className="text-[11px] text-blue-600 dark:text-blue-400">
          These settings apply when Code Scout creates new projects from scratch.
          Extra packages will be added to <code className="px-1 bg-blue-500/10 rounded">package.json</code> automatically.
        </p>
      </div>
    </div>
  );
};

export default ScaffoldSettings;
