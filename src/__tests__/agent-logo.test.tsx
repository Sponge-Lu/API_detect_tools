import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentLogo } from '../renderer/components/AgentLogo';

describe('AgentLogo', () => {
  it.each([
    ['claudeCode', 'Claude Code', 'claudeCode'],
    ['codex-agent', 'Codex', 'codex'],
    ['dsh', 'DeepSeek Harness', 'deepseekHarness'],
    ['deepseek-harness', 'DSH', 'deepseekHarness'],
    ['openCode', 'OpenCode', 'openCode'],
    ['grokBuild', 'Grok Build', 'grokBuild'],
    ['pi-agent', 'Pi Coding Agent', 'pi'],
    ['zCodeAgent', 'Z Code', 'zcode'],
    ['amp-code', 'Amp', 'amp'],
    ['amazon-q-developer', 'Amazon Q Developer', 'amazonQ'],
    ['cline', 'Cline', 'cline'],
    ['tencent-codebuddy', 'CodeBuddy', 'codeBuddy'],
    ['continue-dev', 'Continue', 'continue'],
    ['cursor-agent', 'Cursor', 'cursor'],
    ['cognition-devin', 'Devin', 'devin'],
    ['google-gemini-cli', 'Gemini CLI', 'geminiCli'],
    ['github-copilot', 'GitHub Copilot', 'githubCopilot'],
    ['block-goose', 'Goose', 'goose'],
    ['kilo-code', 'Kilo Code', 'kiloCode'],
    ['kiro-cli', 'Kiro', 'kiro'],
    ['openclaw', 'OpenClaw', 'openClaw'],
    ['openhands', 'OpenHands', 'openHands'],
    ['open-devin', 'OpenHands legacy name', 'openHands'],
    ['qoder-cli', 'Qoder', 'qoder'],
    ['qwen-code', 'Qwen Code', 'qwenCode'],
    ['roo-code', 'Roo Code', 'rooCode'],
    ['roo-cline', 'Roo Code legacy name', 'rooCode'],
    ['trae-agent', 'Trae', 'trae'],
    ['codeium-windsurf', 'Windsurf', 'windsurf'],
  ])('resolves %s to the %s product logo', (agentId, agentName, logo) => {
    const { container } = render(<AgentLogo agentId={agentId} agentName={agentName} />);

    expect(container.querySelector(`[data-agent-logo="${logo}"]`)).toBeInTheDocument();
    expect(container.querySelector('img')).toHaveAttribute('src');
  });

  it('uses a gray placeholder for an unrecognized Agent', () => {
    render(<AgentLogo agentId="custom-runtime" agentName="Local Assistant" />);

    const logo = screen.getByTitle('未知 Agent');
    expect(logo).toHaveAttribute('data-agent-logo', 'unknown');
    expect(logo).toHaveClass('bg-[var(--surface-3)]', 'text-[var(--text-tertiary)]');
    expect(logo.querySelector('img')).not.toBeInTheDocument();
  });

  it('prefers a persisted logo override over automatic name matching', () => {
    render(<AgentLogo logoId="windsurf" agentName="Claude Code" />);

    expect(screen.getByTitle('Windsurf')).toHaveAttribute('data-agent-logo', 'windsurf');
    expect(screen.queryByTitle('Claude Code')).not.toBeInTheDocument();
  });
});
