import { Bot } from 'lucide-react';
import AmazonQIcon from '../assets/agent-icons/aws.svg';
import AmpIcon from '../assets/agent-icons/amp-color.svg';
import ClineIcon from '../assets/agent-icons/cline.svg';
import CodeBuddyIcon from '../assets/agent-icons/codebuddy-color.svg';
import ContinueIcon from '../assets/agent-icons/continue.png';
import CursorIcon from '../assets/agent-icons/cursor.svg';
import DeepSeekHarnessIcon from '../assets/agent-icons/deepseek.svg';
import DevinIcon from '../assets/agent-icons/devin-color.svg';
import GeminiCliIcon from '../assets/agent-icons/geminicli-color.svg';
import GithubCopilotIcon from '../assets/agent-icons/githubcopilot.svg';
import GooseIcon from '../assets/agent-icons/goose.svg';
import KiloCodeIcon from '../assets/agent-icons/kilocode.svg';
import KiroIcon from '../assets/agent-icons/kiro-color.svg';
import OpenClawIcon from '../assets/agent-icons/openclaw-color.svg';
import OpenHandsIcon from '../assets/agent-icons/openhands-color.svg';
import QoderIcon from '../assets/agent-icons/qoder-color.svg';
import QwenCodeIcon from '../assets/agent-icons/qwen-color.svg';
import RooCodeIcon from '../assets/agent-icons/roocode.svg';
import TraeIcon from '../assets/agent-icons/trae-color.svg';
import WindsurfIcon from '../assets/agent-icons/windsurf.svg';
import ClaudeCodeIcon from '../assets/cli-icons/claude-code.svg';
import CodexIcon from '../assets/cli-icons/codex.svg';
import GrokIcon from '../assets/cli-icons/grok.svg';
import OpenCodeIcon from '../assets/cli-icons/opencode.svg';
import PiIcon from '../assets/cli-icons/pi.svg';
import ZCodeIcon from '../assets/cli-icons/zcode.svg';
import { AGENT_LOGO_IDS, type AgentLogoId } from '../../shared/types/config-file-profile';

interface AgentLogoProps {
  logoId?: AgentLogoId | null;
  agentId?: string | null;
  agentName?: string | null;
  className?: string;
}

const AGENT_LOGOS = {
  claudeCode: { label: 'Claude Code', src: ClaudeCodeIcon },
  codex: { label: 'Codex', src: CodexIcon },
  deepseekHarness: { label: 'DeepSeek Harness (DSH)', src: DeepSeekHarnessIcon },
  openCode: { label: 'OpenCode', src: OpenCodeIcon },
  grokBuild: { label: 'Grok Build', src: GrokIcon },
  pi: { label: 'Pi', src: PiIcon },
  zcode: { label: 'ZCode', src: ZCodeIcon },
  amp: { label: 'Amp', src: AmpIcon },
  amazonQ: { label: 'Amazon Q Developer', src: AmazonQIcon, darkInvert: true },
  cline: { label: 'Cline', src: ClineIcon, darkInvert: true },
  codeBuddy: { label: 'CodeBuddy', src: CodeBuddyIcon },
  continue: { label: 'Continue', src: ContinueIcon },
  cursor: { label: 'Cursor', src: CursorIcon, darkInvert: true },
  devin: { label: 'Devin', src: DevinIcon },
  geminiCli: { label: 'Gemini CLI', src: GeminiCliIcon },
  githubCopilot: { label: 'GitHub Copilot', src: GithubCopilotIcon, darkInvert: true },
  goose: { label: 'Goose', src: GooseIcon, darkInvert: true },
  kiloCode: { label: 'Kilo Code', src: KiloCodeIcon, darkInvert: true },
  kiro: { label: 'Kiro', src: KiroIcon },
  openClaw: { label: 'OpenClaw', src: OpenClawIcon },
  openHands: { label: 'OpenHands', src: OpenHandsIcon },
  qoder: { label: 'Qoder', src: QoderIcon, darkInvert: true },
  qwenCode: { label: 'Qwen Code', src: QwenCodeIcon },
  rooCode: { label: 'Roo Code', src: RooCodeIcon, darkInvert: true },
  trae: { label: 'Trae', src: TraeIcon },
  windsurf: { label: 'Windsurf', src: WindsurfIcon, darkInvert: true },
} as const satisfies Record<AgentLogoId, { label: string; src: string; darkInvert?: boolean }>;

type KnownAgent = AgentLogoId;

const AGENT_ALIASES: Record<KnownAgent, readonly string[]> = {
  claudeCode: ['claudecode', 'anthropicclaude'],
  codex: ['codex', 'codexcli', 'openaicodex'],
  deepseekHarness: ['deepseekharness', 'deepseek', 'dsh'],
  openCode: ['opencode', 'opencodeagent'],
  grokBuild: ['grok', 'grokbuild'],
  pi: ['pi', 'piagent', 'picodingagent'],
  zcode: ['zai', 'zcode', 'zcodeagent'],
  amp: ['amp', 'ampcode'],
  amazonQ: ['amazonq', 'amazonqdeveloper', 'awsqdeveloper'],
  cline: ['cline'],
  codeBuddy: ['codebuddy', 'tencentcodebuddy'],
  continue: ['continue', 'continuedev'],
  cursor: ['cursor', 'cursoragent'],
  devin: ['devin', 'cognitiondevin'],
  geminiCli: ['geminicli', 'googlegeminicli'],
  githubCopilot: ['githubcopilot', 'copilotcli'],
  goose: ['goose', 'goosecli', 'blockgoose'],
  kiloCode: ['kilocode', 'kilocodeagent'],
  kiro: ['kiro', 'kirocli'],
  openClaw: ['openclaw'],
  openHands: ['openhands', 'opendevin'],
  qoder: ['qoder', 'qodercli'],
  qwenCode: ['qwen', 'qwencode', 'qwencli'],
  rooCode: ['roo', 'roocode', 'roocline'],
  trae: ['trae', 'traeagent'],
  windsurf: ['windsurf', 'codeiumwindsurf'],
};

function compactIdentity(value: string): string {
  const separated = value.replace(/([a-z\d])([A-Z])/g, '$1 $2').toLowerCase();
  const words = separated.split(/[^a-z\d]+/).filter(Boolean);
  return words.join('');
}

export const AGENT_LOGO_OPTIONS = AGENT_LOGO_IDS.map(id => ({
  id,
  label: AGENT_LOGOS[id].label,
}));

export function resolveAgentLogoId(
  agentId?: string | null,
  agentName?: string | null
): AgentLogoId | null {
  for (const value of [agentId, agentName]) {
    if (!value?.trim()) continue;
    const compact = compactIdentity(value.trim());
    const knownAgents = Object.keys(AGENT_ALIASES) as KnownAgent[];
    const exactMatch = knownAgents.find(agent => AGENT_ALIASES[agent].includes(compact));
    if (exactMatch) return exactMatch;

    const partialMatch = knownAgents.find(agent =>
      AGENT_ALIASES[agent].some(alias => alias.length >= 4 && compact.includes(alias))
    );
    if (partialMatch) return partialMatch;
  }

  return null;
}

export function AgentLogo({ logoId, agentId, agentName, className = 'h-4 w-4' }: AgentLogoProps) {
  const knownAgent = logoId || resolveAgentLogoId(agentId, agentName);

  if (!knownAgent) {
    return (
      <span
        data-agent-logo="unknown"
        className={`inline-flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface-3)] p-0.5 text-[var(--text-tertiary)] ${className}`}
        title="未知 Agent"
      >
        <Bot className="h-full w-full" aria-hidden="true" />
      </span>
    );
  }

  const logo = AGENT_LOGOS[knownAgent];
  return (
    <span
      data-agent-logo={knownAgent}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] ${className}`}
      title={logo.label}
    >
      <img
        src={logo.src}
        alt=""
        className={`h-full w-full object-contain ${'darkInvert' in logo ? 'dark:invert' : ''}`}
        aria-hidden="true"
      />
    </span>
  );
}

export function AgentLogoSelect({
  value,
  agentId,
  agentName,
  onChange,
  ariaLabel = '客户端 Logo',
}: {
  value?: AgentLogoId;
  agentId?: string | null;
  agentName?: string | null;
  onChange: (value: AgentLogoId | undefined) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <AgentLogo logoId={value} agentId={agentId} agentName={agentName} className="h-7 w-7" />
      <select
        aria-label={ariaLabel}
        value={value || ''}
        onChange={event => onChange((event.target.value || undefined) as AgentLogoId | undefined)}
        className="h-9 min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 text-xs text-[var(--text-primary)]"
      >
        <option value="">自动匹配</option>
        {AGENT_LOGO_OPTIONS.map(option => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
