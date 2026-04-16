# Code Scout — Project Structure
> Auto-generated on 2026-04-15T16:51:07.112Z — structural overview (~19646 tokens)

// src/components/auth/LoginGate.tsx
imports: react, lucide-react, @/store/authStore, @/components/auth/PreAuthScreens, @/config/preAuthFlow
function readPreAuthDone(): boolean
function reconcilePreAuthFlowVersion(): void
function phaseAfterReconcile(): 'step1' | 'step2' | 'auth'
export function LoginGate({ children }: { children: ReactNode })
function AuthScreen({ onBack }: { onBack: ()
const handleSubmit = (...)
exports: LoginGate

// src/components/auth/PreAuthScreens.tsx
imports: react, lucide-react
function PreAuthChrome({ children }: { children: ReactNode })
function StepDots({ step }: { step: 1 | 2 })
export function PreAuthStepOne({ onNext }: { onNext: ()
export function PreAuthStepTwo({ onContinue }: { onContinue: ()
exports: PreAuthStepOne, PreAuthStepTwo

// src/components/marketing/CodeScoutScreenshotGallery.tsx
imports: react, @/lib/utils
type CarouselApi,
type CodeScoutGallerySlide,
type GalleryVariant = "standalone" | "hero";
function GallerySlide({ slide }: { slide: CodeScoutGallerySlide })
function EmptyGalleryHint({ compact }: { compact?: boolean })
export function CodeScoutScreenshotGallery({ variant = "standalone" }: { variant?: GalleryVariant })
const onSelect = (...)
exports: CodeScoutScreenshotGallery

// src/components/ui/accordion.tsx
imports: react, @radix-ui/react-accordion, lucide-react, @/lib/utils
exports: Accordion, AccordionItem, AccordionTrigger, AccordionContent

// src/components/ui/alert-dialog.tsx
imports: react, @radix-ui/react-alert-dialog, @/lib/utils, @/components/ui/button
const AlertDialogHeader = (...)
const AlertDialogFooter = (...)

// src/components/ui/alert.tsx
imports: react, class-variance-authority, @/lib/utils
exports: Alert, AlertTitle, AlertDescription

// src/components/ui/aspect-ratio.tsx
imports: @radix-ui/react-aspect-ratio
exports: AspectRatio

// src/components/ui/avatar.tsx
imports: react, @radix-ui/react-avatar, @/lib/utils
exports: Avatar, AvatarImage, AvatarFallback

// src/components/ui/badge.tsx
imports: react, class-variance-authority, @/lib/utils
export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants>
function Badge({ className, variant, ...props }: BadgeProps)
exports: BadgeProps, Badge, badgeVariants

// src/components/ui/breadcrumb.tsx
imports: react, @radix-ui/react-slot, lucide-react, @/lib/utils
const BreadcrumbSeparator = (...)
const BreadcrumbEllipsis = (...)

// src/components/ui/button.tsx
imports: react, @radix-ui/react-slot, class-variance-authority, @/lib/utils
export interface ButtonProps
exports: ButtonProps, Button, buttonVariants

// src/components/ui/calendar.tsx
imports: react, lucide-react, react-day-picker, @/lib/utils, @/components/ui/button
export type CalendarProps = React.ComponentProps<typeof DayPicker>;
function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps)
exports: CalendarProps, Calendar

// src/components/ui/card.tsx
imports: react, @/lib/utils
exports: Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent

// src/components/ui/carousel.tsx
imports: react, embla-carousel-react, lucide-react, @/lib/utils, @/components/ui/button
type CarouselApi = UseEmblaCarouselType[1];
type UseCarouselParameters = Parameters<typeof useEmblaCarousel>;
type CarouselOptions = UseCarouselParameters[0];
type CarouselPlugin = UseCarouselParameters[1];
type CarouselProps
type CarouselContextProps
function useCarousel()
exports: CarouselApi, Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext

// src/components/ui/chart.tsx
imports: react, recharts, @/lib/utils
export type ChartConfig
type ChartContextProps
function useChart()
const ChartStyle = (...)
function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string)
exports: ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, ChartStyle

// src/components/ui/checkbox.tsx
imports: react, @radix-ui/react-checkbox, lucide-react, @/lib/utils
exports: Checkbox

// src/components/ui/collapsible.tsx
imports: @radix-ui/react-collapsible
exports: Collapsible, CollapsibleTrigger, CollapsibleContent

// src/components/ui/command.tsx
imports: react, @radix-ui/react-dialog, cmdk, lucide-react, @/lib/utils, @/components/ui/dialog
interface CommandDialogProps extends DialogProps
const CommandDialog = (...)
const CommandShortcut = (...)

// src/components/ui/context-menu.tsx
imports: react, @radix-ui/react-context-menu, lucide-react, @/lib/utils
const ContextMenuShortcut = (...)

// src/components/ui/dialog.tsx
imports: react, @radix-ui/react-dialog, lucide-react, @/lib/utils
const DialogHeader = (...)
const DialogFooter = (...)

// src/components/ui/drawer.tsx
imports: react, vaul, @/lib/utils
const Drawer = (...)
const DrawerHeader = (...)
const DrawerFooter = (...)

// src/components/ui/dropdown-menu.tsx
imports: react, @radix-ui/react-dropdown-menu, lucide-react, @/lib/utils
const DropdownMenuShortcut = (...)

// src/components/ui/form.tsx
imports: react, @radix-ui/react-label, @radix-ui/react-slot, react-hook-form, @/lib/utils, @/components/ui/label
type FormFieldContextValue<
type FormItemContextValue
const useFormField = (...)
exports: useFormField, Form, FormItem, FormLabel, FormControl, FormDescription, FormMessage, FormField

// src/components/ui/hover-card.tsx
imports: react, @radix-ui/react-hover-card, @/lib/utils
exports: HoverCard, HoverCardTrigger, HoverCardContent

// src/components/ui/input-otp.tsx
imports: react, input-otp, lucide-react, @/lib/utils
exports: InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator

// src/components/ui/input.tsx
imports: react, @/lib/utils
exports: Input

// src/components/ui/label.tsx
imports: react, @radix-ui/react-label, class-variance-authority, @/lib/utils
exports: Label

// src/components/ui/menubar.tsx
imports: react, @radix-ui/react-menubar, lucide-react, @/lib/utils
const MenubarShortcut = (...)

// src/components/ui/pagination.tsx
imports: react, lucide-react, @/lib/utils, @/components/ui/button
type PaginationLinkProps
const Pagination = (...)
const PaginationLink = (...)
const PaginationPrevious = (...)
const PaginationNext = (...)
const PaginationEllipsis = (...)

// src/components/ui/popover.tsx
imports: react, @radix-ui/react-popover, @/lib/utils
exports: Popover, PopoverTrigger, PopoverContent

// src/components/ui/progress.tsx
imports: react, @radix-ui/react-progress, @/lib/utils
exports: Progress

// src/components/ui/radio-group.tsx
imports: react, @radix-ui/react-radio-group, lucide-react, @/lib/utils
exports: RadioGroup, RadioGroupItem

// src/components/ui/resizable.tsx
imports: lucide-react, react-resizable-panels, @/lib/utils
const ResizablePanelGroup = (...)
const ResizableHandle = Component
exports: ResizablePanelGroup, ResizablePanel, ResizableHandle

// src/components/ui/scroll-area.tsx
imports: react, @radix-ui/react-scroll-area, @/lib/utils
exports: ScrollArea, ScrollBar

// src/components/ui/separator.tsx
imports: react, @radix-ui/react-separator, @/lib/utils
exports: Separator

// src/components/ui/sheet.tsx
imports: @radix-ui/react-dialog, class-variance-authority, lucide-react, react, @/lib/utils
interface SheetContentProps
const SheetHeader = (...)
const SheetFooter = (...)

// src/components/ui/sidebar.tsx
imports: react, @radix-ui/react-slot, class-variance-authority, lucide-react, @/hooks/use-mobile, @/lib/utils, @/components/ui/button, @/components/ui/input, @/components/ui/separator, @/components/ui/sheet, @/components/ui/skeleton, @/components/ui/tooltip
type SidebarContext
function useSidebar()
const handleKeyDown = (...)

// src/components/ui/skeleton.tsx
imports: @/lib/utils
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>)
exports: Skeleton

// src/components/ui/slider.tsx
imports: react, @radix-ui/react-slider, @/lib/utils
exports: Slider

// src/components/ui/sonner.tsx
imports: next-themes, sonner
type ToasterProps = React.ComponentProps<typeof Sonner>;
const Toaster = (...)
exports: Toaster, toast

// src/components/ui/switch.tsx
imports: react, @radix-ui/react-switch, @/lib/utils
exports: Switch

// src/components/ui/table.tsx
imports: react, @/lib/utils
exports: Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption

// src/components/ui/tabs.tsx
imports: react, @radix-ui/react-tabs, @/lib/utils
exports: Tabs, TabsList, TabsTrigger, TabsContent

// src/components/ui/textarea.tsx
imports: react, @/lib/utils
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement>
exports: TextareaProps, Textarea

// src/components/ui/toast.tsx
imports: react, @radix-ui/react-toast, class-variance-authority, lucide-react, @/lib/utils
type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;
type ToastActionElement = React.ReactElement<typeof ToastAction>;
type ToastProps,
type ToastActionElement,

// src/components/ui/toaster.tsx
imports: @/hooks/use-toast, @/components/ui/toast
export function Toaster()
exports: Toaster

// src/components/ui/toggle-group.tsx
imports: react, @radix-ui/react-toggle-group, class-variance-authority, @/lib/utils, @/components/ui/toggle
exports: ToggleGroup, ToggleGroupItem

// src/components/ui/toggle.tsx
imports: react, @radix-ui/react-toggle, class-variance-authority, @/lib/utils
exports: Toggle, toggleVariants

// src/components/ui/tooltip.tsx
imports: react, @radix-ui/react-tooltip, @/lib/utils
exports: Tooltip, TooltipTrigger, TooltipContent, TooltipProvider

// src/components/ui/use-toast.ts
imports: @/hooks/use-toast
exports: useToast, toast

// src/components/workbench/ai/AIPanelUtils.ts
imports: @/store/modelStore, @/store/workbenchStoreTypes, @/utils/activityLineNormalize
export type PendingImage
export type PendingTextFile
export type PendingAttachment =
export type ActivityItem =
export function inferWorkbenchAgentRole(status: string, history: string[]): 'coder' | 'orchestrator'
export function providerSupportsNativeTools(provider: ModelProvider): boolean
export function visionAllowedForProvider(p: ModelProvider): boolean
export const formatTokenCount = (...)
export function isTextFile(file: File): boolean
export function readFileAsAttachment(file: File): Promise<PendingImage>
export function readTextFileAsAttachment(file: File): Promise<PendingTextFile>
export function detectStreamProgress(content: string): string
export function extractStepCount(text: string): number
export function extractTokPerSec(text: string): string | null
export function activityIcon(text: string): string
export function fmtElapsed(ms: number): string
export function fmtElapsedExact(ms: number): string
constants: export MAX_TOOL_ROUNDS, export MAX_ATTACHMENTS, export MAX_IMAGE_BYTES, export MAX_TEXT_FILE_BYTES, export modeOptions, export AGENT_META, export ACTIVITY_ICONS
exports: MAX_TOOL_ROUNDS, MAX_ATTACHMENTS, MAX_IMAGE_BYTES, MAX_TEXT_FILE_BYTES, modeOptions, AGENT_META, inferWorkbenchAgentRole, providerSupportsNativeTools, visionAllowedForProvider, formatTokenCount, PendingImage, PendingTextFile, PendingAttachment, isTextFile, readFileAsAttachment, readTextFileAsAttachment, detectStreamProgress, ActivityItem, ACTIVITY_ICONS, extractStepCount, extractTokPerSec, activityIcon, fmtElapsed, fmtElapsedExact

// src/components/workbench/ai/ContextBar.tsx
imports: react
export interface ContextBarProps
function formatTokenCount(n: number): string
export function ContextBar({ used, limit, onNewChat, titleDetail }: ContextBarProps)
exports: ContextBarProps, ContextBar

// src/components/workbench/ai/TokenStatusStrip.tsx
imports: react
export interface AgentTokenCounts
export interface TokenStatusStripProps
function formatTokenCount(n: number): string
exports: AgentTokenCounts, TokenStatusStripProps

// src/components/workbench/AgentActivityFeed.tsx
imports: react, @tanstack/react-virtual, sonner, @/utils/activityLineNormalize
type LineKind
interface ParsedLine
type FocusFilter = 'all' | 'orch' | 'coder';
interface AgentActivityFeedProps
function classifyLine(text: string): ParsedLine
function shouldDimParsed(line: ParsedLine, filter: FocusFilter): boolean
function RoleTag({ role }: { role: 'orchestrator' | 'coder' })
function ToolBadge({ name }: { name: string })
function extractToolNames(text: string): string[]
function extractProseQuote(text: string): string | null
function stripRolePrefix(text: string): string
function FeedLine({ line }: { line: ParsedLine })
function ProgressRing({ current, max, size = 32 }: { current: number; max: number; size?: number })

// src/components/workbench/AgentHeartbeatPopover.tsx
imports: react, @/components/ui/slider, @/components/ui/switch, @/store/modelStore, @/lib/utils
type SliderRowProps
type SectionProps
interface AgentHeartbeatPopoverProps
function SliderRow({ label, hint, value, min, max, step, format, onValueChange }: SliderRowProps)
function Section({ title, icon, accent, children }: SectionProps)
export function AgentHeartbeatPopover({ onOpenModelSettings }: AgentHeartbeatPopoverProps)
exports: AgentHeartbeatPopover

// src/components/workbench/AgentStatusPanel.tsx
imports: lucide-react
export type AgentPhase = 'inspect' | 'code' | 'verify' | 'done' | 'idle';
interface AgentStatusPanelProps
function phaseIndex(phase: AgentPhase): number
export function inferPhaseFromStatus(status: string): AgentPhase
export function AgentStatusPanel({ phase, stepCurrent, stepTotal }: AgentStatusPanelProps)
exports: AgentPhase, inferPhaseFromStatus, AgentStatusPanel

// src/components/workbench/AIPanel.tsx
imports: react, lucide-react, @/store/workbenchStore, @/store/modelStore, @/store/chatHistoryStore, @/services/chatApiMessages, @/services/chatTools, @/services/planGenerator, @/services/orchestrator, @/services/agentExecutor, @/services/memoryManager, @/services/installTracker, @/services/environmentProbe, @/store/projectMemoryStore, @/services/contextCompressor, @/store/agentMemoryStore, @/lib/tauri, @/config/modelVisionHeuristics, ./ChatMarkdown, ./ChatToolInvocations, ./ChatPlanCard, ./EscalationDialog
type CallModelDoneMeta,
type PendingImage
type PendingTextFile
type PendingAttachment =
type ActivityItem =
type SendFlow = 'plan' | 'chat_orchestrator' | 'chat_coder';
type PrepareSendResult
export const ProviderIcon = Component
function providerSupportsNativeTools(provider: ModelProvider): boolean
const AgentLabel = (...)
const formatTokenCount = (...)
const ModelDropdown = (...)
const handler = (...)
function isTextFile(file: File): boolean
function readFileAsAttachment(file: File): Promise<PendingImage>
function readTextFileAsAttachment(file: File): Promise<PendingTextFile>
function visionAllowedForProvider(p: ModelProvider): boolean
function detectStreamProgress(content: string): string
function extractStepCount(text: string): number
function extractTokPerSec(text: string): string | null
function activityIcon(text: string): string
function fmtElapsed(ms: number): string
const PlanActivityFeed = Component
const AIPanel = (...)
const handlePaste = (...)
const getActiveModel = (...)
const handlePickFiles = (...)
const removePendingImage = (...)
const removePendingTextFile = (...)
const beginChatStream = (...)
const handleStop = (...)
const prepareSendPayload = (...)
const clearComposerAfterSend = (...)
const handleSend = (...)
const handlePlanGeneration = (...)
const mockWalk = (...)
const flat = (...)
const walk = (...)
const handleMockChat = (...)
const onTokensFromStream = (...)
const onDone = (...)
const onTokensFromStream = (...)
const onDone = (...)
const fakePlanDelay = (...)
exports: ProviderIcon, default(AIPanel)

// src/components/workbench/BenchmarkLeaderboard.tsx
imports: react, react, @/services/benchmarkScorer, @/types/benchmark, @/store/modelStore, @/services/modelApi
type TaskType = 'coding' | 'refactoring' | 'debugging' | 'reasoning' | 'research';
interface Props
function scoreColor(score: number): string
function scoreBarColor(score: number): string
function ScoreBar({ label, raw, skipped }: { label: string; raw: number; skipped?: boolean })
function ModelRadar({ score }: { score: ModelBenchmarkScore })
function DeltaBadge({ delta }: { delta: number })
function FunctionalTestDetails({ results }: { results: FunctionalResult })
function ErrorBanner({ run }: { run: BenchmarkRun })
function baseUrlForModel(configId: string, fromResult?: string): string
function SummaryStats({ run, previousRun }: { run: BenchmarkRun; previousRun?: BenchmarkRun })
const BenchmarkLeaderboard = (...)
exports: default(BenchmarkLeaderboard)

// src/components/workbench/BenchmarkPanel.tsx
imports: react, react, @/types/benchmark, @/store/benchmarkStore, @/store/modelStore, @/services/benchmarkTests, @/components/workbench/BenchmarkLeaderboard, @/types/benchmark
type TabView = 'setup' | 'results';
class BenchmarkErrorBoundary
function StatusCell({ status }: { status: TestRunStatus | undefined })
const wrap = (...)
function label(run: BenchmarkRun, i: number)
const BenchmarkPanel = (...)
const handleSelectAllModels = (...)
const handleClearModels = (...)
const handleSelectAllTests = (...)
const handleClearTests = (...)
const handleToggleModel = (...)
const handleToggleTest = (...)
const handleStart = (...)
exports: default(BenchmarkPanel)

// src/components/workbench/ChatMarkdown.tsx
imports: react, react-markdown, lucide-react, @/store/workbenchStore, @/store/agentMemoryStore, @/lib/tauri, @/utils/shellSnippet
function parseShellBlock(children: React.ReactNode)
function ShellCodeBlock({ code, languageClass }: { code: string; languageClass: string })
function PreWithShell({ children }: { children?: React.ReactNode })
export function ChatMarkdown({ content }: { content: string })
exports: ChatMarkdown

// src/components/workbench/ChatPlanCard.tsx
imports: react, @/store/workbenchStore, @/store/modelStore, @/services/orchestrator, @/services/modelApi
function StepIcon({ status }: { status: PlanStep['status'] })
export function ChatPlanCard()
const toggleSkip = (...)
exports: ChatPlanCard

// src/components/workbench/ChatToolInvocations.tsx
imports: react, lucide-react, @/store/workbenchStore, @/store/workbenchStore, @/lib/tauri, @/store/agentMemoryStore, @/store/agentMemoryStore, @/store/workbenchStore
type Props
function flattenFilePaths(nodes: FileNode[])
function resolveEffectiveProjectRoot(projectPath: string, files: FileNode[]): string
export function ChatToolInvocations({ messageId, invocations, onChainMaybeContinue }: Props)
const settle = (...)
exports: ChatToolInvocations

// src/components/workbench/EditorPanel.tsx
imports: lucide-react, @monaco-editor/react, @/store/workbenchStore
const findFile = (...)
const EditorPanel = (...)
exports: default(EditorPanel)

// src/components/workbench/EscalationDialog.tsx
imports: react, lucide-react, @/store/taskStore
export function EscalationDialog()
const handleContinue = (...)
const handleOrchestratorReplan = (...)
const handleHint = (...)
const handleSkip = (...)
const handleStop = (...)
exports: EscalationDialog

// src/components/workbench/FileTree.tsx
imports: react, lucide-react, @/store/workbenchStore, @/store/projectMemoryStore, @/services/memoryManager
type ChangeType = 'created' | 'edited' | null;
const FileIcon = (...)
function filterFileTree(nodes: FileNode[], query: string): FileNode[]
const selfMatch = (...)
const walk = (...)
const TreeNode = (...)
const handleRollback = (...)
const FileTree = (...)
exports: default(FileTree)

// src/components/workbench/GitStatusBar.tsx
imports: react, lucide-react, @/store/gitStore, @/store/workbenchStore, @/services/gitService, @/lib/tauri
const GitStatusBar = (...)
const handlePush = (...)
exports: default(GitStatusBar)

// src/components/workbench/GitSyncPanel.tsx
imports: react, @/store/gitStore, @/store/workbenchStore, @/services/gitService, @/lib/tauri, @/store/workbenchStore
interface GitSyncPanelProps
function resolveProjectRoot(path: string, files: FileNode[]): string
const GitSyncPanel = (...)
const handler = (...)
const handleConnect = (...)
const handleDisconnect = (...)
const handleCreateRepo = (...)
const handleSync = (...)
const handleRefresh = (...)
exports: default(GitSyncPanel)

// src/components/workbench/LogsView.tsx
imports: @/store/workbenchStore
const LogsView = (...)
exports: default(LogsView)

// src/components/workbench/ModelActivitiesTab.tsx
imports: react, lucide-react, @/lib/utils
function formatK(n: number): string
export function ModelActivitiesTab()
exports: ModelActivitiesTab

// src/components/workbench/ModelDiscovery.tsx
imports: react, lucide-react, ./AIPanel, @/config/llmNetworkDefaults, @/services/discoveryFetch, @/store/modelStore
interface DiscoveredModel
interface RunningLlamaServer
interface GgufFile
function filterModelsByQuery(items: T[], query: string): T[]
const RoleSelect = Component
const DiscoveredModelRow = (...)
const handleRoleChange = (...)
const handleSelect = (...)
const toggleSelection = (...)
function formatGgufName(filename: string): string
function fmtBytes(b: number): string
function hostFromLlamaBaseUrl(url: string): string
function llamaPortsForScan(baseUrl: string): number[]
function probeLlamaServer(host: string, port: number): Promise<RunningLlamaServer | null>
const LlamaCppSection = (...)
const handleScanServers = (...)
const handleScanFiles = (...)
const addServer = (...)
const addGguf = (...)
const ModelRow = Component
const normEp = (...)
const toggle = (...)
const LocalServerSection = Component
const handleDiscover = (...)
const CloudProviderSection = Component
const handleDiscover = (...)
const handleAddStatic = (...)
const LlamaCppRunHelp = (...)
const ModelDiscovery = (...)
exports: default(ModelDiscovery)

// src/components/workbench/ModelSettings.tsx
imports: react, lucide-react, ./AIPanel, @/config/llmNetworkDefaults, @/config/modelContextDefaults, @/config/modelVisionHeuristics, ./ModelDiscovery
interface ModelFormData
type SettingsTab = 'discover' | 'models';
const needsApiKey = (...)
const ModelForm = Component
const update = (...)
const handleProviderChange = (...)
const ModelCard = (...)
const ModelSettings = (...)
const handleAdd = (...)
const handleEdit = (...)
exports: default(ModelSettings)

// src/components/workbench/PlanTabPanel.tsx
imports: react, @/store/workbenchStore, @/store/modelStore, @/services/orchestrator
function StepStatusIcon({ status }: { status: PlanStep['status'] })
const PlanTabPanel = (...)
const toggleSkip = (...)
const handleExecute = (...)
const handleReject = (...)
const handleRollback = (...)
exports: default(PlanTabPanel)

// src/components/workbench/SessionSidebar.tsx
imports: react, lucide-react, @/store/chatHistoryStore, @/store/workbenchStore, @/store/projectStore
function timeAgo(timestamp: number): string
const SessionSidebar = (...)
const handleNewChat = (...)
const handleLoadChat = (...)
const handleRenameStart = (...)
const handleRenameConfirm = (...)
const handleRenameCancel = (...)
const handleDelete = (...)
exports: default(SessionSidebar)

// src/components/workbench/TerminalPanel.tsx
imports: react, lucide-react, @/store/workbenchStore, @/lib/tauri
function resolveProjectRoot(path: string, files: FileNode[]): string
const TerminalPanel = (...)
const handleSubmit = (...)
const handleKeyDown = (...)
exports: default(TerminalPanel)

// src/components/workbench/TopBar.tsx
imports: react, lucide-react, @/hooks/useTheme, @/store/modelStore, @/store/taskStore, @/store/gitStore, @/store/workbenchStore, @/store/projectStore, @/services/modelApi, @/services/gitService, @/lib/tauri, @/components/CodeScoutLogo, @/components/workbench/GitStatusBar, @/components/workbench/GitSyncPanel
type ConnectionStatus = 'checking' | 'connected' | 'disconnected';
const TopBar = (...)
const checkPrimary = (...)
exports: default(TopBar)

// src/components/AppMessageBanner.tsx
imports: react, lucide-react
interface BannerData
const BANNER_URL = Component
function getColors(color?: string)
function isBlockedBannerMessage(msg: string): boolean
export function AppMessageBanner()
const handleDismiss = (...)
exports: AppMessageBanner

// src/components/CodeScoutLogo.tsx
interface CodeScoutLogoProps
const CodeScoutLogo = (...)
exports: default(CodeScoutLogo)

// src/components/NavLink.tsx
imports: react-router-dom, react, @/lib/utils
interface NavLinkCompatProps
exports: NavLink

// src/components/UpdateBanner.tsx
imports: react, lucide-react
interface UpdateCheckResult
type UpdateStage = 'checking' | 'available' | 'downloading' | 'installed' | 'error' | 'up-to-date';
function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<T>
function isTauri(): boolean
export function UpdateBanner()
exports: UpdateBanner

// src/config/agentBehaviorDefaults.ts
constants: export DEFAULT_AGENT_HEARTBEAT_INTERVAL_MS, export DEFAULT_AGENT_STALL_WARNING_AFTER_MS, export DEFAULT_AGENT_MAX_NO_TOOL_ROUNDS, export DEFAULT_AGENT_MAX_ROUNDS, export DEFAULT_AGENT_REPETITION_NUDGE_AT, export DEFAULT_AGENT_REPETITION_EXIT_AT, export DEFAULT_AGENT_MAX_CODER_ROUNDS, export DEFAULT_AGENT_MAX_CODER_NO_TOOL_ROUNDS, export DEFAULT_AGENT_MAX_JSON_PARSE_ERRORS, export DEFAULT_AGENT_MAX_CONTEXT_ERRORS, export DEFAULT_AGENT_VERIFY_FAIL_WEB_NUDGE_AFTER, export DEFAULT_AGENT_MAX_FILE_READ_CHARS, export DEFAULT_AGENT_HISTORY_MESSAGES, export DEFAULT_AGENT_BACKGROUND_SETTLE_MS, export DEFAULT_AGENT_WARN_WRITE_FILE_CHARS, export DEFAULT_AGENT_MAX_WRITE_FILE_CHARS
exports: DEFAULT_AGENT_HEARTBEAT_INTERVAL_MS, DEFAULT_AGENT_STALL_WARNING_AFTER_MS, DEFAULT_AGENT_MAX_NO_TOOL_ROUNDS, DEFAULT_AGENT_MAX_ROUNDS, DEFAULT_AGENT_REPETITION_NUDGE_AT, DEFAULT_AGENT_REPETITION_EXIT_AT, DEFAULT_AGENT_MAX_CODER_ROUNDS, DEFAULT_AGENT_MAX_CODER_NO_TOOL_ROUNDS, DEFAULT_AGENT_MAX_JSON_PARSE_ERRORS, DEFAULT_AGENT_MAX_CONTEXT_ERRORS, DEFAULT_AGENT_VERIFY_FAIL_WEB_NUDGE_AFTER, DEFAULT_AGENT_MAX_FILE_READ_CHARS, DEFAULT_AGENT_HISTORY_MESSAGES, DEFAULT_AGENT_BACKGROUND_SETTLE_MS, DEFAULT_AGENT_WARN_WRITE_FILE_CHARS, DEFAULT_AGENT_MAX_WRITE_FILE_CHARS

// src/config/llmNetworkDefaults.ts
constants: export LAN_LLM_HOST, export DEFAULT_OLLAMA_URL, export DEFAULT_LLAMA_CPP_URL
exports: LAN_LLM_HOST, DEFAULT_OLLAMA_URL, DEFAULT_LLAMA_CPP_URL

// src/config/modelContextDefaults.ts
export function guessContextWindowFromModelId(modelId: string): number | undefined
constants: export DEFAULT_CONTEXT_WINDOW
exports: DEFAULT_CONTEXT_WINDOW, guessContextWindowFromModelId

// src/config/modelVisionHeuristics.ts
export function guessSupportsVisionFromModelId(modelId: string): boolean
export function effectiveSupportsVision(model: { supportsVision?: boolean; modelId: string } | undefined): boolean
exports: guessSupportsVisionFromModelId, effectiveSupportsVision

// src/config/preAuthFlow.ts
constants: export PRE_AUTH_FLOW_VERSION
exports: PRE_AUTH_FLOW_VERSION

// src/constants/codeScoutGallery.ts
export type CodeScoutGallerySlide
constants: export CODE_SCOUT_GALLERY_SLIDES
exports: CodeScoutGallerySlide, CODE_SCOUT_GALLERY_SLIDES

// src/constants/demoActivityChart.ts
imports: @/store/activityStore
function tokensForCloudEquivUsd(usd: number): number
function seededUnit(seed: string): number
function clamp(n: number, lo: number, hi: number): number
function splitRoles(totalTokens: number, seed: string): DayTokenTotals
export function buildDemoActivityByDay(): Record<ActivityDayKey, DayTokenTotals>
export const isDemoActivityChartEnabled = (...)
export const showDemoActivityChartBanner = (...)
constants: export SEEDED_ACTIVITY_VERSION, export SEEDED_ACTIVITY_MARKER_KEY
exports: SEEDED_ACTIVITY_VERSION, SEEDED_ACTIVITY_MARKER_KEY, buildDemoActivityByDay, isDemoActivityChartEnabled, showDemoActivityChartBanner

// src/constants/waitlistConsent.ts
constants: export WAITLIST_CONSENT_VERSION, export WAITLIST_CONSENT_LABEL
exports: WAITLIST_CONSENT_VERSION, WAITLIST_CONSENT_LABEL

// src/hooks/use-mobile.tsx
imports: react
export function useIsMobile()
const onChange = (...)
exports: useIsMobile

// src/hooks/use-toast.ts
imports: react, @/components/ui/toast
type ToasterToast = ToastProps &
type ActionType = typeof actionTypes;
type Action
interface State
type Toast = Omit<ToasterToast, "id">;
function genId()
const addToRemoveQueue = (...)
export const reducer = (...)
function dispatch(action: Action)
function toast({ ...props }: Toast)
const update = (...)
const dismiss = (...)
function useToast()
exports: reducer, useToast, toast

// src/hooks/useAgentRoleCatalog.ts
imports: react, @/store/modelStore
type RoleCatalogLists,
type RoleCatalogFetchMeta,
export function useAgentRoleCatalog()
exports: useAgentRoleCatalog

// src/hooks/useTheme.ts
imports: react
export type Theme = 'dark' | 'blue' | 'pink' | 'yellow';
function applyTheme(theme: Theme)
export function useTheme()
exports: Theme, useTheme

// src/lib/syncWorkbenchFromProject.ts
imports: @/store/projectStore, @/store/workbenchStore, @/store/projectMemoryStore, @/lib/tauri, @/store/workbenchStore
function triggerEnvironmentProbe(projectPath: string): Promise<void>

// src/lib/tauri.ts
imports: @/store/workbenchStore
export interface OpenDirResult
export interface CommandResult
export interface HttpResponse
export const isTauri = (...)
export function openDirectoryNative(): Promise<OpenDirResult>
export function writeFileNative(absolutePath: string, content: string): Promise<void>
export function createDirNative(absolutePath: string): Promise<void>
export function isWindows(): boolean
export function getUserShell(): Promise<string>
function wrapWithPathSetup(cmd: string, shell: string, cwd?: string): string
function shellArgs(shell: string, wrappedCmd: string): string[]
export function makeHttpRequest(url: string): Promise<HttpResponse>
exports: isTauri, OpenDirResult, CommandResult, openDirectoryNative, writeFileNative, createDirNative, isWindows, getUserShell, HttpResponse, makeHttpRequest

// src/lib/utils.ts
imports: clsx, tailwind-merge
export function cn(...inputs: ClassValue[])
exports: cn

// src/lib/waitlistAnalytics.ts
export type WaitlistAnalyticsEvent = "page_view" | "submit_success";
export function emitWaitlistAnalytics(event: WaitlistAnalyticsEvent): void
exports: WaitlistAnalyticsEvent, emitWaitlistAnalytics

// src/lib/waitlistSource.ts
export function pickWaitlistSource(search: URLSearchParams): string | undefined
exports: pickWaitlistSource

// src/lib/waitlistSubmit.ts
imports: @/constants/waitlistConsent
export type WaitlistSubmitInput
export type WaitlistSubmitResult
function trimApiBase(base: string): string
exports: WaitlistSubmitInput, WaitlistSubmitResult

// src/pages/CodeScoutDownload.tsx
imports: react, react-router-dom, lucide-react
type VersionManifest
export function CodeScoutDownload()
exports: CodeScoutDownload

// src/pages/CodeScoutLanding.tsx
imports: react-router-dom, lucide-react, @/components/marketing/CodeScoutScreenshotGallery
function AppleMark({ className }: { className?: string })
export function CodeScoutLanding()
exports: CodeScoutLanding

// src/pages/Index.tsx
imports: react, lucide-react, @/components/workbench/TopBar, @/components/workbench/FileTree, @/components/workbench/EditorPanel, @/components/workbench/AIPanel, @/components/workbench/PlanTabPanel, @/components/workbench/TerminalPanel, @/components/workbench/ModelSettings, @/components/workbench/SessionSidebar, @/components/workbench/BenchmarkPanel, @/pages/ProjectLauncher, @/pages/WelcomeScreen, @/store/workbenchStore, @/store/projectStore, @/store/chatHistoryStore, @/lib/syncWorkbenchFromProject
function fileIcon(filename: string)
const Index = (...)
exports: default(Index)

// src/pages/NotFound.tsx
imports: react-router-dom, react
const NotFound = (...)
exports: default(NotFound)

// src/pages/ProjectLauncher.tsx
imports: react, @/store/projectStore, @/store/workbenchStore, @/store/projectMemoryStore, @/store/agentMemoryStore, @/lib/tauri
interface CloneModalProps
function timeAgo(ts: number): string
const CloneModal = (...)
const handleClone = (...)
const ProjectLauncher = (...)
const handleCreate = (...)
const handleOpenFolder = (...)
const handleOpen = (...)
const handleDelete = (...)
const handleCloned = (...)
exports: default(ProjectLauncher)

// src/pages/WelcomeScreen.tsx
imports: react, @/components/CodeScoutLogo, @/store/modelStore, @/store/gitStore, @/store/projectStore, @/store/workbenchStore, @/store/projectMemoryStore, @/services/gitService, @/lib/tauri, @/services/fileSystemService, @/services/memoryManager, @/components/workbench/AIPanel, @/config/llmNetworkDefaults
interface WelcomeScreenProps
type StepId = (typeof STEPS)[number]['id'];
type ProbeStatus = 'idle' | 'checking' | 'online' | 'offline';
const WelcomeScreen = (...)
const handleNext = (...)
const handleBack = (...)
const handleFinish = (...)
const StepWelcome = (...)
const StepCloud = (...)
const handleSave = (...)
function buildProbeUrl(id: ModelProvider, endpoint: string): string
const StepLocal = (...)
const probeOne = (...)
const probeAll = (...)
const handleEndpointChange = (...)
const StepGitHub = (...)
const handleConnect = (...)
const StepProject = (...)
const handleOpenFolder = (...)
const handleSkip = (...)
exports: default(WelcomeScreen)

// src/pages/WorkbenchRoot.tsx
imports: react, @/pages/Index.tsx, @/store/modelStore
export function WorkbenchRoot()
exports: WorkbenchRoot

// src/services/agentExecutorCodeGen.ts
imports: @/store/workbenchStore, @/store/modelStore, ./modelApi, @/store/agentMemoryStore, @/utils/terminalContextForAgent, ./pathResolution, react-dom/client, ./App, @vitejs/plugin-react
export function escapeRegex(s: string): string
const addFile = (...)
export function formatContextFilesBlock(contextFiles: Record<string, string> | undefined): string
export function buildFileHints(filePath: string): string
export function cleanCodeResponse(text: string): string
export function generateFallbackCode(step: PlanStep): string
constants: export MAX_GENERATED_FILE_LINES, export WARN_GENERATED_FILE_LINES
exports: MAX_GENERATED_FILE_LINES, WARN_GENERATED_FILE_LINES, escapeRegex, formatContextFilesBlock, buildFileHints, cleanCodeResponse, generateFallbackCode, default(defineConfig)

// src/services/agentExecutorContext.ts
imports: ./repairAgent, ./planGenerator, ./environmentProbe, @/store/workbenchStore, @/store/taskStore
export interface ExecutionCallbacks
export function getProjectContext(): RepairProjectContext | undefined
export function getProjectIdentity(): ProjectIdentity | undefined
export function getEnvInfo(): EnvironmentInfo | undefined
export function getSkillMd(): string | undefined
export function getInstallHistoryForCoder(): string | undefined
export function getScaffoldHint(): string | undefined
export function getWebResearchContext(): string[]
export function setProjectContext(ctx: RepairProjectContext | undefined): void
export function setProjectIdentity(id: ProjectIdentity | undefined): void
export function setEnvInfo(info: EnvironmentInfo | undefined): void
export function setSkillMd(md: string | undefined): void
export function setInstallHistoryForCoder(ctx: string | undefined): void
export function setScaffoldHint(hint: string | undefined): void
export function addWebResearchContext(entry: string): void
export function getWebResearchContextLength(): number
export function getRecentWebResearchContext(n: number): string[]
export function resetAgentState(): void
constants: export WEB_CONTENT_MAX_CHARS
exports: ExecutionCallbacks, WEB_CONTENT_MAX_CHARS, getProjectContext, getProjectIdentity, getEnvInfo, getSkillMd, getInstallHistoryForCoder, getScaffoldHint, getWebResearchContext, setProjectContext, setProjectIdentity, setEnvInfo, setSkillMd, setInstallHistoryForCoder, setScaffoldHint, addWebResearchContext, getWebResearchContextLength, getRecentWebResearchContext, resetAgentState

// src/services/agentExecutorPort.ts
imports: @/lib/tauri, ./pathResolution
export type SimpleCallbacks
export function detectDevServerPort(cmd: string, viteConfigContent?: string): number | null
constants: export BACKGROUND_SETTLE_MS_EXPORT
exports: BACKGROUND_SETTLE_MS_EXPORT, detectDevServerPort, SimpleCallbacks

// src/services/agentExecutorSteps.ts
imports: @/store/workbenchStore, @/store/modelStore, @/lib/tauri, ./fileSystemService, ./validationRunner, @/store/workbenchStoreTypes, ./pathResolution, @/store/agentMemoryStore, ./installTracker, ./agentExecutorContext, ./agentExecutorContext, ./agentExecutorWebResearch, ./agentExecutorUtils, ./agentExecutorPort
export function flattenAllFiles(nodes: import('@/store/workbenchStore')
const handleOutputLine = (...)
export function detectSmartAction(step: PlanStep): PlanStep['action']
export function applySmartDetection(step: PlanStep, callbacks: ExecutionCallbacks): void
constants: export KNOWN_CLI_TOOLS
exports: KNOWN_CLI_TOOLS, flattenAllFiles, detectSmartAction, applySmartDetection

// src/services/agentExecutorUtils.ts
imports: @/store/workbenchStore, ./pathResolution
export function sanitizeRmCommaSeparatedPaths(command: string)
export function escapeRegex(s: string): string
export function appendTailwindCliNpmHint(stderr: string, command: string): string
export function appendGitNotARepoHint(stderr: string, command: string): string
export function appendSudoNonInteractiveHint(stderr: string, command: string): string
export function appendShellCommandHints(stderr: string, command: string): string
exports: sanitizeRmCommaSeparatedPaths, escapeRegex, appendTailwindCliNpmHint, appendGitNotARepoHint, appendSudoNonInteractiveHint, appendShellCommandHints

// src/services/agentExecutorValidation.ts
imports: @/store/workbenchStore, @/lib/tauri, ./fileSystemService, ./verifierAgent, ./pathResolution, ./repairAgent, ./agentExecutorContext, ./agentExecutorPort
export function verifierToValidationResult(verification: VerificationResult): ValidationRunResult | null
const tryAlts = (...)
export function syntaxPreCheck(content: string, filePath: string): string[]
export function applyRepairFix(fix: RepairFix, callbacks: ExecutionCallbacks): Promise<void>
exports: verifierToValidationResult, syntaxPreCheck, applyRepairFix

// src/services/agentExecutorWebResearch.ts
imports: @/store/workbenchStore, @/store/modelStore, @/lib/tauri, ./agentExecutorContext, ./agentExecutorContext
export type AgentWebResearchHooks
export function cleanHtml(s: string): string
export function extractDdgUrl(raw: string): string
export function parseDuckDuckGoResults(html: string)
export function htmlToText(html: string): string
export function makeHttpRequestWithTimeout(url: string): ReturnType<typeof makeHttpRequest>
export function runWebSearchForAgentTool(query: string, hooks: AgentWebResearchHooks): Promise<string>
export function runFetchUrlForAgentTool(url: string, hooks: AgentWebResearchHooks): Promise<string>
function normalizeBrowseActionsJson(raw: unknown): string | null
exports: AgentWebResearchHooks, cleanHtml, extractDdgUrl, parseDuckDuckGoResults, htmlToText, makeHttpRequestWithTimeout, runWebSearchForAgentTool, runFetchUrlForAgentTool

// src/services/agentRegistryLookup.ts
imports: @/lib/tauri
export type RegistryEcosystem = 'npm' | 'crates' | 'pypi';
function httpGet(url: string): Promise<
function trimPkg(s: string): string
exports: RegistryEcosystem

// src/services/agentRoleCatalog.ts
imports: @/config/llmNetworkDefaults, @/services/discoveryFetch
type AgentRole,
type ModelConfig,
type ModelProvider,
export type RoleCatalogLists
export type RoleCatalogFetchMeta
export type RoleCatalogOptionGroup
export function fetchOllamaModelIds(baseUrl: string): Promise<string[]>
export function fetchOpenAiCompatibleModelIds(baseUrl: string): Promise<string[]>
export function fetchOpenRouterModelIds(apiKey: string): Promise<string[]>
export function loadRoleCatalogLists(getState: typeof useModelStore.getState): Promise<
export function roleCatalogSelectValue(current: { id: string } | undefined): string
export function applyRoleCatalogPick(role: AgentRole, value: string): void
export function countCatalogOptions(groups: RoleCatalogOptionGroup[]): number
exports: fetchOllamaModelIds, fetchOpenAiCompatibleModelIds, fetchOpenRouterModelIds, RoleCatalogLists, RoleCatalogFetchMeta, loadRoleCatalogLists, RoleCatalogOptionGroup, roleCatalogSelectValue, applyRoleCatalogPick, countCatalogOptions

// src/services/agentToolDefinitions.ts
imports: ./chatTools
export function buildAgentTools(withCoder: boolean)
constants: export FINISH_TASK_TOOL, export DELEGATE_TO_CODER_TOOL, export REINDEX_PROJECT_TOOL, export ALL_AGENT_TOOLS
exports: FINISH_TASK_TOOL, DELEGATE_TO_CODER_TOOL, REINDEX_PROJECT_TOOL, buildAgentTools, ALL_AGENT_TOOLS

// src/services/agentToolExecutor.ts
imports: @/store/agentMemoryStore, @/store/agentMemoryStore, @/store/workbenchStore, @/store/workbenchStore, @/lib/tauri, ./chatTools, ./pathResolution, ./agentRegistryLookup, @/utils/terminalContextForAgent, ./agentExecutorUtils, ./validationRunner, @/store/workbenchStoreTypes
export type ExecutorCallbacks
export function flattenFilePaths(nodes: FileNode[])
function countNonOverlapping(haystack: string, needle: string): number
export function isShellFileWrite(cmd: string): boolean
function clipStatus(s: string, max: number): string
export function statusForToolCall(tc: AssistantToolCall): string
const detectUrl = (...)
exports: ExecutorCallbacks, flattenFilePaths, isShellFileWrite, statusForToolCall

// src/services/agentToolLoop.smallLlmGuards.test.ts
imports: vitest, ./chatToolParsers, ./plannerPromptBuilder, @/store/workbenchStore
const getContent = (...)

// src/services/agentToolLoop.ts
imports: ./modelApi, @/store/modelStore, @/store/workbenchStore, @/lib/tauri, @/utils/tokenEstimate, ./validationRunner, ./environmentProbe, @/store/workbenchStore, @/store/workbenchStoreTypes
type AssistantToolCall,
export interface AgentToolLoopCallbacks
function clipTimelineText(s: string, max: number): string
function isToolCallJsonParseError(err: Error): boolean
function isContextLimitError(err: Error): boolean
function extractNCtxFromError(err: Error): number | null
function formatToolTimelineLine(inv: ToolInvocation): string
function extractPackageName(importPath: string): string | null
const anyFn = (...)
function toolFingerprint(toolName: string, argsJson: string): string
const anyFn = (...)
constants: export MAX_AGENT_ROUNDS
exports: FINISH_TASK_TOOL, DELEGATE_TO_CODER_TOOL, buildAgentTools, ALL_AGENT_TOOLS, executeAgentToolCall, AgentToolLoopCallbacks, MAX_AGENT_ROUNDS

// src/services/benchmarkEval.ts
imports: @/types/benchmark
export function extractCode(output: string): string
function stripBasicTypeAnnotations(code: string): string
function deepEqual(a: unknown, b: unknown): boolean
function safeStringify(value: unknown): string
exports: extractCode

// src/services/benchmarkRunner.ts
imports: @/services/modelApi, @/services/chatTools, @/services/benchmarkEval, @/store/modelStore, @/types/benchmark
export interface BenchmarkRunnerOptions
function benchmarkRequestSignal(user: AbortSignal): AbortSignal
const anyFn = (...)
function abortErrorMessage(error: Error): string
function worker()
const finish = (...)
exports: BenchmarkRunnerOptions

// src/services/benchmarkScorer.ts
imports: @/store/modelStore, @/store/modelStore, @/services/benchmarkTests
function countHits(output: string, hints: string[]): number
function scoreFunctional(result: TestRunResult): number
function scoreLegacyQuality(result: TestRunResult): number
function scoreToolUse(result: TestRunResult): number
function scoreResult(result: TestRunResult): number

// src/services/benchmarkTests.ts
imports: @/types/benchmark
function romanToInt(s)
function flattenObject(obj)
function recurse(current, prefix)
function isPalindrome(s)
function digitalRoot(n)
function rotateArray(arr, k)
function mergeIntervals(intervals)
function buildContextDocument(): string
export function getTestById(id: string): BenchmarkTest | undefined
constants: export CODE_GEN_TEST, export CODE_EDIT_TEST, export DEBUG_TEST, export REASONING_TEST, export CONTEXT_TEST, export TOOL_USE_TEST, export ALL_BENCHMARK_TESTS
exports: CODE_GEN_TEST, CODE_EDIT_TEST, DEBUG_TEST, REASONING_TEST, CONTEXT_TEST, TOOL_USE_TEST, ALL_BENCHMARK_TESTS, getTestById

// src/services/chatApiMessages.ts
imports: @/store/workbenchStore, @/services/modelApi, @/services/chatTools
function userToApi(m: ChatMessage): ModelRequestMessage
function allInvocationsResolved(inv: ToolInvocation[] | undefined): boolean
function hasActiveInvocations(inv: ToolInvocation[] | undefined): boolean
export function chatMessagesToApiMessages(messages: ChatMessage[]): ModelRequestMessage[]
exports: chatMessagesToApiMessages

// src/services/chatStreamBySession.ts
export function beginStreamForSession(sessionId: string): AbortSignal
export function abortStreamForSession(sessionId: string): void
export function abortAllChatStreams(): void
exports: beginStreamForSession, abortStreamForSession, abortAllChatStreams

// src/services/chatToolFormatting.ts
imports: @/store/workbenchStore
export function formatToolResultForModel(t: ToolInvocation): string
export function describeToolAction(t: ToolInvocation): string
exports: formatToolResultForModel, describeToolAction

// src/services/chatToolParsers.ts
export function parseReadFile(argsJson: string)
export function parseListDir(argsJson: string)
export function parseWebSearch(argsJson: string)
export function parseFetchUrl(argsJson: string)
export function parseGetTerminalSnapshot(argsJson: string)
export function parseReplaceInFile(argsJson: string)
exports: parseReadFile, parseListDir, parseWebSearch, parseFetchUrl, parseGetTerminalSnapshot, parseReplaceInFile

// src/services/chatTools.ts
imports: @/store/workbenchStore
export type AssistantToolCall
export function isCommandSafeToAutoExecute(command: string): boolean
export function parseRunTerminalCommand(argsJson: string)
export function parseWriteToFile(argsJson: string)
export function parseReadFile(argsJson: string)
export function parseListDir(argsJson: string)
export function parseSaveMemory(argsJson: string)
export function parseSearchFiles(argsJson: string)
export function formatToolResultForModel(t: ToolInvocation): string
export function describeToolAction(t: ToolInvocation): string
export function parseTextToolCalls(text: string)
constants: export RUN_TERMINAL_CMD_TOOL, export WRITE_TO_FILE_TOOL, export READ_FILE_TOOL, export LIST_DIR_TOOL, export SEARCH_FILES_TOOL, export SAVE_MEMORY_TOOL, export ALL_CHAT_TOOLS
exports: RUN_TERMINAL_CMD_TOOL, WRITE_TO_FILE_TOOL, READ_FILE_TOOL, LIST_DIR_TOOL, SEARCH_FILES_TOOL, SAVE_MEMORY_TOOL, ALL_CHAT_TOOLS, isCommandSafeToAutoExecute, AssistantToolCall, parseRunTerminalCommand, parseWriteToFile, parseReadFile, parseListDir, parseSaveMemory, parseSearchFiles, formatToolResultForModel, describeToolAction, parseTextToolCalls

// src/services/codescoutSync.ts
imports: @/store/workbenchStore, @/store/projectMemoryStore
export function scheduleCodescoutIndexAfterFileMutation(): void
exports: scheduleCodescoutIndexAfterFileMutation

// src/services/contextCompressor.ts
imports: @/services/modelApi, @/utils/tokenEstimate
export interface CompressOptions
function messageTokens(msg: ModelRequestMessage): number
function truncateText(text: string, maxChars: number): string
function truncateToolResult(msg: ModelRequestMessage): ModelRequestMessage
function truncateOldMessage(msg: ModelRequestMessage): ModelRequestMessage
function summarizeDropped(messages: ModelRequestMessage[]): string
exports: CompressOptions

// src/services/dependencyRepairEngine.ts
export interface RepairEngineConfig
interface RepairCommandResult
export interface RepairContext
export function recordAttempt(ledger: RepairLedger, attempt: RepairAttempt): void
export function shouldStop(ledger: RepairLedger)
export function bumpBudget(ledger: RepairLedger, extraAttempts: number): void
function strategyCount(ledger: RepairLedger, strategyId: string): number
function deterministicCount(ledger: RepairLedger): number
export function formatLedgerForPrompt(ledger: RepairLedger): string
function stripInstallFlags(cmd: string): string
exports: RepairEngineConfig, recordAttempt, shouldStop, bumpBudget, formatLedgerForPrompt, RepairContext

// src/services/discoveryFetch.ts
imports: @/lib/tauri
export interface ProbeResult
export function probeUrl(url: string, timeoutMs = 2500): Promise<ProbeResult>
export function fetchDiscoveryJson(url: string): Promise<unknown>
export function formatDiscoveryError(e: unknown): string
exports: ProbeResult, probeUrl, fetchDiscoveryJson, formatDiscoveryError

// src/services/environmentProbe.ts
imports: @/lib/tauri
export interface EnvironmentInfo
function parseVersion(output: string): string | null
function tryVersionWithPath(cmd: string, resolvedPath: string, cwd?: string): Promise<string | null>
function resolveUserPath(cwd?: string): Promise<string>
export function probeEnvironment(projectPath?: string): Promise<EnvironmentInfo>
const tv = (...)
export function writeEnvironmentCache(projectPath: string, env: EnvironmentInfo): Promise<void>
export function formatEnvForPrompt(env: EnvironmentInfo): string
export function selectPackageManager(env: EnvironmentInfo | null | undefined): string
export function selectTsRunner(_env?: EnvironmentInfo | null): string
exports: EnvironmentInfo, probeEnvironment, writeEnvironmentCache, formatEnvForPrompt, selectPackageManager, selectTsRunner

// src/services/fileSkeletonParser.ts
imports: @/store/workbenchStore
export interface FileSkeleton
export interface ProjectSkeleton
function getExt(path: string): string
function getLang(path: string): string
function shouldSkipDir(name: string): boolean
function shouldParseFile(node: FileNode): boolean
function extractTS(content: string): Omit<FileSkeleton, 'path' | 'language' | 'compact'>
function extractPython(content: string): Omit<FileSkeleton, 'path' | 'language' | 'compact'>
function extractRust(content: string): Omit<FileSkeleton, 'path' | 'language' | 'compact'>
function extractGo(content: string): Omit<FileSkeleton, 'path' | 'language' | 'compact'>
function extractGeneric(content: string): Omit<FileSkeleton, 'path' | 'language' | 'compact'>
function extractSkeleton(path: string, content: string): FileSkeleton
function collectFiles(nodes: FileNode[]): FileNode[]
export function buildProjectSkeleton(files: FileNode[]): ProjectSkeleton
export function buildBudgetedSkeleton(files: FileNode[], maxTokens: number): string
exports: FileSkeleton, ProjectSkeleton, buildProjectSkeleton, buildBudgetedSkeleton

// src/services/fileSystemService.ts
imports: @/store/workbenchStore
export interface OpenDirectoryResult
export interface CloneProgress
function detectLang(filename: string): string
export function openDirectory(): Promise<OpenDirectoryResult>
export function createProjectDirectory(projectName: string): Promise<OpenDirectoryResult>
export function isFSAccessSupported(): boolean
function buildFSAdapter(root: FileSystemDirectoryHandle)
function getDirHandle(path: string, create = false): Promise<FileSystemDirectoryHandle>
exports: OpenDirectoryResult, openDirectory, createProjectDirectory, isFSAccessSupported, CloneProgress

// src/services/gitService.ts
imports: @/lib/tauri, @/store/gitStore
export function refreshGitStatus(projectPath: string): Promise<void>
export function gitCommitAll(projectPath: string, message: string): Promise<void>
exports: refreshGitStatus, gitCommitAll

// src/services/installTracker.ts
export interface InstallRecord
export function isInstallCommand(cmd: string): boolean
export function parsePackagesFromCommand(cmd: string): string[]
function sep(root: string): string
export function recordInstall(record: InstallRecord, projectRoot: string): Promise<void>
export function readInstallHistory(projectRoot: string): Promise<InstallRecord[]>
export function buildInstallContext(projectRoot: string): Promise<string | undefined>
exports: InstallRecord, isInstallCommand, parsePackagesFromCommand, recordInstall, readInstallHistory, buildInstallContext

// src/services/memoryManager.ts
imports: @/store/workbenchStore, @/store/projectMemoryStore, @/services/fileSkeletonParser
function detectFramework(files: FileNode[]): string
const hasDependency = (...)
function detectPackageManager(files: FileNode[]): string
function detectLanguage(files: FileNode[]): string
function detectStyling(files: FileNode[]): string
function detectEntryPoints(files: FileNode[]): string[]
function detectImportantFiles(files: FileNode[]): string[]
function extractRunCommands(files: FileNode[]): Record<string, string>
function detectTopLevelFolders(files: FileNode[]): string[]
function detectRoutingStyle(files: FileNode[]): string
function findFile(nodes: FileNode[], name: string): FileNode | null
function detectFileExtensions(files: FileNode[]): string
function flattenPaths(nodes: FileNode[]): string[]
function flattenFiles(nodes: FileNode[]): FileNode[]
function findFileContent(nodes: FileNode[], path: string): string | undefined
function simpleHash(content: string): string
function buildFileSummaries(files: FileNode[]): Record<string, FileSummary>
function inferFilePurpose(path: string, _content: string): string
function extractExports(content: string): string[]
function extractImports(content: string): string[]
function inferRiskLevel(path: string): 'low' | 'medium' | 'high'
function detectProjectPrefix(files: FileNode[]): string
function buildSkillMd(repoMap: RepoMap, conventions: Conventions, files: FileNode[]): string
function writeIndexToDisk(projectPath: string, memory: ProjectMemory): Promise<void>
function writeSkillsToDisk(projectPath: string, memory: ProjectMemory): Promise<void>
function readIndexFromDisk(projectPath: string): Promise<any | null>
export function writeAgentMemoryToDisk(projectRoot: string, memories: unknown[]): Promise<void>
export function readAgentMemoryFromDisk(projectRoot: string): Promise<unknown[] | null>
export function resolveEffectiveRoot(basePath: string, files: FileNode[]): string
function stripPathPrefix(nodes: FileNode[], prefix: string): FileNode[]
function resolveEffectiveFiles(files: FileNode[])
export function indexProject(files: FileNode[], projectName: string, projectPath?: string): ProjectMemory
export function isMemoryStale(memory: ProjectMemory): boolean
export function getOrIndexProject(files: FileNode[], projectName: string, projectPath?: string): ProjectMemory
export function getBudgetedSkeletonText(files: FileNode[], projectName: string, maxTokens: number): string
exports: writeAgentMemoryToDisk, readAgentMemoryFromDisk, resolveEffectiveRoot, indexProject, isMemoryStale, getOrIndexProject, readIndexFromDisk, getBudgetedSkeletonText

// src/services/modelApi.ollamaResolve.test.ts
imports: node:http, node:net, vitest, ./modelApi
function base()

// src/services/modelApi.ts
imports: @/store/modelStore, @/services/chatTools
export type MultimodalContentPart
export type ModelMessageContent = string | MultimodalContentPart[];
export type ModelRequestMessage
export type ChatToolDefinition
export interface ModelRequest
export interface ModelResponse
export type StreamCallback = (chunk: string) => void;
export interface CallModelDoneMeta
export type DoneCallback = (fullText: string, meta?: CallModelDoneMeta) => void;
export type ErrorCallback = (error: Error) => void;
export type TokensCallback = (usage: TokenUsage) => void;
export interface TokenUsage
function pushStreamLines(buffer: string, chunk: string, emit: (line: string)
function emitOpenAIUsage(parsed: { usage?: Record<string, unknown> }, onTokens?: TokensCallback): void
const num = (...)
function joinTextParts(parts: MultimodalContentPart[]): string
function ollamaPayloadMessage(m: ModelRequestMessage): Record<string, unknown>
function openAICompatibleMessage(m: ModelRequestMessage): Record<string, unknown>
function anthropicBlocks(content: ModelMessageContent): unknown[]
function requestHasImageParts(req: ModelRequest): boolean
export function clearOllamaTagsCache(): void
const handleLine = (...)
const handleLine = (...)
const anthropicBlocksFromRequest = (...)
const handleLine = (...)
function getAdapter(provider: ModelProvider)
exports: MultimodalContentPart, ModelMessageContent, ModelRequestMessage, ChatToolDefinition, ModelRequest, ModelResponse, StreamCallback, CallModelDoneMeta, DoneCallback, ErrorCallback, TokensCallback, TokenUsage, clearOllamaTagsCache

// src/services/modelApiAnthropic.ts
imports: @/services/chatTools, ./modelApiTypes
const anthropicBlocksFromRequest = (...)
const handleLine = (...)

// src/services/modelApiOllama.ts
imports: @/services/chatTools, ./modelApiTypes
type OllamaStreamFn
function ollamaPayloadMessage(m: ModelRequestMessage): Record<string, unknown>
export function clearOllamaTagsCache(): void
const handleLine = (...)
exports: clearOllamaTagsCache

// src/services/modelApiOpenAI.ts
imports: @/services/chatTools, ./modelApiTypes
function openAICompatibleMessage(m: ModelRequestMessage): Record<string, unknown>
function emitOpenAIUsage(parsed: { usage?: Record<string, unknown> }, onTokens?: TokensCallback): void
const num = (...)
function requestHasImageParts(req: ModelRequest): boolean
const handleLine = (...)

// src/services/modelApiTypes.ts
imports: @/services/chatTools, @/store/modelStore
export type MultimodalContentPart
export type ModelMessageContent = string | MultimodalContentPart[];
export type ModelRequestMessage
export type ChatToolDefinition
export interface ModelRequest
export interface ModelResponse
export type StreamCallback = (chunk: string) => void;
export interface CallModelDoneMeta
export type DoneCallback = (fullText: string, meta?: CallModelDoneMeta) => void;
export type ErrorCallback = (error: Error) => void;
export type TokensCallback = (usage: TokenUsage) => void;
export interface TokenUsage
export function pushStreamLines(buffer: string, chunk: string, emit: (line: string)
export function joinTextParts(parts: MultimodalContentPart[]): string
export function anthropicBlocks(content: ModelMessageContent): unknown[]
constants: export DEFAULT_MODEL_STREAM_TIMEOUT_MS
exports: MultimodalContentPart, ModelMessageContent, ModelRequestMessage, ChatToolDefinition, DEFAULT_MODEL_STREAM_TIMEOUT_MS, ModelRequest, ModelResponse, StreamCallback, CallModelDoneMeta, DoneCallback, ErrorCallback, TokensCallback, TokenUsage, pushStreamLines, joinTextParts, anthropicBlocks

// src/services/modelContextFetcher.ts
imports: @/store/modelStore
interface OpenRouterModelEntry
export interface ModelStats
function fetchJson(url: string, opts?: RequestInit): Promise<unknown>
function authHeader(apiKey?: string): HeadersInit
function ollamaContextWindow(endpoint: string, modelId: string): Promise<number | null>
function openRouterModelEntry(modelId: string, apiKey?: string): Promise<OpenRouterModelEntry | null>
function openRouterContextWindow(modelId: string, apiKey?: string): Promise<number | null>
function googleContextWindow(modelId: string, apiKey?: string): Promise<number | null>
function groqContextWindow(modelId: string, apiKey?: string): Promise<number | null>
function mistralContextWindow(modelId: string, apiKey?: string): Promise<number | null>
function llamaCppContextWindow(endpoint: string): Promise<number | null>
export function fetchModelContextWindow(model: ModelConfig): Promise<number | null>
export function fetchModelStats(model: ModelConfig): Promise<ModelStats>
const toPerM = (...)
exports: ModelStats, fetchModelContextWindow, fetchModelStats

// src/services/orchestrator.ts
imports: @/store/workbenchStore, @/store/modelStore, @/store/taskStore, ./planGenerator, ./agentExecutor, ./modelApi, @/lib/tauri, ./environmentProbe, @/store/taskStore, ./installTracker, @/store/agentMemoryStore, ./memoryManager
export interface OrchestratorCallbacks
export interface PlanningContext
class Orchestrator
constants: export orchestrator
exports: OrchestratorCallbacks, PlanningContext, orchestrator

// src/services/pathResolution.ts
type Scored =
export function normalizePath(raw: string): string
function levenshtein(a: string, b: string): number
export function detectFileTreePrefix(allFiles: { path: string }[]): string
export function normalizeCommandPaths(command: string)
export function isBackgroundCommand(cmd: string): boolean
exports: normalizePath, detectFileTreePrefix, normalizeCommandPaths, isBackgroundCommand

// src/services/planGenerator.ts
imports: @/store/workbenchStore, @/store/modelStore, @/store/modelStore, ./modelApi, ./environmentProbe, ./environmentProbe
export interface ProjectIdentity
export interface GeneratePlanOptions
function shouldInlineFile(node: FileNode): boolean
function buildFileContext(files: FileNode[]): string
function buildProjectIdentityBlock(id: ProjectIdentity, projectName?: string): string
function flattenFiles(nodes: FileNode[], result: FileNode[] = []): FileNode[]
function extractJSON(text: string): string | null
function repairTruncatedJSON(json: string): string
function normalizePath(raw: string): string
function validatePlan(data: unknown): Plan | null
export function generatePlan(options: GeneratePlanOptions): Promise<Plan>
function extractComponentName(userRequest: string): string
function detectMockPlanPrefix(flat: FileNode[]): string
exports: ProjectIdentity, GeneratePlanOptions, generatePlan

// src/services/plannerPromptBuilder.test.ts
imports: vitest, @/store/workbenchStore
type ProjectIdentity,

// src/services/plannerPromptBuilder.ts
imports: @/store/workbenchStore, ./environmentProbe, ./environmentProbe
export interface ProjectIdentity
export function flattenFiles(nodes: FileNode[], result: FileNode[] = []): FileNode[]
export function shouldInlineFile(node: FileNode): boolean
export function buildFileContext(files: FileNode[]): string
exports: ProjectIdentity, flattenFiles, shouldInlineFile, buildFileContext

// src/services/repairAgent.ts
imports: @/store/workbenchStore, @/store/modelStore, ./modelApi, ./validationRunner, ./repairTypes, ./dependencyRepairEngine, ./environmentProbe
export interface ReplanInput
export interface OrchestratorReplanStep
export type RepairFix
export interface RepairProjectContext
export interface RepairAgentInput
export function requestOrchestratorReplanning(input: ReplanInput): Promise<OrchestratorReplanStep[]>
function buildRepairSystem(ctx?: RepairProjectContext, envInfo?: EnvironmentInfo): string
function extractJSON(text: string): string | null
export function requestRepairFix(input: RepairAgentInput): Promise<RepairFix | null>
exports: ReplanInput, requestOrchestratorReplanning, OrchestratorReplanStep, RepairFix, RepairProjectContext, RepairAgentInput, requestRepairFix

// src/services/repairTypes.ts
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | null;
export type FailureCategory
export type StrategyFamily
export interface RepairProgress
export interface FailureFingerprint
export interface RepairAttempt
export interface RepairLedger
export type RepairAction
export function noneFingerprint(): FailureFingerprint
exports: PackageManager, FailureCategory, StrategyFamily, RepairProgress, FailureFingerprint, RepairAttempt, RepairLedger, RepairAction, noneFingerprint

// src/services/scaffoldRegistry.ts
imports: @/lib/tauri, @vitejs/plugin-react, @tailwindcss/vite, react-dom/client, ./App, @vitejs/plugin-vue, @tailwindcss/vite, ./App.vue, vue
type Ecosystem = 'npm' | 'pypi' | 'crates';
interface PackageRef
interface ScaffoldArchetype
interface CacheEntry
function cacheKey(ecosystem: Ecosystem, name: string): string
function cached(ecosystem: Ecosystem, name: string): string | null
function store(ecosystem: Ecosystem, name: string, version: string): void
function httpGet(url: string): Promise<string>
function resolveNpm(name: string): Promise<string>
function resolvePypi(name: string): Promise<string>
function resolveCrates(name: string): Promise<string>
function resolveOne(ecosystem: Ecosystem, name: string): Promise<string>
function resolveVersions(packages: PackageRef[]): Promise<Map<string, string>>
function applyVersions(content: string, versions: Map<string, string>): string
export function RootLayout({ children }: { children: React.ReactNode })
function matchArchetype(framework: string, language: string): ScaffoldArchetype | null
export function buildScaffoldHint(framework: string, language: string): Promise<string | null>
export function listSupportedArchetypes(): string
constants: export metadata
exports: default(defineConfig), default(config), metadata, RootLayout, buildScaffoldHint, listSupportedArchetypes

// src/services/validationRunner.ts
imports: @/store/workbenchStore, @/lib/tauri, ./repairTypes
interface PackageScripts
export interface ValidationRunResult
export interface RunValidationOptions
export function normalizeValidationError(text: string): string
export function resolveProjectRoot(projectPath: string, files: FileNode[]): string
function pickNpmScript(scripts: PackageScripts): string | null
const interesting = (...)
const walk = (...)
function extractPackage(): string | null
function buildSignature(category: string, pkg: string | null): string
export function runProjectValidation(opts: RunValidationOptions): Promise<ValidationRunResult>
export function formatValidationFailure(result: ValidationRunResult): string
exports: normalizeValidationError, resolveProjectRoot, ValidationRunResult, RunValidationOptions, runProjectValidation, formatValidationFailure

// src/services/verifierAgent.ts
imports: @/store/workbenchStore, @/store/modelStore, ./modelApi
export interface VerificationInput
export interface VerificationResult
function runDeterministicChecks(input: VerificationInput): VerificationResult | null
exports: VerificationInput, VerificationResult

// src/store/activityStore.ts
imports: zustand, zustand/middleware
export type ActivityDayKey = string; // YYYY-MM-DD (local)
export interface DayTokenTotals
export interface ActivityState
function todayKey(): ActivityDayKey
function pruneOldDays(byDay: Record<ActivityDayKey, DayTokenTotals>): Record<ActivityDayKey, DayTokenTotals>
constants: export useActivityStore
exports: ActivityDayKey, DayTokenTotals, ActivityState, useActivityStore

// src/store/agentMemoryStore.ts
imports: zustand, zustand/middleware, @/lib/tauri, @/store/workbenchStore, @/services/memoryManager
export type MemoryCategory
export interface MemoryEntry
interface AgentMemoryState
function isValidMemoryEntry(x: unknown): x is MemoryEntry
function scheduleAgentMemoryDiskWrite()
function generateId(): string
function decayedRelevance(entry: MemoryEntry): number
constants: export useAgentMemoryStore
exports: MemoryCategory, MemoryEntry, useAgentMemoryStore

// src/store/authStore.ts
imports: zustand, zustand/middleware
interface ApiUser
interface ApiResponse
export interface AuthUser
interface AuthState
function checkOffline(email: string, password: string): boolean
function authFetch(endpoint: string, username: string, password: string): Promise<ApiResponse>
constants: export useAuthStore
exports: AuthUser, useAuthStore

// src/store/benchmarkStore.ts
imports: zustand, zustand/middleware, @/services/benchmarkRunner, @/services/benchmarkScorer, @/services/benchmarkTests, @/store/modelStore, @/store/projectStore, @/types/benchmark
interface BenchmarkStoreState
function asStringArray(v: unknown, fallback: string[]): string[]
function persistRunsToDisk(runs: BenchmarkRun[]): Promise<void>
const onProgress = (...)
constants: export useBenchmarkStore
exports: useBenchmarkStore

// src/store/chatHistoryStore.ts
imports: zustand, zustand/middleware, @/utils/randomId, ./workbenchStore, ./projectStore
export interface SavedChat
interface ChatHistoryState
export function createWelcomeMessages(): ChatMessage[]
function requireProjectId(): string | null
function chatsForProject(state: ChatHistoryState, projectId: string): SavedChat[]
function generateTitle(messages: ChatMessage[]): string
function messagesForStorage(messages: ChatMessage[]): ChatMessage[]
constants: export useChatHistoryStore
exports: SavedChat, createWelcomeMessages, useChatHistoryStore

// src/store/gitStore.ts
imports: zustand, zustand/middleware
interface GitState
constants: export useGitStore
exports: useGitStore

// src/store/modelStore.ts
imports: zustand, zustand/middleware, @/config/llmNetworkDefaults
export type AgentRole = 'orchestrator' | 'coder' | 'tester';
export type ModelProvider
export interface ModelConfig
interface ModelStoreState
constants: export PROVIDER_OPTIONS, export ROLE_OPTIONS, export useModelStore
exports: AgentRole, ModelProvider, ModelConfig, PROVIDER_OPTIONS, ROLE_OPTIONS, useModelStore

// src/store/projectMemoryStore.ts
imports: zustand, zustand/middleware
export interface RepoMap
export interface FileSummary
export interface Conventions
export interface ProjectMemory
interface ProjectMemoryState
constants: export useProjectMemoryStore
exports: RepoMap, FileSummary, Conventions, ProjectMemory, useProjectMemoryStore

// src/store/projectStore.ts
imports: zustand, zustand/middleware, @/utils/randomId
export interface Project
interface ProjectState
constants: export useProjectStore
exports: Project, useProjectStore

// src/store/taskStore.ts
imports: zustand
export type OrchestratorState
export interface TaskEvent
export type TaskEventType
export type EscalationDecision
export interface EscalationContext
export type AgentActivityPhase
export interface AgentActivity
interface TaskStoreState
constants: export useTaskStore
exports: OrchestratorState, TaskEvent, TaskEventType, EscalationDecision, EscalationContext, AgentActivityPhase, AgentActivity, useTaskStore

// src/store/workbenchStore.ts
imports: zustand, ./taskStore, @/services/environmentProbe
export interface FileNode
export interface ChatImagePart
export type ToolInvocationStatus
export interface ToolInvocation
export interface ChatMessage
export interface PlanStep
export interface Plan
export interface FileSnapshot
export interface TerminalTab
export type AppMode = 'ask' | 'plan' | 'build' | 'chat' | 'agent';
interface WorkbenchState
function detectLanguage(filename: string): string
function findFile(nodes: FileNode[], path: string): FileNode | null
function insertFileInTree(nodes: FileNode[], filePath: string, content: string, language: string): FileNode[]
function removeFileFromTree(nodes: FileNode[], filePath: string): FileNode[]
const updateContent = (...)
constants: export CENTER_TAB_PLAN, export CENTER_TAB_BENCHMARK, export useWorkbenchStore
exports: FileNode, ChatImagePart, ToolInvocationStatus, ToolInvocation, ChatMessage, PlanStep, Plan, FileSnapshot, TerminalTab, AppMode, CENTER_TAB_PLAN, CENTER_TAB_BENCHMARK, useWorkbenchStore

// src/store/workbenchStoreTypes.ts
export interface FileNode
export interface ChatImagePart
export type ToolInvocationStatus
export interface ToolInvocation
export interface ChatMessage
export interface PlanStep
export interface Plan
export interface FileSnapshot
export interface TerminalTab
export type AppMode = 'ask' | 'plan' | 'build' | 'chat' | 'agent';
export function setLastDevServerUrl(url: string | null): void
constants: export lastDevServerUrl, export CENTER_TAB_PLAN, export CENTER_TAB_BENCHMARK
exports: FileNode, ChatImagePart, ToolInvocationStatus, ToolInvocation, ChatMessage, lastDevServerUrl, setLastDevServerUrl, PlanStep, Plan, FileSnapshot, TerminalTab, AppMode, CENTER_TAB_PLAN, CENTER_TAB_BENCHMARK

// src/test/prompt-pipeline.test.ts
imports: vitest, @/store/workbenchStore, @/services/memoryManager, @/services/agentExecutor, @/services/planGenerator
function createViteReactFixture(): FileNode[]
function createEmptyFixture(): FileNode[]
function createNestedFixture(): FileNode[]
function flattenFiles(nodes: FileNode[]): FileNode[]
function buildIdentityFromMemory(files: FileNode[], memory: ReturnType<typeof indexProject>): ProjectIdentity
function validatePlan(planJson: string, identity: ProjectIdentity)
const getContent = (...)
const getContent = (...)
const getContent = (...)

// src/types/benchmark.ts
export type TestCategory = 'code-gen' | 'code-edit' | 'debug' | 'reasoning' | 'context' | 'tool-use';
export type ScoreCategory = TestCategory | 'speed' | 'cost';
export interface FunctionalTestCase
export interface FunctionalResult
export interface BenchmarkTest
export type TestRunStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';
export interface TestRunResult
export interface CategoryScore
export interface ModelBenchmarkScore
export type BenchmarkRunStatus = 'idle' | 'running' | 'done' | 'aborted';
export interface BenchmarkRun
export interface RunProgress
exports: TestCategory, ScoreCategory, FunctionalTestCase, FunctionalResult, BenchmarkTest, TestRunStatus, TestRunResult, CategoryScore, ModelBenchmarkScore, BenchmarkRunStatus, BenchmarkRun, RunProgress

// src/utils/activityLineNormalize.ts
export type FormatActivityLogOptions
export function normalizeActivityLine(text: string): string
exports: normalizeActivityLine, FormatActivityLogOptions

// src/utils/agentThreadForPlanner.ts
export function userMessageLooksLikePlanWork(text: string): boolean
exports: userMessageLooksLikePlanWork

// src/utils/chatSessionRouting.ts
imports: @/utils/randomId, @/store/chatHistoryStore, @/store/projectStore, @/store/workbenchStore
export function getActiveChatIdForProject(): string | null
export function getChatTranscriptForSession(sessionId: string | null | undefined): ChatMessage[]
export function isWorkbenchShowingSession(sessionId: string | null | undefined): boolean
export function getLastChatMessageForSession(sessionId: string | null): ChatMessage | undefined
exports: getActiveChatIdForProject, getChatTranscriptForSession, isWorkbenchShowingSession, getLastChatMessageForSession

// src/utils/modelReachabilityMessages.ts
imports: ./openAiModelCompat
export function formatPlanningFailureMessage(raw: string): string
exports: formatPlanningFailureMessage

// src/utils/nodeErrorDiagnostics.test.ts
imports: vitest, @/store/workbenchStore
function msg(role: ChatMessage['role'], content: string): ChatMessage

// src/utils/nodeErrorDiagnostics.ts
imports: @/store/workbenchStore
function lastUserText(messages: ChatMessage[]): string
export function chatTailSuggestsNodeParseError(messages: ChatMessage[]): boolean
export function buildNodeParseErrorDiagnosticsBlock(): string
exports: chatTailSuggestsNodeParseError, buildNodeParseErrorDiagnosticsBlock

// src/utils/openAiModelCompat.ts
export function isOpenAiResponsesApiOnlyModel(modelId: string): boolean
constants: export OPENAI_CHAT_COMPLETIONS_HINT
exports: isOpenAiResponsesApiOnlyModel, OPENAI_CHAT_COMPLETIONS_HINT

// src/utils/planAnnouncementSanitize.ts
export function sanitizePlanUiText(text: string): string
export function sanitizePlanStepDescription(desc: string): string
exports: sanitizePlanUiText, sanitizePlanStepDescription

// src/utils/planExecutionUi.ts
imports: @/store/workbenchStore
export function planExecutionProgressSuffix(steps: PlanStep[]): string
exports: planExecutionProgressSuffix

// src/utils/plannerConversationMessages.ts
imports: @/store/workbenchStore, @/services/modelApi, @/services/chatTools
function clip(s: string, max: number): string
function assistantPlainText(m: ChatMessage): string

// src/utils/randomId.ts
export function randomUuid(): string
exports: randomUuid

// src/utils/shellSnippet.ts
export function normalizeShellSnippet(raw: string): string
exports: normalizeShellSnippet

// src/utils/terminalContextForAgent.ts
export function formatTerminalContextForAgent(lines: string[], maxChars = 6500): string
exports: formatTerminalContextForAgent

// src/utils/tokenEstimate.ts
imports: @/store/workbenchStore, @/config/modelContextDefaults, @/store/modelStore, @/services/modelApi
export function roughTokensFromText(text: string): number
export function roughTokensFromImageBase64(dataBase64: string): number
export function roughTokensFromMessageContent(content: ModelMessageContent): number
export function roughTokensFromRequestMessages(messages: ModelRequestMessage[]): number
export function contextLimitForModel(model: ModelConfig | undefined): number
constants: export CHAT_SYSTEM_PROMPTS
exports: roughTokensFromText, roughTokensFromImageBase64, roughTokensFromMessageContent, roughTokensFromRequestMessages, contextLimitForModel, CHAT_SYSTEM_PROMPTS

// src/App.tsx
imports: react, @tanstack/react-query, react-router-dom, @/components/ui/sonner, @/components/ui/toaster, @/components/ui/tooltip, ./pages/NotFound.tsx, ./pages/CodeScoutLanding.tsx, ./pages/CodeScoutDownload.tsx, ./pages/WorkbenchRoot.tsx, @/components/auth/LoginGate
interface ErrorBoundaryState
class RootErrorBoundary
function LoginGateLayout()
function AppInner()
const App = (...)
exports: default(App)

// src-tauri/src/lib.rs
imports: base64::Engine as _, serde::{Deserialize, Serialize}, std::path::Path, tauri_plugin_shell::ShellExt
pub struct FileEntry
pub struct HttpResponse
fn detect_lang(filename: &str) -> &'static
fn read_project_dir(path: String) -> Result<Vec<FileEntry>,
fn write_file(path: String, content: String) -> Result<(),
fn read_file_text(path: String) -> Result<String,
fn create_dir(path: String) -> Result<(),
fn get_user_shell() -> String
fn http_request(url: String) -> Result<HttpResponse,
fn ensure_playwright() -> Result<String,
fn browse_web(url: String, actions_json: Option<String>) -> Result<String,
pub fn run()
exports: FileEntry, HttpResponse, run

// src-tauri/src/main.rs
fn main()

// src-tauri/src/updater.rs
imports: serde::{Deserialize, Serialize}, std::path::PathBuf
pub struct UpdateManifest
pub struct UpdateCheckResult
fn is_newer(remote: &str, local: &str) -> bool
pub fn check_update(current_version: &str) -> Result<UpdateCheckResult,
pub fn download_and_install(download_url: &str) -> Result<String,
fn find_app_bundle(dir: &std::path::Path) -> Option<PathBuf>
exports: UpdateManifest, UpdateCheckResult, check_update, download_and_install

// src-tauri/build.rs
fn main()
fn compile_swift_sidecars()
fn needs_swift_rebuild(src: &str, out: &str) -> bool

// eslint.config.js
imports: @eslint/js, globals, eslint-plugin-react-hooks, eslint-plugin-react-refresh, typescript-eslint
exports: default(tseslint)

// playwright-fixture.ts
exports: test, expect

// playwright.config.ts
imports: lovable-agent-playwright-config/config
exports: default(createLovableConfig)

// vite.config.ts
imports: vite, @vitejs/plugin-react-swc, path, lovable-tagger
exports: default(defineConfig)

// vitest.config.ts
imports: vitest/config, @vitejs/plugin-react-swc, path
exports: default(defineConfig)