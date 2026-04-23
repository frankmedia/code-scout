/**
 * scaffoldStore — user customizations for project scaffolds.
 *
 * Allows users to add extra packages, toggle features, and override defaults
 * for each scaffold archetype (Next.js, React+Vite, Vue, etc.)
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ScaffoldPackage {
  name: string;
  dev: boolean;
}

export interface ScaffoldCustomization {
  /** Extra packages to add beyond the defaults */
  extraPackages: ScaffoldPackage[];
  /** Whether to include Tailwind CSS (default: true) */
  includeTailwind: boolean;
  /** Whether to use TypeScript strict mode (default: true) */
  strictTypeScript: boolean;
  /** Custom CSS content to append to globals.css */
  customCss: string;
  /** Per-file content overrides keyed by file path */
  fileOverrides: Record<string, string>;
}

export interface ScaffoldStoreState {
  /** Per-archetype customizations keyed by archetype id */
  customizations: Record<string, Partial<ScaffoldCustomization>>;

  /** Get merged customization for an archetype (defaults + user overrides) */
  getCustomization: (archetypeId: string) => ScaffoldCustomization;

  /** Update customization for an archetype */
  setCustomization: (archetypeId: string, patch: Partial<ScaffoldCustomization>) => void;

  /** Add an extra package to an archetype */
  addExtraPackage: (archetypeId: string, pkg: ScaffoldPackage) => void;

  /** Remove an extra package from an archetype */
  removeExtraPackage: (archetypeId: string, packageName: string) => void;

  /** Set a file override for a specific archetype + path */
  setFileOverride: (archetypeId: string, filePath: string, content: string) => void;

  /** Remove a file override (revert to default) */
  removeFileOverride: (archetypeId: string, filePath: string) => void;

  /** Reset an archetype to defaults */
  resetArchetype: (archetypeId: string) => void;

  /** Reset all customizations */
  resetAll: () => void;
}

const DEFAULT_CUSTOMIZATION: ScaffoldCustomization = {
  extraPackages: [],
  includeTailwind: true,
  strictTypeScript: true,
  customCss: '',
  fileOverrides: {},
};

export const useScaffoldStore = create<ScaffoldStoreState>()(
  persist(
    (set, get) => ({
      customizations: {},

      getCustomization: (archetypeId: string): ScaffoldCustomization => {
        const custom = get().customizations[archetypeId] ?? {};
        return {
          ...DEFAULT_CUSTOMIZATION,
          ...custom,
          extraPackages: custom.extraPackages ?? DEFAULT_CUSTOMIZATION.extraPackages,
          fileOverrides: custom.fileOverrides ?? DEFAULT_CUSTOMIZATION.fileOverrides,
        };
      },

      setCustomization: (archetypeId: string, patch: Partial<ScaffoldCustomization>) => {
        set(state => ({
          customizations: {
            ...state.customizations,
            [archetypeId]: {
              ...state.customizations[archetypeId],
              ...patch,
            },
          },
        }));
      },

      addExtraPackage: (archetypeId: string, pkg: ScaffoldPackage) => {
        set(state => {
          const current = state.customizations[archetypeId]?.extraPackages ?? [];
          if (current.some(p => p.name === pkg.name)) return state;
          return {
            customizations: {
              ...state.customizations,
              [archetypeId]: {
                ...state.customizations[archetypeId],
                extraPackages: [...current, pkg],
              },
            },
          };
        });
      },

      removeExtraPackage: (archetypeId: string, packageName: string) => {
        set(state => {
          const current = state.customizations[archetypeId]?.extraPackages ?? [];
          return {
            customizations: {
              ...state.customizations,
              [archetypeId]: {
                ...state.customizations[archetypeId],
                extraPackages: current.filter(p => p.name !== packageName),
              },
            },
          };
        });
      },

      setFileOverride: (archetypeId: string, filePath: string, content: string) => {
        set(state => {
          const current = state.customizations[archetypeId] ?? {};
          return {
            customizations: {
              ...state.customizations,
              [archetypeId]: {
                ...current,
                fileOverrides: {
                  ...(current.fileOverrides ?? {}),
                  [filePath]: content,
                },
              },
            },
          };
        });
      },

      removeFileOverride: (archetypeId: string, filePath: string) => {
        set(state => {
          const current = state.customizations[archetypeId] ?? {};
          const { [filePath]: _, ...rest } = current.fileOverrides ?? {};
          return {
            customizations: {
              ...state.customizations,
              [archetypeId]: {
                ...current,
                fileOverrides: rest,
              },
            },
          };
        });
      },

      resetArchetype: (archetypeId: string) => {
        set(state => {
          const { [archetypeId]: _, ...rest } = state.customizations;
          return { customizations: rest };
        });
      },

      resetAll: () => {
        set({ customizations: {} });
      },
    }),
    {
      name: 'code-scout-scaffolds',
      version: 1,
    }
  )
);

/** Common packages that users might want to add */
export const SUGGESTED_PACKAGES: { category: string; packages: ScaffoldPackage[] }[] = [
  {
    category: 'Animation',
    packages: [
      { name: 'framer-motion', dev: false },
      { name: '@formkit/auto-animate', dev: false },
    ],
  },
  {
    category: 'Icons',
    packages: [
      { name: 'lucide-react', dev: false },
      { name: '@heroicons/react', dev: false },
      { name: 'react-icons', dev: false },
    ],
  },
  {
    category: 'Forms',
    packages: [
      { name: 'react-hook-form', dev: false },
      { name: 'zod', dev: false },
      { name: '@hookform/resolvers', dev: false },
    ],
  },
  {
    category: 'State',
    packages: [
      { name: 'zustand', dev: false },
      { name: 'jotai', dev: false },
      { name: '@tanstack/react-query', dev: false },
    ],
  },
  {
    category: 'UI Components',
    packages: [
      { name: '@radix-ui/react-dialog', dev: false },
      { name: '@radix-ui/react-dropdown-menu', dev: false },
      { name: '@radix-ui/react-tooltip', dev: false },
      { name: 'sonner', dev: false },
    ],
  },
  {
    category: 'Date/Time',
    packages: [
      { name: 'date-fns', dev: false },
      { name: 'dayjs', dev: false },
    ],
  },
];
